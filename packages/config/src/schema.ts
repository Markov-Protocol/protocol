import {
  genesisHashSchema,
  type MarkovEnv,
  markovEnvSchema,
  type SolanaCluster,
  solanaClusterSchema,
} from '@markov/contracts';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const boolFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const intFromEnv = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform((value) => Number.parseInt(value, 10))
    .pipe(z.number().int().min(min).max(max));

/** Raw integer amounts in token base units are strings to avoid float or overflow surprises. */
const rawAmountFromEnv = z.string().regex(/^[1-9]\d{0,38}$/, 'must be a positive integer string');

/**
 * Environment variable contract. Every key documented in .env.example must
 * appear here; anything the code reads must be validated here first.
 */
export const rawEnvSchema = z.object({
  MARKOV_ENV: markovEnvSchema,
  SERVICE_VERSION: z.string().min(1).max(100).default('dev'),

  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),

  API_HOST: z.string().min(1).max(253).default('127.0.0.1'),
  API_PORT: intFromEnv(1, 65535).default(3000),
  API_ALLOWED_ORIGINS: z.string().max(4000).default(''),
  API_TRUST_PROXY: boolFromEnv.default(false),
  API_RATE_LIMIT_MAX_PER_MINUTE: intFromEnv(1, 100_000).default(300),
  API_BODY_LIMIT_BYTES: intFromEnv(1024, 10_485_760).default(262_144),

  DATABASE_URL: z.string().min(1).max(4000),
  DATABASE_SSL: z.enum(['disable', 'require']).optional(),
  DATABASE_POOL_MAX: intFromEnv(1, 200).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: intFromEnv(100, 600_000).default(15_000),

  TEMPORAL_ADDRESS: z.string().min(1).max(253).default('127.0.0.1:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).max(253).default('default'),
  TEMPORAL_TASK_QUEUE_PLATFORM: z.string().min(1).max(200).default('markov-platform'),
  TEMPORAL_TLS: boolFromEnv.default(false),
  TEMPORAL_API_KEY: z.string().min(1).max(4000).optional(),

  SOLANA_CLUSTER: solanaClusterSchema,
  SOLANA_EXPECTED_GENESIS_HASH: genesisHashSchema.optional(),
  SOLANA_RPC_PRIMARY_URL: z.url({ protocol: /^https?$/ }),
  SOLANA_RPC_SECONDARY_URL: z.url({ protocol: /^https?$/ }).optional(),
  SOLANA_RPC_TIMEOUT_MS: intFromEnv(200, 60_000).default(5_000),
  SOLANA_RPC_MAX_RESPONSE_BYTES: intFromEnv(1024, 52_428_800).default(2_097_152),
  SOLANA_READ_COMMITMENT: z.enum(['confirmed', 'finalized']).default('confirmed'),

  EXECUTION_WRITES_ENABLED: boolFromEnv.default(false),
  BETA_MAX_ORDER_NOTIONAL_USDC_RAW: rawAmountFromEnv.optional(),
  BETA_MAX_DAILY_NOTIONAL_USDC_RAW: rawAmountFromEnv.optional(),
  BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW: rawAmountFromEnv.optional(),
  BETA_PARTICIPANT_ALLOWLIST_ENABLED: boolFromEnv.optional(),
  RELEASE_EVIDENCE_REF: z.string().min(1).max(500).optional(),

  SHUTDOWN_TIMEOUT_MS: intFromEnv(1000, 120_000).default(10_000),
});
export type RawEnv = z.infer<typeof rawEnvSchema>;

export interface BetaCaps {
  readonly maxOrderNotionalUsdcRaw: string;
  readonly maxDailyNotionalUsdcRaw: string;
  readonly maxAccountNotionalUsdcRaw: string;
  readonly participantAllowlistEnabled: boolean;
}

/** Fully validated, structured configuration. Treat as immutable. */
export interface MarkovConfig {
  readonly markovEnv: MarkovEnv;
  readonly serviceVersion: string;
  readonly log: { readonly level: LogLevel; readonly format: 'json' | 'pretty' };
  readonly api: {
    readonly host: string;
    readonly port: number;
    readonly allowedOrigins: readonly string[];
    readonly trustProxy: boolean;
    readonly rateLimitMaxPerMinute: number;
    readonly bodyLimitBytes: number;
  };
  readonly database: {
    readonly url: string;
    readonly ssl: 'disable' | 'require';
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
  };
  readonly temporal: {
    readonly address: string;
    readonly namespace: string;
    readonly taskQueues: { readonly platform: string };
    readonly tls: boolean;
    readonly apiKey: string | null;
  };
  readonly solana: {
    readonly cluster: SolanaCluster;
    /** Null only for localnet without an explicit expectation; bound on first migrate. */
    readonly expectedGenesisHash: string | null;
    readonly rpc: {
      readonly primaryUrl: string;
      readonly secondaryUrl: string | null;
      readonly timeoutMs: number;
      readonly maxResponseBytes: number;
    };
    readonly readCommitment: 'confirmed' | 'finalized';
  };
  readonly execution: {
    readonly writesEnabled: boolean;
    readonly betaCaps: BetaCaps | null;
    readonly releaseEvidenceRef: string | null;
  };
  readonly shutdownTimeoutMs: number;
}

/** Which clusters each runtime mode may bind to. Production is mainnet only. */
export const ALLOWED_CLUSTERS_BY_ENV: Readonly<Record<MarkovEnv, readonly SolanaCluster[]>> = {
  local: ['localnet', 'devnet', 'testnet', 'mainnet-beta'],
  test: ['localnet', 'devnet', 'testnet'],
  staging: ['devnet', 'testnet', 'mainnet-beta'],
  'mainnet-read-only': ['mainnet-beta'],
  production: ['mainnet-beta'],
};

/** Modes in which execution writes may be enabled at all. */
export const WRITE_CAPABLE_ENVS: readonly MarkovEnv[] = ['local', 'test', 'staging', 'production'];

/** Modes that require independently configured primary and secondary RPC endpoints. */
export const DUAL_RPC_ENVS: readonly MarkovEnv[] = ['staging', 'mainnet-read-only', 'production'];
