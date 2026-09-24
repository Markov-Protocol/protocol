import { Decimal } from '@markov/amounts';
import type {
  CorporateActionDetails,
  CorporateActionFeed,
  CorporateActionFeedEvent,
  CorporateActionIngestionReport,
  CorporateActionStatus,
  CorporateActionType,
  Issuer,
} from '@markov/contracts';
import { corporateActionFeedSchema } from '@markov/contracts';
import { sanitizeText } from './feed.js';

export interface NormalizedCorporateAction {
  readonly externalId: string;
  readonly productId: string;
  readonly type: CorporateActionType;
  readonly announcedAt: string;
  readonly effectiveAt: string;
  readonly summary: string;
  readonly details: CorporateActionDetails;
  readonly fingerprint: string;
}

export type CorporateActionNormalizeOutcome =
  | { readonly ok: true; readonly event: NormalizedCorporateAction }
  | {
      readonly ok: false;
      readonly externalId: string;
      readonly productId: string;
      readonly reasons: string[];
    };

const DECIMAL = /^\d+(\.\d+)?$/;

function positiveDecimal(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed) || Decimal.fromString(trimmed).isZero()) {
    return null;
  }
  return Decimal.fromString(trimmed).toString();
}

function safeReference(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString().slice(0, 500)
      : null;
  } catch {
    return null;
  }
}

/** Validate one feed event; type-specific fields are required and everything else is dropped. */
export function normalizeCorporateAction(
  raw: CorporateActionFeedEvent,
): CorporateActionNormalizeOutcome {
  const reasons: string[] = [];
  const externalId = sanitizeText(raw.eventId, 100);
  const productId = sanitizeText(raw.productId, 100);
  const summary = sanitizeText(raw.summary, 2000);
  if (externalId.length === 0) {
    reasons.push('missing eventId');
  }
  if (productId.length === 0) {
    reasons.push('missing productId');
  }
  if (summary.length === 0) {
    reasons.push('missing summary');
  }
  const announced = new Date(raw.announcedAt);
  const effective = new Date(raw.effectiveAt);
  if (effective.getTime() < announced.getTime()) {
    reasons.push('effectiveAt is before announcedAt');
  }
  const details: CorporateActionDetails = {
    ratio: null,
    newMultiplier: null,
    distribution: null,
    migration: null,
    sunsetAt: null,
    reference: safeReference(raw.reference),
  };
  const mutable = details as {
    -readonly [K in keyof CorporateActionDetails]: CorporateActionDetails[K];
  };
  switch (raw.type) {
    case 'split':
    case 'reverse_split': {
      const ratio = raw.ratio;
      if (
        !ratio ||
        !Number.isInteger(ratio.numerator) ||
        !Number.isInteger(ratio.denominator) ||
        ratio.numerator <= 0 ||
        ratio.denominator <= 0
      ) {
        reasons.push(`${raw.type} needs a positive integer ratio`);
      } else if (raw.type === 'split' && ratio.numerator <= ratio.denominator) {
        reasons.push('a split must increase the unit count (numerator greater than denominator)');
      } else if (raw.type === 'reverse_split' && ratio.numerator >= ratio.denominator) {
        reasons.push(
          'a reverse split must decrease the unit count (numerator less than denominator)',
        );
      } else {
        mutable.ratio = { numerator: ratio.numerator, denominator: ratio.denominator };
      }
      break;
    }
    case 'multiplier_change': {
      const multiplier = positiveDecimal(raw.newMultiplier);
      if (multiplier === null) {
        reasons.push('multiplier_change needs a positive decimal newMultiplier');
      } else {
        mutable.newMultiplier = multiplier;
      }
      break;
    }
    case 'distribution': {
      const amount = positiveDecimal(raw.distribution?.amountPerToken);
      const unit = raw.distribution ? sanitizeText(raw.distribution.unit, 20).toUpperCase() : '';
      if (amount === null || unit.length === 0) {
        reasons.push('distribution needs a positive amountPerToken and a unit');
      } else {
        mutable.distribution = { amountPerToken: amount, unit };
      }
      break;
    }
    case 'migration': {
      const target = raw.migration ? sanitizeText(raw.migration.targetProductId, 100) : '';
      if (!raw.migration || target.length === 0) {
        reasons.push('migration needs a targetProductId and a deadlineAt');
      } else if (new Date(raw.migration.deadlineAt).getTime() < effective.getTime()) {
        reasons.push('migration deadline is before effectiveAt');
      } else {
        mutable.migration = {
          targetProductId: target,
          deadlineAt: new Date(raw.migration.deadlineAt).toISOString(),
        };
      }
      break;
    }
    case 'sunset': {
      if (!raw.sunsetAt) {
        reasons.push('sunset needs a sunsetAt');
      } else if (new Date(raw.sunsetAt).getTime() < effective.getTime()) {
        reasons.push('sunsetAt is before effectiveAt');
      } else {
        mutable.sunsetAt = new Date(raw.sunsetAt).toISOString();
      }
      break;
    }
    case 'halt':
    case 'resume':
      break;
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      externalId: externalId || raw.eventId.slice(0, 100),
      productId: productId || raw.productId.slice(0, 100),
      reasons,
    };
  }
  const event = {
    externalId,
    productId,
    type: raw.type,
    announcedAt: announced.toISOString(),
    effectiveAt: effective.toISOString(),
    summary,
    details,
  };
  return { ok: true, event: { ...event, fingerprint: JSON.stringify(event) } };
}

export type CorporateActionFeedParseOutcome =
  | { readonly ok: true; readonly feed: CorporateActionFeed }
  | { readonly ok: false; readonly reason: string };

export function parseCorporateActionFeed(
  payload: unknown,
  expectedIssuer: Issuer,
): CorporateActionFeedParseOutcome {
  const parsed = corporateActionFeedSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    return {
      ok: false,
      reason: `corporate action feed does not match schema 1: ${issues.join('; ')}`,
    };
  }
  if (parsed.data.issuer !== expectedIssuer) {
    return {
      ok: false,
      reason: `feed issuer ${parsed.data.issuer} does not match ${expectedIssuer}`,
    };
  }
  return { ok: true, feed: parsed.data };
}

export interface ExistingCorporateAction {
  readonly actionId: string;
  readonly externalId: string;
  readonly status: CorporateActionStatus;
  readonly fingerprint: string;
}

export type CorporateActionWrite =
  | {
      readonly kind: 'insert';
      readonly instrumentId: string;
      readonly event: NormalizedCorporateAction;
    }
  | {
      readonly kind: 'update';
      readonly actionId: string;
      readonly event: NormalizedCorporateAction;
    };

export interface CorporateActionPlan {
  readonly writes: CorporateActionWrite[];
  readonly events: CorporateActionIngestionReport['events'];
  readonly counts: CorporateActionIngestionReport['counts'];
}

/**
 * Plan corporate-action writes: events for unknown products are reported as
 * unmatched (never invented as instruments), duplicates within a feed are
 * rejected, identical pending events are unchanged, changed pending events
 * are updated, and applied or rejected events are never rewritten by a feed.
 */
export function planCorporateActions(
  existing: readonly ExistingCorporateAction[],
  instrumentIdByProduct: ReadonlyMap<string, string>,
  feedEvents: readonly CorporateActionFeedEvent[],
): CorporateActionPlan {
  const byExternalId = new Map(existing.map((item) => [item.externalId, item]));
  const writes: CorporateActionWrite[] = [];
  const events: CorporateActionIngestionReport['events'] = [];
  const counts = { inserted: 0, updated: 0, unchanged: 0, rejected: 0, unmatched: 0 };
  const seen = new Set<string>();
  const record = (
    externalId: string,
    productId: string,
    outcome: keyof typeof counts,
    reasons: string[],
  ) => {
    events.push({ externalId, productId, outcome, reasons });
    counts[outcome] += 1;
  };
  for (const raw of feedEvents) {
    const normalized = normalizeCorporateAction(raw);
    const externalId = normalized.ok ? normalized.event.externalId : normalized.externalId;
    const productId = normalized.ok ? normalized.event.productId : normalized.productId;
    if (seen.has(externalId)) {
      record(externalId, productId, 'rejected', ['duplicate eventId in feed']);
      continue;
    }
    seen.add(externalId);
    if (!normalized.ok) {
      record(externalId, productId, 'rejected', normalized.reasons);
      continue;
    }
    const instrumentId = instrumentIdByProduct.get(productId);
    if (instrumentId === undefined) {
      record(externalId, productId, 'unmatched', [
        'no instrument for this productId; events never create instruments',
      ]);
      continue;
    }
    const current = byExternalId.get(externalId);
    if (!current) {
      writes.push({ kind: 'insert', instrumentId, event: normalized.event });
      record(externalId, productId, 'inserted', []);
      continue;
    }
    if (current.status !== 'pending') {
      record(externalId, productId, 'unchanged', [
        `already ${current.status}; feeds never rewrite it`,
      ]);
      continue;
    }
    if (current.fingerprint === normalized.event.fingerprint) {
      record(externalId, productId, 'unchanged', []);
      continue;
    }
    writes.push({ kind: 'update', actionId: current.actionId, event: normalized.event });
    record(externalId, productId, 'updated', ['pending event changed upstream']);
  }
  return { writes, events, counts };
}

/**
 * The multiplier an applied action produces from the one in force. Splits
 * scale the display quantity by numerator/denominator; a multiplier change
 * sets it explicitly; other actions leave it unchanged (null).
 */
export function multiplierAfterAction(
  action: { readonly type: CorporateActionType; readonly details: CorporateActionDetails },
  currentMultiplier: string,
): string | null {
  if (action.type === 'multiplier_change') {
    return action.details.newMultiplier;
  }
  if ((action.type === 'split' || action.type === 'reverse_split') && action.details.ratio) {
    const current = Decimal.fromString(currentMultiplier);
    const scaled = current.multiply(Decimal.fromBigInt(BigInt(action.details.ratio.numerator)));
    return scaled
      .divideByInteger(BigInt(action.details.ratio.denominator), 18, 'half_even')
      .toString();
  }
  return null;
}
