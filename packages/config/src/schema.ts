import {
  base58AddressSchema,
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

  IDENTITY_PROVIDER: z.enum(['test', 'oidc']).default('test'),
  IDENTITY_ISSUER: z.string().min(1).max(500).optional(),
  IDENTITY_AUDIENCE: z.string().min(1).max(500).optional(),
  IDENTITY_JWKS_URL: z.url({ protocol: /^https$/ }).optional(),
  IDENTITY_ALGORITHMS: z.string().min(1).max(200).default('ES256'),

  CREDENTIAL_PEPPER: z.string().min(32).max(512).optional(),
  AUTH_SESSION_TTL_SECONDS: intFromEnv(300, 30 * 24 * 3600).default(24 * 3600),
  AUTH_STEP_UP_MAX_AGE_SECONDS: intFromEnv(60, 3600).default(600),
  WALLET_CHALLENGE_DOMAIN: z.string().min(1).max(253).optional(),
  WALLET_CHALLENGE_TTL_SECONDS: intFromEnv(60, 900).default(300),

  /** Operator-configured feed serving the Markov issuer feed contract (B03); https outside local/test. */
  PRESTOCKS_FEED_URL: z.url().optional(),
  XSTOCKS_FEED_URL: z.url().optional(),
  XSTOCKS_EVENTS_URL: z.url().optional(),
  /** Stablecoin mint whose balance funding readiness observes; defaults to USDC on mainnet-beta only. */
  FUNDING_STABLECOIN_MINT: base58AddressSchema.optional(),
  /** Research model adapter (B06): `disabled` keeps research manual; `fixture` is allowed in local/test only. */
  RESEARCH_MODEL_PROVIDER: z.enum(['disabled', 'fixture']).default('disabled'),
  /** Companion model adapter (B15): `disabled` answers 503 on runs (tools still work); `fixture` is allowed in local/test only. */
  COMPANION_MODEL_PROVIDER: z.enum(['disabled', 'fixture']).default('disabled'),
  /** Companion runs an account may spend per rolling day, in cost micros; runs beyond it answer BUDGET_EXHAUSTED. */
  COMPANION_DAILY_COST_LIMIT_MICROS: intFromEnv(1000, 1_000_000_000).default(5_000_000),
  /**
   * Execution venue adapter (B09): `disabled` refuses every plan; `fixture` (local/test only) answers
   * synthetic quotes; `configured_url` posts the Markov quote contract to EXECUTION_VENUE_QUOTE_URL.
   */
  EXECUTION_VENUE_PROVIDER: z.enum(['disabled', 'fixture', 'configured_url']).default('disabled'),
  EXECUTION_VENUE_QUOTE_URL: z.url().optional(),
  /** Optional gateway that builds transactions for its quotes (configured_url only); without it execution stays unavailable. */
  EXECUTION_VENUE_BUILD_URL: z.url().optional(),
  /** Fixture venue only (local/test): the most legs it composes into one transaction, to exercise staged plans. */
  EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS: intFromEnv(1, 10).optional(),
  /** Bearer token for the configured gateway; never logged, never part of a plan. */
  EXECUTION_VENUE_API_KEY: z.string().min(1).max(4000).optional(),
  /**
   * Receipt signing (B12): `local_key` signs with RECEIPT_SIGNING_KEY (an Ed25519 PKCS#8 key,
   * base64; never in production); `kms` names the planned KMS-backed signer and is refused until
   * it exists (OD-22); `disabled` issues no receipts.
   */
  RECEIPT_SIGNING_PROVIDER: z.enum(['disabled', 'local_key', 'kms']).default('disabled'),
  RECEIPT_SIGNING_KEY: z.string().min(1).max(4000).optional(),
  /** Versioned identifier of the signing key; published with the verification keys. */
  RECEIPT_SIGNING_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .optional(),
  /** Product complexity limit on recipe legs (B07), tightened downward for a beta; never raised above 10. */
  STRATEGY_MAX_LEGS: intFromEnv(1, 10).default(10),
  /** Strategy registry program (B08). Unset keeps publication disabled and the indexer idle. */
  REGISTRY_PROGRAM_ID: base58AddressSchema.optional(),
  /** Seconds between indexer passes over pending publications and program accounts. */
  REGISTRY_INDEX_INTERVAL_SECONDS: intFromEnv(5, 3600).default(30),

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
    readonly venue: {
      /** Null when no venue is configured; planning then refuses with PROVIDER_UNAVAILABLE. */
      readonly provider: 'fixture' | 'configured_url' | null;
      readonly quoteUrl: string | null;
      /** Optional gateway that builds transactions for its quotes; without it execution is unavailable. */
      readonly buildUrl: string | null;
      /** Fixture venue test control: the most legs composed into one transaction (null: no limit). */
      readonly fixtureComposeMaxLegs: number | null;
      readonly apiKey: string | null;
    };
  };
  readonly identity: {
    readonly provider: 'test' | 'oidc';
    readonly issuer: string;
    readonly audience: string;
    readonly jwksUrl: string | null;
    readonly algorithms: readonly string[];
  };
  readonly auth: {
    readonly credentialPepper: string;
    readonly sessionTtlSeconds: number;
    readonly stepUpMaxAgeSeconds: number;
    readonly walletChallengeDomain: string;
    readonly walletChallengeTtlSeconds: number;
  };
  readonly funding: {
    /** Null when no stablecoin mint is known for the cluster; funding readiness then reports SOL only. */
    readonly stablecoin: {
      readonly symbol: string;
      readonly mint: string;
      readonly decimals: number;
    } | null;
  };
  readonly research: {
    /** Null when no model provider is configured; manual research works without one. */
    readonly modelProvider: 'fixture' | null;
  };
  readonly companion: {
    /** Null when no companion model provider is configured; the typed tools work without one. */
    readonly modelProvider: 'fixture' | null;
    /** Cost micros an account may spend on companion runs per rolling day. */
    readonly dailyCostLimitMicros: number;
  };
  readonly receipts: {
    /** Null when receipts are disabled; issuing then answers PROVIDER_UNAVAILABLE. */
    readonly provider: 'local_key' | null;
    /** Base64 PKCS#8 Ed25519 private key (local_key only); never logged or described. */
    readonly signingKey: string | null;
    readonly keyId: string | null;
  };
  readonly strategies: {
    /** At most this many constituent legs per recipe (default and maximum 10). */
    readonly maxLegs: number;
  };
  readonly registry: {
    /** Program id of the deployed strategy registry, or null when no registry is configured. */
    readonly programId: string | null;
    /** Publication needs a program id in a write-capable mode; reads and indexing need the id alone. */
    readonly publicationEnabled: boolean;
    readonly indexIntervalSeconds: number;
  };
  readonly catalog: {
    /** Null until an operator configures a verified feed; fixture sources serve local and test. */
    readonly prestocksFeedUrl: string | null;
    readonly xstocksFeedUrl: string | null;
    readonly xstocksEventsUrl: string | null;
  };
  readonly shutdownTimeoutMs: number;
}

/** Development pepper; refused outside local and test. */
export const DEVELOPMENT_CREDENTIAL_PEPPER = 'local-development-pepper-not-a-secret-0000';

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
