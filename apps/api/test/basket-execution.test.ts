import type {
  ErrorResponse,
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  PreparedTransaction,
  SpendReservation,
  StrategyDraftContent,
} from '@markov/contracts';
import type { VenueAdapter } from '@markov/planning';
import {
  base64ToBytes,
  bytesToBase64,
  type signerFromPrivateKey,
  signTransaction,
} from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, STABLECOIN, withHarness } from './support/harness.js';

/**
 * Basket execution (B11) against the fixture chain: a two-constituent plan
 * that composes into one atomic transaction sharing the owner's stablecoin
 * account; a staged plan whose legs land one by one with the intent
 * returning to the owner between them; the run stopping as partially
 * completed when a later leg's fresh terms no longer meet the approved
 * bounds, when the owner cancels between legs, or when a later leg fails on
 * chain; and a reviewed completion that buys exactly the unfilled legs at
 * their original targets without reallocating anything.
 */

function pair(ids: Record<string, string>): StrategyDraftContent {
  return {
    title: 'Two names',
    thesis: 'Two fixture names from two issuers.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 4500, note: null },
      { instrumentId: ids['xsa'] as string, weightBps: 4500, note: null },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}

const createIntent = (h: Harness, token: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/v1/me/intents', headers: bearer(token), payload });

async function approvedBasket(
  h: Harness,
  token: string,
  input: {
    versionId: string;
    walletId: string;
    budget: string;
    key: string;
    continuationOfIntentId?: string;
  },
): Promise<{ intent: Intent; plan: ExecutionPlan }> {
  const created = await createIntent(h, token, {
    kind: 'basket_investment',
    strategyVersionId: input.versionId,
    walletId: input.walletId,
    budget: { rawAmount: input.budget },
    idempotencyKey: input.key,
    ...(input.continuationOfIntentId
      ? { continuationOfIntentId: input.continuationOfIntentId }
      : {}),
  });
  expect(created.statusCode, created.body).toBe(201);
  const intent = created.json() as Intent;
  const planned = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intent.intentId}/plans`,
    headers: bearer(token),
  });
  expect(planned.statusCode, planned.body).toBe(201);
  const plan = planned.json() as ExecutionPlan;
  const acknowledged = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intent.intentId}/plans/${plan.planId}/acknowledgements`,
    headers: bearer(token),
    payload: { planHash: plan.planHash, stagedAcknowledged: plan.grouping.acknowledgementRequired },
  });
  expect(acknowledged.statusCode, acknowledged.body).toBe(200);
  return { intent, plan };
}

const build = (h: Harness, token: string, intentId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions`,
    headers: bearer(token),
  });
const submit = (h: Harness, token: string, intentId: string, signed: string, index: number) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions/${index}/submissions`,
    headers: bearer(token),
    payload: { signedTransaction: signed },
  });
const status = async (h: Harness, token: string, intentId: string): Promise<ExecutionStatus> => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/intents/${intentId}/execution`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ExecutionStatus;
};
const reconcile = async (h: Harness, token: string, intentId: string): Promise<ExecutionStatus> => {
  const response = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/execution/reconciliations`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ExecutionStatus;
};
const readIntent = async (h: Harness, token: string, intentId: string): Promise<Intent> =>
  (
    await h.app.inject({ method: 'GET', url: `/v1/me/intents/${intentId}`, headers: bearer(token) })
  ).json() as Intent;
const cancel = (h: Harness, token: string, intentId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/cancel`,
    headers: bearer(token),
  });
const reservations = async (h: Harness, token: string): Promise<SpendReservation[]> =>
  (
    (
      await h.app.inject({ method: 'GET', url: '/v1/me/reservations', headers: bearer(token) })
    ).json() as { reservations: SpendReservation[] }
  ).reservations;

function sign(unsigned: string, signer: ReturnType<typeof signerFromPrivateKey>): string {
  return bytesToBase64(signTransaction(base64ToBytes(unsigned), signer).bytes);
}

const refusalCodes = (body: ErrorResponse): string[] =>
  (body.error.details ?? []).map((detail) => detail.message.split(':')[0] as string);

/** Runs one prepared transaction of the intent to finality: sign, submit, finalize, reconcile. */
async function landBatch(
  h: Harness,
  token: string,
  intentId: string,
  signer: ReturnType<typeof signerFromPrivateKey>,
): Promise<{ prepared: PreparedTransaction; settled: ExecutionStatus }> {
  const built = await build(h, token, intentId);
  expect(built.statusCode, built.body).toBe(201);
  const prepared = built.json() as PreparedTransaction;
  const submitted = await submit(
    h,
    token,
    intentId,
    sign(prepared.unsignedTransaction, signer),
    prepared.transactionIndex,
  );
  expect(submitted.statusCode, submitted.body).toBe(201);
  expect((submitted.json() as ExecutionStatus).state).toBe('SUBMITTED');
  h.chain.finalize();
  return { prepared, settled: await reconcile(h, token, intentId) };
}

describe.skipIf(adminUrl === null)('basket execution API', () => {
  it('executes a two-constituent basket atomically: one composed transaction, one signature, fills per leg', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const version = await h.freezeVersion(alice, pair(ids));

      const { intent, plan } = await approvedBasket(h, alice, {
        versionId: version.versionId,
        walletId: wallet.walletId,
        budget: '1000000000',
        key: 'basket-atomic',
      });
      // The whole basket composed, measured and simulated at plan time: atomic, no staged acknowledgement.
      expect(plan.legs).toHaveLength(2);
      expect(plan.grouping.mode).toBe('atomic');
      expect(plan.grouping.reason).toBe('composition_fits');
      expect(plan.grouping.composition).toMatchObject({ maxBytes: 1232, legs: 2 });
      expect(plan.grouping.composition?.sizeBytes).toBeGreaterThan(0);
      expect(plan.grouping.composition?.sizeBytes).toBeLessThanOrEqual(1232);
      expect(plan.grouping.batches).toHaveLength(1);
      expect(plan.grouping.batches[0]?.legIndexes).toEqual([0, 1]);
      expect(plan.grouping.acknowledgementRequired).toBe(false);
      expect(plan.validity.simulation?.status).toBe('ok');
      expect(plan.fees.network.batches).toBe(1);
      expect(intent.continuation).toBeNull();
      const before = await status(h, alice, intent.intentId);
      expect(before.batches).toEqual([
        {
          batch: 0,
          legIndexes: [0, 1],
          state: 'pending',
          transactionId: null,
          attemptId: null,
          signature: null,
          reason: null,
        },
      ]);

      // One transaction for both legs: budget, both account creations first, swaps in leg order,
      // both swaps debiting the owner's one stablecoin account.
      const built = await build(h, alice, intent.intentId);
      expect(built.statusCode, built.body).toBe(201);
      const prepared = built.json() as PreparedTransaction;
      expect(prepared).toMatchObject({ transactionIndex: 0, batch: 0, legIndexes: [0, 1] });
      expect(prepared.instructions.map((entry) => entry.kind)).toEqual([
        'compute_unit_limit',
        'compute_unit_price',
        'ata_create',
        'ata_create',
        'route_swap',
        'route_swap',
      ]);
      expect(prepared.effects.legs.map((leg) => leg.legIndex)).toEqual([0, 1]);
      expect(prepared.effects.legs.map((leg) => leg.sourceTokenAccount)).toEqual([
        prepared.effects.legs[0]?.sourceTokenAccount,
        prepared.effects.legs[0]?.sourceTokenAccount,
      ]);
      expect(BigInt(prepared.effects.maxInputRaw)).toBe(
        plan.legs.reduce((sum, leg) => sum + BigInt(leg.maxInputRaw), 0n),
      );
      expect(prepared.effects.accountsCreated).toHaveLength(2);
      expect(prepared.simulation.status).toBe('ok');
      expect((await status(h, alice, intent.intentId)).batches[0]?.state).toBe('prepared');

      const signed = sign(prepared.unsignedTransaction, wallet.signer);
      const submitted = await submit(h, alice, intent.intentId, signed, 0);
      expect(submitted.statusCode, submitted.body).toBe(201);
      const afterSubmit = submitted.json() as ExecutionStatus;
      expect(afterSubmit.state).toBe('SUBMITTED');
      expect(afterSubmit.batches[0]).toMatchObject({
        state: 'submitted',
        transactionId: prepared.transactionId,
      });
      // One reservation per leg, keyed by intent, transaction and leg; both held until settled.
      const held = await reservations(h, alice);
      expect(held.map((row) => row.intentId).sort()).toEqual(
        [0, 1].map((index) => `${intent.intentId}:${prepared.transactionId}:${index}`),
      );
      expect(held.every((row) => row.status === 'held')).toBe(true);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
        5_000_000_000n - BigInt(prepared.effects.maxInputRaw),
      );

      h.chain.finalize();
      const settled = await reconcile(h, alice, intent.intentId);
      expect(settled.state).toBe('FINALIZED');
      expect(settled.nextAction).toBe('none');
      expect(settled.fills.map((fill) => fill.legIndex)).toEqual([0, 1]);
      for (const fill of settled.fills) {
        const leg = plan.legs.find((entry) => entry.legIndex === fill.legIndex);
        expect(fill.inputSpentRaw).toBe(leg?.maxInputRaw);
        expect(fill.outputReceivedRaw).toBe(leg?.expectedOutputRaw);
        expect(fill.withinBounds).toBe(true);
        expect(h.chain.tokenBalance(owner, fill.outputMint)).toBe(BigInt(fill.outputReceivedRaw));
      }
      // The network fee is attributed once, to the first leg's fill.
      expect(settled.fills.map((fill) => fill.feeLamports !== '0')).toEqual([true, false]);
      expect(settled.batches[0]).toMatchObject({
        state: 'finalized',
        attemptId: settled.attempts[0]?.attemptId,
      });
      expect((await reservations(h, alice)).map((row) => row.status)).toEqual([
        'consumed',
        'consumed',
      ]);
      const done = await build(h, alice, intent.intentId);
      expect(done.statusCode).toBe(409);
      expect(refusalCodes(done.json() as ErrorResponse)).toContain('PLAN_NOT_APPROVED');
    });
  }, 120_000);

  it('runs a staged basket leg by leg, stops as partially completed when a later leg goes stale, and completes it under review', async () => {
    let quoteShift = 0;
    await withHarness(
      {
        venue: 'fixture',
        writes: true,
        composeMaxLegs: () => 1,
        quoteShiftBps: () => quoteShift,
      },
      async (h) => {
        const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
        const alice = await h.user();
        await h.makeEligible(alice);
        const wallet = await h.linkWallet(alice);
        const owner = wallet.signer.publicKey;
        h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
        const version = await h.freezeVersion(alice, pair(ids));

        const { intent, plan } = await approvedBasket(h, alice, {
          versionId: version.versionId,
          walletId: wallet.walletId,
          budget: '1000000000',
          key: 'basket-staged',
        });
        expect(plan.grouping.mode).toBe('staged');
        expect(plan.grouping.reason).toBe('composition_unavailable');
        expect(plan.grouping.batches.map((batch) => batch.legIndexes)).toEqual([[0], [1]]);
        expect(plan.validity.simulation).toBeNull();
        const [leg0, leg1] = plan.legs as [ExecutionPlan['legs'][0], ExecutionPlan['legs'][0]];
        expect((await status(h, alice, intent.intentId)).batches.map((b) => b.state)).toEqual([
          'pending',
          'pending',
        ]);

        // Transaction 1 of 2 carries the first leg only; transaction 2 cannot be submitted before it exists.
        const built = await build(h, alice, intent.intentId);
        expect(built.statusCode, built.body).toBe(201);
        const first = built.json() as PreparedTransaction;
        expect(first).toMatchObject({ transactionIndex: 0, batch: 0, legIndexes: [0] });
        expect(first.effects.legs.map((leg) => leg.legIndex)).toEqual([0]);
        const early = await submit(h, alice, intent.intentId, 'AAAA', 1);
        expect(early.statusCode).toBe(404);
        const signed = sign(first.unsignedTransaction, wallet.signer);
        const submitted = await submit(h, alice, intent.intentId, signed, 0);
        expect(submitted.statusCode, submitted.body).toBe(201);
        expect((submitted.json() as ExecutionStatus).batches.map((b) => b.state)).toEqual([
          'submitted',
          'pending',
        ]);
        const inFlight = await build(h, alice, intent.intentId);
        expect(inFlight.statusCode).toBe(409);
        expect(refusalCodes(inFlight.json() as ErrorResponse)).toContain('ATTEMPT_IN_FLIGHT');

        // Finality of the first leg returns the intent to the owner for the next signature.
        h.chain.finalize();
        const afterFirst = await reconcile(h, alice, intent.intentId);
        expect(afterFirst.state).toBe('AUTHORIZED');
        expect(afterFirst.stateReason).toMatch(
          /transaction 1 of 2 finalized; transaction 2 awaits/,
        );
        expect(afterFirst.nextAction).toBe('build');
        expect(afterFirst.fills.map((fill) => fill.legIndex)).toEqual([0]);
        expect(afterFirst.batches.map((b) => b.state)).toEqual(['finalized', 'pending']);
        expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
          5_000_000_000n - BigInt(leg0.maxInputRaw),
        );
        expect(h.chain.tokenBalance(owner, leg0.outputMint)).toBe(BigInt(leg0.expectedOutputRaw));
        expect((await reservations(h, alice)).map((row) => row.status)).toEqual(['consumed']);

        // The second leg's fresh quote is 2% worse than approved: nothing is built, no budget moves
        // between constituents, and the basket is partially completed until a reviewed completion.
        quoteShift = -200;
        const stale = await build(h, alice, intent.intentId);
        expect(stale.statusCode, stale.body).toBe(409);
        const staleBody = stale.json() as ErrorResponse;
        expect(staleBody.error.code).toBe('TRANSACTION_REFUSED');
        expect(refusalCodes(staleBody)).toContain('LEG_TERMS_CHANGED');
        expect(staleBody.error.details?.map((detail) => detail.path)).toContain('legs[1]');
        expect(staleBody.error.message).toMatch(/OUTPUT_BELOW_APPROVED/);
        const partial = await status(h, alice, intent.intentId);
        expect(partial.state).toBe('PARTIALLY_COMPLETED');
        expect(partial.nextAction).toBe('review');
        expect(partial.transactions).toHaveLength(1);
        expect(partial.fills).toHaveLength(1);
        expect(partial.batches.map((b) => [b.state, b.transactionId !== null])).toEqual([
          ['finalized', true],
          ['stale', false],
        ]);
        expect(partial.batches[1]?.reason).toMatch(/cannot meet the approved bounds/);
        expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
          5_000_000_000n - BigInt(leg0.maxInputRaw),
        );
        expect(h.chain.tokenBalance(owner, leg1.outputMint)).toBe(0n);
        // Terminal for this intent: no build, no cancel, no second continuation later.
        const again = await build(h, alice, intent.intentId);
        expect(refusalCodes(again.json() as ErrorResponse)).toContain('PLAN_NOT_APPROVED');
        expect((await cancel(h, alice, intent.intentId)).statusCode).toBe(400);

        // A reviewed completion buys exactly the unfilled leg at its original target, from the same
        // wallet and version; anything else is refused with the reason.
        quoteShift = 0;
        const wrongBudget = await createIntent(h, alice, {
          kind: 'basket_investment',
          strategyVersionId: version.versionId,
          walletId: wallet.walletId,
          budget: { rawAmount: '1000000000' },
          idempotencyKey: 'basket-continue-wrong-budget',
          continuationOfIntentId: intent.intentId,
        });
        expect(wrongBudget.statusCode, wrongBudget.body).toBe(400);
        expect((wrongBudget.json() as ErrorResponse).error.details?.map((d) => d.path)).toEqual([
          'budget.rawAmount',
        ]);
        const other = await h.freezeVersion(alice, pair(ids));
        const wrongVersion = await createIntent(h, alice, {
          kind: 'basket_investment',
          strategyVersionId: other.versionId,
          walletId: wallet.walletId,
          budget: { rawAmount: leg1.targetInputRaw },
          idempotencyKey: 'basket-continue-wrong-version',
          continuationOfIntentId: intent.intentId,
        });
        expect(wrongVersion.statusCode, wrongVersion.body).toBe(400);
        expect((wrongVersion.json() as ErrorResponse).error.details?.map((d) => d.path)).toEqual([
          'strategyVersionId',
        ]);
        const notBasket = await createIntent(h, alice, {
          kind: 'single_buy',
          instrumentId: ids.aero,
          walletId: wallet.walletId,
          budget: { rawAmount: leg1.targetInputRaw },
          idempotencyKey: 'basket-continue-single',
          continuationOfIntentId: intent.intentId,
        });
        expect(notBasket.statusCode).toBe(400);

        const continued = await approvedBasket(h, alice, {
          versionId: version.versionId,
          walletId: wallet.walletId,
          budget: leg1.targetInputRaw,
          key: 'basket-continue',
          continuationOfIntentId: intent.intentId,
        });
        expect(continued.intent.continuation).toEqual({
          ofIntentId: intent.intentId,
          ofPlanId: plan.planId,
          legIndexes: [1],
        });
        expect((await readIntent(h, alice, intent.intentId)).continuedByIntentId).toBe(
          continued.intent.intentId,
        );
        const twice = await createIntent(h, alice, {
          kind: 'basket_investment',
          strategyVersionId: version.versionId,
          walletId: wallet.walletId,
          budget: { rawAmount: leg1.targetInputRaw },
          idempotencyKey: 'basket-continue-twice',
          continuationOfIntentId: intent.intentId,
        });
        expect(twice.statusCode).toBe(400);
        expect((twice.json() as ErrorResponse).error.message).toMatch(/already continued/);
        // The continuation plan: the one remaining leg at the original target, no cash, no reweighting.
        expect(continued.plan.legs.map((leg) => [leg.instrumentId, leg.targetInputRaw])).toEqual([
          [leg1.instrumentId, leg1.targetInputRaw],
        ]);
        expect(continued.plan.allocation.legs.map((leg) => leg.targetRaw)).toEqual([
          leg1.targetInputRaw,
        ]);
        expect(continued.plan.allocation.cash.targetRaw).toBe('0');
        expect(continued.plan.input.totalSpendRaw).toBe(leg1.targetInputRaw);
        expect(continued.plan.grouping).toMatchObject({ mode: 'atomic', reason: 'single_leg' });
        expect(continued.plan.strategy?.versionId).toBe(version.versionId);

        const { settled } = await landBatch(h, alice, continued.intent.intentId, wallet.signer);
        expect(settled.state).toBe('FINALIZED');
        expect(settled.fills).toHaveLength(1);
        expect(settled.fills[0]?.outputMint).toBe(leg1.outputMint);
        expect(h.chain.tokenBalance(owner, leg1.outputMint)).toBe(BigInt(leg1.expectedOutputRaw));
        expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
          5_000_000_000n - BigInt(leg0.maxInputRaw) - BigInt(leg1.maxInputRaw),
        );
        // The original stays partially completed as the record of what happened.
        expect((await readIntent(h, alice, intent.intentId)).state).toBe('PARTIALLY_COMPLETED');
      },
    );
  }, 120_000);

  it('leaves a staged basket partially completed when the owner cancels between legs or a later leg fails on chain', async () => {
    await withHarness({ venue: 'fixture', writes: true, composeMaxLegs: () => 1 }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const version = await h.freezeVersion(alice, pair(ids));

      // Cancel between legs: the prepared second transaction is withdrawn, what landed stays.
      const cancelled = await approvedBasket(h, alice, {
        versionId: version.versionId,
        walletId: wallet.walletId,
        budget: '1000000000',
        key: 'basket-cancel',
      });
      const untouched = await cancel(h, alice, cancelled.intent.intentId);
      expect(untouched.statusCode, untouched.body).toBe(200);
      expect((untouched.json() as Intent).state).toBe('CANCELLED');
      const run = await approvedBasket(h, alice, {
        versionId: version.versionId,
        walletId: wallet.walletId,
        budget: '1000000000',
        key: 'basket-cancel-2',
      });
      const { settled: afterFirst } = await landBatch(h, alice, run.intent.intentId, wallet.signer);
      expect(afterFirst.state).toBe('AUTHORIZED');
      const secondBuilt = await build(h, alice, run.intent.intentId);
      expect(secondBuilt.statusCode, secondBuilt.body).toBe(201);
      const second = secondBuilt.json() as PreparedTransaction;
      expect(second).toMatchObject({ transactionIndex: 1, batch: 1, legIndexes: [1] });
      const balanceBefore = h.chain.tokenBalance(owner, STABLECOIN);
      const cancelledRun = await cancel(h, alice, run.intent.intentId);
      expect(cancelledRun.statusCode, cancelledRun.body).toBe(200);
      expect((cancelledRun.json() as Intent).state).toBe('PARTIALLY_COMPLETED');
      expect((cancelledRun.json() as Intent).stateReason).toMatch(/after 1 leg filled/);
      const cancelledStatus = await status(h, alice, run.intent.intentId);
      expect(cancelledStatus.batches.map((b) => b.state)).toEqual(['finalized', 'cancelled']);
      expect(cancelledStatus.fills).toHaveLength(1);
      expect(cancelledStatus.nextAction).toBe('review');
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(balanceBefore);
      const lateSubmit = await submit(
        h,
        alice,
        run.intent.intentId,
        sign(second.unsignedTransaction, wallet.signer),
        1,
      );
      expect(lateSubmit.statusCode).toBe(409);
      expect(refusalCodes(lateSubmit.json() as ErrorResponse)).toContain('PLAN_CHANGED');

      // A later leg landing with an error: the intent is partially completed, not failed; the
      // first leg's fill stands and the second leg's reservation is released.
      const failing = await approvedBasket(h, alice, {
        versionId: version.versionId,
        walletId: wallet.walletId,
        budget: '1000000000',
        key: 'basket-fail',
      });
      const { settled: firstLanded } = await landBatch(
        h,
        alice,
        failing.intent.intentId,
        wallet.signer,
      );
      expect(firstLanded.state).toBe('AUTHORIZED');
      const failingBuilt = await build(h, alice, failing.intent.intentId);
      expect(failingBuilt.statusCode, failingBuilt.body).toBe(201);
      const failingSecond = failingBuilt.json() as PreparedTransaction;
      const spentBefore = h.chain.tokenBalance(owner, STABLECOIN);
      h.chain.landNextWithError = 6;
      const failingSubmit = await submit(
        h,
        alice,
        failing.intent.intentId,
        sign(failingSecond.unsignedTransaction, wallet.signer),
        1,
      );
      expect(failingSubmit.statusCode, failingSubmit.body).toBe(201);
      h.chain.finalize();
      const failed = await reconcile(h, alice, failing.intent.intentId);
      expect(failed.state).toBe('PARTIALLY_COMPLETED');
      expect(failed.stateReason).toMatch(/transaction 2 of 2 failed after earlier ones filled/);
      expect(failed.batches.map((b) => b.state)).toEqual(['finalized', 'failed']);
      expect(failed.fills).toHaveLength(1);
      expect(failed.nextAction).toBe('review');
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(spentBefore);
      const held = await reservations(h, alice);
      expect(
        held.find((row) =>
          row.intentId.startsWith(`${failing.intent.intentId}:${failingSecond.transactionId}`),
        )?.status,
      ).toBe('released');
    });
  }, 120_000);

  it('stays staged with the reason when the composed basket fails simulation at plan time', async () => {
    await withHarness(
      {
        venue: 'fixture',
        writes: true,
        wrapVenue: (venue: VenueAdapter): VenueAdapter => ({
          ...venue,
          compose:
            venue.compose === null
              ? null
              : async (request) =>
                  (venue.compose as NonNullable<VenueAdapter['compose']>)({
                    ...request,
                    // Every leg demands ten times its quoted output: the route program refuses it.
                    legs: request.legs.map((leg) => ({
                      ...leg,
                      quote: {
                        ...leg.quote,
                        otherAmountThresholdRaw: (
                          BigInt(leg.quote.otherAmountThresholdRaw) * 10n
                        ).toString(),
                      },
                    })),
                  }),
        }),
      },
      async (h) => {
        const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
        const alice = await h.user();
        await h.makeEligible(alice);
        const wallet = await h.linkWallet(alice);
        h.fund(wallet.signer.publicKey, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
        const version = await h.freezeVersion(alice, pair(ids));
        const { plan } = await approvedBasket(h, alice, {
          versionId: version.versionId,
          walletId: wallet.walletId,
          budget: '1000000000',
          key: 'basket-simulation-failed',
        });
        expect(plan.grouping.mode).toBe('staged');
        expect(plan.grouping.reason).toBe('composition_simulation_failed');
        expect(plan.grouping.composition?.legs).toBe(2);
        expect(plan.grouping.acknowledgementRequired).toBe(true);
        expect(plan.validity.simulation).toBeNull();
        expect(plan.warnings.join(' ')).toMatch(/failed simulation as one transaction/);
      },
    );
  }, 120_000);
});
