import type { IntentState } from '@markov/contracts';

/**
 * Valid intent transitions. B09 uses the planning states, B10 the single
 * transaction lifecycle and B11 the staged one: a non-final batch that
 * finalizes returns the intent to AUTHORIZED for the next signature; a
 * failure, expiry or cancellation after at least one batch filled ends in
 * PARTIALLY_COMPLETED, which stays partial until a reviewed completion (a new
 * intent for the remaining legs) or an exit. Failure is terminal only where
 * evidence establishes it, which is why a submission that got no answer
 * moves to reconciliation, never to FAILED.
 */
export const INTENT_TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> = {
  DRAFT: ['QUOTED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  QUOTED: ['QUOTED', 'AWAITING_APPROVAL', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  AWAITING_APPROVAL: ['QUOTED', 'AUTHORIZED', 'CANCELLED', 'EXPIRED'],
  AUTHORIZED: ['AUTHORIZED', 'SUBMITTING', 'CANCELLED', 'EXPIRED', 'PARTIALLY_COMPLETED'],
  SUBMITTING: ['SUBMITTED', 'FAILED', 'PARTIALLY_COMPLETED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  SUBMITTED: [
    'CONFIRMED',
    'FINALIZED',
    'AUTHORIZED',
    'FAILED',
    'EXPIRED',
    'PARTIALLY_COMPLETED',
    'UNKNOWN_REQUIRES_RECONCILIATION',
  ],
  CONFIRMED: [
    'FINALIZED',
    'AUTHORIZED',
    'FAILED',
    'PARTIALLY_COMPLETED',
    'UNKNOWN_REQUIRES_RECONCILIATION',
  ],
  FINALIZED: [],
  PARTIALLY_COMPLETED: [],
  EXPIRED: [],
  REJECTED: [],
  FAILED: [],
  CANCEL_REQUESTED: [
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'SUBMITTED',
    'CONFIRMED',
    'FINALIZED',
    'AUTHORIZED',
    'UNKNOWN_REQUIRES_RECONCILIATION',
  ],
  CANCELLED: [],
  UNKNOWN_REQUIRES_RECONCILIATION: [
    'CONFIRMED',
    'FINALIZED',
    'AUTHORIZED',
    'FAILED',
    'PARTIALLY_COMPLETED',
  ],
};

export const TERMINAL_INTENT_STATES: ReadonlySet<IntentState> = new Set(
  (Object.keys(INTENT_TRANSITIONS) as IntentState[]).filter(
    (state) => INTENT_TRANSITIONS[state].length === 0,
  ),
);

export function canTransition(from: IntentState, to: IntentState): boolean {
  return INTENT_TRANSITIONS[from].includes(to);
}

/** States in which a new plan may be requested. */
export const PLANNABLE_STATES: ReadonlySet<IntentState> = new Set([
  'DRAFT',
  'QUOTED',
  'AWAITING_APPROVAL',
]);
