import type { FrozenLeg, StrategyDraftContent } from '@markov/contracts';
import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  bindPlatformIdentity,
  createDbClient,
  createInstance,
  createStrategy,
  createWalletChallenge,
  findInstance,
  findStrategy,
  findVersion,
  findVersionById,
  freezeVersion,
  linkWallet,
  listStrategies,
  listVersions,
  pinInstance,
  readDraft,
  runMigrations,
  saveDraft,
  upsertUserBySubject,
  type VersionContent,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NOW = new Date('2026-09-24T12:00:00Z');
const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';

function content(aeroBps: number, cashBps: number): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: AERO, weightBps: aeroBps, note: null },
      { instrumentId: BIO, weightBps: 10_000 - aeroBps - cashBps, note: null },
    ],
    cashWeightBps: cashBps,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}

/** A stand-in for the service's build: the digest is a function of the content alone. */
function buildFor(draft: { content: StrategyDraftContent }): VersionContent {
  const legs: FrozenLeg[] = draft.content.legs.map((leg, index) => ({
    instrumentId: leg.instrumentId,
    weightBps: leg.weightBps,
    note: leg.note,
    issuer: 'prestocks',
    symbol: index === 0 ? 'FXAERO' : 'FXBIO',
    companyName: index === 0 ? 'Fixture Aerospace Inc' : 'Fixture Bio Inc',
    admission: {
      status: 'admitted',
      admittedAt: NOW.toISOString(),
      verificationId: 1,
      verifiedAt: NOW.toISOString(),
      mint: index === 0 ? 'M1' : 'M2',
      tokenProgram: 'spl-token',
      decimals: 6,
      genesisHash: GENESIS,
    },
  }));
  const digest = `${draft.content.legs[0]?.weightBps ?? 0}:${draft.content.cashWeightBps}`;
  return {
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    authorPrincipal: 'user:test',
    title: draft.content.title,
    thesis: draft.content.thesis,
    thesisId: null,
    legs,
    cashWeightBps: draft.content.cashWeightBps,
    maintenance: draft.content.maintenance,
    disclosures: {
      issuers: [{ issuer: 'prestocks', weightBps: 10_000 - draft.content.cashWeightBps }],
      companies: [],
    },
    references: [],
    canonicalManifest: `manifest:${digest}`,
    manifestHash: 'a'.repeat(64),
    contentDigest: digest.padEnd(64, '0'),
  };
}

async function withStrategyDb(
  fn: (
    db: ReturnType<typeof createDbClient>['db'],
    ids: { alice: string; bob: string },
  ) => Promise<void>,
) {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'strategy-store-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'test',
      );
      const alice = await upsertUserBySubject(client.db, {
        issuer: 'https://issuer.test',
        subject: 'did:test:alice',
      });
      const bob = await upsertUserBySubject(client.db, {
        issuer: 'https://issuer.test',
        subject: 'did:test:bob',
      });
      await fn(client.db, { alice: alice.id, bob: bob.id });
    } finally {
      await client.close();
    }
  });
}

describe.skipIf(adminUrl === null)('strategy store', () => {
  it('scopes strategies, drafts, versions and instances to their owner', async () => {
    await withStrategyDb(async (db, { alice, bob }) => {
      const created = await createStrategy(db, {
        ownerUserId: alice,
        content: content(6000, 1000),
        forkOf: null,
        now: NOW,
      });
      expect(created.draft.revision).toBe(1);
      expect(await findStrategy(db, bob, created.strategy.id)).toBeNull();
      expect(await listStrategies(db, bob)).toEqual([]);
      expect(
        await saveDraft(db, {
          ownerUserId: bob,
          strategyId: created.strategy.id,
          content: content(5000, 1000),
          ifRevision: null,
          now: NOW,
        }),
      ).toEqual({ outcome: 'not_found' });
      expect(
        await freezeVersion(db, {
          ownerUserId: bob,
          strategyId: created.strategy.id,
          ifRevision: null,
          now: NOW,
          build: async (draft) => buildFor(draft),
        }),
      ).toEqual({ outcome: 'not_found' });
      expect((await readDraft(db, created.strategy.id)).content.legs[0]?.weightBps).toBe(6000);
    });
  });

  it('applies exactly one of several concurrent saves that name the same revision', async () => {
    await withStrategyDb(async (db, { alice }) => {
      const created = await createStrategy(db, {
        ownerUserId: alice,
        content: content(6000, 1000),
        forkOf: null,
        now: NOW,
      });
      const results = await Promise.all(
        [5000, 5100, 5200, 5300].map((aero) =>
          saveDraft(db, {
            ownerUserId: alice,
            strategyId: created.strategy.id,
            content: content(aero, 1000),
            ifRevision: 1,
            now: NOW,
          }),
        ),
      );
      expect(results.map((result) => result.outcome).sort()).toEqual([
        'applied',
        'conflict',
        'conflict',
        'conflict',
      ]);
      const draft = await readDraft(db, created.strategy.id);
      expect(draft.revision).toBe(2);
      const applied = results.find((result) => result.outcome === 'applied');
      expect(applied && 'draft' in applied ? applied.draft.content : null).toEqual(draft.content);
    });
  });

  it('freezes one version under concurrent freezes and answers the existing version for unchanged content', async () => {
    await withStrategyDb(async (db, { alice }) => {
      const created = await createStrategy(db, {
        ownerUserId: alice,
        content: content(6000, 1000),
        forkOf: null,
        now: NOW,
      });
      const outcomes = await Promise.all(
        [0, 1, 2, 3].map(() =>
          freezeVersion(db, {
            ownerUserId: alice,
            strategyId: created.strategy.id,
            ifRevision: 1,
            now: NOW,
            build: async (draft) => buildFor(draft),
          }),
        ),
      );
      expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual([
        'frozen',
        'unchanged',
        'unchanged',
        'unchanged',
      ]);
      const versions = await listVersions(db, created.strategy.id);
      expect(versions.map((version) => version.versionNumber)).toEqual([1]);
      const stale = await freezeVersion(db, {
        ownerUserId: alice,
        strategyId: created.strategy.id,
        ifRevision: 7,
        now: NOW,
        build: async (draft) => buildFor(draft),
      });
      expect(stale.outcome).toBe('conflict');
    });
  });

  it('proposes a creator’s new version to instances without moving their pins; frozen rows never change', async () => {
    await withStrategyDb(async (db, { alice }) => {
      const created = await createStrategy(db, {
        ownerUserId: alice,
        content: content(6000, 1000),
        forkOf: null,
        now: NOW,
      });
      const first = await freezeVersion(db, {
        ownerUserId: alice,
        strategyId: created.strategy.id,
        ifRevision: null,
        now: NOW,
        build: async (draft) => buildFor(draft),
      });
      if (first.outcome !== 'frozen') {
        throw new Error(`expected frozen, got ${first.outcome}`);
      }
      const challenge = await createWalletChallenge(db, {
        userId: alice,
        chain: 'solana',
        genesisHash: GENESIS,
        address: '11111111111111111111111111111111',
        nonce: 'n1',
        message: 'm',
        expiresAt: new Date(NOW.getTime() + 60_000),
      });
      const wallet = await linkWallet(db, {
        userId: alice,
        chain: 'solana',
        genesisHash: GENESIS,
        address: '11111111111111111111111111111111',
        challengeId: challenge.id,
      });
      const instance = await createInstance(db, {
        ownerUserId: alice,
        strategyId: created.strategy.id,
        versionId: first.version.id,
        walletId: wallet.id,
        label: 'mine',
        now: NOW,
      });
      expect(instance.pinnedVersionId).toBe(first.version.id);
      expect(instance.proposedVersionId).toBeNull();

      await saveDraft(db, {
        ownerUserId: alice,
        strategyId: created.strategy.id,
        content: content(5000, 2000),
        ifRevision: null,
        now: NOW,
      });
      const second = await freezeVersion(db, {
        ownerUserId: alice,
        strategyId: created.strategy.id,
        ifRevision: null,
        now: new Date(NOW.getTime() + 1000),
        build: async (draft) => buildFor(draft),
      });
      if (second.outcome !== 'frozen') {
        throw new Error(`expected frozen, got ${second.outcome}`);
      }
      expect(second.version.parentVersionId).toBe(first.version.id);
      expect(second.strategy.currentVersionId).toBe(second.version.id);

      const afterSecond = await findInstance(db, alice, instance.id);
      expect(afterSecond?.pinnedVersionId).toBe(first.version.id);
      expect(afterSecond?.proposedVersionId).toBe(second.version.id);
      const v1 = await findVersion(db, created.strategy.id, first.version.id);
      expect(await findVersionById(db, first.version.id)).toEqual(first.version);
      expect(v1).toEqual(first.version);

      const pinned = await pinInstance(db, {
        ownerUserId: alice,
        instanceId: instance.id,
        versionId: second.version.id,
        now: NOW,
      });
      expect(pinned?.pinnedVersionId).toBe(second.version.id);
      expect(pinned?.proposedVersionId).toBeNull();
      expect(
        await pinInstance(db, {
          ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          instanceId: instance.id,
          versionId: first.version.id,
          now: NOW,
        }),
      ).toBeNull();
    });
  });
});
