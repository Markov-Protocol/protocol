import type {
  CatalogPrice,
  EligibilityOutcome,
  InstrumentActionAvailability,
  InstrumentAvailability,
  InstrumentLifecycle,
  InstrumentStatus,
  Issuer,
} from '@markov/contracts';
import type { EligibilityStanding } from './eligibility.js';

export interface CapabilityInstrument {
  readonly instrumentId: string;
  readonly issuer: Issuer;
  readonly status: InstrumentStatus;
  readonly availability: InstrumentAvailability;
  readonly lifecycle: InstrumentLifecycle;
  readonly referencePrice: CatalogPrice | null;
  /** True when the mint carries the NonTransferable extension. */
  readonly nonTransferable: boolean;
}

export interface CapabilityEligibility {
  readonly outcome: EligibilityOutcome;
  readonly issuers: readonly Issuer[];
  readonly standing: EligibilityStanding;
}

export interface CapabilityInput {
  readonly instrument: CapabilityInstrument;
  readonly eligibility: CapabilityEligibility | null;
  readonly termsComplete: boolean;
  readonly executionWritesEnabled: boolean;
  readonly venueEnabled: boolean;
  readonly policyVersion: string | null;
  readonly now: Date;
}

/**
 * Capability states for one person and one instrument. Each state is a
 * separate fact with its own conditions; a discoverable token is never
 * automatically tradable, and nothing here is a legal opinion.
 */
export function capabilityStatesFor(input: CapabilityInput): InstrumentActionAvailability {
  const { instrument } = input;
  const conditions: InstrumentActionAvailability['conditions'] = [];
  const reasons: string[] = [];
  const discoverable = instrument.status === 'admitted' || instrument.status === 'paused';
  const researchable = instrument.availability.research;
  let quoteable = instrument.status === 'admitted';
  if (!discoverable) {
    conditions.push('instrument_not_admitted');
    reasons.push(`instrument is ${instrument.status}`);
  }
  if (instrument.lifecycle.halted) {
    quoteable = false;
    conditions.push('issuer_halted');
    reasons.push(instrument.lifecycle.haltedReason ?? 'the issuer halted this instrument');
  }
  if (instrument.lifecycle.migration) {
    quoteable = false;
    conditions.push('migration_required');
    reasons.push(
      `migrate to ${instrument.lifecycle.migration.targetProductId} before ${instrument.lifecycle.migration.deadlineAt}`,
    );
  }
  if (
    instrument.lifecycle.sunsetAt &&
    new Date(instrument.lifecycle.sunsetAt).getTime() <= input.now.getTime()
  ) {
    quoteable = false;
    conditions.push('instrument_sunset');
    reasons.push(`the product sunset on ${instrument.lifecycle.sunsetAt}`);
  }
  if (
    instrument.lifecycle.pendingActions.some(
      (action) => new Date(action.effectiveAt).getTime() <= input.now.getTime(),
    )
  ) {
    quoteable = false;
    conditions.push('corporate_action_pending');
    reasons.push('an effective corporate action has not been applied yet');
  }
  if (instrument.lifecycle.currentMultiplier === null) {
    quoteable = false;
    conditions.push('multiplier_unknown');
    reasons.push('no multiplier evidence covers now');
  }
  if (instrument.referencePrice?.stale) {
    conditions.push('stale_reference');
    reasons.push(
      `the reference price was observed at ${instrument.referencePrice.observedAt} and is stale`,
    );
  }
  if (!input.venueEnabled) {
    quoteable = false;
    conditions.push('venue_disabled');
    reasons.push('no execution venue is enabled');
  }
  let tradable = quoteable;
  const eligibility = input.eligibility;
  if (
    eligibility === null ||
    eligibility.standing !== 'in_force' ||
    eligibility.outcome === 'unknown'
  ) {
    tradable = false;
    conditions.push('eligibility_unknown');
    reasons.push(
      eligibility === null || eligibility.standing === 'missing'
        ? 'eligibility has not been decided'
        : eligibility.standing === 'in_force'
          ? 'eligibility is unknown pending review or stronger evidence'
          : eligibility.standing === 'superseded'
            ? 'the eligibility decision predates the active policy version'
            : `the eligibility decision ${eligibility.standing === 'revoked' ? 'was revoked' : 'expired'}`,
    );
  } else if (
    eligibility.outcome === 'ineligible' ||
    !eligibility.issuers.includes(instrument.issuer)
  ) {
    tradable = false;
    conditions.push('eligibility_denied');
    reasons.push(
      eligibility.outcome === 'ineligible'
        ? 'the person is not eligible to trade'
        : `eligibility does not cover issuer ${instrument.issuer}`,
    );
  }
  if (!input.termsComplete) {
    tradable = false;
    conditions.push('terms_not_acknowledged');
    reasons.push('the current terms have not been acknowledged');
  }
  if (!input.executionWritesEnabled) {
    tradable = false;
    conditions.push('execution_disabled');
    reasons.push('execution writes are disabled by configuration');
  }
  return {
    instrumentId: instrument.instrumentId,
    capabilities: {
      discoverable,
      researchable,
      quoteable,
      buyable: tradable,
      sellable: tradable,
      redeemable: false,
      transferable: !instrument.nonTransferable,
    },
    conditions,
    reasons,
    evaluatedAt: input.now.toISOString(),
    policyVersion: input.policyVersion,
  };
}
