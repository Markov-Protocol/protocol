import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_CAPABILITY_READINESS,
  bindPlatformIdentity,
  createDbClient,
  type DbClient,
  getMigrationState,
  listCapabilityReadiness,
  PlatformIdentityMismatchError,
  readMigrationJournal,
  readPlatformIdentity,
  runMigrations,
  seedCapabilityReadiness,
  upsertCapabilityReadiness,
  verifyPlatformIdentity,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();

const DEVNET = {
  markovEnv: 'test',
  solanaCluster: 'devnet',
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
} as const;

async function withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  if (adminUrl === null) {
    throw new Error('test requires MARKOV_TEST_DATABASE_URL');
  }
  return withTemporaryDatabase(adminUrl, async (url) => {
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 3,
      statementTimeoutMs: 10_000,
      applicationName: 'markov-db-test',
    });
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  });
}

describe('migration journal', () => {
  it('bundles at least the platform identity migration', () => {
    const journal = readMigrationJournal();
    expect(journal.length).toBeGreaterThan(0);
    expect(journal[0]?.tag).toBe('0000_platform_identity');
  });
});

describe.skipIf(adminUrl === null)('database integration', () => {
  it('reports unmigrated, applies reviewed migrations idempotently and reports current', async () => {
    await withClient(async ({ db, ping }) => {
      expect((await ping()).ok).toBe(true);
      expect((await getMigrationState(db)).status).toBe('unmigrated');
      await runMigrations(db);
      const state = await getMigrationState(db);
      expect(state).toMatchObject({ status: 'current', latestTag: '0000_platform_identity' });
      expect(state.applied).toBe(state.expected);
      await runMigrations(db);
      expect((await getMigrationState(db)).applied).toBe(state.applied);
    });
  });

  it('binds a platform identity once and refuses a contradicting binding', async () => {
    await withClient(async ({ db }) => {
      await runMigrations(db);
      expect(await readPlatformIdentity(db)).toBeNull();
      expect(await verifyPlatformIdentity(db, DEVNET)).toEqual({ status: 'unbound' });

      const first = await bindPlatformIdentity(db, DEVNET, 'test-suite');
      expect(first.created).toBe(true);
      expect(first.stored).toMatchObject({ ...DEVNET, boundBy: 'test-suite' });

      const again = await bindPlatformIdentity(db, DEVNET, 'someone-else');
      expect(again.created).toBe(false);
      expect(again.stored.boundBy).toBe('test-suite');

      await expect(
        bindPlatformIdentity(db, { ...DEVNET, solanaCluster: 'testnet' }, 'attacker'),
      ).rejects.toBeInstanceOf(PlatformIdentityMismatchError);

      const verification = await verifyPlatformIdentity(db, {
        ...DEVNET,
        genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      });
      expect(verification.status).toBe('mismatch');
      if (verification.status === 'mismatch') {
        expect(verification.differences).toEqual([expect.stringContaining('genesisHash')]);
      }
      expect((await verifyPlatformIdentity(db, DEVNET)).status).toBe('bound');
    });
  });

  it('enforces the singleton identity row at the database level', async () => {
    await withClient(async ({ db, pool }) => {
      await runMigrations(db);
      await bindPlatformIdentity(db, DEVNET, 'test-suite');
      await expect(
        pool.query(
          `INSERT INTO platform_identity (id, markov_env, solana_cluster, genesis_hash, bound_by) VALUES (2, 'test', 'devnet', 'x', 'y')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('seeds baseline capabilities without overwriting operator updates', async () => {
    await withClient(async ({ db, pool }) => {
      await runMigrations(db);
      const created = await seedCapabilityReadiness(db, 'migrate');
      expect(created.length).toBe(BASELINE_CAPABILITY_READINESS.length);
      await upsertCapabilityReadiness(db, {
        capability: 'solana.rpc.read',
        status: 'LIVE_READ_VERIFIED',
        summary: 'verified against devnet by operator',
        evidence: { probe: 'markov solana probe', date: '2026-09-24' },
        updatedBy: 'operator@example.test',
      });
      expect(await seedCapabilityReadiness(db, 'migrate')).toEqual([]);
      const rows = await listCapabilityReadiness(db);
      expect(rows.length).toBe(BASELINE_CAPABILITY_READINESS.length);
      expect(rows.find((row) => row.capability === 'solana.rpc.read')).toMatchObject({
        status: 'LIVE_READ_VERIFIED',
        updatedBy: 'operator@example.test',
      });
      await expect(
        pool.query(
          `UPDATE capability_readiness SET status = 'DONE' WHERE capability = 'solana.rpc.read'`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
