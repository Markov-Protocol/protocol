import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  appendRevision,
  bindPlatformIdentity,
  cancelRun,
  createDbClient,
  createRun,
  createThesis,
  currentRevision,
  findRun,
  findThesis,
  findThesisAnyOwner,
  finishRun,
  listRevisions,
  listRuns,
  listSources,
  listTheses,
  type RevisionWrite,
  recordSource,
  runMigrations,
  startRun,
  updateThesis,
  upsertUserBySubject,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const NOW = new Date('2026-09-24T12:00:00Z');

function revision(title: string, notes: string | null = null): RevisionWrite {
  return {
    title,
    claim: `${title} claim`,
    statements: [
      {
        statementId: 'o1',
        kind: 'user_opinion',
        topic: 'general',
        text: 'an opinion',
        sourceIds: [],
        runId: null,
      },
    ],
    counterarguments: [],
    instruments: [],
    subjects: [{ name: 'Unknown Rocket Co', note: null }],
    privateNotes: notes,
    authorPrincipal: 'user:test',
    contentHash: 'a'.repeat(64),
  };
}

async function withResearchDb(
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
      applicationName: 'research-store-test',
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

describe.skipIf(adminUrl === null)('research store', () => {
  it('scopes theses, revisions, sources and runs to their owner', async () => {
    await withResearchDb(async (db, { alice, bob }) => {
      const created = await createThesis(db, {
        ownerUserId: alice,
        visibility: 'private',
        revision: revision('Aerospace exposure', 'private thought'),
        now: NOW,
      });
      expect(created.thesis.currentRevisionNumber).toBe(1);
      expect(created.revision.revisionNumber).toBe(1);

      expect(await findThesis(db, bob, created.thesis.id)).toBeNull();
      expect(await findThesis(db, alice, created.thesis.id)).not.toBeNull();
      expect(await listTheses(db, bob)).toEqual([]);
      expect((await listTheses(db, alice)).map((row) => row.revision.title)).toEqual([
        'Aerospace exposure',
      ]);
      expect(
        await appendRevision(db, {
          ownerUserId: bob,
          thesisId: created.thesis.id,
          revision: revision('hijack'),
          now: NOW,
        }),
      ).toBeNull();
      expect(
        await updateThesis(db, {
          ownerUserId: bob,
          thesisId: created.thesis.id,
          visibility: 'public',
          now: NOW,
        }),
      ).toBeNull();
      expect((await findThesisAnyOwner(db, created.thesis.id))?.visibility).toBe('private');

      await recordSource(db, {
        thesisId: created.thesis.id,
        role: 'issuer',
        url: 'https://issuer.example.com/terms',
        finalUrl: 'https://issuer.example.com/terms',
        title: 'Terms',
        status: 'fetched',
        blockedReason: null,
        contentType: 'text/html',
        byteLength: 10,
        contentHash: 'b'.repeat(64),
        excerpt: 'terms',
        publishedAt: null,
        observedAt: null,
        retrievedAt: NOW,
        redirects: [],
      });
      expect((await listSources(db, created.thesis.id)).map((row) => row.title)).toEqual(['Terms']);

      const run = await createRun(db, {
        thesisId: created.thesis.id,
        ownerUserId: alice,
        question: 'why',
        sourceIds: [],
        budget: { maxOutputChars: 1000, maxStatements: 2 },
        now: NOW,
      });
      expect(await findRun(db, bob, run.id)).toBeNull();
      expect(await cancelRun(db, bob, run.id, NOW)).toBeNull();
      expect((await listRuns(db, bob, null)).length).toBe(0);
      expect((await listRuns(db, alice, created.thesis.id)).map((row) => row.id)).toEqual([run.id]);
    });
  });

  it('numbers revisions in order even under concurrent appends and never edits one', async () => {
    await withResearchDb(async (db, { alice }) => {
      const created = await createThesis(db, {
        ownerUserId: alice,
        visibility: 'private',
        revision: revision('v1'),
        now: NOW,
      });
      const appended = await Promise.all(
        [2, 3, 4, 5].map((n) =>
          appendRevision(db, {
            ownerUserId: alice,
            thesisId: created.thesis.id,
            revision: revision(`v${n}`),
            now: new Date(NOW.getTime() + n),
          }),
        ),
      );
      const numbers = appended.map((row) => row?.revision.revisionNumber ?? -1).sort();
      expect(numbers).toEqual([2, 3, 4, 5]);
      const thesis = await findThesis(db, alice, created.thesis.id);
      expect(thesis?.currentRevisionNumber).toBe(5);
      const current = await currentRevision(db, thesis as NonNullable<typeof thesis>);
      expect(current.revisionNumber).toBe(5);
      const all = await listRevisions(db, created.thesis.id);
      expect(all.map((row) => row.revisionNumber)).toEqual([5, 4, 3, 2, 1]);
      expect(all[4]?.title).toBe('v1');
    });
  });

  it('moves a run through its states once and keeps a cancellation', async () => {
    await withResearchDb(async (db, { alice }) => {
      const created = await createThesis(db, {
        ownerUserId: alice,
        visibility: 'private',
        revision: revision('runs'),
        now: NOW,
      });
      const make = () =>
        createRun(db, {
          thesisId: created.thesis.id,
          ownerUserId: alice,
          question: 'q',
          sourceIds: [],
          budget: { maxOutputChars: 1000, maxStatements: 2 },
          now: NOW,
        });
      const first = await make();
      expect(first.status).toBe('queued');
      expect((await startRun(db, first.id, NOW))?.status).toBe('running');
      expect(await startRun(db, first.id, NOW)).toBeNull();
      const done = await finishRun(db, {
        runId: first.id,
        status: 'succeeded',
        provenance: { provider: 'fixture' },
        output: { draft: [] },
        error: null,
        now: NOW,
      });
      expect(done?.status).toBe('succeeded');
      expect(done?.finishedAt).not.toBeNull();
      expect(await cancelRun(db, alice, first.id, NOW)).toBeNull();

      const second = await make();
      await startRun(db, second.id, NOW);
      expect((await cancelRun(db, alice, second.id, NOW))?.status).toBe('cancelled');
      expect(
        await finishRun(db, {
          runId: second.id,
          status: 'succeeded',
          provenance: null,
          output: { draft: [] },
          error: null,
          now: NOW,
        }),
      ).toBeNull();
      expect((await findRun(db, alice, second.id))?.status).toBe('cancelled');

      const third = await make();
      expect((await cancelRun(db, alice, third.id, NOW))?.status).toBe('cancelled');
      expect(await startRun(db, third.id, NOW)).toBeNull();
    });
  });
});
