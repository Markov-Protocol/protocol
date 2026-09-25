/**
 * The beta fee policy (versioned so a later change is a new version, never a
 * silent edit). Markov charges no execution fee in the beta; network fees are
 * paid in SOL by the owner's wallet and never in stablecoin, so the plan
 * carries a separate SOL budget with an explicit upper bound.
 */
export const FEE_POLICY_VERSION = 'beta-0';
export const PROTOCOL_FEE_BPS = 0;
/** Documented base fee per signature (see the source register); priority fees are bounded per batch. */
export const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000n;
/** The most priority fee a batch may add at build time (B10); the plan never assumes more. */
export const PRIORITY_FEE_CAP_LAMPORTS_PER_BATCH = 100_000n;
/** Default when the network's rent-exempt minimum for a 165-byte token account was not observed. */
export const DEFAULT_RENT_EXEMPT_TOKEN_ACCOUNT_LAMPORTS = 2_039_280n;

export interface NetworkFeeInput {
  readonly batches: number;
  readonly signaturesPerBatch: number;
  readonly rentExemptTokenAccountLamports: bigint;
  /** Worst case: one new token account per constituent whose account may not exist yet. */
  readonly newTokenAccounts: number;
}

export interface NetworkFeeBudget {
  readonly baseFeeLamports: bigint;
  readonly priorityFeeCapLamports: bigint;
  readonly rentLamports: bigint;
  readonly totalLamportsMax: bigint;
}

export function networkFeeBudget(input: NetworkFeeInput): NetworkFeeBudget {
  const baseFeeLamports =
    BASE_FEE_LAMPORTS_PER_SIGNATURE * BigInt(input.signaturesPerBatch) * BigInt(input.batches);
  const priorityFeeCapLamports = PRIORITY_FEE_CAP_LAMPORTS_PER_BATCH * BigInt(input.batches);
  const rentLamports = input.rentExemptTokenAccountLamports * BigInt(input.newTokenAccounts);
  return {
    baseFeeLamports,
    priorityFeeCapLamports,
    rentLamports,
    totalLamportsMax: baseFeeLamports + priorityFeeCapLamports + rentLamports,
  };
}

/** Stablecoin-denominated protocol fee on the investable amount: zero under beta-0. */
export function protocolFeeRaw(investableRaw: bigint): bigint {
  return (investableRaw * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
}
