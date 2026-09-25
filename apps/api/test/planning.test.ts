import type {
  ErrorResponse,
  ExecutionPlan,
  Intent,
  IntentCreateRequest,
  StrategyDraftContent,
} from '@markov/contracts';
import { verifyPlanHash } from '@markov/planning';
import { describe, expect, it } from 'vitest';
import { GENESIS } from './support/fixture-rpc.js';
import { adminUrl, bearer, STABLECOIN, withHarness } from './support/harness.js';

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
    // The fixture venue is limited to one leg per transaction here, so the basket is staged with its reason.
    await withHarness({ venue: 'fixture', composeMaxLegs: () => 1 }, async (h) => {
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
        continuationOfIntentId: null,
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
      expect(plan.grouping.reason).toBe('composition_unavailable');
      expect(plan.grouping.composition).toBeNull();
      expect(plan.validity.simulation).toBeNull();
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
      // Frozen legs are ordered by instrument id, so the pair's order depends on the seeded ids.
      expect([...plan.legs.map((leg) => leg.symbol)].sort()).toEqual(['FXAERO', 'XSFXA']);
      expect([...plan.legs.map((leg) => leg.issuer)].sort()).toEqual(['prestocks', 'xstocks']);
      expect(plan.legs.find((leg) => leg.symbol === 'XSFXA')?.tokenProgram).toBe('token-2022');
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
