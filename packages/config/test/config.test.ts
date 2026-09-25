import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  describeConfig,
  KNOWN_GENESIS_HASHES,
  loadConfig,
  MAINNET_USDC_MINT,
  redactUrl,
  tryLoadConfig,
} from '../src/index.js';

const base: Record<string, string> = {
  MARKOV_ENV: 'local',
  DATABASE_URL: 'postgres://markov:secret-pw@127.0.0.1:5432/markov_dev',
  SOLANA_CLUSTER: 'devnet',
  SOLANA_RPC_PRIMARY_URL: 'https://rpc-a.example.test/v1/super-secret-key',
};

function issuesOf(env: Record<string, string>): string[] {
  const result = tryLoadConfig(env);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('loadConfig', () => {
  it('accepts a minimal local devnet configuration and applies defaults', () => {
    const config = loadConfig(base);
    expect(config.markovEnv).toBe('local');
    expect(config.api.port).toBe(3000);
    expect(config.database.ssl).toBe('disable');
    expect(config.solana.expectedGenesisHash).toBe(KNOWN_GENESIS_HASHES.devnet);
    expect(config.execution.writesEnabled).toBe(false);
    expect(config.execution.betaCaps).toBeNull();
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ ...base, API_PORT: '', LOG_LEVEL: '' });
    expect(config.api.port).toBe(3000);
    expect(config.log.level).toBe('info');
  });

  it('throws a ConfigError listing every issue without echoing values', () => {
    let caught: unknown;
    try {
      loadConfig({ ...base, API_ALLOWED_ORIGINS: '*', DATABASE_URL: 'mysql://x' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const error = caught as ConfigError;
    expect(error.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['API_ALLOWED_ORIGINS', 'DATABASE_URL']),
    );
    expect(error.message).not.toContain('secret-pw');
  });

  it('rejects malformed values at the schema layer', () => {
    expect(issuesOf({ ...base, API_PORT: '70000' })).toEqual([expect.stringContaining('API_PORT')]);
    expect(issuesOf({ ...base, SOLANA_RPC_PRIMARY_URL: 'ftp://x' })).toEqual([
      expect.stringContaining('SOLANA_RPC_PRIMARY_URL'),
    ]);
    const genesisIssues = issuesOf({ ...base, SOLANA_EXPECTED_GENESIS_HASH: '0OIl' });
    expect(genesisIssues.length).toBeGreaterThan(0);
    expect(genesisIssues.every((issue) => issue.startsWith('SOLANA_EXPECTED_GENESIS_HASH'))).toBe(
      true,
    );
    expect(issuesOf({ ...base, BETA_MAX_ORDER_NOTIONAL_USDC_RAW: '0' })).toEqual([
      expect.stringContaining('BETA_MAX_ORDER_NOTIONAL_USDC_RAW'),
    ]);
  });
});

describe('runtime mode x cluster matrix', () => {
  const prodBase = {
    ...base,
    MARKOV_ENV: 'production',
    SOLANA_CLUSTER: 'mainnet-beta',
    SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.test/',
    TEMPORAL_NAMESPACE: 'markov-prod',
    TEMPORAL_TLS: 'true',
    DATABASE_SSL: 'require',
    IDENTITY_PROVIDER: 'oidc',
    IDENTITY_ISSUER: 'https://auth.example.test',
    IDENTITY_AUDIENCE: 'markov-app',
    IDENTITY_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
    CREDENTIAL_PEPPER: 'a-production-pepper-with-at-least-32-characters',
    WALLET_CHALLENGE_DOMAIN: 'markov.pet',
  };

  it('production requires mainnet-beta', () => {
    expect(issuesOf({ ...prodBase, SOLANA_CLUSTER: 'devnet' })).toEqual([
      expect.stringContaining('SOLANA_CLUSTER'),
    ]);
  });

  it('mainnet-read-only never allows execution writes', () => {
    expect(
      issuesOf({
        ...prodBase,
        MARKOV_ENV: 'mainnet-read-only',
        EXECUTION_WRITES_ENABLED: 'true',
      }),
    ).toEqual([
      expect.stringContaining('cannot be enabled when MARKOV_ENV=mainnet-read-only'),
      expect.stringContaining('only allowed when MARKOV_ENV=production'),
    ]);
  });

  it('test mode cannot bind to mainnet-beta', () => {
    expect(issuesOf({ ...base, MARKOV_ENV: 'test', SOLANA_CLUSTER: 'mainnet-beta' })).toEqual([
      expect.stringContaining('SOLANA_CLUSTER'),
    ]);
  });

  it('local may read mainnet-beta but not write to it', () => {
    expect(issuesOf({ ...base, SOLANA_CLUSTER: 'mainnet-beta' })).toEqual([]);
    expect(
      issuesOf({ ...base, SOLANA_CLUSTER: 'mainnet-beta', EXECUTION_WRITES_ENABLED: 'true' }),
    ).toEqual([expect.stringContaining('mainnet-beta execution writes')]);
  });

  it('staging with mainnet-beta is read-only and needs an independent secondary RPC', () => {
    const staging = {
      ...base,
      MARKOV_ENV: 'staging',
      SOLANA_CLUSTER: 'mainnet-beta',
      TEMPORAL_NAMESPACE: 'markov-staging',
      IDENTITY_PROVIDER: 'oidc',
      IDENTITY_ISSUER: 'https://auth.example.test',
      IDENTITY_AUDIENCE: 'markov-app',
      IDENTITY_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
      CREDENTIAL_PEPPER: 'a-staging-pepper-with-at-least-32-characters!',
      WALLET_CHALLENGE_DOMAIN: 'staging.markov.pet',
    };
    expect(issuesOf(staging)).toEqual([expect.stringContaining('SOLANA_RPC_SECONDARY_URL')]);
    expect(
      issuesOf({ ...staging, SOLANA_RPC_SECONDARY_URL: 'https://rpc-a.example.test/other' }),
    ).toEqual([expect.stringContaining('different host')]);
    expect(
      issuesOf({ ...staging, SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.test/' }),
    ).toEqual([]);
  });

  it('production execution writes are fail-closed until beta caps and evidence exist', () => {
    const issues = issuesOf({ ...prodBase, EXECUTION_WRITES_ENABLED: 'true' });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('BETA_MAX_*_USDC_RAW'),
        expect.stringContaining('RELEASE_EVIDENCE_REF'),
      ]),
    );
    const complete = {
      ...prodBase,
      EXECUTION_WRITES_ENABLED: 'true',
      BETA_MAX_ORDER_NOTIONAL_USDC_RAW: '250000000',
      BETA_MAX_DAILY_NOTIONAL_USDC_RAW: '1000000000',
      BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW: '5000000000',
      BETA_PARTICIPANT_ALLOWLIST_ENABLED: 'true',
      RELEASE_EVIDENCE_REF: 'release-evidence/2026-10-01',
    };
    expect(issuesOf(complete)).toEqual([]);
    expect(issuesOf({ ...complete, BETA_PARTICIPANT_ALLOWLIST_ENABLED: 'false' })).toEqual([
      expect.stringContaining('participant allowlist'),
    ]);
  });

  it('production requires Temporal TLS, a non-default namespace, database SSL and json logs', () => {
    const issues = issuesOf({
      ...prodBase,
      TEMPORAL_TLS: 'false',
      TEMPORAL_NAMESPACE: 'default',
      DATABASE_SSL: 'disable',
      LOG_FORMAT: 'pretty',
    });
    expect(issues.map((issue) => issue.split(':')[0])).toEqual(
      expect.arrayContaining(['TEMPORAL_TLS', 'TEMPORAL_NAMESPACE', 'DATABASE_SSL', 'LOG_FORMAT']),
    );
  });

  it('valid production read-only configuration passes', () => {
    expect(
      issuesOf({ ...prodBase, MARKOV_ENV: 'mainnet-read-only', TEMPORAL_TLS: 'false' }),
    ).toEqual([]);
  });
});

describe('identity and credential configuration', () => {
  it('defaults to the test issuer and development pepper only in local and test', () => {
    const config = loadConfig(base);
    expect(config.identity).toEqual({
      provider: 'test',
      issuer: 'markov-test-identity',
      audience: 'markov-test',
      jwksUrl: null,
      algorithms: ['ES256'],
    });
    expect(config.auth.walletChallengeDomain).toBe('localhost');
    const staging = issuesOf({
      ...base,
      MARKOV_ENV: 'staging',
      TEMPORAL_NAMESPACE: 'markov-staging',
      SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.test/',
    });
    expect(staging).toEqual(
      expect.arrayContaining([
        expect.stringContaining('IDENTITY_PROVIDER'),
        expect.stringContaining('CREDENTIAL_PEPPER'),
        expect.stringContaining('WALLET_CHALLENGE_DOMAIN'),
      ]),
    );
  });

  it('requires issuer, audience and a JWKS URL for an OIDC provider and rejects symmetric algorithms', () => {
    expect(issuesOf({ ...base, IDENTITY_PROVIDER: 'oidc' })).toEqual([
      expect.stringContaining('IDENTITY_ISSUER'),
      expect.stringContaining('IDENTITY_AUDIENCE'),
      expect.stringContaining('IDENTITY_JWKS_URL'),
    ]);
    expect(issuesOf({ ...base, IDENTITY_ALGORITHMS: 'ES256,HS256' })).toEqual([
      expect.stringContaining('HS256'),
    ]);
    expect(issuesOf({ ...base, IDENTITY_JWKS_URL: 'http://auth.example.test/jwks' })).toEqual([
      expect.stringContaining('IDENTITY_JWKS_URL'),
    ]);
  });

  it('knows USDC on mainnet-beta only and otherwise needs an explicit stablecoin mint', () => {
    expect(loadConfig(base).funding.stablecoin).toBeNull();
    expect(
      loadConfig({
        ...base,
        FUNDING_STABLECOIN_MINT: 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts',
      }).funding.stablecoin,
    ).toEqual({
      symbol: 'USDC',
      mint: 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts',
      decimals: 6,
    });
    expect(loadConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta' }).funding.stablecoin).toEqual({
      symbol: 'USDC',
      mint: MAINNET_USDC_MINT,
      decimals: 6,
    });
    expect(() => loadConfig({ ...base, FUNDING_STABLECOIN_MINT: 'not-base58!' })).toThrow();
  });

  it('allows the fixture research model in local and test only', () => {
    expect(loadConfig(base).research.modelProvider).toBeNull();
    expect(loadConfig({ ...base, RESEARCH_MODEL_PROVIDER: 'fixture' }).research.modelProvider).toBe(
      'fixture',
    );
    const staging = tryLoadConfig({
      ...base,
      MARKOV_ENV: 'staging',
      RESEARCH_MODEL_PROVIDER: 'fixture',
    });
    expect(staging.ok).toBe(false);
    if (!staging.ok) {
      expect(staging.issues.map((issue) => issue.path)).toContain('RESEARCH_MODEL_PROVIDER');
    }
    expect(() => loadConfig({ ...base, RESEARCH_MODEL_PROVIDER: 'openai' })).toThrow();
  });

  it('allows the fixture companion model in local and test only and bounds the daily cost', () => {
    expect(loadConfig(base).companion).toEqual({
      modelProvider: null,
      dailyCostLimitMicros: 5_000_000,
    });
    expect(
      loadConfig({
        ...base,
        COMPANION_MODEL_PROVIDER: 'fixture',
        COMPANION_DAILY_COST_LIMIT_MICROS: '1000',
      }).companion,
    ).toEqual({ modelProvider: 'fixture', dailyCostLimitMicros: 1000 });
    const staging = tryLoadConfig({
      ...base,
      MARKOV_ENV: 'staging',
      COMPANION_MODEL_PROVIDER: 'fixture',
    });
    expect(staging.ok).toBe(false);
    if (!staging.ok) {
      expect(staging.issues.map((issue) => issue.path)).toContain('COMPANION_MODEL_PROVIDER');
    }
    expect(() => loadConfig({ ...base, COMPANION_DAILY_COST_LIMIT_MICROS: '1' })).toThrow();
  });

  it('configures the xAI model provider fail-closed (B17)', () => {
    expect(loadConfig(base).xai).toEqual({
      apiKey: null,
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4',
      timeoutMs: 30_000,
      inputMicrosPerToken: 3,
      outputMicrosPerToken: 15,
    });
    const key = ['xai', 'test', 'k'.repeat(24)].join('-');
    const configured = loadConfig({
      ...base,
      RESEARCH_MODEL_PROVIDER: 'xai',
      COMPANION_MODEL_PROVIDER: 'xai',
      XAI_API_KEY: key,
      XAI_MODEL: 'grok-3-mini',
      XAI_INPUT_MICROS_PER_TOKEN: '1',
    });
    expect(configured.research.modelProvider).toBe('xai');
    expect(configured.companion.modelProvider).toBe('xai');
    expect(configured.xai).toMatchObject({
      apiKey: key,
      model: 'grok-3-mini',
      inputMicrosPerToken: 1,
    });
    expect(JSON.stringify(describeConfig(configured))).not.toContain(key);
    const missingKey = tryLoadConfig({ ...base, COMPANION_MODEL_PROVIDER: 'xai' });
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) {
      expect(missingKey.issues.map((issue) => issue.path)).toContain('XAI_API_KEY');
    }
    const strayKey = tryLoadConfig({ ...base, XAI_API_KEY: key });
    expect(strayKey.ok).toBe(false);
    if (!strayKey.ok) {
      expect(strayKey.issues.map((issue) => issue.path)).toContain('XAI_API_KEY');
    }
    const insecure = tryLoadConfig({
      ...base,
      MARKOV_ENV: 'staging',
      DATABASE_SSL: 'require',
      SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.invalid',
      CREDENTIAL_PEPPER: 'p'.repeat(40),
      RESEARCH_MODEL_PROVIDER: 'xai',
      XAI_API_KEY: key,
      XAI_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(insecure.ok).toBe(false);
    if (!insecure.ok) {
      expect(insecure.issues.map((issue) => issue.path)).toContain('XAI_BASE_URL');
    }
    expect(() => loadConfig({ ...base, XAI_API_KEY: 'short' })).toThrow();
  });

  it('configures notification email and the maintenance driver fail-closed (B16)', () => {
    expect(loadConfig(base).notifications).toEqual({
      emailProvider: null,
      emailUrl: null,
      emailApiKey: null,
      emailFrom: null,
      appOrigin: null,
    });
    expect(loadConfig(base).maintenance).toEqual({ apiUrl: null, apiToken: null, tickSeconds: 60 });
    expect(
      loadConfig({ ...base, NOTIFICATIONS_EMAIL_PROVIDER: 'fixture' }).notifications.emailProvider,
    ).toBe('fixture');
    const staging = tryLoadConfig({
      ...base,
      MARKOV_ENV: 'staging',
      NOTIFICATIONS_EMAIL_PROVIDER: 'fixture',
    });
    expect(staging.ok).toBe(false);
    if (!staging.ok) {
      expect(staging.issues.map((issue) => issue.path)).toContain('NOTIFICATIONS_EMAIL_PROVIDER');
    }
    const configured = tryLoadConfig({ ...base, NOTIFICATIONS_EMAIL_PROVIDER: 'configured' });
    expect(configured.ok).toBe(false);
    if (!configured.ok) {
      expect(configured.issues.map((issue) => issue.path).sort()).toEqual([
        'NOTIFICATIONS_EMAIL_API_KEY',
        'NOTIFICATIONS_EMAIL_FROM',
        'NOTIFICATIONS_EMAIL_URL',
      ]);
    }
    const complete = loadConfig({
      ...base,
      NOTIFICATIONS_EMAIL_PROVIDER: 'configured',
      NOTIFICATIONS_EMAIL_URL: 'https://mail.example.invalid/send',
      NOTIFICATIONS_EMAIL_API_KEY: 'mail-key',
      NOTIFICATIONS_EMAIL_FROM: 'notifications@markov.pet',
      NOTIFICATIONS_APP_ORIGIN: 'https://markov.pet',
    });
    expect(complete.notifications.emailProvider).toBe('configured');
    expect(JSON.stringify(describeConfig(complete))).not.toContain('mail-key');
    expect(
      tryLoadConfig({ ...base, NOTIFICATIONS_EMAIL_URL: 'https://mail.example.invalid/send' }).ok,
    ).toBe(false);
    expect(tryLoadConfig({ ...base, MAINTENANCE_API_URL: 'http://127.0.0.1:3000' }).ok).toBe(false);
    const driver = loadConfig({
      ...base,
      MAINTENANCE_API_URL: 'http://127.0.0.1:3000',
      MAINTENANCE_API_TOKEN: 'mkv_wk_prefix_secretsecretsecret',
      MAINTENANCE_TICK_SECONDS: '15',
    });
    expect(driver.maintenance).toEqual({
      apiUrl: 'http://127.0.0.1:3000',
      apiToken: 'mkv_wk_prefix_secretsecretsecret',
      tickSeconds: 15,
    });
    expect(JSON.stringify(describeConfig(driver))).not.toContain('secretsecretsecret');
  });

  it('configures the execution venue fail-closed and keeps its key out of the description', () => {
    expect(loadConfig(base).execution.venue).toEqual({
      provider: null,
      quoteUrl: null,
      buildUrl: null,
      fixtureComposeMaxLegs: null,
      apiKey: null,
    });
    expect(
      issuesOf({ ...base, EXECUTION_VENUE_PROVIDER: 'fixture' }).some((issue) =>
        issue.startsWith('FUNDING_STABLECOIN_MINT: is required when an execution venue'),
      ),
    ).toBe(true);
    expect(
      loadConfig({
        ...base,
        EXECUTION_VENUE_PROVIDER: 'fixture',
        FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
      }).execution.venue.provider,
    ).toBe('fixture');
    expect(
      issuesOf({
        ...base,
        MARKOV_ENV: 'staging',
        EXECUTION_VENUE_PROVIDER: 'fixture',
        FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
      }).some((issue) => issue.startsWith('EXECUTION_VENUE_PROVIDER')),
    ).toBe(true);
    expect(
      issuesOf({
        ...base,
        EXECUTION_VENUE_PROVIDER: 'configured_url',
        FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
      }).some((issue) => issue.startsWith('EXECUTION_VENUE_QUOTE_URL: is required')),
    ).toBe(true);
    expect(
      issuesOf({ ...base, EXECUTION_VENUE_API_KEY: 'k' }).some((issue) =>
        issue.startsWith('EXECUTION_VENUE_API_KEY'),
      ),
    ).toBe(true);
    expect(
      issuesOf({
        ...base,
        MARKOV_ENV: 'staging',
        SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.test/v1/key',
        EXECUTION_VENUE_PROVIDER: 'configured_url',
        EXECUTION_VENUE_QUOTE_URL: 'http://gateway.example.test/quote',
        FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
      }).some((issue) => issue.startsWith('EXECUTION_VENUE_QUOTE_URL: must use https')),
    ).toBe(true);
    expect(
      issuesOf({
        ...base,
        EXECUTION_VENUE_PROVIDER: 'configured_url',
        EXECUTION_VENUE_QUOTE_URL: 'https://user:pw@gateway.example.test/quote',
        FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
      }).some((issue) => issue.startsWith('EXECUTION_VENUE_QUOTE_URL: must not embed')),
    ).toBe(true);
    const configured = loadConfig({
      ...base,
      EXECUTION_VENUE_PROVIDER: 'configured_url',
      EXECUTION_VENUE_QUOTE_URL: 'https://gateway.example.test/v1/quote?token=secret-token',
      EXECUTION_VENUE_API_KEY: 'k-secret',
      FUNDING_STABLECOIN_MINT: MAINNET_USDC_MINT,
    });
    expect(configured.execution.venue.apiKey).toBe('k-secret');
    const described = JSON.stringify(describeConfig(configured));
    expect(described).not.toContain('k-secret');
    expect(described).not.toContain('secret-token');
    expect(described).toContain('"apiKeyConfigured":true');
  });

  it('bounds the recipe leg limit to at most ten', () => {
    expect(loadConfig(base).strategies.maxLegs).toBe(10);
    expect(loadConfig({ ...base, STRATEGY_MAX_LEGS: '4' }).strategies.maxLegs).toBe(4);
    expect(() => loadConfig({ ...base, STRATEGY_MAX_LEGS: '11' })).toThrow();
    expect(() => loadConfig({ ...base, STRATEGY_MAX_LEGS: '0' })).toThrow();
  });

  it('keeps registry publication disabled without a program id and fail-closed on mainnet', () => {
    const disabled = loadConfig(base);
    expect(disabled.registry).toEqual({
      programId: null,
      publicationEnabled: false,
      indexIntervalSeconds: 30,
    });
    const program = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
    const devnet = loadConfig({
      ...base,
      REGISTRY_PROGRAM_ID: program,
      REGISTRY_INDEX_INTERVAL_SECONDS: '5',
    });
    expect(devnet.registry).toEqual({
      programId: program,
      publicationEnabled: true,
      indexIntervalSeconds: 5,
    });
    expect(() => loadConfig({ ...base, REGISTRY_PROGRAM_ID: 'not-base58!' })).toThrow();
    expect(() => loadConfig({ ...base, REGISTRY_INDEX_INTERVAL_SECONDS: '1' })).toThrow();
    // Read-only mainnet mode may index the registry but never publishes.
    const readOnly = loadConfig({
      ...base,
      MARKOV_ENV: 'mainnet-read-only',
      SOLANA_CLUSTER: 'mainnet-beta',
      SOLANA_RPC_SECONDARY_URL: 'https://rpc-b.example.test/',
      TEMPORAL_NAMESPACE: 'markov-prod',
      DATABASE_SSL: 'require',
      IDENTITY_PROVIDER: 'oidc',
      IDENTITY_ISSUER: 'https://auth.example.test',
      IDENTITY_AUDIENCE: 'markov-app',
      IDENTITY_JWKS_URL: 'https://auth.example.test/.well-known/jwks.json',
      CREDENTIAL_PEPPER: 'a-production-pepper-with-at-least-32-characters',
      WALLET_CHALLENGE_DOMAIN: 'markov.pet',
      LOG_FORMAT: 'json',
      REGISTRY_PROGRAM_ID: program,
    });
    expect(readOnly.registry.publicationEnabled).toBe(false);
    // Mainnet publication outside production, or without release evidence, is refused.
    expect(
      issuesOf({ ...base, SOLANA_CLUSTER: 'mainnet-beta', REGISTRY_PROGRAM_ID: program }).some(
        (issue) => issue.startsWith('REGISTRY_PROGRAM_ID'),
      ),
    ).toBe(true);
  });

  it('keeps the pepper out of the configuration summary', () => {
    const config = loadConfig({
      ...base,
      CREDENTIAL_PEPPER: 'a-local-pepper-with-at-least-32-characters-x',
    });
    const text = JSON.stringify(describeConfig(config));
    expect(text).not.toContain('a-local-pepper');
    expect(text).toContain('"credentialPepperConfigured":true');
  });
});

describe('network identity expectations', () => {
  it('rejects a genesis override that contradicts the reviewed constant for a public cluster', () => {
    expect(
      issuesOf({ ...base, SOLANA_EXPECTED_GENESIS_HASH: KNOWN_GENESIS_HASHES['mainnet-beta'] }),
    ).toEqual([expect.stringContaining('SOLANA_EXPECTED_GENESIS_HASH')]);
  });

  it('leaves localnet genesis unknown until an explicit expectation is configured', () => {
    const config = loadConfig({
      ...base,
      SOLANA_CLUSTER: 'localnet',
      SOLANA_RPC_PRIMARY_URL: 'http://127.0.0.1:8899',
    });
    expect(config.solana.expectedGenesisHash).toBeNull();
  });

  it('rejects plain http RPC endpoints that are not loopback', () => {
    expect(issuesOf({ ...base, SOLANA_RPC_PRIMARY_URL: 'http://rpc.example.test' })).toEqual([
      expect.stringContaining('loopback'),
    ]);
  });
});

describe('CORS origins', () => {
  it('rejects wildcards, null and non-origin values', () => {
    expect(issuesOf({ ...base, API_ALLOWED_ORIGINS: '*' })).toEqual([
      expect.stringContaining('API_ALLOWED_ORIGINS'),
    ]);
    expect(issuesOf({ ...base, API_ALLOWED_ORIGINS: 'https://markov.pet/app' })).toEqual([
      expect.stringContaining('exact origin'),
    ]);
    expect(
      issuesOf({ ...base, API_ALLOWED_ORIGINS: 'https://markov.pet, https://markov.trade' }),
    ).toEqual([]);
  });
});

describe('redaction', () => {
  it('redacts passwords, query values and provider paths', () => {
    expect(redactUrl('https://user:pw@rpc.example.test/v1/key123?api-key=abc#frag')).toBe(
      'https://user:***@rpc.example.test/[redacted-path]?api-key=***',
    );
    expect(redactUrl('postgres://markov:pw@db.internal:5432/markov', { keepPath: true })).toBe(
      'postgres://markov:***@db.internal:5432/markov',
    );
    expect(redactUrl('not a url')).toBe('[unparseable-url]');
  });

  it('describeConfig never contains secrets', () => {
    const config = loadConfig({ ...base, TEMPORAL_API_KEY: 'tmprl-secret' });
    const text = JSON.stringify(describeConfig(config));
    expect(text).not.toContain('secret-pw');
    expect(text).not.toContain('super-secret-key');
    expect(text).not.toContain('tmprl-secret');
    expect(text).toContain('"apiKeyConfigured":true');
  });
});
