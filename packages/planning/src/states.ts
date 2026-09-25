import type { IntentState } from '@markov/contracts';

/**
 * Valid intent transitions. B09 uses the planning states; the execution
 * states are defined here so B10/B11 extend the machine instead of
 * inventing one. Failure is terminal only where evidence establishes it,
 * which is why a submission that got no answer moves to reconciliation,
 * never to FAILED.
 */
export const INTENT_TRANSITIONS: Readonly<Record<IntentState, readonly IntentState[]>> = {
  DRAFT: ['QUOTED', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  QUOTED: ['QUOTED', 'AWAITING_APPROVAL', 'CANCELLED', 'EXPIRED', 'REJECTED'],
  AWAITING_APPROVAL: ['QUOTED', 'AUTHORIZED', 'CANCELLED', 'EXPIRED'],
  AUTHORIZED: ['SUBMITTING', 'CANCEL_REQUESTED', 'EXPIRED'],
  SUBMITTING: ['SUBMITTED', 'FAILED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  SUBMITTED: ['CONFIRMED', 'FAILED', 'EXPIRED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  CONFIRMED: ['FINALIZED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  FINALIZED: [],
  PARTIALLY_COMPLETED: ['FINALIZED', 'CANCELLED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  EXPIRED: [],
  REJECTED: [],
  FAILED: [],
  CANCEL_REQUESTED: ['CANCELLED', 'SUBMITTED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
  CANCELLED: [],
  UNKNOWN_REQUIRES_RECONCILIATION: ['CONFIRMED', 'FINALIZED', 'FAILED', 'PARTIALLY_COMPLETED'],
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
