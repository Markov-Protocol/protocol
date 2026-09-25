import { generateKeyPairSync } from 'node:crypto';
import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig } from '@markov/config';
import {
  type ErrorResponse,
  type ExecutionPlan,
  encodeBase58,
  type Intent,
  type IntentCreateRequest,
  type StrategyDetail,
  type StrategyDraftContent,
  type StrategyVersion,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createXstocksFixtureSource } from '@markov/issuer-xstocks';
import { createSilentLogger } from '@markov/observability';
import { verifyPlanHash } from '@markov/planning';
import { FIXTURE_JURISDICTION_RULE_SET, FIXTURE_TERMS_DOCUMENT } from '@markov/policy';
import { type Ed25519Signer, signerFromPrivateKey } from '@markov/registry';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { createFixtureVenue } from '@markov/venue-jupiter';
import { describe, expect, it } from 'vitest';
import {
  buildApp,
  createCatalogService,
  createFundingService,
  createIdentityService,
  createPlanningService,
  createPolicyService,
  createProbes,
  createStrategyService,
  type FollowService,
  type MarkovApi,
  type RegistryService,
  type ResearchService,
  type WatchlistService,
} from '../src/index.js';
import {
  GENESIS,
  prestocksFixtureRpcFetch,
  xstocksFixtureMintAccounts,
} from './support/fixture-rpc.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
/** Synthetic stablecoin mint of the fixtures; not a real token. */
const STABLECOIN = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
const RENT_EXEMPT = 2_039_280;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

interface Balance {
  lamports: number;
  stablecoinRaw: bigint;
}

function tokenAccount(amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(new Uint8Array(32).fill(7), 0);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  return Buffer.from(data).toString('base64');
}

/** The PreStocks fixture RPC plus the xStocks mints and balance reads from a mutable table (empty means nothing, never zero by accident). */
function planningRpcFetch(table: Map<string, Balance>): typeof fetch {
  const base = prestocksFixtureRpcFetch();
  const xstocks = xstocksFixtureMintAccounts();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const entry = table.get(String(body.params[0]));
    let result: unknown;
    switch (body.method) {
      case 'getAccountInfo': {
        const account = xstocks.get(String(body.params[0]));
        if (!account) {
          return base(input, init);
        }
        result = {
          context: { slot: 4242 },
          value: {
            data: [Buffer.from(account.data).toString('base64'), 'base64'],
            executable: false,
            lamports: 1,
            owner: account.owner,
            space: account.data.length,
          },
        };
        break;
      }
      case 'getBalance':
        result = { context: { slot: 4242 }, value: entry?.lamports ?? 0 };
        break;
      case 'getTokenAccountsByOwner':
        result = {
          context: { slot: 4242 },
          value:
            entry && entry.stablecoinRaw > 0n
              ? [
                  {
                    pubkey: 'FixtureTokenAccount111111111111111111111111',
                    account: {
                      data: [tokenAccount(entry.stablecoinRaw), 'base64'],
                      executable: false,
                      lamports: RENT_EXEMPT,
                      owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    },
                  },
                ]
              : [],
        };
        break;
      case 'getMinimumBalanceForRentExemption':
        result = RENT_EXEMPT;
        break;
      default:
        return base(input, init);
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

interface Harness {
  app: MarkovApi;
  balances: Map<string, Balance>;
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** FXAERO, FXBIO (PreStocks) and XSFXA (xStocks) admitted; FXBIO's fixture mark is stale by design. */
  seed: (operatorToken: string) => Promise<Record<'aero' | 'bio' | 'xsa', string>>;
  linkWallet: (sessionToken: string) => Promise<{ walletId: string; signer: Ed25519Signer }>;
  /** Fixture rules and terms published, jurisdiction declared and terms acknowledged for the session. */
  makeEligible: (sessionToken: string) => Promise<void>;
  freezeVersion: (sessionToken: string, content: StrategyDraftContent) => Promise<StrategyVersion>;
}

async function withHarness(
  options: { venue: 'fixture' | 'disabled' },
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(
      baseTestEnv({
        DATABASE_URL: url,
        FUNDING_STABLECOIN_MINT: STABLECOIN,
        ...(options.venue === 'fixture' ? { EXECUTION_VENUE_PROVIDER: 'fixture' } : {}),
      }),
    );
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'planning-test',
    });
    const balances = new Map<string, Balance>();
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'planning-test',
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
      const rpc = new SolanaRpcClient({
        url: 'http://rpc.test',
        timeoutMs: 2000,
        maxResponseBytes: 1_000_000,
        fetchImpl: planningRpcFetch(balances),
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
        rpcClients: [rpc],
        sourceFor: (issuer, kind) =>
          issuer === 'xstocks'
            ? createXstocksFixtureSource(kind === 'products' ? 'products' : 'events')
            : createPrestocksFixtureSource('default'),
      });
      const policy = createPolicyService({ config, db: client.db, catalog });
      const funding = createFundingService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [rpc],
      });
      const stablecoin = config.funding.stablecoin;
      if (stablecoin === null) {
        throw new Error('the harness configures a stablecoin');
      }
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
        policy,
        funding,
        research: unavailable<ResearchService>('research'),
        watchlists: unavailable<WatchlistService>('watchlist'),
        strategies: createStrategyService({ config, db: client.db, genesisHash: GENESIS }),
        registry: unavailable<RegistryService>('registry'),
        follows: unavailable<FollowService>('follows'),
        planning: createPlanningService({
          config,
          db: client.db,
          catalog,
          policy,
          funding,
          venue: options.venue === 'fixture' ? createFixtureVenue({ stablecoin }) : null,
          genesisHash: GENESIS,
        }),
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
        for (const issuer of ['prestocks', 'xstocks']) {
          const ingested = await app.inject({
            method: 'POST',
            url: '/v1/ops/catalog/ingestions',
            headers,
            payload: { issuer, source: 'fixture' },
          });
          expect(ingested.statusCode, ingested.body).toBe(201);
        }
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
          xsa: await idOf('XSFXA'),
        };
        for (const id of [ids.aero, ids.bio, ids.xsa]) {
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/mint-verifications`,
            headers,
          });
          const admitted = await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/decisions`,
            headers,
            payload: { decision: 'admit', reason: 'planning test', evidence: { review: 'test' } },
          });
          expect(admitted.statusCode, admitted.body).toBe(201);
        }
        return ids;
      };
      const linkWallet = async (sessionToken: string) => {
        const signer = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
        const challenge = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets/challenges',
          headers: bearer(sessionToken),
          payload: { address: signer.publicKey },
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
          payload: {
            challengeId,
            address: signer.publicKey,
            signature: encodeBase58(signer.sign(new TextEncoder().encode(message))),
          },
        });
        expect(linked.statusCode, linked.body).toBe(201);
        return { walletId: (linked.json() as { walletId: string }).walletId, signer };
      };
      const makeEligible = async (sessionToken: string) => {
        const ops = await credential('operator', null, ['ops:policy:read', 'ops:policy:write']);
        for (const [url, payload] of [
          ['/v1/ops/policy/jurisdiction-rules', FIXTURE_JURISDICTION_RULE_SET],
          ['/v1/ops/policy/terms', FIXTURE_TERMS_DOCUMENT],
        ] as const) {
          const published = await app.inject({
            method: 'POST',
            url,
            headers: bearer(ops),
            payload,
          });
          expect([201, 409]).toContain(published.statusCode);
        }
        const declared = await app.inject({
          method: 'POST',
          url: '/v1/me/eligibility/declarations',
          headers: bearer(sessionToken),
          payload: { jurisdiction: 'ZZ', attestation: true },
        });
        expect(declared.statusCode, declared.body).toBe(201);
        const acknowledged = await app.inject({
          method: 'POST',
          url: '/v1/me/terms/acknowledgements',
          headers: bearer(sessionToken),
          payload: {
            termsVersion: FIXTURE_TERMS_DOCUMENT.termsVersion,
            contentHash: FIXTURE_TERMS_DOCUMENT.contentHash,
          },
        });
        expect(acknowledged.statusCode, acknowledged.body).toBe(201);
      };
      const freezeVersion = async (sessionToken: string, content: StrategyDraftContent) => {
        const created = await app.inject({
          method: 'POST',
          url: '/v1/me/strategies',
          headers: bearer(sessionToken),
          payload: { content },
        });
        expect(created.statusCode, created.body).toBe(201);
        const strategyId = (created.json() as StrategyDetail).strategy.strategyId;
        const frozen = await app.inject({
          method: 'POST',
          url: `/v1/me/strategies/${strategyId}/versions`,
          headers: bearer(sessionToken),
          payload: {},
        });
        expect(frozen.statusCode, frozen.body).toBe(201);
        return frozen.json() as StrategyVersion;
      };
      try {
        await fn({
          app,
          balances,
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          seed,
          linkWallet,
          makeEligible,
          freezeVersion,
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
  aeroBps = 4500,
  cashBps = 1000,
): StrategyDraftContent {
  return {
    title: 'Balanced pair',
    thesis: 'Two fixture names from two issuers, one cash sleeve.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: aeroBps, note: null },
      { instrumentId: ids['xsa'] as string, weightBps: 10_000 - aeroBps - cashBps, note: null },
    ],
    cashWeightBps: cashBps,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}

const sumRaw = (values: readonly string[]) =>
  values.reduce((sum, value) => sum + BigInt(value), 0n);

describe.skipIf(adminUrl === null)('planning API', () => {
  it('plans a basket investment with conserved allocation, checked fixture quotes, policy evidence and a reviewed hash', async () => {
    await withHarness({ venue: 'fixture' }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const bob = await h.user('did:test:bob');
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const version = await h.freezeVersion(alice, content(ids));
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as {
        user: { id: string };
      };
      const request: IntentCreateRequest = {
        schemaVersion: '1',
        kind: 'basket_investment',
        strategyVersionId: version.versionId,
        instrumentId: null,
        walletId: wallet.walletId,
        budget: { rawAmount: '1000000000' },
        budgetMode: 'all_in_stablecoin',
        executionPreference: 'atomic_or_explicit_staged_review',
        approvalMode: 'owner_each_plan',
        slippageBps: null,
        idempotencyKey: 'test-intent-0001',
      };

      // Intent creation is idempotent per key; another payload under the same key is a conflict.
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/intents',
        headers: bearer(alice),
        payload: request,
      });
      expect(created.statusCode, created.body).toBe(201);
      const intent = created.json() as Intent;
      expect(intent).toMatchObject({
        kind: 'basket_investment',
        state: 'DRAFT',
        wallet: { walletId: wallet.walletId, address: wallet.signer.publicKey },
        strategy: {
          versionId: version.versionId,
          versionNumber: 1,
          manifestHash: version.manifestHash,
        },
        budget: { mint: STABLECOIN, symbol: 'USDC', decimals: 6, rawAmount: '1000000000' },
        slippageBps: 50,
        latestPlanId: null,
      });
      const again = await h.app.inject({
        method: 'POST',
        url: '/v1/me/intents',
        headers: bearer(alice),
        payload: request,
      });
      expect(again.statusCode).toBe(200);
      expect((again.json() as Intent).intentId).toBe(intent.intentId);
      const conflict = await h.app.inject({
        method: 'POST',
        url: '/v1/me/intents',
        headers: bearer(alice),
        payload: { ...request, budget: { rawAmount: '2000000000' } },
      });
      expect(conflict.statusCode).toBe(409);
      expect((conflict.json() as ErrorResponse).error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/intents',
            headers: bearer(alice),
            payload: { ...request, idempotencyKey: 'test-intent-0002', slippageBps: 5_000 },
          })
        ).statusCode,
      ).toBe(400);

      // Nobody else sees it; agents read, never create.
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/intents/${intent.intentId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
      const reader = await h.agent(me.user.id, ['portfolio:read']);
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/intents', headers: bearer(reader) })
          ).json() as { intents: Intent[] }
        ).intents.map((row) => row.intentId),
      ).toEqual([intent.intentId]);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/intents',
            headers: bearer(reader),
            payload: request,
          })
        ).statusCode,
      ).toBe(403);

      // An empty wallet cannot fund the plan; the refusal names both assets and nothing is quoted.
      const unfunded = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(unfunded.statusCode, unfunded.body).toBe(409);
      const unfundedError = (unfunded.json() as ErrorResponse).error;
      expect(unfundedError.code).toBe('INSUFFICIENT_FUNDS');
      expect(unfundedError.details?.map((detail) => detail.path)).toEqual([
        'funds.stablecoin',
        'funds.sol',
      ]);

      h.balances.set(wallet.signer.publicKey, {
        lamports: 50_000_000,
        stablecoinRaw: 5_000_000_000n,
      });
      const built = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(built.statusCode, built.body).toBe(201);
      const plan = built.json() as ExecutionPlan;
      expect(plan.mode).toBe('fixture');
      expect(plan.status).toBe('valid');
      expect(plan.intentId).toBe(intent.intentId);
      expect(plan.network).toEqual({ cluster: 'devnet', genesisHash: GENESIS });
      expect(plan.strategy?.manifestHash).toBe(version.manifestHash);
      // Conservation: every leg target plus cash is the investable amount; the bounds cover the spend exactly.
      expect(plan.allocation.conserved).toBe(true);
      expect(
        sumRaw([
          ...plan.allocation.legs.map((leg) => leg.targetRaw),
          plan.allocation.cash.targetRaw,
        ]),
      ).toBe(1_000_000_000n);
      expect(plan.allocation.legs.map((leg) => leg.targetRaw)).toEqual(['450000000', '450000000']);
      expect(plan.allocation.cash.targetRaw).toBe('100000000');
      expect(BigInt(plan.bounds.maxTotalInputRaw) + BigInt(plan.bounds.residualCashRaw)).toBe(
        BigInt(plan.input.totalSpendRaw),
      );
      expect(plan.input.totalSpendRaw).toBe('1000000000');
      // Two constituents: staged, one batch per leg, with worst-case spend and acknowledgement required.
      expect(plan.grouping.mode).toBe('staged');
      expect(plan.grouping.acknowledgementRequired).toBe(true);
      expect(plan.grouping.batches.map((batch) => batch.worstCaseSpentRaw)).toEqual([
        '450000000',
        '900000000',
      ]);
      expect(plan.legs).toHaveLength(2);
      for (const leg of plan.legs) {
        expect(leg.quote.mode).toBe('fixture');
        expect(leg.maxInputRaw).toBe(leg.targetInputRaw);
        expect(BigInt(leg.minimumOutputRaw) <= BigInt(leg.expectedOutputRaw)).toBe(true);
        expect(leg.policyDecision.outcome).toBe('allow');
        expect(leg.slippageBps).toBe(50);
      }
      expect(plan.legs.map((leg) => leg.symbol)).toEqual(['FXAERO', 'XSFXA']);
      expect(plan.legs.map((leg) => leg.issuer)).toEqual(['prestocks', 'xstocks']);
      expect(plan.legs[1]?.tokenProgram).toBe('token-2022');
      // Fees: a separate SOL budget with an explicit upper bound; no protocol fee under beta-0.
      expect(plan.fees.protocol).toEqual({ feePolicyVersion: 'beta-0', feeBps: 0, feeRaw: '0' });
      expect(plan.fees.network.batches).toBe(2);
      expect(plan.fees.network.totalLamportsMax).toBe(
        (2n * 5_000n + 2n * 100_000n + 2n * 2_039_280n).toString(),
      );
      expect(plan.fees.feePayer).toBe(wallet.signer.publicKey);
      // Validity and evidence.
      expect(plan.validity.simulation).toBeNull();
      expect(Date.parse(plan.validity.expiresAt)).toBeLessThanOrEqual(
        Date.parse(plan.validity.quotesExpireAt),
      );
      expect(plan.validity.evidence.policyDecisionIds).toHaveLength(2);
      expect(plan.validity.evidence.quoteRefs.every((ref) => ref.startsWith('fixture:'))).toBe(
        true,
      );
      expect(plan.validity.evidence.eligibilityDecisionId).not.toBeNull();
      expect(plan.funds).toMatchObject({
        sufficient: true,
        stablecoinRaw: '5000000000',
        lamports: '50000000',
        shortfalls: [],
      });
      expect(plan.warnings.some((warning) => warning.startsWith('Fixture mode'))).toBe(true);
      expect(plan.warnings.some((warning) => warning.startsWith('Staged execution'))).toBe(true);
      expect(verifyPlanHash(plan)).toBe(true);
      expect(plan.review).toEqual({
        acknowledgedAt: null,
        acknowledgedHash: null,
        stagedAcknowledged: false,
      });

      const quoted = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/intents/${intent.intentId}`,
          headers: bearer(alice),
        })
      ).json() as Intent;
      expect(quoted).toMatchObject({
        state: 'QUOTED',
        latestPlanId: plan.planId,
        latestPlanHash: plan.planHash,
      });
      const read = await h.app.inject({
        method: 'GET',
        url: `/v1/me/intents/${intent.intentId}/plans/${plan.planId}`,
        headers: bearer(reader),
      });
      expect(read.statusCode).toBe(200);
      expect((read.json() as ExecutionPlan).planHash).toBe(plan.planHash);

      // Review: a staged plan needs explicit acknowledgement, the hash must be this plan's, and then the intent waits for approval.
      const ackUrl = `/v1/me/intents/${intent.intentId}/plans/${plan.planId}/acknowledgements`;
      const noStaged = await h.app.inject({
        method: 'POST',
        url: ackUrl,
        headers: bearer(alice),
        payload: { planHash: plan.planHash },
      });
      expect(noStaged.statusCode).toBe(400);
      expect((noStaged.json() as ErrorResponse).error.details?.[0]?.path).toBe(
        'stagedAcknowledged',
      );
      const wrongHash = await h.app.inject({
        method: 'POST',
        url: ackUrl,
        headers: bearer(alice),
        payload: { planHash: '0'.repeat(64), stagedAcknowledged: true },
      });
      expect(wrongHash.statusCode).toBe(409);
      expect((wrongHash.json() as ErrorResponse).error.code).toBe('PLAN_CHANGED');
      const acknowledged = await h.app.inject({
        method: 'POST',
        url: ackUrl,
        headers: bearer(alice),
        payload: { planHash: plan.planHash, stagedAcknowledged: true },
      });
      expect(acknowledged.statusCode, acknowledged.body).toBe(200);
      const reviewed = acknowledged.json() as ExecutionPlan;
      expect(reviewed.review.acknowledgedHash).toBe(plan.planHash);
      expect(reviewed.review.stagedAcknowledged).toBe(true);
      expect(reviewed.review.acknowledgedAt).not.toBeNull();
      expect(reviewed.planHash).toBe(plan.planHash);
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/intents/${intent.intentId}`,
              headers: bearer(alice),
            })
          ).json() as Intent
        ).state,
      ).toBe('AWAITING_APPROVAL');
      const twice = await h.app.inject({
        method: 'POST',
        url: ackUrl,
        headers: bearer(alice),
        payload: { planHash: plan.planHash, stagedAcknowledged: true },
      });
      expect(twice.statusCode).toBe(200);

      // A new plan supersedes the reviewed one; the old hash can no longer be acknowledged.
      const rebuilt = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(rebuilt.statusCode, rebuilt.body).toBe(201);
      const second = rebuilt.json() as ExecutionPlan;
      expect(second.planId).not.toBe(plan.planId);
      expect(second.review.acknowledgedHash).toBeNull();
      const stale = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/intents/${intent.intentId}/plans/${plan.planId}`,
          headers: bearer(alice),
        })
      ).json() as ExecutionPlan;
      expect(stale.status).toBe('superseded');
      const superseded = await h.app.inject({
        method: 'POST',
        url: ackUrl,
        headers: bearer(alice),
        payload: { planHash: plan.planHash, stagedAcknowledged: true },
      });
      expect(superseded.statusCode).toBe(409);
      expect((superseded.json() as ErrorResponse).error.code).toBe('PLAN_CHANGED');
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/intents/${intent.intentId}`,
              headers: bearer(alice),
            })
          ).json() as Intent
        ).state,
      ).toBe('QUOTED');

      // Cancel: terminal, idempotent, and no further plan.
      const cancelled = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/cancel`,
        headers: bearer(alice),
      });
      expect(cancelled.statusCode).toBe(200);
      expect((cancelled.json() as Intent).state).toBe('CANCELLED');
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/intents/${intent.intentId}/cancel`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(200);
      const afterCancel = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(afterCancel.statusCode).toBe(400);

      // A budget below the route minimum is refused with the smallest workable budget; weights are untouched.
      const tiny = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/intents',
          headers: bearer(alice),
          payload: {
            ...request,
            idempotencyKey: 'test-intent-tiny',
            budget: { rawAmount: '1500000' },
          },
        })
      ).json() as Intent;
      const tooSmall = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${tiny.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(tooSmall.statusCode, tooSmall.body).toBe(400);
      const tooSmallError = (tooSmall.json() as ErrorResponse).error;
      expect(tooSmallError.message).toMatch(/route minimum/);
      // 1 USDC at 45% → 2,222,223 raw investable.
      expect(tooSmallError.details?.[0]).toEqual({
        path: 'budget.rawAmount',
        message: 'the smallest workable budget is 2222223 raw USDC',
      });

      // Policy denies a leg above the order cap: no plan, machine-readable denials.
      const large = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/intents',
          headers: bearer(alice),
          payload: {
            ...request,
            idempotencyKey: 'test-intent-large',
            budget: { rawAmount: '3000000000' },
          },
        })
      ).json() as Intent;
      const denied = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${large.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(denied.statusCode, denied.body).toBe(403);
      const deniedError = (denied.json() as ErrorResponse).error;
      expect(deniedError.code).toBe('POLICY_DENIED');
      expect(deniedError.details?.[0]?.message).toMatch(/ORDER_CAP_EXCEEDED/);
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/intents/${large.intentId}`,
              headers: bearer(alice),
            })
          ).json() as Intent
        ).state,
      ).toBe('DRAFT');

      // Data quality gates planning too: the FXBIO fixture mark is stale, so its leg is denied.
      const staleBuy = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/intents',
          headers: bearer(alice),
          payload: {
            kind: 'single_buy',
            instrumentId: ids.bio,
            walletId: wallet.walletId,
            budget: { rawAmount: '100000000' },
            idempotencyKey: 'test-intent-stale',
          },
        })
      ).json() as Intent;
      const staleDenied = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${staleBuy.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(staleDenied.statusCode, staleDenied.body).toBe(403);
      expect((staleDenied.json() as ErrorResponse).error.details?.[0]?.message).toMatch(
        /REFERENCE_STALE/,
      );

      // A single buy is one atomic transaction and needs no staged acknowledgement.
      const single = await h.app.inject({
        method: 'POST',
        url: '/v1/me/intents',
        headers: bearer(alice),
        payload: {
          kind: 'single_buy',
          instrumentId: ids.aero,
          walletId: wallet.walletId,
          budget: { rawAmount: '100000000' },
          idempotencyKey: 'test-intent-single',
        },
      });
      expect(single.statusCode, single.body).toBe(201);
      const singleIntent = single.json() as Intent;
      expect(singleIntent).toMatchObject({
        kind: 'single_buy',
        instrumentId: ids.aero,
        strategy: null,
      });
      const singlePlanResponse = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${singleIntent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(singlePlanResponse.statusCode, singlePlanResponse.body).toBe(201);
      const singlePlan = singlePlanResponse.json() as ExecutionPlan;
      expect(singlePlan.grouping).toMatchObject({ mode: 'atomic', acknowledgementRequired: false });
      expect(singlePlan.legs).toHaveLength(1);
      expect(singlePlan.allocation.legs[0]?.targetRaw).toBe('100000000');
      expect(singlePlan.fees.network.batches).toBe(1);
      const singleAck = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${singleIntent.intentId}/plans/${singlePlan.planId}/acknowledgements`,
        headers: bearer(alice),
        payload: { planHash: singlePlan.planHash },
      });
      expect(singleAck.statusCode, singleAck.body).toBe(200);
      expect(verifyPlanHash(singlePlan)).toBe(true);

      // Bob cannot invest in Alice's unpublished version, and unknown wallets are refused.
      await h.makeEligible(bob);
      const bobWallet = await h.linkWallet(bob);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/intents',
            headers: bearer(bob),
            payload: {
              ...request,
              walletId: bobWallet.walletId,
              idempotencyKey: 'bob-intent-0001',
            },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/intents',
            headers: bearer(bob),
            payload: { ...request, idempotencyKey: 'bob-intent-0002' },
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  it('fails closed without a configured venue and never labels a fixture plan as live', async () => {
    await withHarness({ venue: 'disabled' }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.balances.set(wallet.signer.publicKey, {
        lamports: 50_000_000,
        stablecoinRaw: 5_000_000_000n,
      });
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/intents',
        headers: bearer(alice),
        payload: {
          kind: 'single_buy',
          instrumentId: ids.aero,
          walletId: wallet.walletId,
          budget: { rawAmount: '100000000' },
          idempotencyKey: 'no-venue-0001',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const intent = created.json() as Intent;
      const plan = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/plans`,
        headers: bearer(alice),
      });
      expect(plan.statusCode).toBe(503);
      expect((plan.json() as ErrorResponse).error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/intents/${intent.intentId}`,
              headers: bearer(alice),
            })
          ).json() as Intent
        ).state,
      ).toBe('DRAFT');
    });
  });
});
