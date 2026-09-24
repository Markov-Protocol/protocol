import { z } from 'zod';

/** Contract schema version for all v1 payloads. Bump with a documented migration. */
export const CONTRACT_SCHEMA_VERSION = '1' as const;

/** Runtime modes. Each mode restricts which chain and which capabilities are allowed. */
export const MARKOV_ENVS = ['local', 'test', 'staging', 'mainnet-read-only', 'production'] as const;
export const markovEnvSchema = z.enum(MARKOV_ENVS);
export type MarkovEnv = z.infer<typeof markovEnvSchema>;

/** Solana clusters the platform can be bound to. A cluster is identified by its genesis hash, never by name alone. */
export const SOLANA_CLUSTERS = ['localnet', 'devnet', 'testnet', 'mainnet-beta'] as const;
export const solanaClusterSchema = z.enum(SOLANA_CLUSTERS);
export type SolanaCluster = z.infer<typeof solanaClusterSchema>;

/** Base58 alphabet used by Solana for hashes, addresses and signatures. */
export const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A Solana genesis hash: 32 bytes, base58 encoded (43 or 44 characters). */
export const genesisHashSchema = z
  .string()
  .min(43)
  .max(44)
  .regex(BASE58_REGEX, 'genesis hash must be base58');
export type GenesisHash = z.infer<typeof genesisHashSchema>;

/** Commitment levels used for reads. Execution finality is a separate, explicit state. */
export const SOLANA_COMMITMENTS = ['processed', 'confirmed', 'finalized'] as const;
export const solanaCommitmentSchema = z.enum(SOLANA_COMMITMENTS);
export type SolanaCommitment = z.infer<typeof solanaCommitmentSchema>;

/**
 * The identity a database and every service process must agree on. It is
 * written once by `markov db migrate` and verified at every service boot.
 * A mismatch is a fatal configuration error, never a warning.
 */
export const platformIdentitySchema = z.object({
  markovEnv: markovEnvSchema,
  solanaCluster: solanaClusterSchema,
  genesisHash: genesisHashSchema,
});
export type PlatformIdentity = z.infer<typeof platformIdentitySchema>;

export const boundPlatformIdentitySchema = platformIdentitySchema.extend({
  boundAt: z.iso.datetime(),
  boundBy: z.string().min(1).max(200),
});
export type BoundPlatformIdentity = z.infer<typeof boundPlatformIdentitySchema>;
