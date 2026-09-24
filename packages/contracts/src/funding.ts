import { z } from 'zod';
import { base58AddressSchema, idSchema } from './identity.js';
import { genesisHashSchema, solanaClusterSchema } from './platform.js';
import { rawAmountSchema } from './price.js';

/**
 * Funding readiness of a verified wallet (F04). Balances are observed from
 * the configured RPC endpoint at the moment of the request; nothing here is
 * a deposit credit, a pooled address or a promise about fees. A strategy
 * plan states its exact fee payer and costs (B10); until then readiness uses
 * the network's rent-exempt minimum for a token account and the base fee
 * per signature.
 */

export const FUNDING_READINESS = ['funded', 'needs_sol', 'needs_stablecoin', 'unfunded'] as const;
export const fundingReadinessSchema = z.enum(FUNDING_READINESS);
export type FundingReadiness = z.infer<typeof fundingReadinessSchema>;

export const stablecoinBalanceSchema = z.object({
  symbol: z.string().max(10),
  mint: base58AddressSchema,
  decimals: z.number().int().min(0).max(18),
  /** Sum of every token account the wallet owns for the mint, raw base units. */
  raw: rawAmountSchema,
  tokenAccounts: z.number().int().nonnegative(),
});

export const walletFundingResponseSchema = z.object({
  walletId: idSchema,
  chain: z.literal('solana'),
  cluster: solanaClusterSchema,
  genesisHash: genesisHashSchema,
  /** The person's own verified address; Markov never provides a pooled deposit address. */
  address: base58AddressSchema,
  observedAt: z.iso.datetime(),
  slot: z.number().int().nonnegative(),
  commitment: z.enum(['confirmed', 'finalized']),
  source: z.literal('rpc'),
  sol: z.object({
    lamports: rawAmountSchema,
    /** Enough SOL for the requirements below. */
    sufficientForFees: z.boolean(),
  }),
  /** Null when no stablecoin mint is configured for this cluster; the reason says so. */
  stablecoin: stablecoinBalanceSchema.nullable(),
  stablecoinUnavailableReason: z.string().max(300).nullable(),
  requirements: z.object({
    /** Observed from the network for a 165-byte token account. */
    rentExemptTokenAccountLamports: rawAmountSchema,
    /** Documented base fee (see the source register); priority fees come with a plan. */
    baseFeeLamportsPerSignature: rawAmountSchema,
    assumedSignatures: z.number().int().positive(),
    /** Rent for a first token account when none exists, plus the fee allowance. */
    requiredLamports: rawAmountSchema,
    explanation: z.string().max(600),
  }),
  readiness: fundingReadinessSchema,
});
export type WalletFundingResponse = z.infer<typeof walletFundingResponseSchema>;
