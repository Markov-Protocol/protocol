import type {
  CorporateActionType,
  InstrumentAvailability,
  InstrumentLifecycle,
  InstrumentStatus,
} from '@markov/contracts';
import { type MultiplierPoint, multiplierAsOf } from './multipliers.js';

export interface LifecycleInputs {
  readonly haltedAt: string | null;
  readonly haltedReason: string | null;
  /** Latest on-chain verification saw the mint paused. */
  readonly onChainPaused: boolean;
  readonly migration: {
    readonly targetProductId: string;
    readonly targetInstrumentId: string | null;
    readonly deadlineAt: string;
  } | null;
  readonly sunsetAt: string | null;
  readonly pendingActions: readonly {
    readonly actionId: string;
    readonly type: CorporateActionType;
    readonly effectiveAt: string;
  }[];
  readonly multipliers: readonly MultiplierPoint[];
}

/** Lifecycle as the catalog can prove it now: applied actions, on-chain pause flag and multiplier evidence. */
export function lifecycleFrom(inputs: LifecycleInputs, now: Date): InstrumentLifecycle {
  const halted = inputs.haltedAt !== null || inputs.onChainPaused;
  const current = multiplierAsOf(inputs.multipliers, now);
  return {
    halted,
    haltedReason: halted
      ? (inputs.haltedReason ?? (inputs.onChainPaused ? 'transfers are paused on chain' : null))
      : null,
    pendingActions: [...inputs.pendingActions]
      .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
      .map((action) => ({
        actionId: action.actionId,
        type: action.type,
        effectiveAt: action.effectiveAt,
      })),
    migration: inputs.migration,
    sunsetAt: inputs.sunsetAt,
    currentMultiplier: current.multiplier,
    multiplierEffectiveAt: current.effectiveAt,
  };
}

/**
 * What the catalog alone permits. Trading is never enabled by the catalog:
 * eligibility (B05), planning (B09) and execution (B10) each add their own
 * checks, and execution writes are disabled by configuration until then.
 * Lifecycle facts only ever remove permissions.
 */
export function availabilityFor(
  status: InstrumentStatus,
  lifecycle?: InstrumentLifecycle,
  now: Date = new Date(),
): InstrumentAvailability {
  let research = false;
  let strategy = false;
  const reasons: string[] = [];
  switch (status) {
    case 'admitted':
      research = true;
      strategy = true;
      break;
    case 'paused':
      research = true;
      reasons.push('INSTRUMENT_PAUSED');
      break;
    case 'quarantined':
      reasons.push('INSTRUMENT_QUARANTINED');
      break;
    case 'rejected':
      reasons.push('INSTRUMENT_REJECTED');
      break;
    case 'delisted':
      reasons.push('INSTRUMENT_DELISTED');
      break;
  }
  if (lifecycle) {
    if (lifecycle.halted) {
      strategy = false;
      reasons.push('ISSUER_HALTED');
    }
    if (lifecycle.migration) {
      strategy = false;
      reasons.push('MIGRATION_REQUIRED');
    }
    if (lifecycle.sunsetAt !== null && new Date(lifecycle.sunsetAt).getTime() <= now.getTime()) {
      strategy = false;
      reasons.push('INSTRUMENT_SUNSET');
    }
    if (
      lifecycle.pendingActions.some(
        (action) => new Date(action.effectiveAt).getTime() <= now.getTime(),
      )
    ) {
      strategy = false;
      reasons.push('CORPORATE_ACTION_PENDING');
    }
    if (lifecycle.currentMultiplier === null && (status === 'admitted' || status === 'paused')) {
      strategy = false;
      reasons.push('MULTIPLIER_UNKNOWN');
    }
  }
  reasons.push('EXECUTION_NOT_ENABLED');
  return { research, strategy, trade: false, reasons };
}

/** Only admitted and paused instruments are ever visible without operator scope. */
export function isPubliclyVisible(status: InstrumentStatus): boolean {
  return status === 'admitted' || status === 'paused';
}
