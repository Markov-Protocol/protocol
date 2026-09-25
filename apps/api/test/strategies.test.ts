import {
  createEd25519TestWallet,
  createIdentityVerifier,
  createTestIdentityIssuer,
  generateCredential,
} from '@markov/auth';
import { loadConfig } from '@markov/config';
import type {
  PortfolioInstance,
  StrategyDetail,
  StrategyDraft,
  StrategyDraftContent,
  StrategyVersion,
  VersionDiff,
} from '@markov/contracts';
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
  type AnalyticsService,
  buildApp,
  createCatalogService,
  createIdentityService,
  createPolicyService,
  createProbes,
  createStrategyService,
  type ExecutionService,
  type FollowService,
  type FundingService,
  type MarkovApi,
  type PlanningService,
  type RegistryService,
  type ResearchService,
  type WatchlistService,
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

interface Harness {
  app: MarkovApi;
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** Ingests the PreStocks fixture; admits FXAERO and FXBIO; FXGRID stays quarantined. */
  seed: (operatorToken: string) => Promise<Record<'aero' | 'bio' | 'grid', string>>;
  /** Links a fixture wallet to the session's account and answers its wallet id. */
  linkWallet: (sessionToken: string) => Promise<string>;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url, STRATEGY_MAX_LEGS: '3' }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'strategy-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'strategy-test',
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
        watchlists: unavailableWatchlists,
        registry: unavailable<RegistryService>('registry'),
        follows: unavailable<FollowService>('follows'),
        planning: unavailable<PlanningService>('planning'),
        execution: unavailable<ExecutionService>('execution'),
        accounting: unavailable<AccountingService>('accounting'),
        analytics: unavailable<AnalyticsService>('analytics'),
        strategies: createStrategyService({ config, db: client.db, genesisHash: GENESIS }),
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
          aero: await idOf('FXAERO'),
          bio: await idOf('FXBIO'),
          grid: await idOf('FXGRID'),
        };
        for (const id of [ids.aero, ids.bio]) {
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/mint-verifications`,
            headers,
          });
          const admitted = await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/decisions`,
            headers,
            payload: { decision: 'admit', reason: 'strategy test', evidence: { review: 'test' } },
          });
          expect(admitted.statusCode, admitted.body).toBe(201);
        }
        return ids;
      };
      const linkWallet = async (sessionToken: string) => {
        const wallet = createEd25519TestWallet();
        const challenge = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets/challenges',
          headers: bearer(sessionToken),
          payload: { address: wallet.address },
        });
        expect(challenge.statusCode, challenge.body).toBe(201);
        const { challengeId, message } = challenge.json() as {
          challengeId: string;
          message: string;
        };
        const linked = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets',
          headers: bearer(sessionToken),
          payload: { challengeId, address: wallet.address, signature: wallet.sign(message) },
        });
        expect(linked.statusCode, linked.body).toBe(201);
        return (linked.json() as { walletId: string }).walletId;
      };
      try {
        await fn({
          app,
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          seed,
          linkWallet,
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

function content(
  ids: Record<string, string>,
  overrides: Partial<StrategyDraftContent> = {},
): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 6000, note: null },
      { instrumentId: ids['bio'] as string, weightBps: 3000, note: 'biotech hedge' },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
    ...overrides,
  };
}

describe.skipIf(adminUrl === null)('strategy API', () => {
  it('validates exact recipes, freezes immutable versions, forks with provenance and pins instances explicitly', async () => {
    await withHarness(async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as { user: { id: string } };

      const limits = await h.app.inject({ method: 'GET', url: '/v1/strategies/limits' });
      expect(limits.statusCode).toBe(200);
      expect(limits.json()).toMatchObject({
        schemaVersion: '1',
        totalBps: 10000,
        maxLegs: 3,
        maxIssuerConcentrationBps: 5000,
        maxCompanyConcentrationBps: 3000,
        ceilingSource: 'policy_defaults',
      });

      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/strategies',
        headers: bearer(alice),
        payload: { content: content(ids) },
      });
      expect(created.statusCode, created.body).toBe(201);
      const detail = created.json() as StrategyDetail;
      const strategyId = detail.strategy.strategyId;
      expect(detail.strategy).toMatchObject({
        status: 'active',
        forkOf: null,
        currentVersion: null,
        draftRevision: 1,
        ownerUserId: me.user.id,
      });
      expect(detail.draft.validation).toMatchObject({
        valid: true,
        totals: { legsBps: 9000, cashBps: 1000, totalBps: 10000 },
      });
      // 9,000 bps on one issuer and 6,000 on one company exceed the policy ceilings: advisory,
      // never blocking. FXBIO sits exactly on the 3,000 company ceiling and is not reported.
      expect(detail.draft.validation.issues).toEqual([
        expect.objectContaining({
          code: 'ISSUER_CONCENTRATION',
          severity: 'warning',
          limit: 5000,
          observed: 9000,
        }),
        expect.objectContaining({
          code: 'COMPANY_CONCENTRATION',
          severity: 'warning',
          limit: 3000,
          observed: 6000,
        }),
      ]);

      // 9,999 and 10,001 totals, duplicates, unadmitted and too many legs are reported exactly and never renormalised.
      const save = (body: Record<string, unknown>, token = alice) =>
        h.app.inject({
          method: 'PUT',
          url: `/v1/me/strategies/${strategyId}/draft`,
          headers: bearer(token),
          payload: body,
        });
      for (const cash of [999, 1001]) {
        const saved = await save({ content: content(ids, { cashWeightBps: cash }) });
        expect(saved.statusCode, saved.body).toBe(200);
        const draft = saved.json() as StrategyDraft;
        expect(draft.validation.valid).toBe(false);
        expect(
          draft.validation.issues.find((issue) => issue.code === 'WEIGHTS_TOTAL'),
        ).toMatchObject({ severity: 'error', limit: 10000, observed: 9000 + cash });
        expect(draft.content.cashWeightBps).toBe(cash);
      }
      const bad = (
        await save({
          content: content(ids, {
            legs: [
              { instrumentId: ids['aero'] as string, weightBps: 3000, note: null },
              { instrumentId: ids['aero'] as string, weightBps: 3000, note: null },
              { instrumentId: ids['grid'] as string, weightBps: 2000, note: null },
              { instrumentId: BOGUS, weightBps: 1000, note: null },
            ],
            cashWeightBps: 1000,
          }),
        })
      ).json() as StrategyDraft;
      expect(
        bad.validation.issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.code)
          .sort(),
      ).toEqual([
        'DUPLICATE_INSTRUMENT',
        'INSTRUMENT_NOT_ADMITTED',
        'TOO_MANY_LEGS',
        'UNKNOWN_INSTRUMENT',
      ]);
      expect(bad.revision).toBe(4);
      const frozenBad = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions`,
        headers: bearer(alice),
        payload: {},
      });
      expect(frozenBad.statusCode).toBe(400);
      expect(
        (frozenBad.json() as { error: { details: { path: string }[] } }).error.details.map(
          (d) => d.path,
        ),
      ).toContain('legs/1');

      // Revisions: a stale ifRevision is refused with the current revision and nothing is overwritten.
      const stale = await save({ content: content(ids), ifRevision: 2 });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        details: [{ path: 'ifRevision', message: 'the current revision is 4' }],
      });
      const fresh = (await save({ content: content(ids), ifRevision: 4 })).json() as StrategyDraft;
      expect(fresh.revision).toBe(5);
      expect(fresh.validation.valid).toBe(true);

      // Freeze v1: admission snapshots, disclosures, manifest hash; identical re-freeze answers the same version.
      const frozen = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions`,
        headers: bearer(alice),
        payload: { ifRevision: 5 },
      });
      expect(frozen.statusCode, frozen.body).toBe(201);
      const v1 = frozen.json() as StrategyVersion;
      expect(v1).toMatchObject({
        versionNumber: 1,
        schemaVersion: '1',
        parentVersionId: null,
        forkOf: null,
        publication: 'unpublished',
        cashWeightBps: 1000,
        authorPrincipal: `user:${me.user.id}`,
      });
      expect(v1.legs.map((leg) => leg.symbol)).toHaveLength(2);
      const aeroLeg = v1.legs.find((leg) => leg.instrumentId === ids['aero']);
      expect(aeroLeg?.admission).toMatchObject({
        status: 'admitted',
        tokenProgram: 'spl-token',
        genesisHash: GENESIS,
      });
      expect(aeroLeg?.admission.verificationId).not.toBeNull();
      expect(v1.disclosures.issuers).toEqual([{ issuer: 'prestocks', weightBps: 9000 }]);
      expect(v1.disclosures.companies.map((row) => row.weightBps)).toEqual([6000, 3000]);
      expect(v1.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      const again = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions`,
        headers: bearer(alice),
        payload: {},
      });
      expect(again.statusCode).toBe(200);
      expect((again.json() as StrategyVersion).versionId).toBe(v1.versionId);

      // Fork keeps provenance under a new strategy; the original is untouched.
      const forked = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/forks`,
        headers: bearer(alice),
        payload: { versionId: v1.versionId },
      });
      expect(forked.statusCode, forked.body).toBe(201);
      const fork = forked.json() as StrategyDetail;
      expect(fork.strategy.forkOf).toEqual({ strategyId, versionId: v1.versionId });
      expect(fork.draft.content.legs.map((leg) => leg.weightBps)).toEqual(
        v1.legs.map((leg) => leg.weightBps),
      );
      expect(fork.draft.content.title).toBe('Aerospace tilt (fork)');

      // Instances pin explicitly; a creator's new version proposes but never moves the pin; v1 stays byte-identical.
      const walletId = await h.linkWallet(alice);
      const instanceCreated = await h.app.inject({
        method: 'POST',
        url: '/v1/me/instances',
        headers: bearer(alice),
        payload: { strategyId, versionId: v1.versionId, walletId, label: 'my aerospace' },
      });
      expect(instanceCreated.statusCode, instanceCreated.body).toBe(201);
      const instance = instanceCreated.json() as PortfolioInstance;
      expect(instance).toMatchObject({
        pinnedVersionId: v1.versionId,
        pinnedVersionNumber: 1,
        proposedVersionId: null,
        walletId,
        status: 'active',
      });

      await save({
        content: content(ids, {
          title: 'Aerospace tilt v2',
          cashWeightBps: 2000,
          legs: [
            { instrumentId: ids['aero'] as string, weightBps: 5000, note: null },
            { instrumentId: ids['bio'] as string, weightBps: 3000, note: 'biotech hedge' },
          ],
        }),
      });
      const frozen2 = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions`,
        headers: bearer(alice),
        payload: {},
      });
      expect(frozen2.statusCode).toBe(201);
      const v2 = frozen2.json() as StrategyVersion;
      expect(v2).toMatchObject({ versionNumber: 2, parentVersionId: v1.versionId });
      const afterV2 = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/instances/${instance.instanceId}`,
          headers: bearer(alice),
        })
      ).json() as PortfolioInstance;
      expect(afterV2).toMatchObject({
        pinnedVersionId: v1.versionId,
        pinnedVersionNumber: 1,
        proposedVersionId: v2.versionId,
      });
      const v1Again = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/strategies/${strategyId}/versions/${v1.versionId}`,
          headers: bearer(alice),
        })
      ).json() as StrategyVersion;
      expect(v1Again).toEqual(v1);
      const detailAfter = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/strategies/${strategyId}`,
          headers: bearer(alice),
        })
      ).json() as StrategyDetail;
      expect(detailAfter.strategy.currentVersion?.versionNumber).toBe(2);
      expect(detailAfter.versions.map((v) => v.versionNumber)).toEqual([2, 1]);

      const diff = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/strategies/${strategyId}/versions/${v2.versionId}/diff?against=${v1.versionId}`,
          headers: bearer(alice),
        })
      ).json() as VersionDiff;
      expect(diff).toMatchObject({
        fromVersionId: v1.versionId,
        toVersionId: v2.versionId,
        cashWeightBps: { from: 1000, to: 2000 },
        titleChanged: true,
        turnoverBps: 1000,
      });
      expect(diff.legs.changed).toEqual([
        { instrumentId: ids['aero'], symbol: 'FXAERO', fromBps: 6000, toBps: 5000 },
      ]);

      const pinned = await h.app.inject({
        method: 'POST',
        url: `/v1/me/instances/${instance.instanceId}/pin`,
        headers: bearer(alice),
        payload: { versionId: v2.versionId },
      });
      expect(pinned.statusCode, pinned.body).toBe(200);
      expect(pinned.json()).toMatchObject({
        pinnedVersionId: v2.versionId,
        pinnedVersionNumber: 2,
        proposedVersionId: null,
      });
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/instances/${instance.instanceId}/pin`,
            headers: bearer(alice),
            payload: { versionId: fork.strategy.currentVersion?.versionId ?? BOGUS },
          })
        ).statusCode,
      ).toBe(404);

      // Nothing on the API mutates a frozen version: no route exists, and archiving keeps history.
      const versionUrl = `/v1/me/strategies/${strategyId}/versions/${v1.versionId}`;
      for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
        const attempt = await h.app.inject({
          method,
          url: versionUrl,
          headers: bearer(alice),
          payload: {},
        });
        expect(attempt.statusCode, method).toBe(404);
      }
      const archived = await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/strategies/${strategyId}`,
        headers: bearer(alice),
        payload: { status: 'archived' },
      });
      expect(archived.statusCode).toBe(200);
      expect((await save({ content: content(ids) })).statusCode).toBe(400);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/strategies/${strategyId}/versions`,
            headers: bearer(alice),
            payload: {},
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/strategies/${strategyId}/versions`,
              headers: bearer(alice),
            })
          ).json() as { versions: unknown[] }
        ).versions,
      ).toHaveLength(2);

      // Scopes and ownership: agents draft with proposals:create but never freeze; another person sees nothing.
      const drafter = await h.agent(me.user.id, ['proposals:create', 'portfolio:read']);
      const agentCreated = await h.app.inject({
        method: 'POST',
        url: '/v1/me/strategies',
        headers: bearer(drafter),
        payload: { content: content(ids) },
      });
      expect(agentCreated.statusCode).toBe(201);
      const agentStrategy = (agentCreated.json() as StrategyDetail).strategy.strategyId;
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/strategies/${agentStrategy}/versions`,
            headers: bearer(drafter),
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/instances',
            headers: bearer(drafter),
            payload: { strategyId, versionId: v1.versionId, walletId, label: null },
          })
        ).statusCode,
      ).toBe(403);
      const reader = await h.agent(me.user.id, ['portfolio:read']);
      expect(
        (
          await h.app.inject({
            method: 'PUT',
            url: `/v1/me/strategies/${strategyId}/draft`,
            headers: bearer(reader),
            payload: { content: content(ids) },
          })
        ).statusCode,
      ).toBe(403);
      const bob = await h.user('did:test:bob');
      const foreign: { method: 'GET' | 'PUT' | 'POST'; url: string; payload?: object }[] = [
        { method: 'GET', url: `/v1/me/strategies/${strategyId}` },
        {
          method: 'PUT',
          url: `/v1/me/strategies/${strategyId}/draft`,
          payload: { content: content(ids) },
        },
        { method: 'POST', url: `/v1/me/strategies/${strategyId}/versions`, payload: {} },
        {
          method: 'POST',
          url: `/v1/me/strategies/${strategyId}/forks`,
          payload: { versionId: v1.versionId },
        },
        { method: 'GET', url: `/v1/me/instances/${instance.instanceId}` },
        {
          method: 'POST',
          url: '/v1/me/instances',
          payload: { strategyId, versionId: v1.versionId, walletId, label: null },
        },
      ];
      for (const request of foreign) {
        const response = await h.app.inject({
          method: request.method,
          url: request.url,
          headers: bearer(bob),
          ...(request.payload ? { payload: request.payload } : {}),
        });
        expect(response.statusCode, request.url).toBe(404);
      }
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/strategies', headers: bearer(bob) })
          ).json() as { strategies: unknown[] }
        ).strategies,
      ).toEqual([]);
    });
  });
});
