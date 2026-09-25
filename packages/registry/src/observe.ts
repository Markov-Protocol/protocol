import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import type { ChainObservation, Unavailable } from './publication.js';

/**
 * Ask a node everything `derivePublicationOutcome` needs about one
 * submitted transaction. Each answer is independent: a node that cannot
 * serve one of them yields `unavailable` for that field only, so the
 * decision can distinguish "not landed" from "could not ask".
 */
async function attempt<T>(call: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SolanaRpcError) {
      return 'unavailable';
    }
    throw error;
  }
}

export async function observeSubmission(
  rpc: SolanaRpcClient,
  input: { readonly signature: string; readonly recordAddress: string },
  now: () => Date = () => new Date(),
): Promise<ChainObservation> {
  const [statuses, blockHeight] = await Promise.all([
    attempt(() => rpc.getSignatureStatuses([input.signature])),
    attempt(() => rpc.getBlockHeight('finalized')),
  ]);
  const signature = statuses === 'unavailable' ? 'unavailable' : (statuses.statuses[0] ?? null);
  const finalized =
    signature !== 'unavailable' &&
    signature !== null &&
    signature.err === null &&
    signature.confirmationStatus === 'finalized';
  const [transaction, account] = finalized
    ? await Promise.all([
        attempt(() => rpc.getTransaction(input.signature, 'finalized')),
        attempt(async () => {
          const info = await rpc.getAccountInfo(input.recordAddress, 'finalized');
          return info.account ? { owner: info.account.owner, data: info.account.data } : null;
        }),
      ])
    : [null, null];
  return {
    signature:
      signature === 'unavailable' || signature === null
        ? signature
        : {
            slot: signature.slot,
            err: signature.err,
            confirmationStatus: signature.confirmationStatus,
          },
    blockHeight,
    transaction:
      transaction === 'unavailable' || transaction === null
        ? transaction
        : {
            slot: transaction.slot,
            blockTime: transaction.blockTime,
            err: transaction.err,
            logs: transaction.logs,
          },
    account,
    observedAt: now().toISOString(),
  };
}
