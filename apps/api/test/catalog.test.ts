import { readFileSync } from 'node:fs';
import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { encodeMintAccount, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@markov/catalog';
import { KNOWN_GENESIS_HASHES, loadConfig } from '@markov/config';
import { decodeBase58 } from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource, type PrestocksFixture } from '@markov/issuer-prestocks';
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
  type DiscoveryService,
  type ExecutionService,
  type FollowService,
  type FundingService,
  type MarkovApi,
  type PlanningService,
  type RegistryService,
  type ResearchService,
  type StrategyService,
  type WatchlistService,
} from '../src/index.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const GENESIS = KNOWN_GENESIS_HASHES.devnet;

interface FixtureMint {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: 'spl-token' | 'token-2022';
  extensions?: string[];
}

const fixtureMints = (
  JSON.parse(
    readFileSync(
      new URL('../../../packages/issuer-prestocks/fixtures/fixture-mints.json', import.meta.url),
      'utf8',
    ),
  ) as { mints: FixtureMint[] }
).mints;

/** JSON-RPC stand-in serving the fixture mints as real-shaped accounts; FXGRID is deliberately absent. */
function fixtureRpcFetch(): typeof fetch {
  const accounts = new Map<string, { owner: string; data: Uint8Array }>();
  for (const item of fixtureMints) {
    if (item.symbol === 'FXGRID') {
      continue;
    }
    const authority = decodeBase58('11111111111111111111111111111111');
    const extensions =
      item.tokenProgram === 'token-2022' ? [{ type: 18, data: new Uint8Array(64) }] : [];
    accounts.set(item.mint, {
      owner: item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
      data: encodeMintAccount({
        decimals: item.decimals,
        supply: 1_000_000n,
        mintAuthority: authority,
        freezeAuthority: null,
        extensions,
      }),
    });
  }
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    let result: unknown;
    switch (body.method) {
      case 'getGenesisHash':
        result = GENESIS;
        break;
      case 'getHealth':
        result = 'ok';
        break;
      case 'getVersion':
        result = { 'solana-core': 'fixture' };
        break;
      case 'getAccountInfo': {
        const account = accounts.get(String(body.params[0]));
        result = {
          context: { slot: 4242 },
          value: account
            ? {
                data: [Buffer.from(account.data).toString('base64'), 'base64'],
                executable: false,
                lamports: 1,
                owner: account.owner,
                space: account.data.length,
              }
            : null,
        };
        break;
      }
      default:
        result = null;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

interface Harness {
  app: MarkovApi;
  operator: (scopes: string[]) => Promise<string>;
  user: () => Promise<string>;
  useFixture: (fixture: PrestocksFixture) => void;
}

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 4,
      statementTimeoutMs: 10_000,
      applicationName: 'catalog-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'catalog-test',
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
      let fixture: PrestocksFixture = 'default';
      const catalog = createCatalogService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [
          new SolanaRpcClient({
            url: 'http://rpc.test',
            timeoutMs: 2000,
            maxResponseBytes: 1_000_000,
            fetchImpl: fixtureRpcFetch(),
          }),
        ],
        sourceFor: (_issuer, _kind, source) => {
          if (source !== 'fixture') {
            throw new Error('configured_url is not stubbed in this test');
          }
          return createPrestocksFixtureSource(fixture);
        },
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
        watchlists: unavailableWatchlists,
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
      const operator = async (scopes: string[]) => {
        const generated = generateCredential('operator', config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId: null,
          principalClass: 'operator',
          label: 'ops',
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      const user = async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: { identityToken: await issuer.mint({ subject: 'did:test:alice' }) },
        });
        return response.json().sessionToken as string;
      };
      try {
        await fn({
          app,
          operator,
          user,
          useFixture: (next) => {
            fixture = next;
          },
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

const unavailableFunding = new Proxy({} as FundingService, {
  get: () => () => {
    throw new Error('funding service is not part of this test');
  },
});
const unavailableResearch = new Proxy({} as ResearchService, {
  get: () => () => {
    throw new Error('research service is not part of this test');
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe.skipIf(adminUrl === null)('catalog API', () => {
  it('ingests into quarantine, verifies mints on chain and admits only what matched', async () => {
    await withHarness(async ({ app, operator, user }) => {
      const writer = await operator(['ops:catalog:read', 'ops:catalog:write']);
      const reader = await operator(['ops:read']);
      const userToken = await user();

      // Authorization: only operators with the catalog write scope ingest.
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/catalog/ingestions',
            headers: bearer(userToken),
            payload: { issuer: 'prestocks', source: 'fixture' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/catalog/ingestions',
            headers: bearer(reader),
            payload: { issuer: 'prestocks', source: 'fixture' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/ops/catalog/instruments',
            headers: bearer(reader),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/ops/catalog/instruments' })).statusCode,
      ).toBe(401);

      const ingested = await app.inject({
        method: 'POST',
        url: '/v1/ops/catalog/ingestions',
        headers: bearer(writer),
        payload: { issuer: 'prestocks', source: 'fixture' },
      });
      expect(ingested.statusCode).toBe(201);
      const report = ingested.json();
      expect(report.snapshot.status).toBe('accepted');
      expect(report.counts).toEqual({
        inserted: 4,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        paused: 0,
      });

      // Quarantined instruments are invisible to the public and visible to operators.
      const publicList = await app.inject({ method: 'GET', url: '/v1/catalog/instruments' });
      expect(publicList.statusCode).toBe(200);
      expect(publicList.json().instruments).toEqual([]);
      const opsList = await app.inject({
        method: 'GET',
        url: '/v1/ops/catalog/instruments?status=quarantined',
        headers: bearer(writer),
      });
      const quarantined = opsList.json().instruments as {
        instrumentId: string;
        symbol: string;
        tokenProgram: string;
      }[];
      expect(quarantined.map((item) => item.symbol)).toEqual([
        'FXAERO',
        'FXBIO',
        'FXDRFT',
        'FXGRID',
      ]);
      const byId = new Map(quarantined.map((item) => [item.symbol, item.instrumentId]));
      expect(
        (await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('FXAERO')}` }))
          .statusCode,
      ).toBe(404);

      // Admission without a verification is blocked.
      const early = await app.inject({
        method: 'POST',
        url: `/v1/ops/catalog/instruments/${byId.get('FXAERO')}/decisions`,
        headers: bearer(writer),
        payload: { decision: 'admit', reason: 'terms reviewed' },
      });
      expect(early.statusCode).toBe(409);
      expect(early.json().error.code).toBe('ADMISSION_BLOCKED');

      // Verification: matching, mismatching (declared 6, chain 9) and missing mints.
      const verify = (symbol: string) =>
        app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${byId.get(symbol)}/mint-verifications`,
          headers: bearer(writer),
        });
      expect((await verify('FXAERO')).json()).toMatchObject({
        result: 'verified',
        mismatches: [],
        rpcHost: 'rpc.test',
        slot: 4242,
        onChain: { tokenProgram: 'spl-token', decimals: 6 },
      });
      expect((await verify('FXBIO')).json()).toMatchObject({
        result: 'verified',
        onChain: { tokenProgram: 'token-2022', extensions: ['MetadataPointer'] },
      });
      expect((await verify('FXDRFT')).json()).toMatchObject({
        result: 'mismatch',
        mismatches: ['decimals: declared 6, on-chain 9'],
      });
      expect((await verify('FXGRID')).json()).toMatchObject({ result: 'not_found' });

      const decide = (symbol: string, decision: string, reason = 'operator review') =>
        app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${byId.get(symbol)}/decisions`,
          headers: bearer(writer),
          payload: { decision, reason, evidence: { review: 'R-1' } },
        });
      expect((await decide('FXAERO', 'admit', 'terms and mint reviewed')).statusCode).toBe(201);
      expect((await decide('FXBIO', 'admit')).statusCode).toBe(201);
      expect((await decide('FXDRFT', 'admit')).json().error.code).toBe('ADMISSION_BLOCKED');
      expect((await decide('FXGRID', 'admit')).json().error.code).toBe('ADMISSION_BLOCKED');
      expect((await decide('FXGRID', 'reject', 'no mint on chain')).statusCode).toBe(201);
      expect((await decide('FXGRID', 'admit')).statusCode).toBe(400);

      // Public catalog: admitted instruments with typed reference prices and honest availability.
      const listed = (await app.inject({ method: 'GET', url: '/v1/catalog/instruments' })).json();
      expect(listed.instruments.map((item: { symbol: string }) => item.symbol)).toEqual([
        'FXAERO',
        'FXBIO',
      ]);
      const aero = listed.instruments[0];
      expect(aero.availability).toEqual({
        research: true,
        strategy: true,
        trade: false,
        reasons: ['EXECUTION_NOT_ENABLED'],
      });
      expect(aero.referencePrice).toMatchObject({
        kind: 'issuer_mark',
        unit: 'USD',
        value: '18.25',
        expiresAt: null,
      });
      expect(aero.referencePrice.kind).not.toBe('execution_quote');
      expect(aero.tokenProgram).toBe('spl-token');
      expect(aero.statusReason).toBe('terms and mint reviewed');
      const search = (
        await app.inject({ method: 'GET', url: '/v1/catalog/instruments?q=biotech' })
      ).json();
      expect(search.instruments.map((item: { symbol: string }) => item.symbol)).toEqual(['FXBIO']);
      const paged = (
        await app.inject({ method: 'GET', url: '/v1/catalog/instruments?limit=1' })
      ).json();
      expect(paged.instruments).toHaveLength(1);
      expect(paged.nextCursor).not.toBeNull();
      const page2 = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments?limit=1&cursor=${encodeURIComponent(paged.nextCursor)}`,
        })
      ).json();
      expect(page2.instruments[0].symbol).toBe('FXBIO');
      const detail = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('FXAERO')}` })
      ).json();
      expect(detail.latestMintVerification).toMatchObject({ result: 'verified' });
      expect(JSON.stringify(detail)).not.toContain('execution_quote');

      // Lifecycle overrides: pause keeps research, blocks strategies; delist hides.
      expect((await decide('FXAERO', 'pause', 'issuer notice')).statusCode).toBe(201);
      const paused = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('FXAERO')}` })
      ).json();
      expect(paused.availability).toMatchObject({
        research: true,
        strategy: false,
        reasons: ['INSTRUMENT_PAUSED', 'EXECUTION_NOT_ENABLED'],
      });
      expect((await decide('FXAERO', 'resume')).json().error.code).toBe('ADMISSION_BLOCKED');
      await verify('FXAERO');
      expect((await decide('FXAERO', 'resume')).statusCode).toBe(201);
      expect((await decide('FXBIO', 'delist', 'issuer withdrew')).statusCode).toBe(201);
      const afterDelist = (
        await app.inject({ method: 'GET', url: '/v1/catalog/instruments' })
      ).json();
      expect(afterDelist.instruments.map((item: { symbol: string }) => item.symbol)).toEqual([
        'FXAERO',
      ]);
      const history = (
        await app.inject({
          method: 'GET',
          url: `/v1/ops/catalog/instruments/${byId.get('FXAERO')}/decisions`,
          headers: bearer(writer),
        })
      ).json();
      expect(history.decisions.map((item: { decision: string }) => item.decision)).toEqual([
        'resume',
        'pause',
        'admit',
      ]);
    });
  });

  it('rejects counterfeit symbols, missing fields and duplicate ids, and refuses drifted feeds without touching the catalog', async () => {
    await withHarness(async ({ app, operator, useFixture }) => {
      const writer = await operator(['ops:catalog:read', 'ops:catalog:write']);
      const first = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'prestocks', source: 'fixture' },
        })
      ).json();
      expect(first.counts.inserted).toBe(4);

      useFixture('counterfeit');
      const counterfeit = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'prestocks', source: 'fixture' },
        })
      ).json();
      expect(counterfeit.counts).toEqual({
        inserted: 0,
        updated: 0,
        unchanged: 1,
        rejected: 3,
        paused: 0,
      });
      const outcomes = Object.fromEntries(
        counterfeit.products.map(
          (
            item: { issuerProductId: string; outcome: string; reasons: string[] },
            index: number,
          ) => [`${index}:${item.issuerProductId}`, [item.outcome, item.reasons]],
        ),
      );
      expect(outcomes['0:fx-aero-001']).toEqual(['unchanged', []]);
      expect(outcomes['1:fx-fake-101'][0]).toBe('rejected');
      expect(outcomes['1:fx-fake-101'][1].join(' | ')).toMatch(
        /symbol FXAERO belongs to instrument/,
      );
      expect(outcomes['1:fx-fake-101'][1].join(' | ')).toMatch(
        /already used in this feed by fx-aero-001/,
      );
      expect(outcomes['2:fx-missing-102']).toEqual([
        'rejected',
        ['missing name', 'mint is not a base58 32-byte address'],
      ]);
      expect(outcomes['3:fx-missing-102'][1][0]).toBe('duplicate productId in feed');
      const rejected = (
        await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/instruments?status=rejected',
          headers: bearer(writer),
        })
      ).json();
      expect(rejected.instruments.map((item: { symbol: string }) => item.symbol)).toEqual([
        'FXAERO',
      ]);
      expect(rejected.instruments[0].issuerProductId).toBe('fx-fake-101');

      useFixture('drift');
      const drifted = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'prestocks', source: 'fixture' },
        })
      ).json();
      expect(drifted.snapshot.status).toBe('rejected');
      expect(drifted.snapshot.rejectionReason).toMatch(/feed does not match schema 1/);
      expect(drifted.counts).toEqual({
        inserted: 0,
        updated: 0,
        unchanged: 0,
        rejected: 0,
        paused: 0,
      });
      const all = (
        await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/instruments',
          headers: bearer(writer),
        })
      ).json();
      expect(all.instruments).toHaveLength(5);
      const snapshots = (
        await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/snapshots?issuer=prestocks',
          headers: bearer(writer),
        })
      ).json();
      expect(
        snapshots.snapshots.map((item: { status: string; sourceRef: string }) => [
          item.sourceRef,
          item.status,
        ]),
      ).toEqual([
        ['fixture:drift', 'rejected'],
        ['fixture:counterfeit', 'accepted'],
        ['fixture:default', 'accepted'],
      ]);
      expect(JSON.stringify(snapshots)).not.toContain('mintAddress');
    });
  });
});
