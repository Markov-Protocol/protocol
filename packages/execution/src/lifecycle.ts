import type { AttemptState, IntentState } from '@markov/contracts';
import { fillsFromMeta, type TokenBalanceObservation } from './fills.js';
import {
  DEFAULT_RESEND_AFTER_SECONDS,
  decideReconciliation,
  describeChainError,
  type SignatureEvidence,
} from './reconcile.js';

/**
 * Reconciliation of live attempts from chain evidence, over narrow
 * interfaces so the API and the worker run the same logic against the same
 * stores and RPC client. Nothing here builds or signs: a live attempt is
 * observed, resent as the same bytes while its blockhash is valid, and moved
 * to a terminal state only on evidence.
 */

export interface LiveAttempt {
  readonly attemptId: string;
  readonly intentId: string;
  readonly planId: string;
  readonly ownerUserId: string;
  readonly transactionIndex: number;
  readonly legIndex: number;
  readonly signature: string;
  readonly signedTransaction: string;
  readonly state: 'submitting' | 'submitted' | 'confirmed' | 'unknown';
  readonly lastValidBlockHeight: number;
  readonly lastSentAt: Date | null;
  readonly resendCount: number;
  readonly intentState: IntentState;
  readonly owner: string;
  readonly side: 'buy' | 'sell';
  readonly inputMint: string;
  readonly outputMint: string;
  readonly maxInputRaw: bigint;
  readonly minimumOutputRaw: bigint;
}

export interface ExecutionRpc {
  getSignatureStatuses(signatures: readonly string[]): Promise<{
    readonly slot: number;
    readonly statuses: readonly (SignatureEvidence | null)[];
  }>;
  getBlockHeight(commitment: 'finalized'): Promise<number>;
  sendTransaction(transactionBase64: string): Promise<string>;
  getTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized',
  ): Promise<{
    readonly slot: number;
    readonly blockTime: number | null;
    readonly err: unknown | null;
    readonly fee: number | null;
    readonly accountKeys: readonly string[];
    readonly preBalances: readonly number[];
    readonly postBalances: readonly number[];
    readonly preTokenBalances: readonly TokenBalanceObservation[];
    readonly postTokenBalances: readonly TokenBalanceObservation[];
  } | null>;
}

export interface AttemptPatch {
  readonly state?: AttemptState;
  readonly reason?: string | null;
  readonly confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
  readonly slot?: number | null;
  readonly chainError?: string | null;
  readonly lastCheckedAt?: Date;
  readonly lastSentAt?: Date;
  readonly resendCount?: number;
}

export interface FillRecord {
  readonly attemptId: string;
  readonly intentId: string;
  readonly planId: string;
  readonly ownerUserId: string;
  readonly legIndex: number;
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: Date | null;
  readonly side: 'buy' | 'sell';
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inputSpentRaw: string;
  readonly outputReceivedRaw: string;
  readonly feeLamports: string;
  readonly lamportsSpent: string;
  readonly withinBounds: boolean;
  readonly observedAt: Date;
}

export interface ExecutionStore {
  updateAttempt(attemptId: string, patch: AttemptPatch, now: Date): Promise<void>;
  /** Guarded intent transition; false when the intent was not in one of `from`. */
  transitionIntent(input: {
    readonly intentId: string;
    readonly from: readonly IntentState[];
    readonly to: IntentState;
    readonly reason: string | null;
    readonly now: Date;
  }): Promise<boolean>;
  /** Records the fill once (idempotent on signature and leg) and answers whether it was new. */
  recordFill(fill: FillRecord): Promise<boolean>;
  /** Settles the attempt's policy reservation: consumed when it filled, released otherwise. */
  settleReservation(attemptId: string, outcome: 'consumed' | 'released', now: Date): Promise<void>;
  writeOutbox(event: {
    readonly kind:
      | 'execution.submitted'
      | 'execution.confirmed'
      | 'execution.finalized'
      | 'execution.failed'
      | 'execution.expired'
      | 'execution.unknown';
    readonly intentId: string;
    readonly ownerUserId: string;
    readonly payload: Record<string, unknown>;
    readonly now: Date;
  }): Promise<void>;
}

export interface ReconcileDeps {
  readonly rpc: ExecutionRpc;
  readonly store: ExecutionStore;
  readonly now?: () => Date;
  readonly resendAfterSeconds?: number;
}

export interface ReconcileOutcome {
  readonly attemptId: string;
  readonly before: LiveAttempt['state'];
  readonly next:
    | 'wait'
    | 'resend'
    | 'submitted'
    | 'confirmed'
    | 'finalized'
    | 'failed'
    | 'expired'
    | 'unknown';
  readonly reason: string;
  readonly evidence: readonly string[];
}

/** The intent states an attempt state maps to. */
export const ATTEMPT_TO_INTENT: Readonly<Record<string, IntentState>> = {
  submitting: 'SUBMITTING',
  submitted: 'SUBMITTED',
  confirmed: 'CONFIRMED',
  finalized: 'FINALIZED',
  failed: 'FAILED',
  expired: 'FAILED',
  unknown: 'UNKNOWN_REQUIRES_RECONCILIATION',
};

const OPEN_INTENT_STATES: readonly IntentState[] = [
  'AUTHORIZED',
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
  'CANCEL_REQUESTED',
];

/**
 * One reconciliation round for one live attempt: ask the node, decide, and
 * apply the decision to the attempt and the intent. Every step that can
 * fail leaves the attempt observable again on the next round.
 */
export async function reconcileAttempt(
  deps: ReconcileDeps,
  attempt: LiveAttempt,
): Promise<ReconcileOutcome> {
  const now = deps.now ? deps.now() : new Date();
  const evidence: string[] = [];
  let status: SignatureEvidence | null | 'unavailable' = 'unavailable';
  try {
    const answer = await deps.rpc.getSignatureStatuses([attempt.signature]);
    status = answer.statuses[0] ?? null;
    evidence.push(
      status === null
        ? `signature ${attempt.signature} unknown to the node at slot ${answer.slot}`
        : `signature ${attempt.signature} ${status.confirmationStatus ?? 'processed'} at slot ${status.slot}${status.err ? ' with an error' : ''}`,
    );
  } catch (error) {
    evidence.push(
      `signature status unavailable: ${error instanceof Error ? error.message : 'rpc failure'}`,
    );
  }
  let blockHeight: number | 'unavailable' = 'unavailable';
  if (status === null) {
    try {
      blockHeight = await deps.rpc.getBlockHeight('finalized');
      evidence.push(
        `finalized block height ${blockHeight}; blockhash valid until ${attempt.lastValidBlockHeight}`,
      );
    } catch (error) {
      evidence.push(
        `block height unavailable: ${error instanceof Error ? error.message : 'rpc failure'}`,
      );
    }
  }
  const decision = decideReconciliation({
    state: attempt.state,
    lastValidBlockHeight: attempt.lastValidBlockHeight,
    status,
    blockHeight,
    lastSentAt: attempt.lastSentAt,
    now,
    resendAfterSeconds: deps.resendAfterSeconds ?? DEFAULT_RESEND_AFTER_SECONDS,
  });
  const outcome = (next: ReconcileOutcome['next'], reason: string): ReconcileOutcome => ({
    attemptId: attempt.attemptId,
    before: attempt.state,
    next,
    reason,
    evidence,
  });

  switch (decision.next) {
    case 'wait':
      await deps.store.updateAttempt(attempt.attemptId, { lastCheckedAt: now }, now);
      return outcome('wait', decision.reason);
    case 'unknown': {
      await deps.store.updateAttempt(
        attempt.attemptId,
        { state: 'unknown', reason: decision.reason, lastCheckedAt: now },
        now,
      );
      if (attempt.intentState !== 'UNKNOWN_REQUIRES_RECONCILIATION') {
        const moved = await deps.store.transitionIntent({
          intentId: attempt.intentId,
          from: OPEN_INTENT_STATES,
          to: 'UNKNOWN_REQUIRES_RECONCILIATION',
          reason: decision.reason,
          now,
        });
        if (moved) {
          await deps.store.writeOutbox({
            kind: 'execution.unknown',
            intentId: attempt.intentId,
            ownerUserId: attempt.ownerUserId,
            payload: {
              attemptId: attempt.attemptId,
              signature: attempt.signature,
              reason: decision.reason,
            },
            now,
          });
        }
      }
      return outcome('unknown', decision.reason);
    }
    case 'resend': {
      try {
        await deps.rpc.sendTransaction(attempt.signedTransaction);
        evidence.push('the same signed bytes were sent again');
        await deps.store.updateAttempt(
          attempt.attemptId,
          {
            state: 'submitted',
            reason: decision.reason,
            lastSentAt: now,
            lastCheckedAt: now,
            resendCount: attempt.resendCount + 1,
          },
          now,
        );
        if (attempt.intentState !== 'SUBMITTED' && attempt.intentState !== 'CANCEL_REQUESTED') {
          await deps.store.transitionIntent({
            intentId: attempt.intentId,
            from: OPEN_INTENT_STATES,
            to: 'SUBMITTED',
            reason: null,
            now,
          });
        }
        return outcome('resend', decision.reason);
      } catch (error) {
        const reason = `resend failed: ${error instanceof Error ? error.message : 'rpc failure'}`;
        evidence.push(reason);
        await deps.store.updateAttempt(attempt.attemptId, { lastCheckedAt: now }, now);
        return outcome('wait', reason);
      }
    }
    case 'submitted':
      await deps.store.updateAttempt(
        attempt.attemptId,
        {
          state: 'submitted',
          confirmationStatus: 'processed',
          slot: decision.slot,
          lastCheckedAt: now,
        },
        now,
      );
      return outcome('submitted', decision.reason);
    case 'confirmed': {
      await deps.store.updateAttempt(
        attempt.attemptId,
        {
          state: 'confirmed',
          confirmationStatus: 'confirmed',
          slot: decision.slot,
          lastCheckedAt: now,
          reason: decision.reason,
        },
        now,
      );
      if (attempt.intentState !== 'CONFIRMED') {
        const moved = await deps.store.transitionIntent({
          intentId: attempt.intentId,
          from: OPEN_INTENT_STATES,
          to: 'CONFIRMED',
          reason: null,
          now,
        });
        if (moved) {
          await deps.store.writeOutbox({
            kind: 'execution.confirmed',
            intentId: attempt.intentId,
            ownerUserId: attempt.ownerUserId,
            payload: {
              attemptId: attempt.attemptId,
              signature: attempt.signature,
              slot: decision.slot,
            },
            now,
          });
        }
      }
      return outcome('confirmed', decision.reason);
    }
    case 'finalized': {
      const fill = await readFill(deps, attempt, now, evidence);
      await deps.store.updateAttempt(
        attempt.attemptId,
        {
          state: 'finalized',
          confirmationStatus: 'finalized',
          slot: decision.slot,
          lastCheckedAt: now,
          reason: decision.reason,
        },
        now,
      );
      await deps.store.settleReservation(attempt.attemptId, 'consumed', now);
      const target: IntentState =
        fill === 'violated' ? 'UNKNOWN_REQUIRES_RECONCILIATION' : 'FINALIZED';
      const reason =
        fill === 'violated'
          ? 'the landed transaction moved amounts outside the approved bounds; frozen for review'
          : fill === 'unavailable'
            ? 'finalized; the fill could not be read yet and will be read on the next check'
            : null;
      const moved = await deps.store.transitionIntent({
        intentId: attempt.intentId,
        from: [...OPEN_INTENT_STATES, 'FINALIZED'],
        to: target,
        reason,
        now,
      });
      if (moved && target === 'FINALIZED') {
        await deps.store.writeOutbox({
          kind: 'execution.finalized',
          intentId: attempt.intentId,
          ownerUserId: attempt.ownerUserId,
          payload: {
            attemptId: attempt.attemptId,
            signature: attempt.signature,
            slot: decision.slot,
          },
          now,
        });
      }
      return outcome('finalized', reason ?? decision.reason);
    }
    case 'failed': {
      await deps.store.updateAttempt(
        attempt.attemptId,
        {
          state: 'failed',
          reason: decision.reason,
          chainError: decision.err,
          confirmationStatus: null,
          slot: decision.slot,
          lastCheckedAt: now,
        },
        now,
      );
      await deps.store.settleReservation(attempt.attemptId, 'released', now);
      const moved = await deps.store.transitionIntent({
        intentId: attempt.intentId,
        from: OPEN_INTENT_STATES,
        to: 'FAILED',
        reason: `${decision.reason}: ${decision.err}`,
        now,
      });
      if (moved) {
        await deps.store.writeOutbox({
          kind: 'execution.failed',
          intentId: attempt.intentId,
          ownerUserId: attempt.ownerUserId,
          payload: {
            attemptId: attempt.attemptId,
            signature: attempt.signature,
            error: decision.err,
          },
          now,
        });
      }
      return outcome('failed', decision.reason);
    }
    case 'expired': {
      await deps.store.updateAttempt(
        attempt.attemptId,
        { state: 'expired', reason: decision.reason, lastCheckedAt: now },
        now,
      );
      await deps.store.settleReservation(attempt.attemptId, 'released', now);
      const cancelled = attempt.intentState === 'CANCEL_REQUESTED';
      const moved = await deps.store.transitionIntent({
        intentId: attempt.intentId,
        from: OPEN_INTENT_STATES,
        to: cancelled ? 'CANCELLED' : 'FAILED',
        reason: decision.reason,
        now,
      });
      if (moved) {
        await deps.store.writeOutbox({
          kind: cancelled ? 'execution.expired' : 'execution.expired',
          intentId: attempt.intentId,
          ownerUserId: attempt.ownerUserId,
          payload: {
            attemptId: attempt.attemptId,
            signature: attempt.signature,
            blockHeight: decision.blockHeight,
          },
          now,
        });
      }
      return outcome('expired', decision.reason);
    }
  }
}

async function readFill(
  deps: ReconcileDeps,
  attempt: LiveAttempt,
  now: Date,
  evidence: string[],
): Promise<'recorded' | 'violated' | 'unavailable'> {
  let landed: Awaited<ReturnType<ExecutionRpc['getTransaction']>>;
  try {
    landed = await deps.rpc.getTransaction(attempt.signature, 'finalized');
  } catch (error) {
    evidence.push(
      `transaction read unavailable: ${error instanceof Error ? error.message : 'rpc failure'}`,
    );
    return 'unavailable';
  }
  if (landed === null) {
    evidence.push('the finalized transaction could not be read back');
    return 'unavailable';
  }
  if (landed.err !== null) {
    evidence.push(`the finalized transaction carries an error: ${describeChainError(landed.err)}`);
    return 'violated';
  }
  const feePayerIndex = Math.max(0, landed.accountKeys.indexOf(attempt.owner));
  const fill = fillsFromMeta({
    owner: attempt.owner,
    feePayerIndex,
    inputMint: attempt.inputMint,
    outputMint: attempt.outputMint,
    preTokenBalances: landed.preTokenBalances,
    postTokenBalances: landed.postTokenBalances,
    preBalances: landed.preBalances,
    postBalances: landed.postBalances,
    fee: landed.fee,
    bounds: { maxInputRaw: attempt.maxInputRaw, minimumOutputRaw: attempt.minimumOutputRaw },
  });
  evidence.push(
    `fill from transaction meta: spent ${fill.inputSpentRaw} raw, received ${fill.outputReceivedRaw} raw, fee ${fill.feeLamports} lamports`,
  );
  for (const note of fill.notes) {
    evidence.push(note);
  }
  await deps.store.recordFill({
    attemptId: attempt.attemptId,
    intentId: attempt.intentId,
    planId: attempt.planId,
    ownerUserId: attempt.ownerUserId,
    legIndex: attempt.legIndex,
    signature: attempt.signature,
    slot: landed.slot,
    blockTime: landed.blockTime === null ? null : new Date(landed.blockTime * 1000),
    side: attempt.side,
    inputMint: attempt.inputMint,
    outputMint: attempt.outputMint,
    inputSpentRaw: fill.inputSpentRaw.toString(),
    outputReceivedRaw: fill.outputReceivedRaw.toString(),
    feeLamports: fill.feeLamports.toString(),
    lamportsSpent: fill.lamportsSpent.toString(),
    withinBounds: fill.withinBounds,
    observedAt: now,
  });
  return fill.withinBounds ? 'recorded' : 'violated';
}

/** The rows a live attempt is assembled from; states arrive as strings from storage and are narrowed here. */
export interface LiveAttemptRows {
  readonly attempt: {
    readonly id: string;
    readonly intentId: string;
    readonly planId: string;
    readonly ownerUserId: string;
    readonly transactionIndex: number;
    readonly signature: string;
    readonly signedTransaction: string;
    readonly state: string;
    readonly lastValidBlockHeight: number;
    readonly lastSentAt: Date | null;
    readonly resendCount: number;
  };
  readonly transaction: {
    readonly feePayer: string;
    readonly legIndexes: readonly number[];
    readonly effects: {
      readonly side: 'buy' | 'sell';
      readonly inputMint: string;
      readonly outputMint: string;
      readonly maxInputRaw: string;
      readonly minimumOutputRaw: string;
    };
  };
  readonly intent: { readonly state: string };
}

const LIVE_STATES: ReadonlySet<string> = new Set([
  'submitting',
  'submitted',
  'confirmed',
  'unknown',
]);

/** Null when the attempt is not live (nothing to reconcile). */
export function liveAttemptFromRows(rows: LiveAttemptRows): LiveAttempt | null {
  if (!LIVE_STATES.has(rows.attempt.state)) {
    return null;
  }
  return {
    attemptId: rows.attempt.id,
    intentId: rows.attempt.intentId,
    planId: rows.attempt.planId,
    ownerUserId: rows.attempt.ownerUserId,
    transactionIndex: rows.attempt.transactionIndex,
    legIndex: rows.transaction.legIndexes[0] ?? 0,
    signature: rows.attempt.signature,
    signedTransaction: rows.attempt.signedTransaction,
    state: rows.attempt.state as LiveAttempt['state'],
    lastValidBlockHeight: rows.attempt.lastValidBlockHeight,
    lastSentAt: rows.attempt.lastSentAt,
    resendCount: rows.attempt.resendCount,
    intentState: rows.intent.state as IntentState,
    owner: rows.transaction.feePayer,
    side: rows.transaction.effects.side,
    inputMint: rows.transaction.effects.inputMint,
    outputMint: rows.transaction.effects.outputMint,
    maxInputRaw: BigInt(rows.transaction.effects.maxInputRaw),
    minimumOutputRaw: BigInt(rows.transaction.effects.minimumOutputRaw),
  };
}
