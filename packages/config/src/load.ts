import { ConfigError, type ConfigIssue } from './errors.js';
import { knownGenesisHash } from './known-genesis.js';
import { redactUrl } from './redact.js';
import {
  ALLOWED_CLUSTERS_BY_ENV,
  DEVELOPMENT_CREDENTIAL_PEPPER,
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
      venue: {
        provider: raw.EXECUTION_VENUE_PROVIDER === 'disabled' ? null : raw.EXECUTION_VENUE_PROVIDER,
        quoteUrl: raw.EXECUTION_VENUE_QUOTE_URL ?? null,
        buildUrl: raw.EXECUTION_VENUE_BUILD_URL ?? null,
        fixtureComposeMaxLegs: raw.EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS ?? null,
        apiKey: raw.EXECUTION_VENUE_API_KEY ?? null,
      },
    },
    identity: {
      provider: raw.IDENTITY_PROVIDER,
      issuer: raw.IDENTITY_ISSUER ?? 'markov-test-identity',
      audience: raw.IDENTITY_AUDIENCE ?? 'markov-test',
      jwksUrl: raw.IDENTITY_JWKS_URL ?? null,
      algorithms: raw.IDENTITY_ALGORITHMS.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    },
    auth: {
      credentialPepper: raw.CREDENTIAL_PEPPER ?? DEVELOPMENT_CREDENTIAL_PEPPER,
      sessionTtlSeconds: raw.AUTH_SESSION_TTL_SECONDS,
      stepUpMaxAgeSeconds: raw.AUTH_STEP_UP_MAX_AGE_SECONDS,
      walletChallengeDomain: raw.WALLET_CHALLENGE_DOMAIN ?? 'localhost',
      walletChallengeTtlSeconds: raw.WALLET_CHALLENGE_TTL_SECONDS,
    },
    funding: {
      stablecoin: stablecoinFor(raw.SOLANA_CLUSTER, raw.FUNDING_STABLECOIN_MINT),
    },
    research: {
      modelProvider:
        raw.RESEARCH_MODEL_PROVIDER === 'disabled' ? null : raw.RESEARCH_MODEL_PROVIDER,
    },
    companion: {
      modelProvider:
        raw.COMPANION_MODEL_PROVIDER === 'disabled' ? null : raw.COMPANION_MODEL_PROVIDER,
      dailyCostLimitMicros: raw.COMPANION_DAILY_COST_LIMIT_MICROS,
    },
    notifications: {
      emailProvider:
        raw.NOTIFICATIONS_EMAIL_PROVIDER === 'disabled' ? null : raw.NOTIFICATIONS_EMAIL_PROVIDER,
      emailUrl: raw.NOTIFICATIONS_EMAIL_URL ?? null,
      emailApiKey: raw.NOTIFICATIONS_EMAIL_API_KEY ?? null,
      emailFrom: raw.NOTIFICATIONS_EMAIL_FROM ?? null,
      appOrigin: raw.NOTIFICATIONS_APP_ORIGIN ?? null,
    },
    maintenance: {
      apiUrl: raw.MAINTENANCE_API_URL ?? null,
      apiToken: raw.MAINTENANCE_API_TOKEN ?? null,
      tickSeconds: raw.MAINTENANCE_TICK_SECONDS,
    },
    receipts: {
      provider: raw.RECEIPT_SIGNING_PROVIDER === 'local_key' ? 'local_key' : null,
      signingKey:
        raw.RECEIPT_SIGNING_PROVIDER === 'local_key' ? (raw.RECEIPT_SIGNING_KEY ?? null) : null,
      keyId:
        raw.RECEIPT_SIGNING_PROVIDER === 'local_key' ? (raw.RECEIPT_SIGNING_KEY_ID ?? null) : null,
    },
    strategies: { maxLegs: raw.STRATEGY_MAX_LEGS },
    registry: {
      programId: raw.REGISTRY_PROGRAM_ID ?? null,
      publicationEnabled:
        raw.REGISTRY_PROGRAM_ID !== undefined && raw.MARKOV_ENV !== 'mainnet-read-only',
      indexIntervalSeconds: raw.REGISTRY_INDEX_INTERVAL_SECONDS,
    },
    catalog: {
      prestocksFeedUrl: raw.PRESTOCKS_FEED_URL ?? null,
      xstocksFeedUrl: raw.XSTOCKS_FEED_URL ?? null,
      xstocksEventsUrl: raw.XSTOCKS_EVENTS_URL ?? null,
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
/** USDC on mainnet-beta, read live in B03 (SR-MINT-01); every other cluster needs an explicit mint. */
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function stablecoinFor(
  cluster: string,
  configured: string | undefined,
): MarkovConfig['funding']['stablecoin'] {
  if (configured !== undefined) {
    return { symbol: 'USDC', mint: configured, decimals: 6 };
  }
  if (cluster === 'mainnet-beta') {
    return { symbol: 'USDC', mint: MAINNET_USDC_MINT, decimals: 6 };
  }
  return null;
}

export function validateInvariants(config: MarkovConfig, raw: RawEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const env = config.markovEnv;
  const cluster = config.solana.cluster;
  const isProdLike = env === 'staging' || env === 'mainnet-read-only' || env === 'production';
  const isDev = env === 'local' || env === 'test';

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

  // 2b. Registry publication on mainnet-beta is a permanent public write: production only, with release evidence.
  if (config.registry.publicationEnabled && cluster === 'mainnet-beta') {
    if (env !== 'production') {
      issues.push({
        path: 'REGISTRY_PROGRAM_ID',
        message:
          'mainnet-beta registry publication is only allowed when MARKOV_ENV=production (mainnet-read-only may index it)',
      });
    } else if (config.execution.releaseEvidenceRef === null) {
      issues.push({
        path: 'RELEASE_EVIDENCE_REF',
        message: 'production registry publication requires a release evidence reference',
      });
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

  // 8. Identity and credentials: no test issuer, development pepper or localhost challenge domain outside local/test.
  for (const [path, value] of [
    ['PRESTOCKS_FEED_URL', config.catalog.prestocksFeedUrl],
    ['XSTOCKS_FEED_URL', config.catalog.xstocksFeedUrl],
    ['XSTOCKS_EVENTS_URL', config.catalog.xstocksEventsUrl],
    ['EXECUTION_VENUE_QUOTE_URL', config.execution.venue.quoteUrl],
    ['EXECUTION_VENUE_BUILD_URL', config.execution.venue.buildUrl],
  ] as const) {
    if (value === null) {
      continue;
    }
    const feed = new URL(value);
    if (feed.username || feed.password) {
      issues.push({ path, message: 'must not embed credentials' });
    }
    if (!isDev && feed.protocol !== 'https:') {
      issues.push({ path, message: 'must use https outside local and test' });
    }
  }

  if (
    config.execution.venue.fixtureComposeMaxLegs !== null &&
    config.execution.venue.provider !== 'fixture'
  ) {
    issues.push({
      path: 'EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS',
      message: 'is a fixture venue control; set EXECUTION_VENUE_PROVIDER=fixture or unset it',
    });
  }

  // 2c. Receipt signing: a local key is a development and staging convenience, never production;
  // the KMS-backed signer does not exist yet and is refused rather than silently substituted.
  if (raw.RECEIPT_SIGNING_PROVIDER === 'kms') {
    issues.push({
      path: 'RECEIPT_SIGNING_PROVIDER',
      message:
        'the KMS-backed receipt signer is not implemented (OD-22); use local_key outside production or disabled',
    });
  }
  if (raw.RECEIPT_SIGNING_PROVIDER === 'local_key') {
    if (env === 'production') {
      issues.push({
        path: 'RECEIPT_SIGNING_PROVIDER',
        message: 'a local receipt signing key is not allowed when MARKOV_ENV=production',
      });
    }
    if (config.receipts.signingKey === null) {
      issues.push({
        path: 'RECEIPT_SIGNING_KEY',
        message: 'is required when RECEIPT_SIGNING_PROVIDER=local_key',
      });
    }
    if (config.receipts.keyId === null) {
      issues.push({
        path: 'RECEIPT_SIGNING_KEY_ID',
        message: 'is required when RECEIPT_SIGNING_PROVIDER=local_key',
      });
    }
  } else if (raw.RECEIPT_SIGNING_KEY !== undefined || raw.RECEIPT_SIGNING_KEY_ID !== undefined) {
    issues.push({
      path: 'RECEIPT_SIGNING_KEY',
      message:
        'is set but RECEIPT_SIGNING_PROVIDER is not local_key; remove it or enable the provider',
    });
  }

  if (config.research.modelProvider === 'fixture' && !isDev) {
    issues.push({
      path: 'RESEARCH_MODEL_PROVIDER',
      message: `the fixture research model is not allowed when MARKOV_ENV=${env}`,
    });
  }
  if (config.companion.modelProvider === 'fixture' && !isDev) {
    issues.push({
      path: 'COMPANION_MODEL_PROVIDER',
      message: `the fixture companion model is not allowed when MARKOV_ENV=${env}`,
    });
  }
  if (config.notifications.emailProvider === 'fixture' && !isDev) {
    issues.push({
      path: 'NOTIFICATIONS_EMAIL_PROVIDER',
      message: `the fixture email adapter is not allowed when MARKOV_ENV=${env}`,
    });
  }
  if (config.notifications.emailProvider === 'configured') {
    for (const [path, value] of [
      ['NOTIFICATIONS_EMAIL_URL', config.notifications.emailUrl],
      ['NOTIFICATIONS_EMAIL_API_KEY', config.notifications.emailApiKey],
      ['NOTIFICATIONS_EMAIL_FROM', config.notifications.emailFrom],
    ] as const) {
      if (value === null) {
        issues.push({
          path,
          message: 'is required when NOTIFICATIONS_EMAIL_PROVIDER=configured',
        });
      }
    }
  } else {
    if (config.notifications.emailUrl !== null || config.notifications.emailApiKey !== null) {
      issues.push({
        path: 'NOTIFICATIONS_EMAIL_URL',
        message:
          'is set but NOTIFICATIONS_EMAIL_PROVIDER is not configured; remove it or enable the provider',
      });
    }
  }
  if ((config.maintenance.apiUrl === null) !== (config.maintenance.apiToken === null)) {
    issues.push({
      path: 'MAINTENANCE_API_URL',
      message: 'MAINTENANCE_API_URL and MAINTENANCE_API_TOKEN are set together or not at all',
    });
  }
  if (config.execution.venue.provider === 'fixture' && !isDev) {
    issues.push({
      path: 'EXECUTION_VENUE_PROVIDER',
      message: `the fixture execution venue is not allowed when MARKOV_ENV=${env}`,
    });
  }
  if (
    config.execution.venue.provider === 'configured_url' &&
    config.execution.venue.quoteUrl === null
  ) {
    issues.push({
      path: 'EXECUTION_VENUE_QUOTE_URL',
      message: 'is required when EXECUTION_VENUE_PROVIDER=configured_url',
    });
  }
  if (config.execution.venue.provider !== null && config.funding.stablecoin === null) {
    issues.push({
      path: 'FUNDING_STABLECOIN_MINT',
      message:
        'is required when an execution venue is configured: plans are budgeted in the stablecoin',
    });
  }
  if (
    config.execution.venue.provider !== 'configured_url' &&
    config.execution.venue.apiKey !== null
  ) {
    issues.push({
      path: 'EXECUTION_VENUE_API_KEY',
      message:
        'is only used when EXECUTION_VENUE_PROVIDER=configured_url; remove it or configure the gateway',
    });
  }

  if (config.identity.provider === 'test' && !isDev) {
    issues.push({
      path: 'IDENTITY_PROVIDER',
      message: `the test identity issuer is not allowed when MARKOV_ENV=${env}`,
    });
  }
  if (config.identity.provider === 'oidc') {
    if (raw.IDENTITY_ISSUER === undefined) {
      issues.push({ path: 'IDENTITY_ISSUER', message: 'required when IDENTITY_PROVIDER=oidc' });
    }
    if (raw.IDENTITY_AUDIENCE === undefined) {
      issues.push({ path: 'IDENTITY_AUDIENCE', message: 'required when IDENTITY_PROVIDER=oidc' });
    }
    if (config.identity.jwksUrl === null) {
      issues.push({ path: 'IDENTITY_JWKS_URL', message: 'required when IDENTITY_PROVIDER=oidc' });
    }
  }
  for (const algorithm of config.identity.algorithms) {
    if (!/^(ES256|ES384|ES512|RS256|RS384|RS512|PS256|PS384|PS512|EdDSA)$/.test(algorithm)) {
      issues.push({
        path: 'IDENTITY_ALGORITHMS',
        message: `algorithm "${algorithm}" is not an accepted asymmetric algorithm`,
      });
    }
  }
  if (!isDev && config.auth.credentialPepper === DEVELOPMENT_CREDENTIAL_PEPPER) {
    issues.push({
      path: 'CREDENTIAL_PEPPER',
      message: `an explicit credential pepper is required when MARKOV_ENV=${env}`,
    });
  }
  if (
    !isDev &&
    (config.auth.walletChallengeDomain === 'localhost' || raw.WALLET_CHALLENGE_DOMAIN === undefined)
  ) {
    issues.push({
      path: 'WALLET_CHALLENGE_DOMAIN',
      message: `the wallet challenge domain must be the real origin host when MARKOV_ENV=${env}`,
    });
  }

  // 9. CORS origins: exact origins only, never wildcards.
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
    execution: {
      writesEnabled: config.execution.writesEnabled,
      betaCaps: config.execution.betaCaps,
      releaseEvidenceRef: config.execution.releaseEvidenceRef,
      venue: {
        provider: config.execution.venue.provider,
        quoteUrl:
          config.execution.venue.quoteUrl === null
            ? null
            : redactUrl(config.execution.venue.quoteUrl),
        buildUrl:
          config.execution.venue.buildUrl === null
            ? null
            : redactUrl(config.execution.venue.buildUrl),
        fixtureComposeMaxLegs: config.execution.venue.fixtureComposeMaxLegs,
        apiKeyConfigured: config.execution.venue.apiKey !== null,
      },
    },
    funding: config.funding,
    research: config.research,
    companion: config.companion,
    notifications: {
      emailProvider: config.notifications.emailProvider,
      emailUrl:
        config.notifications.emailUrl === null ? null : redactUrl(config.notifications.emailUrl),
      emailFrom: config.notifications.emailFrom,
      appOrigin: config.notifications.appOrigin,
      emailApiKeyConfigured: config.notifications.emailApiKey !== null,
    },
    maintenance: {
      apiUrl: config.maintenance.apiUrl === null ? null : redactUrl(config.maintenance.apiUrl),
      apiTokenConfigured: config.maintenance.apiToken !== null,
      tickSeconds: config.maintenance.tickSeconds,
    },
    receipts: { provider: config.receipts.provider, keyId: config.receipts.keyId },
    strategies: config.strategies,
    registry: config.registry,
    identity: config.identity,
    auth: {
      credentialPepperConfigured: config.auth.credentialPepper !== DEVELOPMENT_CREDENTIAL_PEPPER,
      sessionTtlSeconds: config.auth.sessionTtlSeconds,
      stepUpMaxAgeSeconds: config.auth.stepUpMaxAgeSeconds,
      walletChallengeDomain: config.auth.walletChallengeDomain,
      walletChallengeTtlSeconds: config.auth.walletChallengeTtlSeconds,
    },
    shutdownTimeoutMs: config.shutdownTimeoutMs,
  };
}
