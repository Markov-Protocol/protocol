import { KNOWN_GENESIS_HASHES } from '@markov/config';
import {
  bindPlatformIdentity,
  createDbClient,
  runMigrations,
  seedCapabilityReadiness,
} from '@markov/db';
import { createSilentLogger } from '@markov/observability';
import {
  baseTestEnv,
  startFakeJsonRpcServer,
  testDatabaseUrl,
  withTemporaryDatabase,
} from '@markov/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { BootError, bootApi, EXIT_CONFIG, EXIT_UNAVAILABLE } from '../src/index.js';

const adminUrl = testDatabaseUrl();
const logger = createSilentLogger();

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function bootFailure(env: Record<string, string>): Promise<BootError> {
  try {
    const booted = await bootApi({ env, logger, listen: { host: '127.0.0.1', port: 0 } });
    await booted.shutdown();
    throw new Error('boot unexpectedly succeeded');
  } catch (error) {
    if (error instanceof BootError) {
      return error;
    }
    throw error;
  }
}

describe('boot refuses to run on contradictory configuration', () => {
  it('rejects invalid configuration with the config exit code', async () => {
    const error = await bootFailure(baseTestEnv({ SOLANA_CLUSTER: 'mainnet-beta' }));
    expect(error.exitCode).toBe(EXIT_CONFIG);
    expect(error.message).toContain('SOLANA_CLUSTER');
  });

  it('reports an unreachable database as unavailable, not as a configuration error', async () => {
    const error = await bootFailure(
      baseTestEnv({ DATABASE_URL: 'postgres://markov:markov@127.0.0.1:1/nope' }),
    );
    expect(error.exitCode).toBe(EXIT_UNAVAILABLE);
    expect(error.message).toContain('database unreachable');
    expect(error.message).not.toContain('markov:markov');
  });
});

describe.skipIf(adminUrl === null)('boot against a real database', () => {
  async function prepared<T>(fn: (url: string) => Promise<T>, bind = true): Promise<T> {
    if (adminUrl === null) {
      throw new Error('unreachable');
    }
    return withTemporaryDatabase(adminUrl, async (url) => {
      const client = createDbClient({
        url,
        ssl: 'disable',
        poolMax: 2,
        statementTimeoutMs: 10_000,
        applicationName: 'boot-test',
      });
      try {
        await runMigrations(client.db);
        if (bind) {
          await bindPlatformIdentity(
            client.db,
            {
              markovEnv: 'test',
              solanaCluster: 'devnet',
              genesisHash: KNOWN_GENESIS_HASHES.devnet,
            },
            'boot-test',
          );
          await seedCapabilityReadiness(client.db, 'boot-test');
        }
      } finally {
        await client.close();
      }
      return fn(url);
    });
  }

  it('refuses an unmigrated database', async () => {
    if (adminUrl === null) {
      return;
    }
    await withTemporaryDatabase(adminUrl, async (url) => {
      const error = await bootFailure(baseTestEnv({ DATABASE_URL: url }));
      expect(error.exitCode).toBe(EXIT_CONFIG);
      expect(error.message).toContain('unmigrated');
    });
  });

  it('refuses a migrated but unbound database', async () => {
    await prepared(async (url) => {
      const error = await bootFailure(baseTestEnv({ DATABASE_URL: url }));
      expect(error.exitCode).toBe(EXIT_CONFIG);
      expect(error.message).toContain('no platform identity');
    }, false);
  });

  it('refuses a database bound to a different cluster', async () => {
    await prepared(async (url) => {
      const error = await bootFailure(
        baseTestEnv({ DATABASE_URL: url, SOLANA_CLUSTER: 'testnet' }),
      );
      expect(error.exitCode).toBe(EXIT_CONFIG);
      expect(error.message).toContain('bound to devnet');
    });
  });

  it('refuses an RPC endpoint that reports a different genesis hash', async () => {
    const rpc = await startFakeJsonRpcServer({
      handlers: { getGenesisHash: () => KNOWN_GENESIS_HASHES['mainnet-beta'] },
    });
    closers.push(rpc.close);
    await prepared(async (url) => {
      const error = await bootFailure(
        baseTestEnv({ DATABASE_URL: url, SOLANA_RPC_PRIMARY_URL: rpc.url }),
      );
      expect(error.exitCode).toBe(EXIT_CONFIG);
      expect(error.message).toContain('network identity mismatch');
    });
  });

  it('boots, serves readiness and shuts down when database and network agree', async () => {
    const rpc = await startFakeJsonRpcServer({
      handlers: { getGenesisHash: () => KNOWN_GENESIS_HASHES.devnet },
    });
    closers.push(rpc.close);
    await prepared(async (url) => {
      const booted = await bootApi({
        env: baseTestEnv({ DATABASE_URL: url, SOLANA_RPC_PRIMARY_URL: rpc.url }),
        logger,
        listen: { host: '127.0.0.1', port: 0 },
      });
      try {
        expect(booted.expectedGenesisHash).toBe(KNOWN_GENESIS_HASHES.devnet);
        const ready = await fetch(`${booted.address}/readyz`);
        expect(ready.status).toBe(200);
        const body = (await ready.json()) as {
          status: string;
          checks: Record<string, { status: string }>;
        };
        expect(body.status).toBe('ready');
        expect(Object.values(body.checks).map((check) => check.status)).toEqual([
          'pass',
          'pass',
          'pass',
          'pass',
        ]);
        const platform = await fetch(`${booted.address}/v1/platform`);
        expect(platform.status).toBe(200);
      } finally {
        await booted.shutdown();
        await booted.shutdown();
      }
      await expect(fetch(`${booted.address}/healthz`)).rejects.toThrow();
    });
  });

  it('boots but reports not ready while the RPC endpoint is unavailable', async () => {
    await prepared(async (url) => {
      const booted = await bootApi({
        env: baseTestEnv({ DATABASE_URL: url, SOLANA_RPC_PRIMARY_URL: 'http://127.0.0.1:1' }),
        logger,
        listen: { host: '127.0.0.1', port: 0 },
      });
      try {
        const ready = await fetch(`${booted.address}/readyz`);
        expect(ready.status).toBe(503);
        const body = (await ready.json()) as { checks: Record<string, { status: string }> };
        expect(body.checks['solana_rpc']?.status).toBe('unverified');
        expect(body.checks['database']?.status).toBe('pass');
      } finally {
        await booted.shutdown();
      }
    });
  });
});
