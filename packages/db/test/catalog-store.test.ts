import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  applyIngestion,
  bindPlatformIdentity,
  createDbClient,
  findInstrument,
  InstrumentStatusConflictError,
  type InstrumentUpstreamFields,
  latestMintVerification,
  listInstrumentDecisions,
  listInstruments,
  listInstrumentsForPlanning,
  listIssuerSnapshots,
  recordInstrumentDecision,
  recordIssuerSnapshot,
  recordMintVerification,
  runMigrations,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NOW = new Date('2026-09-24T12:00:00Z');
const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function product(overrides: Partial<InstrumentUpstreamFields> = {}): InstrumentUpstreamFields {
  return {
    productId: 'p-1',
    symbol: 'EXA',
    name: 'Example',
    companyName: 'Example Inc',
    kind: 'pre_ipo_exposure' as const,
    mint: MINT_A,
    decimals: 6,
    tokenProgram: 'unknown' as const,
    website: null,
    description: null,
    referencePrice: null,
    ...overrides,
  };
}

async function withCatalogDb(
  fn: (db: ReturnType<typeof createDbClient>['db'], snapshotId: string) => Promise<void>,
) {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 4,
      statementTimeoutMs: 10_000,
      applicationName: 'catalog-store-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'test',
      );
      const snapshot = await recordIssuerSnapshot(client.db, {
        issuer: 'prestocks',
        source: 'fixture',
        sourceRef: 'fixture:default',
        fetchedAt: NOW,
        contentHash: 'a'.repeat(64),
        schemaVersion: '1',
        itemCount: 2,
        status: 'accepted',
        rejectionReason: null,
        createdBy: 'test',
      });
      await fn(client.db, snapshot.id);
    } finally {
      await client.close();
    }
  });
}

describe.skipIf(adminUrl === null)('catalog store', () => {
  it('applies ingestion writes atomically, paginates by keyset and searches', async () => {
    await withCatalogDb(async (db, snapshotId) => {
      await applyIngestion(db, {
        issuer: 'prestocks',
        genesisHash: GENESIS,
        snapshotId,
        now: NOW,
        writes: [
          {
            kind: 'insert',
            product: product(),
            fingerprint: 'f1',
            status: 'quarantined',
            reasons: [],
          },
          {
            kind: 'insert',
            product: product({
              productId: 'p-2',
              symbol: 'EXB',
              mint: MINT_B,
              companyName: 'Beta Corp',
            }),
            fingerprint: 'f2',
            status: 'quarantined',
            reasons: [],
          },
          {
            kind: 'insert',
            product: product({
              productId: 'p-3',
              symbol: 'EXC',
              mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
            }),
            fingerprint: 'f3',
            status: 'rejected',
            reasons: ['symbol collision'],
          },
        ],
      });
      const planning = await listInstrumentsForPlanning(db, 'prestocks');
      expect(planning.map((row) => [row.issuerProductId, row.status])).toEqual([
        ['p-1', 'quarantined'],
        ['p-2', 'quarantined'],
        ['p-3', 'rejected'],
      ]);
      const page1 = await listInstruments(db, { statuses: ['quarantined', 'rejected'], limit: 2 });
      expect(page1.rows.map((row) => row.symbol)).toEqual(['EXA', 'EXB']);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listInstruments(db, {
        statuses: ['quarantined', 'rejected'],
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
      });
      expect(page2.rows.map((row) => row.symbol)).toEqual(['EXC']);
      expect(page2.nextCursor).toBeNull();
      const search = await listInstruments(db, { statuses: ['quarantined'], limit: 10, q: 'beta' });
      expect(search.rows.map((row) => row.symbol)).toEqual(['EXB']);
      expect(
        (await listInstruments(db, { statuses: ['quarantined'], limit: 10, q: '%' })).rows,
      ).toHaveLength(0);
      expect((await listInstruments(db, { statuses: ['admitted'], limit: 10 })).rows).toHaveLength(
        0,
      );
      expect(
        (await listInstruments(db, { statuses: ['quarantined'], limit: 10, cursor: 'garbage' }))
          .rows,
      ).toHaveLength(0);

      // A second live instrument cannot reuse a live mint; the transaction rolls back as a whole.
      await expect(
        applyIngestion(db, {
          issuer: 'prestocks',
          genesisHash: GENESIS,
          snapshotId,
          now: NOW,
          writes: [
            {
              kind: 'insert',
              product: product({
                productId: 'p-4',
                symbol: 'EXD',
                mint: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T',
              }),
              fingerprint: 'f4',
              status: 'quarantined',
              reasons: [],
            },
            {
              kind: 'insert',
              product: product({ productId: 'p-5', symbol: 'EXE', mint: MINT_A }),
              fingerprint: 'f5',
              status: 'quarantined',
              reasons: [],
            },
          ],
        }),
      ).rejects.toThrow();
      expect(
        (await listInstrumentsForPlanning(db, 'prestocks')).map((row) => row.issuerProductId),
      ).toEqual(['p-1', 'p-2', 'p-3']);
      expect((await listIssuerSnapshots(db, 'prestocks')).map((row) => row.sourceRef)).toEqual([
        'fixture:default',
      ]);
    });
  });

  it('records verifications and decisions with a status guard', async () => {
    await withCatalogDb(async (db, snapshotId) => {
      await applyIngestion(db, {
        issuer: 'prestocks',
        genesisHash: GENESIS,
        snapshotId,
        now: NOW,
        writes: [
          {
            kind: 'insert',
            product: product(),
            fingerprint: 'f1',
            status: 'quarantined',
            reasons: [],
          },
        ],
      });
      const row = (await listInstrumentsForPlanning(db, 'prestocks'))[0];
      if (!row) {
        throw new Error('missing instrument');
      }
      expect(await latestMintVerification(db, row.id)).toBeNull();
      const verification = await recordMintVerification(db, {
        instrumentId: row.id,
        rpcHost: 'rpc.test',
        slot: 42,
        result: 'verified',
        onChain: {
          tokenProgram: 'spl-token',
          decimals: 6,
          supply: '1000',
          mintAuthority: null,
          freezeAuthority: null,
          isInitialized: true,
          extensions: [],
          unknownExtensionTypes: [],
        },
        mismatches: [],
        verifiedAt: NOW,
      });
      expect((await latestMintVerification(db, row.id))?.id).toBe(verification.id);
      expect((await findInstrument(db, row.id))?.tokenProgram).toBe('spl-token');

      const decision = await recordInstrumentDecision(db, {
        instrumentId: row.id,
        decision: 'admit',
        reason: 'terms reviewed',
        evidence: { review: 'T-1' },
        decidedBy: 'op-1',
        expectedPreviousStatus: 'quarantined',
        newStatus: 'admitted',
        decidedAt: NOW,
      });
      expect(decision.previousStatus).toBe('quarantined');
      const admitted = await findInstrument(db, row.id);
      expect(admitted?.status).toBe('admitted');
      expect(admitted?.admittedAt?.toISOString()).toBe(NOW.toISOString());
      await expect(
        recordInstrumentDecision(db, {
          instrumentId: row.id,
          decision: 'admit',
          reason: 'again',
          evidence: {},
          decidedBy: 'op-2',
          expectedPreviousStatus: 'quarantined',
          newStatus: 'admitted',
          decidedAt: NOW,
        }),
      ).rejects.toBeInstanceOf(InstrumentStatusConflictError);
      expect((await listInstrumentDecisions(db, row.id)).map((item) => item.decision)).toEqual([
        'admit',
      ]);

      await applyIngestion(db, {
        issuer: 'prestocks',
        genesisHash: GENESIS,
        snapshotId,
        now: NOW,
        writes: [
          {
            kind: 'invalid',
            instrumentId: row.id,
            currentStatus: 'admitted',
            reasons: ['missing name'],
          },
        ],
      });
      expect((await findInstrument(db, row.id))?.status).toBe('paused');
    });
  });
});
