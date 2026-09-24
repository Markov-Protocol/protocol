import { ConfigError, type ConfigIssue } from './errors.js';
import { knownGenesisHash } from './known-genesis.js';
import { redactUrl } from './redact.js';
import {
  ALLOWED_CLUSTERS_BY_ENV,
  DUAL_RPC_ENVS,
  type MarkovConfig,
  type RawEnv,
  rawEnvSchema,
  WRITE_CAPABLE_ENVS,
} from './schema.js';

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type LoadConfigResult =
  | { readonly ok: true; readonly config: MarkovConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Empty strings in .env files mean "unset"; normalise them away before validation. */
function withoutEmptyValues(env: EnvSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') {
      out[key] = value;
    }
  }
  return out;
}

function structure(raw: RawEnv): MarkovConfig {
  const isDev = raw.MARKOV_ENV === 'local' || raw.MARKOV_ENV === 'test';
  const allBetaCapsPresent =
    raw.BETA_MAX_ORDER_NOTIONAL_USDC_RAW !== undefined &&
    raw.BETA_MAX_DAILY_NOTIONAL_USDC_RAW !== undefined &&
    raw.BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW !== undefined &&
    raw.BETA_PARTICIPANT_ALLOWLIST_ENABLED !== undefined;

  return {
    markovEnv: raw.MARKOV_ENV,
    serviceVersion: raw.SERVICE_VERSION,
    log: { level: raw.LOG_LEVEL, format: raw.LOG_FORMAT },
    api: {
      host: raw.API_HOST,
      port: raw.API_PORT,
      allowedOrigins: raw.API_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      trustProxy: raw.API_TRUST_PROXY,
      rateLimitMaxPerMinute: raw.API_RATE_LIMIT_MAX_PER_MINUTE,
      bodyLimitBytes: raw.API_BODY_LIMIT_BYTES,
    },
    database: {
      url: raw.DATABASE_URL,
      ssl: raw.DATABASE_SSL ?? (isDev ? 'disable' : 'require'),
      poolMax: raw.DATABASE_POOL_MAX,
      statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    temporal: {
      address: raw.TEMPORAL_ADDRESS,
      namespace: raw.TEMPORAL_NAMESPACE,
      taskQueues: { platform: raw.TEMPORAL_TASK_QUEUE_PLATFORM },
      tls: raw.TEMPORAL_TLS,
      apiKey: raw.TEMPORAL_API_KEY ?? null,
    },
    solana: {
      cluster: raw.SOLANA_CLUSTER,
      expectedGenesisHash: raw.SOLANA_EXPECTED_GENESIS_HASH ?? knownGenesisHash(raw.SOLANA_CLUSTER),
      rpc: {
        primaryUrl: raw.SOLANA_RPC_PRIMARY_URL,
        secondaryUrl: raw.SOLANA_RPC_SECONDARY_URL ?? null,
        timeoutMs: raw.SOLANA_RPC_TIMEOUT_MS,
        maxResponseBytes: raw.SOLANA_RPC_MAX_RESPONSE_BYTES,
      },
      readCommitment: raw.SOLANA_READ_COMMITMENT,
    },
    execution: {
      writesEnabled: raw.EXECUTION_WRITES_ENABLED,
      betaCaps: allBetaCapsPresent
        ? {
            maxOrderNotionalUsdcRaw: raw.BETA_MAX_ORDER_NOTIONAL_USDC_RAW as string,
            maxDailyNotionalUsdcRaw: raw.BETA_MAX_DAILY_NOTIONAL_USDC_RAW as string,
            maxAccountNotionalUsdcRaw: raw.BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW as string,
            participantAllowlistEnabled: raw.BETA_PARTICIPANT_ALLOWLIST_ENABLED as boolean,
          }
        : null,
      releaseEvidenceRef: raw.RELEASE_EVIDENCE_REF ?? null,
    },
    shutdownTimeoutMs: raw.SHUTDOWN_TIMEOUT_MS,
  };
}

function checkRpcUrl(path: string, value: string, issues: ConfigIssue[]): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    issues.push({ path, message: 'must be an absolute http(s) URL' });
    return null;
  }
  if (
    url.protocol === 'http:' &&
    !LOOPBACK_HOSTS.has(url.hostname) &&
    !LOOPBACK_HOSTS.has(url.host)
  ) {
    issues.push({ path, message: 'plain http is only allowed for loopback RPC endpoints' });
  }
  return url;
}

/**
 * Cross-field invariants. Every rule fails closed: an ambiguous or
 * contradictory combination is rejected rather than interpreted.
 */
export function validateInvariants(config: MarkovConfig, raw: RawEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const env = config.markovEnv;
  const cluster = config.solana.cluster;
  const isProdLike = env === 'staging' || env === 'mainnet-read-only' || env === 'production';

  // 1. Runtime mode x cluster matrix.
  if (!ALLOWED_CLUSTERS_BY_ENV[env].includes(cluster)) {
    issues.push({
      path: 'SOLANA_CLUSTER',
      message: `cluster "${cluster}" is not allowed when MARKOV_ENV=${env} (allowed: ${ALLOWED_CLUSTERS_BY_ENV[env].join(', ')})`,
    });
  }

  // 2. Execution writes: only in write-capable modes, and on mainnet only in production.
  if (config.execution.writesEnabled) {
    if (!WRITE_CAPABLE_ENVS.includes(env)) {
      issues.push({
        path: 'EXECUTION_WRITES_ENABLED',
        message: `execution writes cannot be enabled when MARKOV_ENV=${env}`,
      });
    }
    if (cluster === 'mainnet-beta' && env !== 'production') {
      issues.push({
        path: 'EXECUTION_WRITES_ENABLED',
        message: 'mainnet-beta execution writes are only allowed when MARKOV_ENV=production',
      });
    }
    if (env === 'production') {
      if (config.execution.betaCaps === null) {
        issues.push({
          path: 'BETA_MAX_*_USDC_RAW',
          message:
            'production execution writes require BETA_MAX_ORDER_NOTIONAL_USDC_RAW, BETA_MAX_DAILY_NOTIONAL_USDC_RAW, BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW and BETA_PARTICIPANT_ALLOWLIST_ENABLED',
        });
      } else if (!config.execution.betaCaps.participantAllowlistEnabled) {
        issues.push({
          path: 'BETA_PARTICIPANT_ALLOWLIST_ENABLED',
          message: 'production execution writes require the participant allowlist to be enabled',
        });
      }
      if (config.execution.releaseEvidenceRef === null) {
        issues.push({
          path: 'RELEASE_EVIDENCE_REF',
          message: 'production execution writes require a release evidence reference',
        });
      }
    }
  }

  // 3. Genesis hash expectations for public clusters must equal the reviewed constant.
  const known = knownGenesisHash(cluster);
  if (
    known !== null &&
    raw.SOLANA_EXPECTED_GENESIS_HASH !== undefined &&
    raw.SOLANA_EXPECTED_GENESIS_HASH !== known
  ) {
    issues.push({
      path: 'SOLANA_EXPECTED_GENESIS_HASH',
      message: `does not match the reviewed genesis hash for ${cluster}; update KNOWN_GENESIS_HASHES with evidence instead of overriding`,
    });
  }

  // 4. RPC endpoints: https outside loopback; independent secondary where required.
  const primary = checkRpcUrl('SOLANA_RPC_PRIMARY_URL', config.solana.rpc.primaryUrl, issues);
  const secondary =
    config.solana.rpc.secondaryUrl === null
      ? null
      : checkRpcUrl('SOLANA_RPC_SECONDARY_URL', config.solana.rpc.secondaryUrl, issues);
  if (DUAL_RPC_ENVS.includes(env)) {
    if (secondary === null) {
      issues.push({
        path: 'SOLANA_RPC_SECONDARY_URL',
        message: `an independent secondary RPC endpoint is required when MARKOV_ENV=${env}`,
      });
    } else if (primary !== null && primary.host === secondary.host) {
      issues.push({
        path: 'SOLANA_RPC_SECONDARY_URL',
        message: 'secondary RPC endpoint must use a different host than the primary',
      });
    }
  }

  // 5. Temporal: production-like modes need an explicit namespace; production needs TLS.
  if ((env === 'staging' || env === 'production') && config.temporal.namespace === 'default') {
    issues.push({
      path: 'TEMPORAL_NAMESPACE',
      message: `an explicit, non-default namespace is required when MARKOV_ENV=${env}`,
    });
  }
  if (env === 'production' && !config.temporal.tls) {
    issues.push({ path: 'TEMPORAL_TLS', message: 'TLS is required for Temporal in production' });
  }

  // 6. Database URL shape and transport.
  let dbUrl: URL | null = null;
  try {
    dbUrl = new URL(config.database.url);
  } catch {
    issues.push({ path: 'DATABASE_URL', message: 'must be a postgres:// or postgresql:// URL' });
  }
  if (dbUrl !== null && dbUrl.protocol !== 'postgres:' && dbUrl.protocol !== 'postgresql:') {
    issues.push({
      path: 'DATABASE_URL',
      message: 'must use the postgres:// or postgresql:// scheme',
    });
  }
  if (env === 'production' && config.database.ssl !== 'require') {
    issues.push({ path: 'DATABASE_SSL', message: 'production requires DATABASE_SSL=require' });
  }

  // 7. Logging.
  if (isProdLike && config.log.format === 'pretty') {
    issues.push({
      path: 'LOG_FORMAT',
      message: `pretty logs are not allowed when MARKOV_ENV=${env}`,
    });
  }

  // 8. CORS origins: exact origins only, never wildcards.
  for (const origin of config.api.allowedOrigins) {
    if (origin === '*' || origin === 'null') {
      issues.push({
        path: 'API_ALLOWED_ORIGINS',
        message: `"${origin}" is not an acceptable origin`,
      });
      continue;
    }
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      parsed = null;
    }
    if (parsed === null || parsed.origin !== origin) {
      issues.push({
        path: 'API_ALLOWED_ORIGINS',
        message: `"${origin}" must be an exact origin such as https://markov.pet (no path, no trailing slash)`,
      });
    }
  }

  return issues;
}

/** Parse and validate; return issues instead of throwing. */
export function tryLoadConfig(env: EnvSource): LoadConfigResult {
  const parsed = rawEnvSchema.safeParse(withoutEmptyValues(env));
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
        message: issue.message,
      })),
    };
  }
  const config = structure(parsed.data);
  const issues = validateInvariants(config, parsed.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, config };
}

/** Parse and validate; throw a ConfigError listing every issue. */
export function loadConfig(env: EnvSource = process.env): MarkovConfig {
  const result = tryLoadConfig(env);
  if (!result.ok) {
    throw new ConfigError(result.issues);
  }
  return result.config;
}

/** Secret-free summary suitable for logs, the CLI and readiness output. */
export function describeConfig(config: MarkovConfig): Record<string, unknown> {
  return {
    markovEnv: config.markovEnv,
    serviceVersion: config.serviceVersion,
    log: config.log,
    api: config.api,
    database: {
      url: redactUrl(config.database.url, { keepPath: true }),
      ssl: config.database.ssl,
      poolMax: config.database.poolMax,
      statementTimeoutMs: config.database.statementTimeoutMs,
    },
    temporal: {
      address: config.temporal.address,
      namespace: config.temporal.namespace,
      taskQueues: config.temporal.taskQueues,
      tls: config.temporal.tls,
      apiKeyConfigured: config.temporal.apiKey !== null,
    },
    solana: {
      cluster: config.solana.cluster,
      expectedGenesisHash: config.solana.expectedGenesisHash,
      rpc: {
        primaryUrl: redactUrl(config.solana.rpc.primaryUrl),
        secondaryUrl:
          config.solana.rpc.secondaryUrl === null
            ? null
            : redactUrl(config.solana.rpc.secondaryUrl),
        timeoutMs: config.solana.rpc.timeoutMs,
        maxResponseBytes: config.solana.rpc.maxResponseBytes,
      },
      readCommitment: config.solana.readCommitment,
    },
    execution: config.execution,
    shutdownTimeoutMs: config.shutdownTimeoutMs,
  };
}
