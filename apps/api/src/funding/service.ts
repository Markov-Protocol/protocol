import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import type { FundingReadiness, WalletFundingResponse } from '@markov/contracts';
import { type Database, listWallets } from '@markov/db';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { ApiError } from '../errors.js';

/**
 * Base fee per signature in lamports: agave `fee/src/lib.rs`
 * (`LAMPORTS_PER_SIGNATURE = 5_000`, SR-SOL-FEE-01). Priority fees and the
 * exact fee payer arrive with a plan (B10); this is an allowance, not a quote.
 */
export const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000n;
/** A first strategy leg plus a token-account creation: two signatures of allowance. */
export const ASSUMED_SIGNATURES = 2;
/** SPL Token account size in bytes; Token-2022 accounts are at least this long. */
export const TOKEN_ACCOUNT_BYTES = 165;
const AMOUNT_OFFSET = 64;
const COMMITMENT = 'confirmed' as const;

export interface FundingServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  readonly rpcClients: readonly SolanaRpcClient[];
  readonly now?: () => Date;
}

export interface FundingService {
  walletFunding(principal: Principal, walletId: string): Promise<WalletFundingResponse>;
}

/** Amount field of an SPL Token / Token-2022 token account (u64 little-endian at byte 64). */
export function tokenAccountAmount(data: Uint8Array): bigint {
  if (data.length < TOKEN_ACCOUNT_BYTES) {
    throw new Error(
      `token account data is ${data.length} bytes; expected at least ${TOKEN_ACCOUNT_BYTES}`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(AMOUNT_OFFSET, true);
}

export function createFundingService(deps: FundingServiceDeps): FundingService {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const rpc = deps.rpcClients[0];
  if (!rpc) {
    throw new Error('funding service needs at least one RPC client');
  }

  return {
    async walletFunding(principal, walletId) {
      if (
        (principal.class !== 'user' && principal.class !== 'agent') ||
        principal.userId === null
      ) {
        throw new ApiError(
          'FORBIDDEN',
          'this operation requires a user session or an agent acting for one',
        );
      }
      const wallet = (await listWallets(db, principal.userId)).find((row) => row.id === walletId);
      if (!wallet) {
        throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
      }
      const stablecoin = config.funding.stablecoin;
      let balance: Awaited<ReturnType<SolanaRpcClient['getBalance']>>;
      let tokenAccounts: Awaited<ReturnType<SolanaRpcClient['getTokenAccountsByOwner']>> | null;
      let rentExempt: number;
      try {
        [balance, tokenAccounts, rentExempt] = await Promise.all([
          rpc.getBalance(wallet.address, COMMITMENT),
          stablecoin === null
            ? Promise.resolve(null)
            : rpc.getTokenAccountsByOwner(wallet.address, stablecoin.mint, COMMITMENT),
          rpc.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_BYTES),
        ]);
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            `the RPC endpoint could not be read (${error.kind}); balances are unknown, not zero`,
          );
        }
        throw error;
      }

      let stablecoinRaw = 0n;
      let accountCount = 0;
      if (tokenAccounts !== null) {
        for (const account of tokenAccounts.accounts) {
          stablecoinRaw += tokenAccountAmount(account.data);
          accountCount += 1;
        }
      }
      const feeAllowance = BASE_FEE_LAMPORTS_PER_SIGNATURE * BigInt(ASSUMED_SIGNATURES);
      const rentNeeded = accountCount === 0 ? BigInt(rentExempt) : 0n;
      const required = feeAllowance + rentNeeded;
      const lamports = BigInt(balance.lamports);
      const sufficient = lamports >= required;
      const hasStablecoin = stablecoin !== null && stablecoinRaw > 0n;
      const readiness: FundingReadiness = sufficient
        ? hasStablecoin
          ? 'funded'
          : 'needs_stablecoin'
        : hasStablecoin
          ? 'needs_sol'
          : 'unfunded';
      const explanation =
        `${ASSUMED_SIGNATURES} signatures at the base fee of ${BASE_FEE_LAMPORTS_PER_SIGNATURE} lamports each` +
        (rentNeeded > 0n
          ? `, plus ${rentExempt} lamports to open a ${stablecoin?.symbol ?? 'token'} account that does not exist yet`
          : '') +
        '. A strategy plan states its exact fee payer, priority fee and account costs before anything is signed.';
      return {
        walletId: wallet.id,
        chain: 'solana',
        cluster: config.solana.cluster,
        genesisHash: deps.genesisHash,
        address: wallet.address,
        observedAt: now().toISOString(),
        slot: Math.max(balance.slot, tokenAccounts?.slot ?? 0),
        commitment: COMMITMENT,
        source: 'rpc',
        sol: { lamports: lamports.toString(), sufficientForFees: sufficient },
        stablecoin:
          stablecoin === null
            ? null
            : {
                symbol: stablecoin.symbol,
                mint: stablecoin.mint,
                decimals: stablecoin.decimals,
                raw: stablecoinRaw.toString(),
                tokenAccounts: accountCount,
              },
        stablecoinUnavailableReason:
          stablecoin === null
            ? `no stablecoin mint is configured for ${config.solana.cluster}; only SOL is observed`
            : null,
        requirements: {
          rentExemptTokenAccountLamports: String(rentExempt),
          baseFeeLamportsPerSignature: BASE_FEE_LAMPORTS_PER_SIGNATURE.toString(),
          assumedSignatures: ASSUMED_SIGNATURES,
          requiredLamports: required.toString(),
          explanation,
        },
        readiness,
      };
    },
  };
}
