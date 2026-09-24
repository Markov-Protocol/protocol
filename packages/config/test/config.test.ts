import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  describeConfig,
  KNOWN_GENESIS_HASHES,
  loadConfig,
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
