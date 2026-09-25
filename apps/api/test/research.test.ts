import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig } from '@markov/config';
import type {
  PublicThesis,
  ResearchRun,
  SourceRecord,
  ThesisDetail,
  ThesisRevision,
  ThesisRevisionInput,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createSilentLogger } from '@markov/observability';
import { createFixtureModelAdapter, FIXTURE_SOURCES, MAX_BODY_BYTES } from '@markov/research';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  buildApp,
  createCatalogService,
  createIdentityService,
  createPolicyService,
  createProbes,
  createResearchService,
  createRetriever,
  type FollowService,
  type FundingService,
  type MarkovApi,
  type RegistryService,
  type StrategyService,
  type WatchlistService,
} from '../src/index.js';
import { fakeTransport } from './support/fake-transport.js';
import { GENESIS, prestocksFixtureRpcFetch } from './support/fixture-rpc.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const ISSUER_URL = FIXTURE_SOURCES['issuer-terms']?.url ?? '';
const NEWS_URL = FIXTURE_SOURCES['news-article']?.url ?? '';
const BOGUS = '99999999-9999-4999-8999-999999999999';

interface Harness {
  app: MarkovApi;
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** Ingests, verifies and admits FXAERO; FXGRID stays quarantined. */
  admitAero: (operatorToken: string) => Promise<{ aeroId: string; gridId: string }>;
}

const unavailableFunding = new Proxy({} as FundingService, {
  get: () => () => {
    throw new Error('funding service is not part of this test');
  },
});
const unavailableWatchlists = new Proxy({} as WatchlistService, {
  get: () => () => {
    throw new Error('watchlist service is not part of this test');
  },
});
const unavailableStrategies = new Proxy({} as StrategyService, {
  get: () => () => {
    throw new Error('strategy service is not part of this test');
  },
});

function transportForTests() {
  const big = new Uint8Array(MAX_BODY_BYTES + 1).fill(97);
  return fakeTransport(
    {
      'news.example.com': ['93.184.216.34'],
      'internal.example.com': ['10.1.2.3'],
    },
    {
      'https://news.example.com/article': {
        status: 200,
        contentType: 'text/html',
        body: '<html><head><title>Rocket news</title></head><body><p>Unknown Rocket Co raised money on 2026-09-02.</p></body></html>',
      },
      'https://news.example.com/big': { status: 200, contentType: 'text/plain', body: [big] },
      'https://news.example.com/to-private': {
        status: 302,
        location: 'https://internal.example.com/secret',
      },
      'https://news.example.com/pdf': {
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF',
      },
    },
  );
}

async function withHarness(
  options: { model: 'fixture' | null },
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(
      baseTestEnv({
        DATABASE_URL: url,
        RESEARCH_MODEL_PROVIDER: options.model ?? 'disabled',
      }),
    );
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'research-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'research-test',
      );
      const issuer = await createTestIdentityIssuer({
        issuer: config.identity.issuer,
        audience: config.identity.audience,
      });
      const verifier = createIdentityVerifier({
        issuer: issuer.issuer,
        audience: issuer.audience,
        algorithms: ['ES256'],
        keys: { jwks: issuer.jwks() },
      });
      const identity = createIdentityService({
        config,
        db: client.db,
        verifier,
        genesisHash: GENESIS,
      });
      const catalog = createCatalogService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [
          new SolanaRpcClient({
            url: 'http://rpc.test',
            timeoutMs: 2000,
            maxResponseBytes: 1_000_000,
            fetchImpl: prestocksFixtureRpcFetch(),
          }),
        ],
        sourceFor: () => createPrestocksFixtureSource('default'),
      });
      const research = createResearchService({
        config,
        db: client.db,
        retriever: createRetriever({ fixtures: true, transport: transportForTests() }),
        model: config.research.modelProvider === 'fixture' ? createFixtureModelAdapter() : null,
      });
      const app = await buildApp({
        config,
        logger: createSilentLogger(),
        service: { name: 'markov-api', version: 'test', startedAt: Date.now() },
        probes: createProbes(config, client),
        network: {
          snapshot: () => ({
            status: 'verified',
            observedGenesisHash: GENESIS,
            detail: 'stub',
            checkedAt: new Date().toISOString(),
            durationMs: 1,
          }),
        },
        expectedGenesisHash: GENESIS,
        identity,
        catalog,
        policy: createPolicyService({ config, db: client.db, catalog }),
        funding: unavailableFunding,
        research,
        watchlists: unavailableWatchlists,
        registry: unavailable<RegistryService>('registry'),
        follows: unavailable<FollowService>('follows'),
        strategies: unavailableStrategies,
        mintTestToken: (input) => issuer.mint({ subject: input.subject }),
      });
      await app.ready();
      const credential = async (
        principalClass: 'operator' | 'agent',
        userId: string | null,
        scopes: string[],
      ) => {
        const generated = generateCredential(principalClass, config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId,
          principalClass,
          label: principalClass,
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      const user = async (subject = 'did:test:alice') => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: { identityToken: await issuer.mint({ subject }) },
        });
        return response.json().sessionToken as string;
      };
      const admitAero = async (operatorToken: string) => {
        const headers = bearer(operatorToken);
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers,
          payload: { issuer: 'prestocks', source: 'fixture' },
        });
        const find = async (symbol: string) => {
          const list = await app.inject({
            method: 'GET',
            url: `/v1/ops/catalog/instruments?q=${symbol}&status=quarantined`,
            headers,
          });
          return (list.json().instruments[0] as { instrumentId: string }).instrumentId;
        };
        const aeroId = await find('FXAERO');
        const gridId = await find('FXGRID');
        await app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${aeroId}/mint-verifications`,
          headers,
        });
        const admitted = await app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${aeroId}/decisions`,
          headers,
          payload: { decision: 'admit', reason: 'research test', evidence: { review: 'test' } },
        });
        expect(admitted.statusCode).toBe(201);
        return { aeroId, gridId };
      };
      try {
        await fn({
          app,
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          admitAero,
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const OPERATOR_SCOPES = ['ops:catalog:read', 'ops:catalog:write'];

function opinion(overrides: Partial<ThesisRevisionInput> = {}): ThesisRevisionInput {
  return {
    title: 'Fixture Aerospace exposure is worth a small position',
    claim: 'Tokenised pre-IPO exposure to Fixture Aerospace Inc is attractive at current marks.',
    statements: [
      {
        statementId: 'op-1',
        kind: 'user_opinion',
        topic: 'general',
        text: 'I think the launch cadence is underestimated.',
        sourceIds: [],
        runId: null,
      },
    ],
    counterarguments: ['Pre-IPO marks are stale.'],
    instruments: [],
    subjects: [],
    privateNotes: 'do not share: sizing thoughts',
    ...overrides,
  };
}

async function attach(
  app: MarkovApi,
  token: string,
  thesisId: string,
  url: string,
  role = 'other',
): Promise<SourceRecord> {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/me/theses/${thesisId}/sources`,
    headers: bearer(token),
    payload: { url, role },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SourceRecord;
}

async function revise(app: MarkovApi, token: string, thesisId: string, input: ThesisRevisionInput) {
  return app.inject({
    method: 'POST',
    url: `/v1/me/theses/${thesisId}/revisions`,
    headers: bearer(token),
    payload: input,
  });
}

function issueMessages(response: { json(): unknown }): string[] {
  const body = response.json() as { error: { details?: { path: string; message: string }[] } };
  return (body.error.details ?? []).map((issue) => `${issue.path}: ${issue.message}`);
}

describe.skipIf(adminUrl === null)('research API', () => {
  it('keeps manual research honest: citations, evidence roles, admitted instruments and a labelled public projection', async () => {
    await withHarness({ model: null }, async (h) => {
      const { aeroId, gridId } = await h.admitAero(await h.operator(OPERATOR_SCOPES));
      const alice = await h.user();
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as {
        user: { id: string };
      };

      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/theses',
        headers: bearer(alice),
        payload: { revision: opinion() },
      });
      expect(created.statusCode, created.body).toBe(201);
      const detail = created.json() as ThesisDetail;
      const thesisId = detail.thesis.thesisId;
      expect(detail.thesis).toMatchObject({
        visibility: 'private',
        status: 'draft',
        currentRevisionNumber: 1,
        ownerUserId: me.user.id,
      });
      expect(detail.revision.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(detail.revision.authorPrincipal).toBe(`user:${me.user.id}`);
      expect(detail.revision.privateNotes).toBe('do not share: sizing thoughts');
      expect(detail.sources).toEqual([]);

      // A fact without a source is refused before anything is stored.
      const unsourced = await h.app.inject({
        method: 'POST',
        url: '/v1/me/theses',
        headers: bearer(alice),
        payload: {
          revision: opinion({
            statements: [
              {
                statementId: 'f-1',
                kind: 'fact',
                topic: 'general',
                text: 'The company raised a round.',
                sourceIds: [],
                runId: null,
              },
            ],
          }),
        },
      });
      expect(unsourced.statusCode).toBe(400);
      expect(issueMessages(unsourced)).toContain(
        'statements/0: a fact must cite at least one source',
      );
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/theses', headers: bearer(alice) })
          ).json() as {
            theses: unknown[];
          }
        ).theses,
      ).toHaveLength(1);

      const issuerSource = await attach(h.app, alice, thesisId, ISSUER_URL, 'issuer');
      expect(issuerSource).toMatchObject({
        status: 'fetched',
        role: 'issuer',
        finalUrl: ISSUER_URL,
        title: 'Fixture Aerospace Inc — token terms',
        contentType: 'text/html',
        redirects: [],
      });
      expect(issuerSource.excerpt).toContain('no shareholder voting rights');
      expect(issuerSource.excerpt).not.toMatch(/script|onload|evil|ignore previous|[<>]/i);
      expect(issuerSource.contentHash).toMatch(/^[0-9a-f]{64}$/);
      const newsSource = await attach(h.app, alice, thesisId, NEWS_URL, 'news');
      expect(newsSource.status).toBe('fetched');

      // Rights claims need issuer, legal or filing evidence; a news source is not enough.
      const weak = await revise(
        h.app,
        alice,
        thesisId,
        opinion({
          statements: [
            {
              statementId: 'ia-1',
              kind: 'issuer_assertion',
              topic: 'rights',
              text: 'Holders have no voting rights.',
              sourceIds: [newsSource.sourceId],
              runId: null,
            },
          ],
        }),
      );
      expect(weak.statusCode).toBe(400);
      expect(issueMessages(weak)).toContain(
        'statements/0: a claim about rights must cite an issuer, legal or filing source',
      );

      const quarantined = await revise(
        h.app,
        alice,
        thesisId,
        opinion({ instruments: [{ instrumentId: gridId, note: null }] }),
      );
      expect(quarantined.statusCode).toBe(400);
      expect(issueMessages(quarantined)[0]).toContain('is quarantined');
      const unknownInstrument = await revise(
        h.app,
        alice,
        thesisId,
        opinion({ instruments: [{ instrumentId: BOGUS, note: null }] }),
      );
      expect(issueMessages(unknownInstrument)).toContain(
        `instruments/0: instrument ${BOGUS} is not in the admitted catalog`,
      );
      const duplicateCompany = await revise(
        h.app,
        alice,
        thesisId,
        opinion({
          instruments: [{ instrumentId: aeroId, note: null }],
          subjects: [{ name: 'Fixture Aerospace, Inc.', note: null }],
        }),
      );
      expect(issueMessages(duplicateCompany)).toContain(
        'subjects/0: Fixture Aerospace, Inc. is already referenced through an admitted instrument',
      );

      const sourced = await revise(
        h.app,
        alice,
        thesisId,
        opinion({
          statements: [
            {
              statementId: 'f-1',
              kind: 'fact',
              topic: 'general',
              text: 'Fixture Aerospace announced a funding round on 2026-09-01.',
              sourceIds: [newsSource.sourceId],
              runId: null,
            },
            {
              statementId: 'ia-1',
              kind: 'issuer_assertion',
              topic: 'rights',
              text: 'The issuer states that holders have no shareholder voting rights.',
              sourceIds: [issuerSource.sourceId],
              runId: null,
            },
            {
              statementId: 'op-1',
              kind: 'user_opinion',
              topic: 'general',
              text: 'The spread is acceptable for a small position.',
              sourceIds: [],
              runId: null,
            },
          ],
          instruments: [{ instrumentId: aeroId, note: 'admitted PreStocks exposure' }],
          subjects: [{ name: 'Unknown Rocket Co', note: 'competitor; not in the catalog' }],
        }),
      );
      expect(sourced.statusCode, sourced.body).toBe(201);
      const second = sourced.json() as ThesisRevision;
      expect(second.revisionNumber).toBe(2);
      expect(second.contentHash).not.toBe(detail.revision.contentHash);

      const revisions = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/theses/${thesisId}/revisions`,
          headers: bearer(alice),
        })
      ).json() as { revisions: ThesisRevision[] };
      expect(revisions.revisions.map((row) => row.revisionNumber)).toEqual([2, 1]);

      // The list carries the current revision's instrument ids and filters by one (F06).
      const listed = (
        await h.app.inject({ method: 'GET', url: '/v1/me/theses', headers: bearer(alice) })
      ).json() as { theses: { thesisId: string; instrumentIds: string[] }[] };
      expect(listed.theses.map((row) => row.instrumentIds)).toEqual([[aeroId]]);
      const byAero = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/theses?instrumentId=${aeroId}`,
          headers: bearer(alice),
        })
      ).json() as { theses: { thesisId: string }[] };
      expect(byAero.theses.map((row) => row.thesisId)).toEqual([thesisId]);
      const byGrid = await h.app.inject({
        method: 'GET',
        url: `/v1/me/theses?instrumentId=${gridId}`,
        headers: bearer(alice),
      });
      expect(byGrid.statusCode).toBe(200);
      expect((byGrid.json() as { theses: unknown[] }).theses).toEqual([]);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: '/v1/me/theses?instrumentId=nope',
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(400);

      // The mapping never turns an unknown company into a mint.
      const mapping = await h.app.inject({
        method: 'POST',
        url: '/v1/me/research/mappings',
        headers: bearer(alice),
        payload: { companies: ['Fixture Aerospace, Inc.', 'Unknown Rocket Co', 'Fixture Grid Co'] },
      });
      expect(mapping.statusCode).toBe(200);
      const results = (
        mapping.json() as { results: { unmatched: boolean; matches: { instrumentId: string }[] }[] }
      ).results;
      expect(results[0]?.matches.map((m) => m.instrumentId)).toEqual([aeroId]);
      expect(results[1]).toMatchObject({ unmatched: true, matches: [] });
      expect(results[2]).toMatchObject({ unmatched: true, matches: [] });

      // Private until published; the projection carries no private notes and no owner.
      const hidden = await h.app.inject({ method: 'GET', url: `/v1/research/theses/${thesisId}` });
      expect(hidden.statusCode).toBe(404);
      const published = await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/theses/${thesisId}`,
        headers: bearer(alice),
        payload: { visibility: 'public' },
      });
      expect(published.statusCode, published.body).toBe(200);
      const projection = await h.app.inject({
        method: 'GET',
        url: `/v1/research/theses/${thesisId}`,
      });
      expect(projection.statusCode).toBe(200);
      const publicThesis = projection.json() as PublicThesis & Record<string, unknown>;
      expect(publicThesis.revisionNumber).toBe(2);
      expect(publicThesis.contentHash).toBe(second.contentHash);
      expect(publicThesis.statements.map((s) => s.kind)).toEqual([
        'fact',
        'issuer_assertion',
        'user_opinion',
      ]);
      expect(publicThesis.sources).toHaveLength(2);
      expect(projection.body).not.toContain('sizing thoughts');
      expect(projection.body).not.toContain(me.user.id);
      expect(publicThesis['privateNotes']).toBeUndefined();
      expect(publicThesis['ownerUserId']).toBeUndefined();

      // Agents: read with research:read, write only with research:write, never publish.
      const reader = await h.agent(me.user.id, ['research:read']);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/theses/${thesisId}`,
            headers: bearer(reader),
          })
        ).statusCode,
      ).toBe(200);
      expect((await revise(h.app, reader, thesisId, opinion())).statusCode).toBe(403);
      const writer = await h.agent(me.user.id, ['research:read', 'research:write']);
      const byAgent = await revise(h.app, writer, thesisId, opinion());
      expect(byAgent.statusCode).toBe(201);
      expect((byAgent.json() as ThesisRevision).authorPrincipal).toMatch(/^agent:/);
      expect(
        (
          await h.app.inject({
            method: 'PATCH',
            url: `/v1/me/theses/${thesisId}`,
            headers: bearer(writer),
            payload: { visibility: 'private' },
          })
        ).statusCode,
      ).toBe(403);

      // Another person sees nothing.
      const bob = await h.user('did:test:bob');
      for (const request of [
        { method: 'GET' as const, url: `/v1/me/theses/${thesisId}` },
        { method: 'GET' as const, url: `/v1/me/theses/${thesisId}/sources` },
        {
          method: 'PATCH' as const,
          url: `/v1/me/theses/${thesisId}`,
          payload: { status: 'archived' },
        },
        { method: 'POST' as const, url: `/v1/me/theses/${thesisId}/revisions`, payload: opinion() },
        { method: 'GET' as const, url: `/v1/me/research/runs?thesisId=${thesisId}` },
      ]) {
        const response = await h.app.inject({ ...request, headers: bearer(bob) });
        expect(response.statusCode, request.url).toBe(404);
      }
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/theses', headers: bearer(bob) })
          ).json() as {
            theses: unknown[];
          }
        ).theses,
      ).toEqual([]);

      // Archiving withdraws the projection and closes the thesis to revisions.
      const archived = await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/theses/${thesisId}`,
        headers: bearer(alice),
        payload: { status: 'archived' },
      });
      expect(archived.statusCode).toBe(200);
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/research/theses/${thesisId}` })).statusCode,
      ).toBe(404);
      expect((await revise(h.app, alice, thesisId, opinion())).statusCode).toBe(400);

      // Manual research never needed a model: runs answer 503 when none is configured.
      const run = await h.app.inject({
        method: 'POST',
        url: '/v1/me/research/runs',
        headers: bearer(alice),
        payload: { thesisId, question: 'anything' },
      });
      expect(run.statusCode).toBe(503);
      expect((run.json() as { error: { code: string } }).error.code).toBe('PROVIDER_UNAVAILABLE');
    });
  });

  it('records refused and failed retrievals as evidence that cannot be cited', async () => {
    await withHarness({ model: null }, async (h) => {
      const alice = await h.user();
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/theses',
        headers: bearer(alice),
        payload: { revision: opinion() },
      });
      const thesisId = (created.json() as ThesisDetail).thesis.thesisId;

      const cases: { url: string; status: 'blocked' | 'failed'; reason: RegExp }[] = [
        { url: 'http://news.example.com/article', status: 'blocked', reason: /only https/ },
        {
          url: 'https://169.254.169.254/latest/meta-data/',
          status: 'blocked',
          reason: /address literal/,
        },
        {
          url: 'https://internal.example.com/x',
          status: 'blocked',
          reason: /refused address: 10\.1\.2\.3/,
        },
        {
          url: 'https://news.example.com/to-private',
          status: 'blocked',
          reason: /redirect refused|refused address/,
        },
        { url: 'https://news.example.com/big', status: 'blocked', reason: /byte cap/ },
        { url: 'https://news.example.com/pdf', status: 'blocked', reason: /application\/pdf/ },
        { url: 'https://news.example.com/down', status: 'failed', reason: /ECONNREFUSED/ },
        { url: 'https://nowhere.example.com/', status: 'failed', reason: /could not resolve/ },
      ];
      const recorded: SourceRecord[] = [];
      for (const item of cases) {
        const source = await attach(h.app, alice, thesisId, item.url);
        expect(source.status, item.url).toBe(item.status);
        expect(source.blockedReason ?? '', item.url).toMatch(item.reason);
        expect(source.excerpt).toBeNull();
        expect(source.contentHash).toBeNull();
        recorded.push(source);
      }
      const fetched = await attach(
        h.app,
        alice,
        thesisId,
        'https://news.example.com/article',
        'news',
      );
      expect(fetched).toMatchObject({ status: 'fetched', title: 'Rocket news' });
      expect(fetched.excerpt).toContain('Unknown Rocket Co raised money');

      const blocked = recorded[0] as SourceRecord;
      const citingBlocked = await revise(
        h.app,
        alice,
        thesisId,
        opinion({
          statements: [
            {
              statementId: 'f-1',
              kind: 'fact',
              topic: 'general',
              text: 'A fact resting on a refused fetch.',
              sourceIds: [blocked.sourceId],
              runId: null,
            },
          ],
        }),
      );
      expect(citingBlocked.statusCode).toBe(400);
      expect(issueMessages(citingBlocked)).toContain(
        `statements/0/sourceIds/0: source ${blocked.sourceId} was blocked; cite a fetched source`,
      );
      const citingFetched = await revise(
        h.app,
        alice,
        thesisId,
        opinion({
          statements: [
            {
              statementId: 'f-1',
              kind: 'fact',
              topic: 'general',
              text: 'Unknown Rocket Co raised money on 2026-09-02.',
              sourceIds: [fetched.sourceId],
              runId: null,
            },
          ],
          subjects: [{ name: 'Unknown Rocket Co', note: null }],
        }),
      );
      expect(citingFetched.statusCode, citingFetched.body).toBe(201);

      const sources = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/theses/${thesisId}/sources`,
          headers: bearer(alice),
        })
      ).json() as { sources: SourceRecord[] };
      expect(sources.sources).toHaveLength(cases.length + 1);
      // Fixture URLs are never fetched from the network: the catalog of records shows their .invalid host only as a fixture.
      expect(sources.sources.every((row) => row.url.startsWith('http'))).toBe(true);
    });
  });

  it('runs the bounded fixture model with provenance and never turns an unknown company into a mint', async () => {
    await withHarness({ model: 'fixture' }, async (h) => {
      const { aeroId } = await h.admitAero(await h.operator(OPERATOR_SCOPES));
      const alice = await h.user();
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as {
        user: { id: string };
      };
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/theses',
        headers: bearer(alice),
        payload: { revision: opinion() },
      });
      const thesisId = (created.json() as ThesisDetail).thesis.thesisId;
      const issuerSource = await attach(h.app, alice, thesisId, ISSUER_URL, 'issuer');
      const newsSource = await attach(h.app, alice, thesisId, NEWS_URL, 'news');
      const blocked = await attach(h.app, alice, thesisId, 'http://news.example.com/article');

      const started = await h.app.inject({
        method: 'POST',
        url: '/v1/me/research/runs',
        headers: bearer(alice),
        payload: {
          thesisId,
          question: 'Should I hold Fixture Aerospace Inc rather than Unknown Rocket Co?',
          sourceIds: [issuerSource.sourceId, newsSource.sourceId],
        },
      });
      expect(started.statusCode, started.body).toBe(201);
      const run = started.json() as ResearchRun;
      expect(run.status).toBe('succeeded');
      expect(run.ownerUserId).toBe(me.user.id);
      expect(run.provenance).toMatchObject({
        provider: 'fixture',
        model: 'fixture-research',
        toolCalls: [],
        budgetUsed: { statements: 2 },
      });
      expect(run.provenance?.promptHash).toMatch(/^[0-9a-f]{64}$/);
      expect(run.output?.draft).toHaveLength(2);
      for (const statement of run.output?.draft ?? []) {
        expect(statement.kind).toBe('model_inference');
        expect(statement.runId).toBe(run.runId);
        expect(statement.statementId).toMatch(/^run-/);
        expect(statement.text).not.toMatch(/[<>]/);
        for (const id of statement.sourceIds) {
          expect([issuerSource.sourceId, newsSource.sourceId]).toContain(id);
        }
      }
      expect(run.output?.suggestedInstrumentIds).toEqual([aeroId]);
      expect(run.output?.unmatchedCompanies).toEqual(['Unknown Rocket Co']);
      expect(run.output?.rejected).toEqual([]);
      expect(run.startedAt).not.toBeNull();
      expect(run.finishedAt).not.toBeNull();

      // Budgets cut the draft and report what was dropped.
      const tight = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/research/runs',
          headers: bearer(alice),
          payload: {
            thesisId,
            question: 'Summarise the terms',
            sourceIds: [issuerSource.sourceId, newsSource.sourceId],
            budget: { maxOutputChars: 4000, maxStatements: 1 },
          },
        })
      ).json() as ResearchRun;
      expect(tight.status).toBe('succeeded');
      expect(tight.output?.draft).toHaveLength(1);
      expect(tight.output?.rejected).toEqual(['statement 1: over the statement budget']);
      expect(tight.provenance?.budgetUsed.statements).toBe(1);

      // Runs read fetched sources of this thesis only.
      for (const sourceIds of [[BOGUS], [blocked.sourceId]]) {
        const refused = await h.app.inject({
          method: 'POST',
          url: '/v1/me/research/runs',
          headers: bearer(alice),
          payload: { thesisId, question: 'q', sourceIds },
        });
        expect(refused.statusCode).toBe(400);
      }

      // Inferences enter a revision only with their run; a bogus run id is refused.
      const draft = run.output?.draft ?? [];
      const adopted = await revise(
        h.app,
        alice,
        thesisId,
        opinion({ statements: draft, instruments: [{ instrumentId: aeroId, note: null }] }),
      );
      expect(adopted.statusCode, adopted.body).toBe(201);
      const forged = await revise(
        h.app,
        alice,
        thesisId,
        opinion({ statements: draft.map((s) => ({ ...s, runId: BOGUS })) }),
      );
      expect(forged.statusCode).toBe(400);
      expect(issueMessages(forged)[0]).toContain(`unknown research run ${BOGUS}`);
      const unlabelled = await revise(
        h.app,
        alice,
        thesisId,
        opinion({ statements: draft.map((s) => ({ ...s, kind: 'fact' as const })) }),
      );
      expect(issueMessages(unlabelled)).toContain(
        'statements/0/runId: only model inferences carry a run id',
      );

      const listed = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/research/runs?thesisId=${thesisId}`,
          headers: bearer(alice),
        })
      ).json() as { runs: ResearchRun[] };
      expect(listed.runs.map((row) => row.runId)).toEqual([tight.runId, run.runId]);
      const one = await h.app.inject({
        method: 'GET',
        url: `/v1/me/research/runs/${run.runId}`,
        headers: bearer(alice),
      });
      expect(one.statusCode).toBe(200);
      const cancel = await h.app.inject({
        method: 'POST',
        url: `/v1/me/research/runs/${run.runId}/cancel`,
        headers: bearer(alice),
      });
      expect(cancel.statusCode).toBe(200);
      expect((cancel.json() as ResearchRun).status).toBe('succeeded');

      // Scopes and ownership.
      const reader = await h.agent(me.user.id, ['research:read']);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/research/runs',
            headers: bearer(reader),
            payload: { thesisId, question: 'q' },
          })
        ).statusCode,
      ).toBe(403);
      const writer = await h.agent(me.user.id, ['research:write']);
      const agentRun = await h.app.inject({
        method: 'POST',
        url: '/v1/me/research/runs',
        headers: bearer(writer),
        payload: { thesisId, question: 'q' },
      });
      expect(agentRun.statusCode, agentRun.body).toBe(201);
      expect((agentRun.json() as ResearchRun).output?.draft[0]?.text).toContain(
        'No source was attached',
      );
      const bob = await h.user('did:test:bob');
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/research/runs',
            headers: bearer(bob),
            payload: { thesisId, question: 'q' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/research/runs/${run.runId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
    });
  });
});
