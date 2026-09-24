import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig } from '@markov/config';
import type { EligibilityStatusResponse, PolicyDecision } from '@markov/contracts';
import {
  applyIngestion,
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  recordIssuerSnapshot,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createSilentLogger } from '@markov/observability';
import { FIXTURE_JURISDICTION_RULE_SET, FIXTURE_TERMS_DOCUMENT } from '@markov/policy';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  buildApp,
  createCatalogService,
  createIdentityService,
  createPolicyService,
  createProbes,
  type FundingService,
  type MarkovApi,
} from '../src/index.js';
import { GENESIS, prestocksFixtureRpcFetch } from './support/fixture-rpc.js';

const adminUrl = testDatabaseUrl();
const USDC = (units: number) => String(BigInt(units) * 1_000_000n);

interface Harness {
  app: MarkovApi;
  db: ReturnType<typeof createDbClient>['db'];
  clock: { offsetMs: number; now: () => Date };
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string, authTime?: Date) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** Ingests, verifies and admits FXAERO; returns its instrument id and company name. */
  admitAero: (operatorToken: string) => Promise<{ instrumentId: string; companyName: string }>;
}

async function withHarness(
  env: Record<string, string>,
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url, ...env }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'policy-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'policy-test',
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
      const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs) };
      const policy = createPolicyService({ config, db: client.db, catalog, now: clock.now });
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
        funding: unavailableFunding,
        mintTestToken: (input) =>
          issuer.mint({
            subject: input.subject,
            ...(input.authTime ? { authTime: new Date(input.authTime) } : {}),
          }),
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
      const agent = async (userId: string, scopes: string[]) => {
        const generated = generateCredential('agent', config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId,
          principalClass: 'agent',
          label: 'agent',
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      const user = async (subject = 'did:test:alice', authTime?: Date) => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: {
            identityToken: await issuer.mint({ subject, ...(authTime ? { authTime } : {}) }),
          },
        });
        return response.json().sessionToken as string;
      };
      const admitAero = async (operatorToken: string) => {
        const headers = { authorization: `Bearer ${operatorToken}` };
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers,
          payload: { issuer: 'prestocks', source: 'fixture' },
        });
        const list = await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/instruments?q=FXAERO&status=quarantined',
          headers,
        });
        const instrument = list.json().instruments[0] as {
          instrumentId: string;
          companyName: string;
        };
        await app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${instrument.instrumentId}/mint-verifications`,
          headers,
        });
        const admitted = await app.inject({
          method: 'POST',
          url: `/v1/ops/catalog/instruments/${instrument.instrumentId}/decisions`,
          headers,
          payload: { decision: 'admit', reason: 'policy test', evidence: { review: 'test' } },
        });
        expect(admitted.statusCode).toBe(201);
        return { instrumentId: instrument.instrumentId, companyName: instrument.companyName };
      };
      try {
        await fn({ app, db: client.db, clock, operator, user, agent, admitAero });
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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const OPERATOR_SCOPES = [
  'ops:catalog:read',
  'ops:catalog:write',
  'ops:policy:read',
  'ops:policy:write',
];

function evaluation(overrides: Record<string, unknown>) {
  return {
    side: 'buy',
    notionalUsdcRaw: USDC(100),
    intentId: 'intent-1',
    exposure: {
      source: 'caller_declared',
      observedAt: new Date().toISOString(),
      positions: [],
      cashUsdcRaw: USDC(1000),
    },
    ...overrides,
  };
}

describe.skipIf(adminUrl === null)('policy API', () => {
  it('blocks an otherwise valid intent until eligibility, terms and limits pass, and re-checks before submission', async () => {
    await withHarness({}, async ({ app, operator, user, admitAero }) => {
      const ops = await operator(OPERATOR_SCOPES);
      const alice = await user();
      const { instrumentId } = await admitAero(ops);

      // Anonymous and wrongly scoped principals are refused before any policy logic runs.
      expect((await app.inject({ method: 'GET', url: '/v1/me/eligibility' })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/policy/jurisdiction-rules',
            headers: bearer(alice),
            payload: FIXTURE_JURISDICTION_RULE_SET,
          })
        ).statusCode,
      ).toBe(403);

      // Nothing published yet: unknown eligibility, and the evaluation of an admitted instrument is denied.
      const initial = await app.inject({
        method: 'GET',
        url: '/v1/me/eligibility',
        headers: bearer(alice),
      });
      expect(initial.statusCode).toBe(200);
      const initialStatus = initial.json() as EligibilityStatusResponse;
      expect(initialStatus).toMatchObject({
        outcome: 'unknown',
        decision: null,
        policyVersion: null,
        steps: ['declare_jurisdiction', 'verify_wallet'],
      });
      expect(initialStatus.terms.complete).toBe(true);
      const blocked = await app.inject({
        method: 'POST',
        url: '/v1/me/policy/evaluations',
        headers: bearer(alice),
        payload: evaluation({ instrumentId }),
      });
      expect(blocked.statusCode).toBe(201);
      expect(blocked.json().outcome).toBe('deny');
      expect((blocked.json() as PolicyDecision).denials.map((d) => d.code)).toEqual([
        'ELIGIBILITY_UNKNOWN',
      ]);

      // Declaring without rules records an unknown decision that expires in a day.
      const noRules = await app.inject({
        method: 'POST',
        url: '/v1/me/eligibility/declarations',
        headers: bearer(alice),
        payload: { jurisdiction: 'ZZ', attestation: true },
      });
      expect(noRules.statusCode).toBe(201);
      expect(noRules.json()).toMatchObject({
        outcome: 'unknown',
        policyVersion: null,
        evidenceKind: 'self_declared',
      });
      expect(
        (
          await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(alice) })
        ).json().steps,
      ).toEqual(['await_review', 'verify_wallet']);

      // Operators publish rules and terms; versions are immutable.
      const published = await app.inject({
        method: 'POST',
        url: '/v1/ops/policy/jurisdiction-rules',
        headers: bearer(ops),
        payload: FIXTURE_JURISDICTION_RULE_SET,
      });
      expect(published.statusCode).toBe(201);
      expect(published.json()).toMatchObject({ policyVersion: '2026-09-24', active: true });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/policy/jurisdiction-rules',
            headers: bearer(ops),
            payload: FIXTURE_JURISDICTION_RULE_SET,
          })
        ).statusCode,
      ).toBe(409);
      const terms = await app.inject({
        method: 'POST',
        url: '/v1/ops/policy/terms',
        headers: bearer(ops),
        payload: FIXTURE_TERMS_DOCUMENT,
      });
      expect(terms.statusCode).toBe(201);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/terms/current' })).json().documents,
      ).toHaveLength(1);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/policy/terms',
            headers: bearer(ops),
            payload: {
              ...FIXTURE_TERMS_DOCUMENT,
              termsVersion: '2026-09-25',
              url: 'http://insecure.example/terms',
            },
          })
        ).statusCode,
      ).toBe(400);

      // The earlier unknown decision is now superseded (made without a policy version).
      const afterRules = (
        await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(alice) })
      ).json() as EligibilityStatusResponse;
      expect(afterRules.steps).toEqual([
        'declare_jurisdiction',
        'acknowledge_terms',
        'verify_wallet',
      ]);
      expect(afterRules.summary).toContain('rules changed');

      // A denied jurisdiction stays denied; an allowed one becomes eligible for every issuer.
      const denied = await app.inject({
        method: 'POST',
        url: '/v1/me/eligibility/declarations',
        headers: bearer(alice),
        payload: { jurisdiction: 'XX', attestation: true },
      });
      expect(denied.json()).toMatchObject({
        outcome: 'ineligible',
        issuers: [],
        reasons: ['fixture jurisdiction XX is denied'],
      });
      const deniedEval = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId }),
        })
      ).json() as PolicyDecision;
      expect(deniedEval.denials.map((d) => d.code)).toEqual([
        'ELIGIBILITY_DENIED',
        'TERMS_NOT_ACKNOWLEDGED',
      ]);
      const eligible = await app.inject({
        method: 'POST',
        url: '/v1/me/eligibility/declarations',
        headers: bearer(alice),
        payload: { jurisdiction: 'ZZ', attestation: true },
      });
      expect(eligible.json()).toMatchObject({
        outcome: 'eligible',
        policyVersion: '2026-09-24',
        issuers: ['prestocks', 'xstocks', 'tessera'],
      });
      expect(
        new Date(eligible.json().expiresAt).getTime() -
          new Date(eligible.json().decidedAt).getTime(),
      ).toBe(180 * 86_400_000);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/me/eligibility/declarations',
            headers: bearer(alice),
            payload: { jurisdiction: 'zz', attestation: true },
          })
        ).statusCode,
      ).toBe(400);

      // Terms must be acknowledged by the hash of the text that was shown.
      const wrongHash = await app.inject({
        method: 'POST',
        url: '/v1/me/terms/acknowledgements',
        headers: bearer(alice),
        payload: { termsVersion: '2026-09-24', contentHash: 'f'.repeat(64) },
      });
      expect(wrongHash.statusCode).toBe(400);
      expect(wrongHash.json().error.details).toEqual([
        { path: 'body/contentHash', message: 'does not match the published content hash' },
      ]);
      const ack = await app.inject({
        method: 'POST',
        url: '/v1/me/terms/acknowledgements',
        headers: bearer(alice),
        payload: { termsVersion: '2026-09-24', contentHash: FIXTURE_TERMS_DOCUMENT.contentHash },
      });
      expect(ack.statusCode).toBe(201);
      const ackAgain = await app.inject({
        method: 'POST',
        url: '/v1/me/terms/acknowledgements',
        headers: bearer(alice),
        payload: {
          termsVersion: '2026-09-24',
          contentHash: FIXTURE_TERMS_DOCUMENT.contentHash,
          channel: 'cli',
        },
      });
      expect(ackAgain.json()).toEqual(ack.json());
      const ready = (
        await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(alice) })
      ).json() as EligibilityStatusResponse;
      expect(ready).toMatchObject({
        outcome: 'eligible',
        policyVersion: '2026-09-24',
        steps: ['verify_wallet'],
      });
      expect(ready.terms.complete).toBe(true);

      // Capability states: discoverable and researchable, but not quoteable or buyable until a venue exists and execution is enabled.
      const availability = await app.inject({
        method: 'GET',
        url: `/v1/me/instruments/${instrumentId}/availability`,
        headers: bearer(alice),
      });
      expect(availability.statusCode).toBe(200);
      expect(availability.json()).toMatchObject({
        capabilities: {
          discoverable: true,
          researchable: true,
          quoteable: false,
          buyable: false,
          sellable: false,
          redeemable: false,
          transferable: true,
        },
        conditions: ['venue_disabled', 'execution_disabled'],
        policyVersion: '2026-09-24',
      });
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/me/instruments/00000000-0000-4000-8000-000000000000/availability',
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(404);

      // Quote-stage evaluation passes and holds the notional; the same intent replays idempotently.
      const allowed = await app.inject({
        method: 'POST',
        url: '/v1/me/policy/evaluations',
        headers: bearer(alice),
        payload: evaluation({ instrumentId, reserve: true }),
      });
      expect(allowed.statusCode).toBe(201);
      const decision = allowed.json() as PolicyDecision;
      expect(decision).toMatchObject({
        outcome: 'allow',
        stage: 'quote',
        denials: [],
        budget: {
          dailyUsedUsdcRaw: USDC(100),
          dailyRemainingUsdcRaw: USDC(4900),
          accountUsedUsdcRaw: USDC(100),
          accountRemainingUsdcRaw: USDC(24900),
        },
        evidence: {
          policyVersion: '2026-09-24',
          termsVersions: ['2026-09-24'],
          ceilingSource: 'policy_defaults',
          exposureSource: 'caller_declared',
        },
      });
      expect(decision.reservation).toMatchObject({
        intentId: 'intent-1',
        status: 'held',
        notionalUsdcRaw: USDC(100),
      });
      expect(decision.evidence.eligibilityDecisionId).toBe(eligible.json().decisionId);
      const replay = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId, reserve: true }),
        })
      ).json() as PolicyDecision;
      expect(replay.reservation?.reservationId).toBe(decision.reservation?.reservationId);
      expect(replay.budget.dailyUsedUsdcRaw).toBe(USDC(100));

      // Submission re-evaluates and is blocked while execution and the venue are disabled.
      const submit = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId, stage: 'submit', intentId: 'intent-1' }),
        })
      ).json() as PolicyDecision;
      expect(submit.denials.map((d) => d.code)).toEqual(['EXECUTION_DISABLED', 'VENUE_DISABLED']);

      // Caps are reported with their limit and observed value.
      const tooLarge = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({
            instrumentId,
            intentId: 'intent-2',
            notionalUsdcRaw: USDC(1500),
            exposure: {
              source: 'caller_declared',
              observedAt: null,
              positions: [],
              cashUsdcRaw: USDC(100000),
            },
          }),
        })
      ).json() as PolicyDecision;
      expect(tooLarge.denials).toEqual([
        {
          code: 'ORDER_CAP_EXCEEDED',
          message: 'the order exceeds the per-order cap',
          limit: USDC(1000),
          observed: USDC(1500),
          unit: 'USDC raw',
        },
      ]);

      // Owners can only tighten; loosening is refused with the ceiling, and changes need a fresh sign-in.
      const limits = await app.inject({
        method: 'GET',
        url: '/v1/me/limits',
        headers: bearer(alice),
      });
      expect(limits.json()).toMatchObject({
        owner: null,
        ceilingSource: 'policy_defaults',
        effective: { maxOrderNotionalUsdcRaw: USDC(1000) },
      });
      const loosen = await app.inject({
        method: 'PUT',
        url: '/v1/me/limits',
        headers: bearer(alice),
        payload: { maxOrderNotionalUsdcRaw: USDC(2000), maxSlippageBps: 500 },
      });
      expect(loosen.statusCode).toBe(400);
      expect(loosen.json().error.details).toEqual([
        {
          path: 'body/maxOrderNotionalUsdcRaw',
          message: `cannot exceed the ceiling ${USDC(1000)}`,
        },
        { path: 'body/maxSlippageBps', message: 'cannot exceed the ceiling 100 bps' },
      ]);
      const stale = await user('did:test:alice', new Date(Date.now() - 3600_000));
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/v1/me/limits',
            headers: bearer(stale),
            payload: { maxOrderNotionalUsdcRaw: USDC(50) },
          })
        ).json().error.code,
      ).toBe('STEP_UP_REQUIRED');
      const tightened = await app.inject({
        method: 'PUT',
        url: '/v1/me/limits',
        headers: bearer(alice),
        payload: { maxOrderNotionalUsdcRaw: USDC(50) },
      });
      expect(tightened.statusCode).toBe(200);
      expect(tightened.json()).toMatchObject({
        owner: { maxOrderNotionalUsdcRaw: USDC(50) },
        effective: { maxOrderNotionalUsdcRaw: USDC(50), maxDailyNotionalUsdcRaw: USDC(5000) },
      });
      const ownerCapped = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId, intentId: 'intent-3' }),
        })
      ).json() as PolicyDecision;
      expect(ownerCapped.denials.map((d) => d.code)).toEqual(['ORDER_CAP_EXCEEDED']);
      expect(ownerCapped.evidence.limitsUpdatedAt).not.toBeNull();

      // Reservations are listed and released by intent id.
      const held = await app.inject({
        method: 'GET',
        url: '/v1/me/reservations',
        headers: bearer(alice),
      });
      expect(
        held
          .json()
          .reservations.map((r: { intentId: string; status: string }) => [r.intentId, r.status]),
      ).toEqual([['intent-1', 'held']]);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/v1/me/reservations/intent-1',
            headers: bearer(alice),
          })
        ).json().status,
      ).toBe('released');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/v1/me/reservations/intent-1',
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({ instrumentId, reserve: true, notionalUsdcRaw: USDC(10) }),
          })
        ).json().error.code,
      ).toBe('IDEMPOTENCY_CONFLICT');

      // Operators revoke; the person must declare again; a new policy version supersedes older decisions.
      const revoked = await app.inject({
        method: 'POST',
        url: `/v1/ops/policy/eligibility/${eligible.json().decisionId}/revoke`,
        headers: bearer(ops),
        payload: { reason: 'counsel update' },
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json().revokedReason).toBe('counsel update');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/ops/policy/eligibility/${eligible.json().decisionId}/revoke`,
            headers: bearer(ops),
            payload: { reason: 'again' },
          })
        ).statusCode,
      ).toBe(409);
      const afterRevoke = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId, intentId: 'intent-4', notionalUsdcRaw: USDC(10) }),
        })
      ).json() as PolicyDecision;
      expect(afterRevoke.denials).toEqual([
        {
          code: 'ELIGIBILITY_EXPIRED',
          message: 'the eligibility decision was revoked',
          limit: null,
          observed: null,
          unit: null,
        },
      ]);
      expect(
        (
          await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(alice) })
        ).json().steps,
      ).toEqual(['declare_jurisdiction', 'verify_wallet']);
      await app.inject({
        method: 'POST',
        url: '/v1/me/eligibility/declarations',
        headers: bearer(alice),
        payload: { jurisdiction: 'ZZ', attestation: true },
      });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/ops/policy/jurisdiction-rules',
            headers: bearer(ops),
            payload: { ...FIXTURE_JURISDICTION_RULE_SET, policyVersion: '2026-09-25' },
          })
        ).statusCode,
      ).toBe(201);
      const superseded = (
        await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({ instrumentId, intentId: 'intent-5', notionalUsdcRaw: USDC(10) }),
        })
      ).json() as PolicyDecision;
      expect(superseded.denials.map((d) => d.code)).toEqual(['ELIGIBILITY_SUPERSEDED']);
      const me = (
        await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as { user: { id: string } };
      const history = await app.inject({
        method: 'GET',
        url: `/v1/ops/policy/users/${me.user.id}/eligibility`,
        headers: bearer(ops),
      });
      expect(
        history
          .json()
          .decisions.map(
            (d: { jurisdiction: string; outcome: string }) => `${d.jurisdiction}:${d.outcome}`,
          ),
      ).toEqual(['ZZ:eligible', 'ZZ:eligible', 'XX:ineligible', 'ZZ:unknown']);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/ops/policy/jurisdiction-rules',
            headers: bearer(ops),
          })
        )
          .json()
          .ruleSets.map((r: { policyVersion: string; active: boolean }) => [
            r.policyVersion,
            r.active,
          ]),
      ).toEqual([
        ['2026-09-25', true],
        ['2026-09-24', false],
      ]);
    });
  });

  it('never lets concurrent intents overspend a shared daily budget', async () => {
    await withHarness({}, async ({ app, operator, user, admitAero }) => {
      const ops = await operator(OPERATOR_SCOPES);
      const alice = await user();
      const { instrumentId } = await admitAero(ops);
      await app.inject({
        method: 'POST',
        url: '/v1/ops/policy/jurisdiction-rules',
        headers: bearer(ops),
        payload: FIXTURE_JURISDICTION_RULE_SET,
      });
      await app.inject({
        method: 'POST',
        url: '/v1/me/eligibility/declarations',
        headers: bearer(alice),
        payload: { jurisdiction: 'ZZ', attestation: true },
      });
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/v1/me/limits',
            headers: bearer(alice),
            payload: { maxDailyNotionalUsdcRaw: USDC(1000) },
          })
        ).statusCode,
      ).toBe(200);

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({
              instrumentId,
              intentId: `race-${index}`,
              notionalUsdcRaw: USDC(300),
              reserve: true,
            }),
          }),
        ),
      );
      const decisions = responses.map((response) => response.json() as PolicyDecision);
      expect(decisions.filter((d) => d.outcome === 'allow')).toHaveLength(3);
      const deniedCodes = decisions
        .filter((d) => d.outcome === 'deny')
        .map((d) => d.denials.map((x) => x.code));
      expect(deniedCodes).toEqual(Array(5).fill(['DAILY_CAP_EXCEEDED']));
      const held = (
        await app.inject({ method: 'GET', url: '/v1/me/reservations', headers: bearer(alice) })
      ).json().reservations as { status: string; notionalUsdcRaw: string }[];
      const heldTotal = held
        .filter((r) => r.status === 'held')
        .reduce((sum, r) => sum + BigInt(r.notionalUsdcRaw), 0n);
      expect(heldTotal).toBe(BigInt(USDC(900)));
      for (const decision of decisions.filter((d) => d.outcome === 'allow')) {
        expect(BigInt(decision.budget.dailyUsedUsdcRaw)).toBeLessThanOrEqual(BigInt(USDC(1000)));
      }
    });
  });

  it('measures company concentration across issuers, expires decisions and enforces the beta allowlist and agent scopes', async () => {
    await withHarness(
      {
        BETA_MAX_ORDER_NOTIONAL_USDC_RAW: USDC(500),
        BETA_MAX_DAILY_NOTIONAL_USDC_RAW: USDC(9000),
        BETA_MAX_ACCOUNT_NOTIONAL_USDC_RAW: USDC(2000),
        BETA_PARTICIPANT_ALLOWLIST_ENABLED: 'true',
      },
      async ({ app, db, clock, operator, user, agent, admitAero }) => {
        const ops = await operator(OPERATOR_SCOPES);
        const alice = await user();
        const { instrumentId, companyName } = await admitAero(ops);
        const me = (
          await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
        ).json() as { user: { id: string } };
        await app.inject({
          method: 'POST',
          url: '/v1/ops/policy/jurisdiction-rules',
          headers: bearer(ops),
          payload: { ...FIXTURE_JURISDICTION_RULE_SET, validityDays: 1 },
        });
        await app.inject({
          method: 'POST',
          url: '/v1/me/eligibility/declarations',
          headers: bearer(alice),
          payload: { jurisdiction: 'ZZ', attestation: true },
        });

        // Beta caps tighten the ceiling; the allowlist blocks everyone until an operator adds them.
        expect(
          (
            await app.inject({ method: 'GET', url: '/v1/me/limits', headers: bearer(alice) })
          ).json(),
        ).toMatchObject({
          ceilingSource: 'beta_caps',
          effective: {
            maxOrderNotionalUsdcRaw: USDC(500),
            maxDailyNotionalUsdcRaw: USDC(5000),
            maxAccountNotionalUsdcRaw: USDC(2000),
          },
        });
        const notListed = (
          await app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({ instrumentId }),
          })
        ).json() as PolicyDecision;
        expect(notListed.denials.map((d) => d.code)).toEqual(['PARTICIPANT_NOT_ALLOWLISTED']);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/ops/policy/participants',
              headers: bearer(ops),
              payload: { userId: me.user.id, note: 'pilot' },
            })
          ).statusCode,
        ).toBe(201);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/v1/ops/policy/participants',
              headers: bearer(ops),
            })
          ).json().participants,
        ).toHaveLength(1);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/me/policy/evaluations',
              headers: bearer(alice),
              payload: evaluation({ instrumentId }),
            })
          ).json().outcome,
        ).toBe('allow');

        // A second issuer's token for the same company shares the company bucket but not the issuer bucket.
        const snapshot = await recordIssuerSnapshot(db, {
          issuer: 'xstocks',
          source: 'fixture',
          sourceRef: 'test',
          fetchedAt: clock.now(),
          contentHash: 'b'.repeat(64),
          schemaVersion: '1',
          itemCount: 1,
          status: 'accepted',
          rejectionReason: null,
          createdBy: 'test',
        });
        await applyIngestion(db, {
          issuer: 'xstocks',
          genesisHash: GENESIS,
          snapshotId: snapshot.id,
          now: clock.now(),
          writes: [
            {
              kind: 'insert',
              product: {
                productId: 'xs-aero',
                symbol: 'XAERO',
                name: 'Aero x',
                companyName: companyName.toUpperCase(),
                kind: 'listed_stock',
                mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                decimals: 8,
                tokenProgram: 'token-2022',
                website: null,
                description: null,
                referencePrice: null,
                underlying: null,
              },
              fingerprint: 'x1',
              status: 'quarantined',
              reasons: [],
            },
          ],
        });
        const list = await app.inject({
          method: 'GET',
          url: '/v1/ops/catalog/instruments?q=XAERO&status=quarantined',
          headers: bearer(ops),
        });
        const otherIssuerId = list.json().instruments[0].instrumentId as string;
        const concentrated = (
          await app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({
              instrumentId,
              intentId: 'conc-1',
              notionalUsdcRaw: USDC(200),
              exposure: {
                source: 'caller_declared',
                observedAt: clock.now().toISOString(),
                positions: [{ instrumentId: otherIssuerId, notionalUsdcRaw: USDC(250) }],
                cashUsdcRaw: USDC(550),
              },
            }),
          })
        ).json() as PolicyDecision;
        // company: 250 + 200 of 1000 = 4500 bps > 3000; issuer prestocks: 200 of 1000 = 2000 bps < 5000.
        expect(concentrated.denials).toEqual([
          {
            code: 'COMPANY_CONCENTRATION_EXCEEDED',
            message:
              'exposure to the underlying company across issuers would exceed the concentration limit',
            limit: '3000',
            observed: '4500',
            unit: 'bps',
          },
        ]);
        const unknownPosition = await app.inject({
          method: 'POST',
          url: '/v1/me/policy/evaluations',
          headers: bearer(alice),
          payload: evaluation({
            instrumentId,
            exposure: {
              source: 'caller_declared',
              observedAt: null,
              positions: [
                { instrumentId: '00000000-0000-4000-8000-000000000000', notionalUsdcRaw: '1' },
              ],
              cashUsdcRaw: null,
            },
          }),
        });
        expect(unknownPosition.statusCode).toBe(400);

        // Agents evaluate only with the proposals scope; a read-only agent is refused.
        const proposer = await agent(me.user.id, ['proposals:create', 'portfolio:read']);
        const reader = await agent(me.user.id, ['research:read']);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/me/policy/evaluations',
              headers: bearer(proposer),
              payload: evaluation({ instrumentId, intentId: 'agent-1' }),
            })
          ).statusCode,
        ).toBe(201);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/me/policy/evaluations',
              headers: bearer(reader),
              payload: evaluation({ instrumentId, intentId: 'agent-2' }),
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(reader) }))
            .statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/me/eligibility/declarations',
              headers: bearer(proposer),
              payload: { jurisdiction: 'ZZ', attestation: true },
            })
          ).statusCode,
        ).toBe(403);

        // Expiry: two days later the one-day decision no longer stands.
        clock.offsetMs = 2 * 86_400_000;
        const expired = (
          await app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({ instrumentId, intentId: 'late-1' }),
          })
        ).json() as PolicyDecision;
        expect(expired.denials.map((d) => d.code)).toEqual(['ELIGIBILITY_EXPIRED']);
        expect(
          (
            await app.inject({ method: 'GET', url: '/v1/me/eligibility', headers: bearer(alice) })
          ).json(),
        ).toMatchObject({ outcome: 'unknown', steps: ['declare_jurisdiction', 'verify_wallet'] });

        // Removing the participant blocks again; unknown users answer 404.
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/v1/ops/policy/participants/${me.user.id}`,
              headers: bearer(ops),
            })
          ).statusCode,
        ).toBe(204);
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/v1/ops/policy/participants/${me.user.id}`,
              headers: bearer(ops),
            })
          ).statusCode,
        ).toBe(404);
        await app.inject({
          method: 'POST',
          url: '/v1/me/eligibility/declarations',
          headers: bearer(alice),
          payload: { jurisdiction: 'ZZ', attestation: true },
        });
        const afterRemoval = (
          await app.inject({
            method: 'POST',
            url: '/v1/me/policy/evaluations',
            headers: bearer(alice),
            payload: evaluation({ instrumentId, intentId: 'late-2' }),
          })
        ).json() as PolicyDecision;
        expect(afterRemoval.denials.map((d) => d.code)).toEqual(['PARTICIPANT_NOT_ALLOWLISTED']);
      },
    );
  });
});
