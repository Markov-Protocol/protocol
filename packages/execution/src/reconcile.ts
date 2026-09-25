/**
 * Reconciliation decisions from chain evidence. A timeout is not evidence
 * that nothing happened, so an attempt that got no answer is `unknown` until
 * the signature is observed or its blockhash has provably expired (block
 * height past `lastValidBlockHeight` at finalized commitment) without any
 * trace of the transaction. The same signed bytes may be sent again while
 * the blockhash is valid; nothing new is ever built or signed here.
 */

export interface SignatureEvidence {
  readonly slot: number;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  readonly err: unknown | null;
}

export interface ReconcileInput {
  readonly state: 'submitting' | 'submitted' | 'confirmed' | 'unknown';
  readonly lastValidBlockHeight: number;
  /** null: the node does not know the signature; 'unavailable': the node could not be asked. */
  readonly status: SignatureEvidence | null | 'unavailable';
  /** Finalized block height, or 'unavailable'. */
  readonly blockHeight: number | 'unavailable';
  readonly lastSentAt: Date | null;
  readonly now: Date;
  /** Seconds between resends of the same bytes while unobserved. */
  readonly resendAfterSeconds?: number;
}

export type ReconcileDecision =
  | { readonly next: 'wait'; readonly reason: string }
  | { readonly next: 'resend'; readonly reason: string }
  | { readonly next: 'submitted'; readonly reason: string; readonly slot: number }
  | { readonly next: 'confirmed'; readonly reason: string; readonly slot: number }
  | { readonly next: 'finalized'; readonly reason: string; readonly slot: number }
  | {
      readonly next: 'failed';
      readonly reason: string;
      readonly slot: number;
      readonly err: string;
    }
  | { readonly next: 'expired'; readonly reason: string; readonly blockHeight: number }
  | { readonly next: 'unknown'; readonly reason: string };

export function describeChainError(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err).slice(0, 300);
  } catch {
    return 'unknown error';
  }
}

export const DEFAULT_RESEND_AFTER_SECONDS = 5;

export function decideReconciliation(input: ReconcileInput): ReconcileDecision {
  const { status } = input;
  if (status === 'unavailable') {
    return { next: 'unknown', reason: 'the node could not be asked about the signature' };
  }
  if (status !== null) {
    if (status.err !== null) {
      if (status.confirmationStatus === 'processed') {
        return {
          next: 'wait',
          reason:
            'the transaction landed with an error at processed depth only; waiting for confirmation before treating it as failed',
        };
      }
      return {
        next: 'failed',
        reason: `the transaction landed with an error at ${status.confirmationStatus ?? 'unknown'} depth`,
        slot: status.slot,
        err: describeChainError(status.err),
      };
    }
    switch (status.confirmationStatus) {
      case 'finalized':
        return { next: 'finalized', reason: 'observed at finalized depth', slot: status.slot };
      case 'confirmed':
        return { next: 'confirmed', reason: 'observed at confirmed depth', slot: status.slot };
      default:
        return { next: 'submitted', reason: 'observed at processed depth', slot: status.slot };
    }
  }
  // Not found anywhere.
  if (input.blockHeight === 'unavailable') {
    return {
      next: 'unknown',
      reason: 'the signature is unknown and the block height could not be read',
    };
  }
  if (input.blockHeight > input.lastValidBlockHeight) {
    return {
      next: 'expired',
      reason: `the blockhash expired at height ${input.lastValidBlockHeight} (finalized height ${input.blockHeight}) and the signature was never observed`,
      blockHeight: input.blockHeight,
    };
  }
  const resendAfter = (input.resendAfterSeconds ?? DEFAULT_RESEND_AFTER_SECONDS) * 1000;
  if (
    input.lastSentAt === null ||
    input.now.getTime() - input.lastSentAt.getTime() >= resendAfter
  ) {
    return {
      next: 'resend',
      reason:
        'the signature is not known yet and the blockhash is still valid; the same signed bytes are sent again',
    };
  }
  return { next: 'wait', reason: 'the signature is not known yet; the blockhash is still valid' };
}
