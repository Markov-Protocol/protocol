import { Rational } from '@markov/analytics';
import type {
  ErrorResponse,
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  PerformanceExport,
  PerformanceResponse,
  PreparedTransaction,
  PriceHistoryResponse,
  PriceObservation,
  RankingResponse,
  StrategyDraftContent,
  WalletHoldingsResponse,
} from '@markov/contracts';
import {
  base64ToBytes,
  bytesToBase64,
  type signerFromPrivateKey,
  signTransaction,
} from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, STABLECOIN, withHarness } from './support/harness.js';

/**
 * Performance analytics (B13) against the fixture chain: recorded price
 * observations value a wallet and a strategy instance; the funding of a
 * wallet is an external flow that never becomes a return; a price move is;
 * a version's model series is public only once registered; a stale end
 * price leaves every return null with its reason and keeps the version out
 * of any ranking; observations are idempotent and never quotes.
 */

type Signer = ReturnType<typeof signerFromPrivateKey>;
const DAY = 86_400_000;

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

async function approved(
  h: Harness,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ intent: Intent; plan: ExecutionPlan }> {
  const created = await h.app.inject({
    method: 'POST',
    url: '/v1/me/intents',
    headers: bearer(token),
    payload,
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

async function land(
  h: Harness,
  token: string,
  intentId: string,
  signer: Signer,
): Promise<ExecutionStatus> {
  const built = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions`,
    headers: bearer(token),
  });
  expect(built.statusCode, built.body).toBe(201);
  const prepared = built.json() as PreparedTransaction;
  const signed = bytesToBase64(
    signTransaction(base64ToBytes(prepared.unsignedTransaction), signer).bytes,
  );
  const submitted = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions/${prepared.transactionIndex}/submissions`,
    headers: bearer(token),
    payload: { signedTransaction: signed },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  h.chain.finalize();
  const reconciled = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/execution/reconciliations`,
    headers: bearer(token),
  });
  expect(reconciled.statusCode, reconciled.body).toBe(200);
  const settled = reconciled.json() as ExecutionStatus;
  expect(settled.state).toBe('FINALIZED');
  return settled;
}

const reconcileWallet = async (h: Harness, token: string, walletId: string) => {
  const response = await h.app.inject({
    method: 'POST',
    url: `/v1/me/wallets/${walletId}/reconciliations`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as WalletHoldingsResponse;
};
const acknowledgeAll = async (h: Harness, token: string, walletId: string) => {
  const reconciled = await reconcileWallet(h, token, walletId);
  for (const entryId of reconciled.unexplainedEntryIds) {
    const acknowledged = await h.app.inject({
      method: 'POST',
      url: `/v1/me/journal/${entryId}/acknowledgements`,
      headers: bearer(token),
      payload: { kind: 'deposit', note: 'funding' },
    });
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
  }
  return reconciled;
};
const project = async (h: Harness, token: string) => {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/me/journal/projections',
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
};
const record = async (
  h: Harness,
  operator: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: PriceObservation | ErrorResponse }> => {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/operator/prices/observations',
    headers: bearer(operator),
    payload: body,
  });
  return { status: response.statusCode, body: response.json() };
};
const observe = async (
  h: Harness,
  operator: string,
  instrumentId: string | null,
  kind: string,
  value: string,
  observedAt: Date,
) => {
  const { status, body } = await record(h, operator, {
    ...(instrumentId ? { instrumentId } : { asset: 'SOL' }),
    kind,
    value,
    unit: 'USD',
    observedAt: observedAt.toISOString(),
    source: 'api-test',
    evidence: { note: 'fixture' },
  });
  expect(status, JSON.stringify(body)).toBe(201);
  return body as PriceObservation;
};
const performance = async (
  h: Harness,
  token: string | null,
  path: string,
): Promise<{ status: number; body: PerformanceResponse | ErrorResponse }> => {
  const response = await h.app.inject({
    method: 'GET',
    url: path,
    ...(token ? { headers: bearer(token) } : {}),
  });
  return { status: response.statusCode, body: response.json() };
};
const ok = (result: { status: number; body: PerformanceResponse | ErrorResponse }) => {
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body as PerformanceResponse;
};
const value = (text: string | null) => Rational.fromDecimal(text as string);

describe.skipIf(adminUrl === null)('analytics API', () => {
  it('values a wallet and an instance from recorded observations, keeps deposits out of returns and refuses to report through stale prices', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const operator = await h.operator(['ops:catalog:read', 'ops:catalog:write']);
      const ids = await h.seed(operator);
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const t0 = h.clock.current;

      // Ingestion recorded the fixture feeds' reference prices; the operator adds fresh ones.
      const aeroHistory = await h.app.inject({
        method: 'GET',
        url: `/v1/catalog/instruments/${ids['aero']}/prices`,
      });
      expect(aeroHistory.statusCode).toBe(200);
      const ingested = (aeroHistory.json() as PriceHistoryResponse).observations;
      expect(ingested.length).toBeGreaterThanOrEqual(1);
      expect(ingested.every((entry) => entry.sourceKind === 'fixture')).toBe(true);
      expect(ingested[0]).toMatchObject({ kind: 'issuer_mark', value: '18.25', unit: 'USD' });

      const first = await observe(h, operator, ids['aero'] as string, 'issuer_mark', '18.25', t0);
      expect(first).toMatchObject({ sourceKind: 'operator', source: 'api-test', unit: 'USD' });
      const again = await observe(h, operator, ids['aero'] as string, 'issuer_mark', '18.25', t0);
      expect(again.observationId).toBe(first.observationId);
      await observe(h, operator, ids['xsa'] as string, 'secondary_market', '101.20', t0);
      await observe(h, operator, null, 'secondary_market', '150', t0);
      const future = await record(h, operator, {
        asset: 'SOL',
        kind: 'secondary_market',
        value: '150',
        unit: 'USD',
        observedAt: new Date(t0.getTime() + DAY).toISOString(),
        source: 'api-test',
      });
      expect(future.status).toBe(400);
      expect((future.body as ErrorResponse).error.code).toBe('VALIDATION_FAILED');
      const notOperator = await h.app.inject({
        method: 'POST',
        url: '/v1/operator/prices/observations',
        headers: bearer(alice),
        payload: {
          asset: 'SOL',
          kind: 'secondary_market',
          value: '1',
          observedAt: t0.toISOString(),
          source: 'x',
        },
      });
      expect(notOperator.statusCode).toBe(403);

      // The funding arrived before any record: reconciled as deposits, it opens the series.
      const funded = await acknowledgeAll(h, alice, wallet.walletId);
      const opening = ok(
        await performance(h, alice, `/v1/me/wallets/${wallet.walletId}/performance?period=all`),
      );
      expect(opening.series).toMatchObject({
        kind: 'actual',
        currency: 'USD',
        methodologyVersion: 'stocks-v1',
        subject: { type: 'wallet', id: wallet.walletId },
      });
      expect(opening.series.points.length).toBeGreaterThanOrEqual(1);
      expect(opening.series.start).toBe(funded.checkpoint?.observedAt);
      // 5,000 USDC at par plus 0.05 SOL at 150.
      expect(opening.metrics.endValue).toBe('5007.500000');
      expect(opening.metrics.netFlows).toBe('0.000000');
      expect(opening.metrics.timeWeightedReturn).toBe('0.00000000');
      expect(opening.series.latest.map((position) => position.symbol).sort()).toEqual([
        'SOL',
        'USDC',
      ]);
      expect(
        opening.series.latest.find((position) => position.asset === STABLECOIN)?.caveats,
      ).toEqual(['stablecoin_par']);

      // A day later a buy lands and FXAERO is marked 10% higher: that is a return.
      h.clock.advance(DAY);
      const t1 = h.clock.current;
      await observe(h, operator, ids['aero'] as string, 'issuer_mark', '20.075', t1);
      await observe(h, operator, ids['xsa'] as string, 'secondary_market', '101.20', t1);
      await observe(h, operator, null, 'secondary_market', '150', t1);
      const { intent } = await approved(h, alice, {
        kind: 'single_buy',
        instrumentId: ids['aero'],
        walletId: wallet.walletId,
        budget: { rawAmount: '100000000' },
        idempotencyKey: 'perf-buy-1',
      });
      const settled = await land(h, alice, intent.intentId, wallet.signer);
      const fill = settled.fills[0] as ExecutionStatus['fills'][number];
      await project(h, alice);
      const afterBuy = ok(
        await performance(h, alice, `/v1/me/wallets/${wallet.walletId}/performance?period=all`),
      );
      expect(afterBuy.metrics.available, JSON.stringify(afterBuy.metrics)).toBe(true);
      expect(afterBuy.metrics.netFlows).toBe('0.000000');
      expect(afterBuy.metrics.tradedValue).toBe('100.000000');
      expect(afterBuy.metrics.fees.lamports).toBe(fill.lamportsSpent);
      expect(afterBuy.metrics.fees.value).not.toBeNull();
      const aero = afterBuy.series.latest.find((position) => position.asset === fill.outputMint);
      expect(aero).toMatchObject({ raw: fill.outputReceivedRaw, multiplier: '1' });
      expect(aero?.price).toMatchObject({
        value: '20.075',
        kind: 'issuer_mark',
        source: 'api-test',
      });
      expect(aero?.value).toBe(
        Rational.of(BigInt(fill.outputReceivedRaw), 1_000_000n)
          .multiply(Rational.fromDecimal('20.075'))
          .toDecimal(6),
      );
      // The chained return equals end over start: no flow entered the wallet.
      const expectedReturn = value(afterBuy.metrics.endValue)
        .divide(value(afterBuy.metrics.startValue))
        .subtract(Rational.one())
        .toDecimal(8);
      expect(afterBuy.metrics.timeWeightedReturn).toBe(expectedReturn);
      expect(afterBuy.metrics.completeness).toMatchObject({ endFresh: true, historyDays: 1 });

      // A deposit of 1,000 USDC raises the value and the flows, not the return.
      h.fund(owner, {
        lamports: 50_000_000 - Number(fill.lamportsSpent),
        stablecoinRaw: 5_000_000_000n - BigInt(fill.inputSpentRaw) + 1_000_000_000n,
      });
      const flagged = await reconcileWallet(h, alice, wallet.walletId);
      expect(flagged.unexplainedEntryIds).toHaveLength(1);
      const afterDeposit = ok(
        await performance(h, alice, `/v1/me/wallets/${wallet.walletId}/performance?period=all`),
      );
      expect(afterDeposit.metrics.netFlows).toBe('1000.000000');
      expect(
        value(afterDeposit.metrics.endValue)
          .subtract(value(afterBuy.metrics.endValue))
          .toDecimal(6),
      ).toBe('1000.000000');
      expect(afterDeposit.metrics.timeWeightedReturn).toBe(afterBuy.metrics.timeWeightedReturn);
      expect(afterDeposit.series.flows).toHaveLength(1);
      expect(afterDeposit.series.flows[0]).toMatchObject({
        kind: 'external_inflow',
        asset: STABLECOIN,
        raw: '1000000000',
        value: '1000.000000',
      });
      const exported = await h.app.inject({
        method: 'GET',
        url: `/v1/me/wallets/${wallet.walletId}/performance/export`,
        headers: bearer(alice),
      });
      expect(exported.statusCode).toBe(200);
      const record_ = exported.json() as PerformanceExport;
      expect(record_.metrics.map((entry) => entry.period)).toEqual([
        '7d',
        '30d',
        '90d',
        '365d',
        'all',
      ]);
      expect(record_.metrics.find((entry) => entry.period === '7d')?.reasons).toEqual([
        'insufficient_history',
      ]);
      expect(record_.observations.some((entry) => entry.asset === 'SOL')).toBe(true);

      // A strategy instance: the basket's lots are its holdings, their cost its contribution.
      const version = await h.freezeVersion(alice, pair(ids));
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/instances',
        headers: bearer(alice),
        payload: {
          strategyId: version.strategyId,
          versionId: version.versionId,
          walletId: wallet.walletId,
          label: 'two names',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const instanceId = (created.json() as { instanceId: string }).instanceId;
      await acknowledgeAll(h, alice, wallet.walletId);
      const basket = await approved(h, alice, {
        kind: 'basket_investment',
        strategyVersionId: version.versionId,
        walletId: wallet.walletId,
        budget: { rawAmount: '1000000000' },
        idempotencyKey: 'perf-basket-1',
      });
      const basketSettled = await land(h, alice, basket.intent.intentId, wallet.signer);
      expect(basketSettled.fills).toHaveLength(2);
      await project(h, alice);
      const instance = ok(
        await performance(h, alice, `/v1/me/instances/${instanceId}/performance?period=all`),
      );
      expect(instance.series.subject).toEqual({
        type: 'instance',
        id: instanceId,
        label: 'two names',
      });
      expect(instance.series.latest).toHaveLength(2);
      const cost = basketSettled.fills.reduce(
        (sum, entry) => sum + BigInt(entry.inputSpentRaw),
        0n,
      );
      expect(instance.metrics.tradedValue).toBe(Rational.of(cost, 1_000_000n).toDecimal(6));
      expect(instance.metrics.realizedPnl).toBe('0.000000');
      expect(instance.metrics.unrealizedPnl).toBe(
        value(instance.metrics.endValue).subtract(Rational.of(cost, 1_000_000n)).toDecimal(6),
      );
      const scaled = instance.series.latest.find((position) => position.symbol === 'XSFXA');
      expect(scaled?.multiplier).not.toBeNull();
      expect(scaled?.price).toMatchObject({ value: '101.20', kind: 'secondary_market' });

      // The version's model series: owner-readable while unpublished, invisible to others, never an account.
      const model = ok(
        await performance(
          h,
          alice,
          `/v1/strategies/${version.strategyId}/versions/1/performance?period=all`,
        ),
      );
      expect(model.series.kind).toBe('model');
      expect(model.series.start).not.toBeNull();
      expect(model.series.points[0]?.caveats).toEqual(
        expect.arrayContaining(['model_buy_and_hold', 'model_no_costs', 'stablecoin_par']),
      );
      expect(model.metrics.realizedPnl).toBeNull();
      expect(model.metrics.tradedValue).toBe('0.000000');
      expect(model.series.flows).toEqual([]);
      const anonymous = await performance(
        h,
        null,
        `/v1/strategies/${version.strategyId}/versions/1/performance`,
      );
      expect(anonymous.status).toBe(404);
      const bob = await h.user('did:test:bob');
      expect(
        (await performance(h, bob, `/v1/strategies/${version.strategyId}/versions/1/performance`))
          .status,
      ).toBe(404);
      expect(
        (await performance(h, bob, `/v1/me/wallets/${wallet.walletId}/performance`)).status,
      ).toBe(404);
      expect((await performance(h, bob, `/v1/me/instances/${instanceId}/performance`)).status).toBe(
        404,
      );

      // Nothing is registered: the public ranking lists nothing, and its note says whose series rank.
      const ranking = await h.app.inject({ method: 'GET', url: '/v1/rankings/model?period=30d' });
      expect(ranking.statusCode).toBe(200);
      expect(ranking.json() as RankingResponse).toMatchObject({
        kind: 'model',
        period: '30d',
        minHistoryDays: 30,
        entries: [],
      });

      // Two days without observations: every end price is stale, no return is reported and the reason says so.
      h.clock.advance(2 * DAY);
      const stale = ok(
        await performance(h, alice, `/v1/me/wallets/${wallet.walletId}/performance?period=all`),
      );
      expect(stale.metrics.available).toBe(false);
      expect(stale.metrics.reasons).toEqual(['incomplete_points', 'stale_end']);
      expect(stale.metrics.timeWeightedReturn).toBeNull();
      expect(stale.metrics.endValue).toBeNull();
      expect(stale.metrics.completeness.endFresh).toBe(false);
      expect(stale.metrics.completeness.missing.length).toBeGreaterThanOrEqual(1);
      expect(
        stale.metrics.completeness.missing[0]?.issues.every(
          (issue) => issue.code === 'stale_price',
        ),
      ).toBe(true);
      const staleModel = ok(
        await performance(
          h,
          alice,
          `/v1/strategies/${version.strategyId}/versions/1/performance?period=all`,
        ),
      );
      expect(staleModel.metrics.available).toBe(false);
      expect(staleModel.metrics.timeWeightedReturn).toBeNull();

      const methodology = await h.app.inject({ method: 'GET', url: '/v1/performance/methodology' });
      expect(methodology.statusCode).toBe(200);
      expect(methodology.json()).toMatchObject({
        version: 'stocks-v1',
        currency: 'USD',
        rankingMinHistoryDays: 30,
        priceMaxAgeMs: 86_400_000,
      });
      const sol = await h.app.inject({ method: 'GET', url: '/v1/prices/sol' });
      expect(sol.statusCode).toBe(200);
      expect((sol.json() as PriceHistoryResponse).observations.map((entry) => entry.value)).toEqual(
        ['150', '150'],
      );
    });
  }, 120_000);
});
