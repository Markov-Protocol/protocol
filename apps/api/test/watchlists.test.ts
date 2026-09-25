import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig } from '@markov/config';
import type { Watchlist } from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createSilentLogger } from '@markov/observability';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  type AccountingService,
  type AgentService,
  type AnalyticsService,
  buildApp,
  createCatalogService,
  createIdentityService,
  createPolicyService,
  createProbes,
  createWatchlistService,
  type DiscoveryService,
  type ExecutionService,
  type FollowService,
  type FundingService,
  type MarkovApi,
  type PlanningService,
  type RegistryService,
  type ResearchService,
  type StrategyService,
} from '../src/index.js';
import { GENESIS, prestocksFixtureRpcFetch } from './support/fixture-rpc.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const BOGUS = '99999999-9999-4999-8999-999999999999';

const unavailableFunding = new Proxy({} as FundingService, {
  get: () => () => {
    throw new Error('funding service is not part of this test');
  },
});
const unavailableStrategies = new Proxy({} as StrategyService, {
  get: () => () => {
    throw new Error('strategy service is not part of this test');
  },
});
const unavailableResearch = new Proxy({} as ResearchService, {
  get: () => () => {
    throw new Error('research service is not part of this test');
  },
});

interface Harness {
  app: MarkovApi;
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** Ingests the PreStocks fixture, admits FXAERO and FXBIO; FXGRID stays quarantined. */
  seed: (operatorToken: string) => Promise<{ aeroId: string; bioId: string; gridId: string }>;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'watchlist-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'watchlist-test',
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
        research: unavailableResearch,
        watchlists: createWatchlistService({ db: client.db, catalog }),
        registry: unavailable<RegistryService>('registry'),
        follows: unavailable<FollowService>('follows'),
        planning: unavailable<PlanningService>('planning'),
        execution: unavailable<ExecutionService>('execution'),
        accounting: unavailable<AccountingService>('accounting'),
        analytics: unavailable<AnalyticsService>('analytics'),
        discovery: unavailable<DiscoveryService>('discovery'),
        agents: unavailable<AgentService>('agents'),
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
      const seed = async (operatorToken: string) => {
        const headers = bearer(operatorToken);
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers,
          payload: { issuer: 'prestocks', source: 'fixture' },
        });
        const idOf = async (symbol: string) => {
          const list = await app.inject({
            method: 'GET',
            url: `/v1/ops/catalog/instruments?q=${symbol}&status=quarantined`,
            headers,
          });
          const found = (
            list.json().instruments as { instrumentId: string; symbol: string }[]
          ).find((row) => row.symbol === symbol);
          if (!found) {
            throw new Error(`fixture ${symbol} missing`);
          }
          return found.instrumentId;
        };
        const ids = {
          aeroId: await idOf('FXAERO'),
          bioId: await idOf('FXBIO'),
          gridId: await idOf('FXGRID'),
        };
        for (const id of [ids.aeroId, ids.bioId]) {
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/mint-verifications`,
            headers,
          });
          const admitted = await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/decisions`,
            headers,
            payload: { decision: 'admit', reason: 'watchlist test', evidence: { review: 'test' } },
          });
          expect(admitted.statusCode).toBe(201);
        }
        return ids;
      };
      try {
        await fn({
          app,
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          seed,
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

describe.skipIf(adminUrl === null)('watchlist API', () => {
  it('keeps a versioned, owner-scoped list of admitted instruments that survives delisting', async () => {
    await withHarness(async (h) => {
      const operatorToken = await h.operator(['ops:catalog:read', 'ops:catalog:write']);
      const { aeroId, bioId, gridId } = await h.seed(operatorToken);
      const alice = await h.user();
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as {
        user: { id: string };
      };

      const empty = await h.app.inject({
        method: 'GET',
        url: '/v1/me/watchlist',
        headers: bearer(alice),
      });
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({ contractVersion: 1, version: 0, items: [], updatedAt: null });

      const saved = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/watchlist/items/${aeroId}`,
        headers: bearer(alice),
        payload: { note: 'launch cadence thesis', ifVersion: 0 },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const first = saved.json() as Watchlist;
      expect(first.version).toBe(1);
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({
        instrumentId: aeroId,
        note: 'launch cadence thesis',
        instrument: { symbol: 'FXAERO', issuer: 'prestocks', status: 'admitted' },
      });
      expect(first.items[0]?.instrument?.availability.trade).toBe(false);

      // Idempotent: the same note changes nothing and the version stays.
      const again = (
        await h.app.inject({
          method: 'PUT',
          url: `/v1/me/watchlist/items/${aeroId}`,
          headers: bearer(alice),
          payload: { note: 'launch cadence thesis' },
        })
      ).json() as Watchlist;
      expect(again.version).toBe(1);

      // A stale version from another device is refused with the current one.
      const stale = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/watchlist/items/${bioId}`,
        headers: bearer(alice),
        payload: { ifVersion: 0 },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        details: [{ path: 'ifVersion', message: 'the current version is 1' }],
      });
      const second = (
        await h.app.inject({
          method: 'PUT',
          url: `/v1/me/watchlist/items/${bioId}`,
          headers: bearer(alice),
          payload: { ifVersion: 1 },
        })
      ).json() as Watchlist;
      expect(second.version).toBe(2);
      expect(second.items.map((item) => item.instrumentId)).toEqual([bioId, aeroId]);

      // Unadmitted or unknown instruments are refused; nothing executable comes from a watchlist.
      const quarantined = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/watchlist/items/${gridId}`,
        headers: bearer(alice),
        payload: {},
      });
      expect(quarantined.statusCode).toBe(409);
      expect(quarantined.json().error.code).toBe('ASSET_NOT_ADMITTED');
      expect(
        (
          await h.app.inject({
            method: 'PUT',
            url: `/v1/me/watchlist/items/${BOGUS}`,
            headers: bearer(alice),
            payload: {},
          })
        ).statusCode,
      ).toBe(404);
      const markup = await h.app.inject({
        method: 'PUT',
        url: `/v1/me/watchlist/items/${aeroId}`,
        headers: bearer(alice),
        payload: { note: '<script>alert(1)</script>' },
      });
      expect(markup.statusCode).toBe(400);

      // Another person and a read-only agent.
      const bob = await h.user('did:test:bob');
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/watchlist', headers: bearer(bob) })
          ).json() as Watchlist
        ).items,
      ).toEqual([]);
      const reader = await h.agent(me.user.id, ['research:read']);
      const viaAgent = await h.app.inject({
        method: 'GET',
        url: '/v1/me/watchlist',
        headers: bearer(reader),
      });
      expect(viaAgent.statusCode).toBe(200);
      expect((viaAgent.json() as Watchlist).items).toHaveLength(2);
      expect(
        (
          await h.app.inject({
            method: 'PUT',
            url: `/v1/me/watchlist/items/${aeroId}`,
            headers: bearer(reader),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);

      // Delisting keeps the item visible with its new status; the public catalog no longer lists it.
      const delisted = await h.app.inject({
        method: 'POST',
        url: `/v1/ops/catalog/instruments/${bioId}/decisions`,
        headers: bearer(operatorToken),
        payload: { decision: 'delist', reason: 'issuer sunset', evidence: { notice: 'test' } },
      });
      expect(delisted.statusCode, delisted.body).toBe(201);
      const afterDelist = (
        await h.app.inject({ method: 'GET', url: '/v1/me/watchlist', headers: bearer(alice) })
      ).json() as Watchlist;
      const bioItem = afterDelist.items.find((item) => item.instrumentId === bioId);
      expect(bioItem?.instrument?.status).toBe('delisted');
      expect(bioItem?.instrument?.availability.reasons).toContain('INSTRUMENT_DELISTED');
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/catalog/instruments/${bioId}` })).statusCode,
      ).toBe(404);

      // Removal is idempotent and versioned.
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/v1/me/watchlist/items/${bioId}?ifVersion=2`,
        headers: bearer(alice),
      });
      expect(removed.statusCode, removed.body).toBe(200);
      expect((removed.json() as Watchlist).version).toBe(3);
      const removedAgain = await h.app.inject({
        method: 'DELETE',
        url: `/v1/me/watchlist/items/${bioId}`,
        headers: bearer(alice),
      });
      expect((removedAgain.json() as Watchlist).version).toBe(3);
      expect((removedAgain.json() as Watchlist).items.map((item) => item.instrumentId)).toEqual([
        aeroId,
      ]);
      const staleRemove = await h.app.inject({
        method: 'DELETE',
        url: `/v1/me/watchlist/items/${aeroId}?ifVersion=1`,
        headers: bearer(alice),
      });
      expect(staleRemove.statusCode).toBe(409);
      expect((await h.app.inject({ method: 'GET', url: '/v1/me/watchlist' })).statusCode).toBe(401);
    });
  });
});
