import type {
  ExposureSnapshot,
  InstrumentLifecycle,
  InstrumentStatus,
  Issuer,
  OwnerLimits,
  PolicyDenial,
  PolicyDenialCode,
} from '@markov/contracts';
import { companyKey } from '@markov/contracts';
import { eligibilityStanding } from './eligibility.js';

export interface PolicyInstrument {
  readonly instrumentId: string;
  readonly issuer: Issuer;
  /** Normalised company name; two issuers' tokens for one company share exposure. */
  readonly companyKey: string;
  readonly status: InstrumentStatus;
  readonly lifecycle: InstrumentLifecycle;
  readonly referencePriceStale: boolean | null;
}

export interface PolicyPosition {
  readonly instrumentId: string;
  readonly issuer: Issuer;
  readonly companyKey: string;
  readonly notionalUsdcRaw: string;
}

export interface PolicyEligibility {
  readonly decisionId: string;
  readonly outcome: 'eligible' | 'ineligible' | 'unknown';
  readonly issuers: readonly Issuer[];
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly policyVersion: string | null;
}

export interface PolicyInput {
  readonly now: Date;
  readonly stage: 'quote' | 'submit';
  readonly side: 'buy' | 'sell';
  readonly instrument: PolicyInstrument;
  readonly notionalUsdcRaw: string;
  readonly venue: string;
  readonly slippageBps: number;
  readonly quoteObservedAt: Date | null;
  readonly exposure: ExposureSnapshot;
  /** Positions with instrument identity resolved by the caller (issuer and company). */
  readonly positions: readonly PolicyPosition[];
  readonly limits: OwnerLimits;
  readonly eligibility: PolicyEligibility | null;
  /** Version of the rule set active now; a decision under another version is superseded. */
  readonly activePolicyVersion: string | null;
  readonly termsComplete: boolean;
  readonly executionWritesEnabled: boolean;
  /** The venue adapter is verified and enabled; only the submit stage depends on it. */
  readonly venueEnabled: boolean;
  readonly participantAllowlisted: boolean;
  /** Raw USDC already used today and held against the account, excluding this intent. */
  readonly dailyUsedUsdcRaw: string;
  readonly reservedUsdcRaw: string;
}

export interface PolicyEvaluation {
  readonly outcome: 'allow' | 'deny';
  readonly denials: PolicyDenial[];
  readonly budget: {
    readonly dailyUsedUsdcRaw: string;
    readonly dailyRemainingUsdcRaw: string;
    readonly accountUsedUsdcRaw: string;
    readonly accountRemainingUsdcRaw: string;
  };
  readonly expiresAt: Date;
}

/** Decisions never outlive this many seconds even when nothing else expires sooner. */
export const DECISION_TTL_SECONDS = 60;
const BPS = 10_000n;

function denial(
  code: PolicyDenialCode,
  message: string,
  limit: string | null = null,
  observed: string | null = null,
  unit: string | null = null,
): PolicyDenial {
  return { code, message, limit, observed, unit };
}

function bpsOf(part: bigint, total: bigint): bigint {
  return total === 0n ? 0n : (part * BPS) / total;
}

function clampZero(value: bigint): string {
  return (value < 0n ? 0n : value).toString();
}

/**
 * Deterministic policy evaluation. Every check runs and every failure is
 * reported with its limit and observed value, so a person sees exactly
 * what to change. Integer base units only; no floating point.
 */
export function evaluatePolicy(input: PolicyInput): PolicyEvaluation {
  const denials: PolicyDenial[] = [];
  const notional = BigInt(input.notionalUsdcRaw);
  const { limits, instrument } = input;
  const now = input.now.getTime();

  if (notional === 0n) {
    denials.push(
      denial('NOTIONAL_ZERO', 'the notional must be greater than zero', null, '0', 'USDC raw'),
    );
  }
  if (input.stage === 'submit' && !input.executionWritesEnabled) {
    denials.push(
      denial(
        'EXECUTION_DISABLED',
        'execution writes are disabled by configuration; nothing can be submitted',
      ),
    );
  }
  if (input.stage === 'submit' && !input.venueEnabled) {
    denials.push(
      denial('VENUE_DISABLED', `venue ${input.venue} is not verified and enabled on this platform`),
    );
  }
  if (!input.participantAllowlisted) {
    denials.push(
      denial(
        'PARTICIPANT_NOT_ALLOWLISTED',
        'the beta participant allowlist is enabled and this account is not on it',
      ),
    );
  }

  const eligibility = input.eligibility;
  const standing = eligibilityStanding(eligibility, input.activePolicyVersion, input.now);
  if (eligibility === null || standing === 'missing') {
    denials.push(
      denial(
        'ELIGIBILITY_UNKNOWN',
        'eligibility has not been decided; declare a jurisdiction first',
      ),
    );
  } else if (standing === 'revoked' || standing === 'expired') {
    denials.push(
      denial(
        'ELIGIBILITY_EXPIRED',
        standing === 'revoked'
          ? 'the eligibility decision was revoked'
          : 'the eligibility decision expired; declare again',
      ),
    );
  } else if (standing === 'superseded') {
    denials.push(
      denial(
        'ELIGIBILITY_SUPERSEDED',
        `the eligibility decision was made under policy ${eligibility.policyVersion ?? 'none'}; policy ${input.activePolicyVersion ?? 'none'} is active now, declare again`,
      ),
    );
  } else if (eligibility.outcome === 'unknown') {
    denials.push(
      denial(
        'ELIGIBILITY_UNKNOWN',
        'eligibility is unknown; the declaration is awaiting review or stronger evidence',
      ),
    );
  } else if (eligibility.outcome === 'ineligible') {
    denials.push(denial('ELIGIBILITY_DENIED', 'the person is not eligible to trade stocks'));
  } else if (!eligibility.issuers.includes(instrument.issuer)) {
    denials.push(
      denial('ISSUER_NOT_COVERED', `eligibility does not cover issuer ${instrument.issuer}`),
    );
  }
  if (!input.termsComplete) {
    denials.push(denial('TERMS_NOT_ACKNOWLEDGED', 'the current terms have not been acknowledged'));
  }

  if (instrument.status !== 'admitted') {
    denials.push(denial('INSTRUMENT_NOT_ADMITTED', `instrument is ${instrument.status}`));
  }
  if (instrument.lifecycle.halted) {
    denials.push(
      denial(
        'ISSUER_HALTED',
        instrument.lifecycle.haltedReason ?? 'the issuer halted this instrument',
      ),
    );
  }
  if (
    instrument.lifecycle.pendingActions.some(
      (action) => new Date(action.effectiveAt).getTime() <= now,
    )
  ) {
    denials.push(
      denial('CORPORATE_ACTION_PENDING', 'an effective corporate action has not been applied yet'),
    );
  }
  if (instrument.lifecycle.migration) {
    denials.push(
      denial(
        'MIGRATION_REQUIRED',
        `migrate to ${instrument.lifecycle.migration.targetProductId} first`,
      ),
    );
  }
  if (instrument.lifecycle.sunsetAt && new Date(instrument.lifecycle.sunsetAt).getTime() <= now) {
    denials.push(denial('INSTRUMENT_SUNSET', 'the product sunset; no new positions'));
  }
  if (instrument.lifecycle.currentMultiplier === null) {
    denials.push(
      denial(
        'MULTIPLIER_UNKNOWN',
        'no multiplier evidence covers now; quantities cannot be trusted',
      ),
    );
  }
  if (instrument.referencePriceStale === true) {
    denials.push(
      denial(
        'REFERENCE_STALE',
        'the reference price is stale; data quality is insufficient for a decision',
      ),
    );
  }

  if (!limits.allowedVenues.includes(input.venue as OwnerLimits['allowedVenues'][number])) {
    denials.push(
      denial(
        'VENUE_NOT_ALLOWED',
        `venue ${input.venue} is not allowed`,
        limits.allowedVenues.join(','),
        input.venue,
        'venue',
      ),
    );
  }
  if (input.slippageBps > limits.maxSlippageBps) {
    denials.push(
      denial(
        'SLIPPAGE_LIMIT_EXCEEDED',
        'the slippage tolerance exceeds the limit',
        String(limits.maxSlippageBps),
        String(input.slippageBps),
        'bps',
      ),
    );
  }
  if (input.quoteObservedAt !== null) {
    const ageSeconds = Math.floor((now - input.quoteObservedAt.getTime()) / 1000);
    if (ageSeconds > limits.maxQuoteAgeSeconds) {
      denials.push(
        denial(
          'QUOTE_STALE',
          'the quote is older than the allowed age',
          String(limits.maxQuoteAgeSeconds),
          String(ageSeconds),
          'seconds',
        ),
      );
    }
  }

  const orderCap = BigInt(limits.maxOrderNotionalUsdcRaw);
  if (notional > orderCap) {
    denials.push(
      denial(
        'ORDER_CAP_EXCEEDED',
        'the order exceeds the per-order cap',
        limits.maxOrderNotionalUsdcRaw,
        input.notionalUsdcRaw,
        'USDC raw',
      ),
    );
  }
  const dailyUsed = BigInt(input.dailyUsedUsdcRaw);
  const dailyCap = BigInt(limits.maxDailyNotionalUsdcRaw);
  if (dailyUsed + notional > dailyCap) {
    denials.push(
      denial(
        'DAILY_CAP_EXCEEDED',
        'today’s turnover including pending reservations would exceed the daily cap',
        limits.maxDailyNotionalUsdcRaw,
        (dailyUsed + notional).toString(),
        'USDC raw',
      ),
    );
  }
  const positionsTotal = input.positions.reduce(
    (sum, position) => sum + BigInt(position.notionalUsdcRaw),
    0n,
  );
  const reserved = BigInt(input.reservedUsdcRaw);
  const accountUsed = positionsTotal + reserved;
  const accountCap = BigInt(limits.maxAccountNotionalUsdcRaw);
  if (input.side === 'buy' && accountUsed + notional > accountCap) {
    denials.push(
      denial(
        'ACCOUNT_CAP_EXCEEDED',
        'holdings plus pending reservations would exceed the account cap',
        limits.maxAccountNotionalUsdcRaw,
        (accountUsed + notional).toString(),
        'USDC raw',
      ),
    );
  }

  const exposureKnown = input.exposure.source !== 'none';
  if (input.stage === 'submit' && !exposureKnown) {
    denials.push(
      denial(
        'EXPOSURE_UNKNOWN',
        'holdings and cash were not declared; concentration and reserve checks need them before submission',
      ),
    );
  }
  if (input.side === 'buy' && exposureKnown) {
    const cash = input.exposure.cashUsdcRaw === null ? null : BigInt(input.exposure.cashUsdcRaw);
    const totalAfter = positionsTotal + notional + (cash === null ? 0n : cash);
    const issuerExposure =
      input.positions
        .filter((position) => position.issuer === instrument.issuer)
        .reduce((sum, position) => sum + BigInt(position.notionalUsdcRaw), 0n) + notional;
    const issuerBps = bpsOf(issuerExposure, totalAfter);
    if (issuerBps > BigInt(limits.maxIssuerConcentrationBps)) {
      denials.push(
        denial(
          'ISSUER_CONCENTRATION_EXCEEDED',
          `exposure to issuer ${instrument.issuer} would exceed the concentration limit`,
          String(limits.maxIssuerConcentrationBps),
          issuerBps.toString(),
          'bps',
        ),
      );
    }
    const companyExposure =
      input.positions
        .filter((position) => position.companyKey === instrument.companyKey)
        .reduce((sum, position) => sum + BigInt(position.notionalUsdcRaw), 0n) + notional;
    const companyBps = bpsOf(companyExposure, totalAfter);
    if (companyBps > BigInt(limits.maxCompanyConcentrationBps)) {
      denials.push(
        denial(
          'COMPANY_CONCENTRATION_EXCEEDED',
          'exposure to the underlying company across issuers would exceed the concentration limit',
          String(limits.maxCompanyConcentrationBps),
          companyBps.toString(),
          'bps',
        ),
      );
    }
    if (cash !== null) {
      const cashAfter = cash - notional;
      const reserve = (totalAfter * BigInt(limits.cashReserveBps)) / BPS;
      if (cashAfter < 0n) {
        denials.push(
          denial(
            'CASH_RESERVE_BREACHED',
            'the declared cash does not cover the order',
            cash.toString(),
            input.notionalUsdcRaw,
            'USDC raw',
          ),
        );
      } else if (cashAfter < reserve) {
        denials.push(
          denial(
            'CASH_RESERVE_BREACHED',
            'the order would break the cash reserve',
            reserve.toString(),
            cashAfter.toString(),
            'USDC raw',
          ),
        );
      }
    }
  }

  const outcome = denials.length === 0 ? 'allow' : 'deny';
  const dailyAfter = outcome === 'allow' ? dailyUsed + notional : dailyUsed;
  const accountAfter =
    outcome === 'allow' && input.side === 'buy' ? accountUsed + notional : accountUsed;
  let expires = now + DECISION_TTL_SECONDS * 1000;
  if (eligibility !== null) {
    expires = Math.min(expires, new Date(eligibility.expiresAt).getTime());
  }
  if (input.quoteObservedAt !== null) {
    expires = Math.min(expires, input.quoteObservedAt.getTime() + limits.maxQuoteAgeSeconds * 1000);
  }
  return {
    outcome,
    denials,
    budget: {
      dailyUsedUsdcRaw: dailyAfter.toString(),
      dailyRemainingUsdcRaw: clampZero(dailyCap - dailyAfter),
      accountUsedUsdcRaw: accountAfter.toString(),
      accountRemainingUsdcRaw: clampZero(accountCap - accountAfter),
    },
    expiresAt: new Date(Math.max(expires, now)),
  };
}

/** Company identity for concentration: the shared contracts rule (`companyKey`). */
export function companyKeyOf(companyName: string): string {
  return companyKey(companyName);
}
