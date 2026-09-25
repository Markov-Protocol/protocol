import { readFileSync } from 'node:fs';
import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import {
  EXTENSION_TYPE_BY_NAME,
  type ExtensionFixtureSpec,
  encodeExtensionData,
  encodeMintAccount,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@markov/catalog';
import { KNOWN_GENESIS_HASHES, loadConfig } from '@markov/config';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createXstocksFixtureSource, type XstocksFixture } from '@markov/issuer-xstocks';
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
import type { MaintenanceService } from '../src/maintenance/service.js';
import type { NotificationService } from '../src/notifications/service.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const GENESIS = KNOWN_GENESIS_HASHES.devnet;
const NOW = new Date('2026-09-24T12:00:00Z');

interface FixtureMint {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: 'spl-token' | 'token-2022';
  extensions?: Record<string, unknown>[];
}

const fixtureMints = (
  JSON.parse(
    readFileSync(
      new URL('../../../packages/issuer-xstocks/fixtures/fixture-mints.json', import.meta.url),
      'utf8',
    ),
  ) as {
    mints: FixtureMint[];
  }
).mints;
const authority = new Uint8Array(32).fill(7);

function spec(raw: Record<string, unknown>): ExtensionFixtureSpec {
  switch (raw['name']) {
    case 'MetadataPointer':
      return { name: 'MetadataPointer', authority, metadataAddress: authority };
    case 'ScaledUiAmount':
      return {
        name: 'ScaledUiAmount',
        authority,
        multiplier: Number(raw['multiplier']),
        newMultiplier: Number(raw['newMultiplier']),
        newMultiplierEffectiveAt: Number(raw['newMultiplierEffectiveAt'] ?? 0),
      };
    case 'Pausable':
      return { name: 'Pausable', authority, paused: Boolean(raw['paused']) };
    case 'TransferFeeConfig':
      return {
        name: 'TransferFeeConfig',
        basisPoints: Number(raw['basisPoints']),
        maximumFee: BigInt(String(raw['maximumFee'])),
      };
    case 'PermanentDelegate':
      return { name: 'PermanentDelegate', delegate: raw['delegate'] ? authority : null };
    default:
      throw new Error(`unknown fixture extension ${String(raw['name'])}`);
  }
}

function fixtureRpcFetch(): typeof fetch {
  const accounts = new Map<string, { owner: string; data: Uint8Array }>();
  for (const item of fixtureMints) {
    const extensions = (item.extensions ?? []).map((raw) => {
      const full = spec(raw);
      return { type: EXTENSION_TYPE_BY_NAME[full.name], data: encodeExtensionData(full) };
    });
    accounts.set(item.mint, {
      owner: item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
      data: encodeMintAccount({
        decimals: item.decimals,
        supply: 5_000_000n,
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
    let result: unknown = null;
    if (body.method === 'getGenesisHash') {
      result = GENESIS;
    } else if (body.method === 'getHealth') {
      result = 'ok';
    } else if (body.method === 'getAccountInfo') {
      const account = accounts.get(String(body.params[0]));
      result = {
        context: { slot: 777 },
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
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

interface Harness {
  app: MarkovApi;
  operator: () => Promise<string>;
  useFixture: (products: XstocksFixture, events: XstocksFixture) => void;
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
      applicationName: 'listed-stocks-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'listed-stocks-test',
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
      let fixtures: { products: XstocksFixture; events: XstocksFixture } = {
        products: 'products',
        events: 'events',
      };
      const catalog = createCatalogService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        now: () => NOW,
        rpcClients: [
          new SolanaRpcClient({
            url: 'http://rpc.test',
            timeoutMs: 2000,
            maxResponseBytes: 1_000_000,
            fetchImpl: fixtureRpcFetch(),
          }),
        ],
        sourceFor: (_issuer, kind, source) => {
          if (source !== 'fixture') {
            throw new Error('configured_url is not stubbed in this test');
          }
          return createXstocksFixtureSource(
            kind === 'products' ? fixtures.products : fixtures.events,
          );
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
        maintenance: unavailable<MaintenanceService>('maintenance'),
        notifications: unavailable<NotificationService>('notifications'),
        strategies: unavailableStrategies,
        mintTestToken: (input) => issuer.mint({ subject: input.subject }),
      });
      await app.ready();
      const operator = async () => {
        const generated = generateCredential('operator', config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId: null,
          principalClass: 'operator',
          label: 'ops',
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes: ['ops:catalog:read', 'ops:catalog:write'],
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      try {
        await fn({
          app,
          operator,
          useFixture: (products, events) => {
            fixtures = { products, events };
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

describe.skipIf(adminUrl === null)('listed stocks API', () => {
  it('assesses token extensions, refuses unsupported mints, records multiplier evidence and applies corporate actions', async () => {
    await withHarness(async ({ app, operator, useFixture }) => {
      const writer = await operator();
      const ingested = await app.inject({
        method: 'POST',
        url: '/v1/ops/catalog/ingestions',
        headers: bearer(writer),
        payload: { issuer: 'xstocks', source: 'fixture' },
      });
      expect(ingested.statusCode).toBe(201);
      expect(ingested.json().counts.inserted).toBe(4);
      const quarantined = (
        await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/instruments?issuer=xstocks',
          headers: bearer(writer),
        })
      ).json().instruments as {
        instrumentId: string;
        symbol: string;
        underlying: { ticker: string };
      }[];
      const byId = new Map(quarantined.map((item) => [item.symbol, item.instrumentId]));
      expect(quarantined.map((item) => item.underlying.ticker)).toEqual([
        'FXA',
        'FXB',
        'FXC',
        'FXD',
      ]);

      const verify = async (symbol: string) =>
        (
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${byId.get(symbol)}/mint-verifications`,
            headers: bearer(writer),
          })
        ).json();
      const decide = (symbol: string, decision: string, evidence: Record<string, string> = {}) =>
        app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${byId.get(symbol)}/decisions`,
          headers: bearer(writer),
          payload: { decision, reason: 'operator review', evidence },
        });

      const alpha = await verify('XSFXA');
      expect(alpha).toMatchObject({
        result: 'verified',
        compatibility: {
          compatibility: 'supported',
          paused: false,
          scaledUiAmount: { multiplier: '2' },
        },
      });
      const beta = await verify('XSFXB');
      expect(beta).toMatchObject({
        result: 'verified',
        compatibility: { compatibility: 'unsupported', transferFee: { basisPoints: 25 } },
      });
      const gamma = await verify('XSFXC');
      expect(gamma.compatibility.compatibility).toBe('review_required');
      const delta = await verify('XSFXD');
      expect(delta.compatibility.paused).toBe(true);

      expect((await decide('XSFXA', 'admit')).statusCode).toBe(201);
      const betaAdmit = await decide('XSFXB', 'admit');
      expect(betaAdmit.statusCode).toBe(409);
      expect(betaAdmit.json().error.code).toBe('ADMISSION_BLOCKED');
      expect(betaAdmit.json().error.details[0].path).toBe('TransferFeeConfig');
      const gammaWithoutEvidence = await decide('XSFXC', 'admit');
      expect(gammaWithoutEvidence.statusCode).toBe(409);
      expect(gammaWithoutEvidence.json().error.details[0].path).toBe('PermanentDelegate');
      expect(
        (await decide('XSFXC', 'admit', { extensionReview: 'issuer terms section 4 accepted' }))
          .statusCode,
      ).toBe(201);
      expect((await decide('XSFXD', 'admit')).statusCode).toBe(201);

      const listed = (
        await app.inject({ method: 'GET', url: '/v1/catalog/instruments?issuer=xstocks' })
      ).json().instruments as {
        symbol: string;
        lifecycle: { halted: boolean; currentMultiplier: string | null };
        availability: { strategy: boolean; reasons: string[] };
      }[];
      expect(listed.map((item) => item.symbol)).toEqual(['XSFXA', 'XSFXC', 'XSFXD']);
      const alphaListed = listed[0] as (typeof listed)[number];
      expect(alphaListed.lifecycle).toMatchObject({ halted: false, currentMultiplier: '2' });
      expect(alphaListed.availability).toMatchObject({
        strategy: true,
        reasons: ['EXECUTION_NOT_ENABLED'],
      });
      const deltaListed = listed[2] as (typeof listed)[number];
      expect(deltaListed.lifecycle.halted).toBe(true);
      expect(deltaListed.availability).toMatchObject({
        strategy: false,
        reasons: ['ISSUER_HALTED', 'EXECUTION_NOT_ENABLED'],
      });

      // Corporate actions: inserted, unmatched and rejected events; nothing invented.
      const events = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/corporate-actions/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'xstocks', source: 'fixture' },
        })
      ).json();
      expect(events.snapshot.kind).toBe('corporate_actions');
      expect(events.counts).toEqual({
        inserted: 6,
        updated: 0,
        unchanged: 0,
        rejected: 1,
        unmatched: 1,
      });
      const again = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/corporate-actions/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'xstocks', source: 'fixture' },
        })
      ).json();
      expect(again.counts).toEqual({
        inserted: 0,
        updated: 0,
        unchanged: 6,
        rejected: 1,
        unmatched: 1,
      });
      const pending = (
        await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/corporate-actions?issuer=xstocks&status=pending',
          headers: bearer(writer),
        })
      ).json().actions as {
        actionId: string;
        externalId: string;
        type: string;
        effectiveAt: string;
      }[];
      const byExternal = new Map(pending.map((item) => [item.externalId, item]));
      expect(pending).toHaveLength(6);

      // A pending, already-effective split blocks strategy building until an operator applies it.
      const alphaPending = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('XSFXA')}` })
      ).json();
      expect(alphaPending.availability.reasons).toContain('CORPORATE_ACTION_PENDING');
      expect(
        alphaPending.lifecycle.pendingActions.map((item: { type: string }) => item.type),
      ).toEqual(['split', 'multiplier_change']);

      const apply = (externalId: string) =>
        app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/corporate-actions/${byExternal.get(externalId)?.actionId}/apply`,
          headers: bearer(writer),
          payload: { reason: 'issuer notice verified', evidence: { notice: 'N-1' } },
        });
      const split = await apply('xs-ev-001');
      expect(split.statusCode).toBe(201);
      expect(split.json().multiplier).toMatchObject({
        multiplier: '2',
        source: 'corporate_action',
        effectiveAt: '2026-09-20T00:00:00.000Z',
      });
      expect(split.json().multiplier.evidence).toMatchObject({
        basis: 'on_chain_after_effective_time',
        previousMultiplier: 'unknown',
        notice: 'N-1',
      });
      const future = await apply('xs-ev-006');
      expect(future.statusCode).toBe(400);
      expect(future.json().error.message).toMatch(/not effective before 2026-11-01/);
      expect((await apply('xs-ev-001')).statusCode).toBe(400);

      // Multiplier history and as-of resolution; incomplete history is reported, never assumed.
      const history = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/multipliers`,
        })
      ).json();
      expect(
        history.multipliers.map((item: { multiplier: string; source: string }) => [
          item.multiplier,
          item.source,
        ]),
      ).toEqual([
        ['2', 'on_chain'],
        ['2', 'corporate_action'],
      ]);
      const beforeSplit = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/multiplier?asOf=2026-09-19T00:00:00Z`,
        })
      ).json();
      expect(beforeSplit).toMatchObject({ complete: false, multiplier: null });
      const afterSplit = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/multiplier?asOf=2026-09-21T00:00:00Z`,
        })
      ).json();
      expect(afterSplit).toMatchObject({
        complete: true,
        multiplier: '2',
        source: 'corporate_action',
      });
      const nowMultiplier = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/multiplier`,
        })
      ).json();
      expect(nowMultiplier).toMatchObject({ complete: true, multiplier: '2', source: 'on_chain' });

      // Quantities: raw never changes; scaled uses the multiplier in force at the time asked.
      const scaledNow = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/quantities?raw=150000000`,
        })
      ).json();
      expect(scaledNow).toMatchObject({
        raw: '150000000',
        decimals: 8,
        multiplier: '2',
        scaled: '3',
        rounded: false,
      });
      const scaledAfterSplit = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/quantities?raw=150000000&asOf=2026-09-21T00:00:00Z`,
        })
      ).json();
      expect(scaledAfterSplit).toMatchObject({
        multiplier: '2',
        scaled: '3',
        multiplierSource: 'corporate_action',
      });
      const back = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/quantities?scaled=3&asOf=2026-09-21T00:00:00Z&rounding=half_even`,
        })
      ).json();
      expect(back).toMatchObject({ raw: '150000000', scaled: '3' });
      const tooEarly = await app.inject({
        method: 'GET',
        url: `/v1/catalog/instruments/${byId.get('XSFXA')}/quantities?raw=1&asOf=2026-01-01T00:00:00Z`,
      });
      expect(tooEarly.statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/catalog/instruments/${byId.get('XSFXA')}/quantities`,
          })
        ).statusCode,
      ).toBe(400);

      // Halt, resume, migration and sunset change availability truthfully.
      expect((await apply('xs-ev-002')).statusCode).toBe(201);
      expect((await apply('xs-ev-003')).statusCode).toBe(201);
      expect((await apply('xs-ev-004')).statusCode).toBe(201);
      expect((await apply('xs-ev-005')).statusCode).toBe(201);
      const gammaDetail = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('XSFXC')}` })
      ).json();
      expect(gammaDetail.lifecycle.migration).toMatchObject({
        targetProductId: 'xs-alpha',
        targetInstrumentId: byId.get('XSFXA'),
        deadlineAt: '2026-12-31T00:00:00.000Z',
      });
      expect(gammaDetail.availability.reasons).toContain('MIGRATION_REQUIRED');
      const deltaDetail = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('XSFXD')}` })
      ).json();
      expect(deltaDetail.lifecycle.sunsetAt).toBe('2027-01-31T00:00:00.000Z');
      expect(deltaDetail.availability.reasons).toEqual(['ISSUER_HALTED', 'EXECUTION_NOT_ENABLED']);
      const betaOps = (
        await app.inject({
          method: 'GET',
          url: `/v1/ops/catalog/instruments/${byId.get('XSFXB')}`,
          headers: bearer(writer),
        })
      ).json();
      expect(betaOps.lifecycle.halted).toBe(false);
      const alphaActions = (
        await app.inject({
          method: 'GET',
          url: `/v1/catalog/instruments/${byId.get('XSFXA')}/corporate-actions`,
        })
      ).json();
      expect(
        alphaActions.actions.map((item: { externalId: string; status: string }) => [
          item.externalId,
          item.status,
        ]),
      ).toEqual([
        ['xs-ev-006', 'pending'],
        ['xs-ev-001', 'applied'],
      ]);
      const reject = await app.inject({
        method: 'POST',
        url: `/v1/ops/catalog/corporate-actions/${byExternal.get('xs-ev-006')?.actionId}/reject`,
        headers: bearer(writer),
        payload: { reason: 'issuer withdrew the change' },
      });
      expect(reject.statusCode).toBe(201);
      expect(reject.json().status).toBe('rejected');
      const alphaAfter = (
        await app.inject({ method: 'GET', url: `/v1/catalog/instruments/${byId.get('XSFXA')}` })
      ).json();
      expect(alphaAfter.lifecycle.pendingActions).toEqual([]);
      expect(alphaAfter.availability.strategy).toBe(true);

      // A drifted event feed is recorded and changes nothing; public and anonymous access to operator routes is refused.
      useFixture('products', 'events-drift');
      const drifted = (
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/corporate-actions/ingestions',
          headers: bearer(writer),
          payload: { issuer: 'xstocks', source: 'fixture' },
        })
      ).json();
      expect(drifted.snapshot.status).toBe('rejected');
      expect(
        (await app.inject({ method: 'GET', url: '/v1/ops/catalog/corporate-actions' })).statusCode,
      ).toBe(401);
      expect(JSON.stringify(alphaAfter)).not.toContain('execution_quote');
    });
  });
});
