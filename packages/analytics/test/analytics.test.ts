import { readFileSync } from 'node:fs';
import type {
  PerformancePeriod,
  PerformanceSeries,
  SeriesSubject,
  ValuationCaveatCode,
  WindowMetrics,
} from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AssetFacts,
  type BalanceChange,
  buildActualSeries,
  buildModelSeries,
  createPriceLookup,
  gridTimes,
  type MetricsContext,
  methodologySummary,
  multiplierAt,
  type ObservationInput,
  type PriceLookup,
  Rational,
  rankModelSeries,
  valuePositions,
  windowMetrics,
} from '../src/index.js';

/**
 * The fixture vectors were derived independently by
 * fixtures/derive-vectors.py (Python fractions, round half to even) from
 * the methodology text; this suite replays every scenario against the
 * implementation and compares the reported numbers exactly.
 */

interface Vector {
  readonly id: string;
  readonly notes: string;
  readonly kind: 'model' | 'actual';
  readonly assets: readonly AssetFacts[];
  readonly observations: readonly ObservationInput[];
  readonly legs: readonly { asset: string; weightBps: number }[] | null;
  readonly cash: { asset: string; weightBps: number } | null;
  readonly frozenAt: string | null;
  readonly changes:
    | readonly {
        at: string;
        asset: string;
        deltaRaw: string;
        flow: {
          kind: BalanceChange['flow'] extends infer F ? (F extends null ? never : F) : never;
        }['kind'] extends never
          ? never
          : NonNullable<BalanceChange['flow']> | null;
      }[]
    | null;
  readonly start: string | null;
  readonly end: string;
  readonly context: {
    trades?: [string, string][];
    realized?: [string, string][];
    openCost?: string;
    fees?: [string, number][];
  };
  readonly expected: {
    series: {
      start: string | null;
      end: string;
      points: {
        at: string;
        value: string | null;
        complete: boolean;
        netFlow: string | null;
        index: string | null;
        issues: string[];
        caveats: string[];
      }[];
      flows: { at: string; value: string | null }[];
    };
    windows: Record<
      string,
      Partial<WindowMetrics> & {
        completeness?: Omit<WindowMetrics['completeness'], 'missing'>;
      }
    >;
  };
}

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/performance-vectors.json', import.meta.url), 'utf8'),
) as { methodologyVersion: string; scenarios: Vector[] };

const USDC = 'FixtureStab1ecoin11111111111111111111111111';
const A = 'FixtureTokenA1111111111111111111111111111111';

function subjectOf(vector: Vector): SeriesSubject {
  return {
    type: vector.kind === 'model' ? 'version' : 'instance',
    id: '00000000-0000-4000-8000-000000000001',
    label: vector.id,
  };
}

function lookupOf(vector: Vector): PriceLookup {
  return createPriceLookup({
    observations: vector.observations,
    currency: 'USD',
    stablecoin: { asset: USDC },
  });
}

function seriesOf(vector: Vector, prices = lookupOf(vector)): PerformanceSeries {
  const assets = new Map(vector.assets.map((facts) => [facts.asset, facts]));
  if (vector.kind === 'model') {
    const legs = (vector.legs ?? []).map((leg) => ({
      facts: assets.get(leg.asset) as AssetFacts,
      weightBps: leg.weightBps,
    }));
    return buildModelSeries({
      subject: subjectOf(vector),
      legs,
      cash: vector.cash
        ? { facts: assets.get(vector.cash.asset) as AssetFacts, weightBps: vector.cash.weightBps }
        : null,
      frozenAt: new Date(vector.frozenAt as string),
      end: new Date(vector.end),
      prices,
    });
  }
  return buildActualSeries({
    subject: subjectOf(vector),
    assets,
    changes: (vector.changes ?? []).map((change) => ({
      at: change.at,
      asset: change.asset,
      deltaRaw: BigInt(change.deltaRaw),
      flow: change.flow,
    })),
    prices,
    end: new Date(vector.end),
    start: vector.start ? new Date(vector.start) : null,
  });
}

function contextOf(vector: Vector, prices: PriceLookup): MetricsContext {
  return {
    trades: (vector.context.trades ?? []).map(([at, value]) => ({ at, value })),
    realized: (vector.context.realized ?? []).map(([at, value]) => ({ at, value })),
    openCost: vector.context.openCost ?? null,
    fees: (vector.context.fees ?? []).map(([at, lamports]) => ({ at, lamports: BigInt(lamports) })),
    prices,
  };
}

function metricsOf(vector: Vector, period: PerformancePeriod): WindowMetrics {
  const prices = lookupOf(vector);
  return windowMetrics(seriesOf(vector, prices), period, contextOf(vector, prices));
}

const vector = (id: string): Vector => vectors.scenarios.find((entry) => entry.id === id) as Vector;

describe('performance vectors (independently derived)', () => {
  it('replays every scenario exactly', () => {
    expect(vectors.methodologyVersion).toBe(methodologySummary().version);
    for (const scenario of vectors.scenarios) {
      const prices = lookupOf(scenario);
      const series = seriesOf(scenario, prices);
      expect(series.kind, scenario.id).toBe(scenario.kind);
      expect(series.start, scenario.id).toBe(scenario.expected.series.start);
      expect(series.end, scenario.id).toBe(scenario.expected.series.end);
      expect(
        series.points.map((point) => ({
          at: point.at,
          value: point.value,
          complete: point.complete,
          netFlow: point.netFlow,
          index: point.index,
          issues: point.issues.map((issue) => issue.code),
          caveats: [...point.caveats].sort(),
        })),
        scenario.id,
      ).toEqual(
        scenario.expected.series.points.map((point) => ({
          ...point,
          caveats: [...point.caveats].sort(),
        })),
      );
      expect(
        series.flows.map((flow) => ({ at: flow.at, value: flow.value })),
        scenario.id,
      ).toEqual(scenario.expected.series.flows);
      for (const [period, expected] of Object.entries(scenario.expected.windows)) {
        const metrics = windowMetrics(
          series,
          period as PerformancePeriod,
          contextOf(scenario, prices),
        );
        const { completeness, ...rest } = expected;
        const { completeness: actualCompleteness, ...actualRest } = metrics;
        for (const [key, value] of Object.entries(rest)) {
          expect(
            actualRest[key as keyof typeof actualRest],
            `${scenario.id} ${period} ${key}`,
          ).toEqual(value);
        }
        if (completeness) {
          const { missing: _missing, ...actualNoMissing } = actualCompleteness;
          expect(actualNoMissing, `${scenario.id} ${period} completeness`).toEqual(completeness);
        }
      }
    }
  });

  it('a deposit is not profit: the valuation doubles while both returns stay zero', () => {
    const metrics = metricsOf(vector('deposit-not-profit'), 'all');
    expect(metrics.startValue).toBe('1000.000000');
    expect(metrics.endValue).toBe('2000.000000');
    expect(metrics.netFlows).toBe('1000.000000');
    expect(metrics.timeWeightedReturn).toBe('0.00000000');
    expect(metrics.moneyWeightedReturn).toBe('0.00000000');
    expect(metrics.maxDrawdown?.value).toBe('0.00000000');
  });

  it('a deposit before a fall: positive time-weighted, negative money-weighted, drawdown from the index', () => {
    const metrics = metricsOf(vector('price-return-with-deposit'), 'all');
    expect(metrics.timeWeightedReturn).toBe('0.03373239');
    expect(metrics.moneyWeightedReturn).toBe('-0.00307692');
    expect(metrics.maxDrawdown).toEqual({
      value: '0.01549296',
      peakAt: '2026-08-02T00:00:00.000Z',
      troughAt: '2026-08-03T00:00:00.000Z',
    });
    expect(metrics.endValue).toBe('699.000000');
    const week = metricsOf(vector('price-return-with-deposit'), '7d');
    expect(week.available).toBe(false);
    expect(week.reasons).toEqual(['insufficient_history']);
    expect(week.timeWeightedReturn).toBeNull();
  });

  it('a split moves the multiplier and the price together and never the value', () => {
    const series = seriesOf(vector('model-split'));
    const scaled = series.latest.find((position) => position.symbol === 'XSB');
    expect(scaled?.multiplier).toBe('2');
    expect(scaled?.raw).toBe('8000000000');
    expect(scaled?.scaledQuantity).toBe('160');
    expect(scaled?.value).toBe('4160.000000');
    expect(series.points.map((point) => point.value)).toEqual([
      '10000.000000',
      '10500.000000',
      '10410.000000',
    ]);
    expect(series.points.every((point) => point.caveats.includes('model_buy_and_hold'))).toBe(true);
    const metrics = windowMetrics(series, 'all');
    expect(metrics.timeWeightedReturn).toBe('0.04100000');
    expect(metrics.realizedPnl).toBeNull();
    expect(metrics.turnover).toBe('0.00000000');
  });

  it('a missing observation breaks the chain: no return although the end value is known', () => {
    const metrics = metricsOf(vector('model-missing-observation'), 'all');
    expect(metrics.available).toBe(false);
    expect(metrics.reasons).toEqual(['incomplete_points']);
    expect(metrics.timeWeightedReturn).toBeNull();
    expect(metrics.endValue).toBe('10410.000000');
    expect(metrics.completeness.missing).toEqual([
      {
        at: '2026-08-02T00:00:00.000Z',
        issues: [expect.objectContaining({ code: 'stale_price', asset: expect.any(String) })],
      },
    ]);
  });

  it('a zero valuation cannot be chained through', () => {
    const metrics = metricsOf(vector('zero-base'), 'all');
    expect(metrics.available).toBe(false);
    expect(metrics.reasons).toEqual(['zero_base']);
    expect(metrics.moneyWeightedReturn).toBe('0.00000000');
  });

  it('an instance sale is a withdrawal, realized and unrealized P&L follow the lots, fees are valued in SOL', () => {
    const metrics = metricsOf(vector('instance-trade'), 'all');
    expect(metrics.timeWeightedReturn).toBe('0.10000000');
    expect(metrics.netFlows).toBe('-48.000000');
    expect(metrics.realizedPnl).toBe('8.000000');
    expect(metrics.unrealizedPnl).toBe('6.000000');
    expect(metrics.turnover).toBe('1.86554622');
    expect(metrics.fees).toEqual({ lamports: '5000', value: '0.000750' });
  });
});

describe('ranking', () => {
  const IDS: Record<string, string> = {
    'model-long-a': '00000000-0000-4000-8000-000000000001',
    'model-long-b': '00000000-0000-4000-8000-000000000002',
    'model-missing-observation': '00000000-0000-4000-8000-000000000003',
    'model-split': '00000000-0000-4000-8000-000000000004',
    'model-stale-end': '00000000-0000-4000-8000-000000000005',
    'price-return-with-deposit': '00000000-0000-4000-8000-000000000006',
  };
  const candidate = (id: string, period: '30d' | 'all' = '30d') => {
    const entry = vector(id);
    const prices = lookupOf(entry);
    const series = seriesOf(entry, prices);
    return {
      strategyId: '00000000-0000-4000-8000-0000000000aa',
      versionId: IDS[id] as string,
      versionNumber: 1,
      title: id,
      series,
      metrics: windowMetrics(series, period, contextOf(entry, prices)),
    };
  };

  it('ranks only complete, fresh model series with enough history and lists the rest without a return', () => {
    const entries = rankModelSeries([
      candidate('model-long-b'),
      candidate('model-split'),
      candidate('model-missing-observation'),
      candidate('model-long-a'),
      candidate('model-stale-end'),
      candidate('price-return-with-deposit'),
    ]);
    expect(
      entries.map((entry) => [entry.title, entry.rank, entry.timeWeightedReturn, entry.reasons]),
    ).toEqual([
      ['model-long-a', 1, '0.27272727', []],
      ['model-long-b', 2, '0.14285714', []],
      ['model-missing-observation', null, null, ['insufficient_history']],
      ['model-split', null, null, ['insufficient_history']],
      ['model-stale-end', null, null, ['insufficient_history', 'stale_end']],
      // An account with a deposit never enters a ranking, whatever its numbers say.
      ['price-return-with-deposit', null, null, ['not_model_series', 'insufficient_history']],
    ]);
    expect(entries.filter((entry) => entry.rank !== null).every((entry) => entry.eligible)).toBe(
      true,
    );
    expect(entries.filter((entry) => entry.rank === null).every((entry) => !entry.eligible)).toBe(
      true,
    );
  });

  it('never shows a return for an incomplete window even when the end value is known', () => {
    const [entry] = rankModelSeries([candidate('model-missing-observation', 'all')], {
      minHistoryDays: 1,
    });
    expect(entry?.rank).toBeNull();
    expect(entry?.timeWeightedReturn).toBeNull();
    expect(entry?.reasons).toEqual(['incomplete_window']);
    expect(entry?.completeness?.completePoints).toBe(2);
    const [complete] = rankModelSeries([candidate('model-split', 'all')], { minHistoryDays: 1 });
    expect(complete?.rank).toBe(1);
    expect(complete?.timeWeightedReturn).toBe('0.04100000');
  });
});

describe('price resolution', () => {
  const at = new Date('2026-08-02T00:00:00Z');
  it('takes the most direct fresh kind and never an implied valuation', () => {
    const lookup = createPriceLookup({
      currency: 'USD',
      stablecoin: { asset: USDC },
      observations: [
        {
          asset: A,
          kind: 'implied_valuation',
          value: '99',
          unit: 'USD',
          observedAt: '2026-08-01T23:00:00Z',
          source: 'x',
        },
        {
          asset: A,
          kind: 'underlying_equity',
          value: '10',
          unit: 'USD',
          observedAt: '2026-08-01T23:00:00Z',
          source: 'x',
        },
        {
          asset: A,
          kind: 'issuer_mark',
          value: '11',
          unit: 'USD',
          observedAt: '2026-07-30T00:00:00Z',
          source: 'x',
        },
      ],
    });
    const resolved = lookup.priceAt(A, at);
    expect(resolved.ok && resolved.price.value).toBe('10');
    expect(resolved.ok && resolved.caveats).toEqual(['underlying_as_token_price']);
    const onlyImplied = createPriceLookup({
      currency: 'USD',
      stablecoin: null,
      observations: [
        {
          asset: A,
          kind: 'implied_valuation',
          value: '99',
          unit: 'USD',
          observedAt: '2026-08-01T23:00:00Z',
          source: 'x',
        },
      ],
    }).priceAt(A, at);
    expect(!onlyImplied.ok && onlyImplied.issue.code).toBe('excluded_price_kind');
  });

  it('reports stale, unit mismatch and no observation distinctly', () => {
    const stale = createPriceLookup({
      currency: 'USD',
      stablecoin: null,
      observations: [
        {
          asset: A,
          kind: 'secondary_market',
          value: '10',
          unit: 'USD',
          observedAt: '2026-07-31T23:59:59Z',
          source: 'x',
        },
      ],
    }).priceAt(A, at);
    expect(!stale.ok && stale.issue.code).toBe('stale_price');
    const exactlyAtLimit = createPriceLookup({
      currency: 'USD',
      stablecoin: null,
      observations: [
        {
          asset: A,
          kind: 'secondary_market',
          value: '10',
          unit: 'USD',
          observedAt: '2026-08-01T00:00:00Z',
          source: 'x',
        },
      ],
    }).priceAt(A, at);
    expect(exactlyAtLimit.ok).toBe(true);
    const unit = createPriceLookup({
      currency: 'USD',
      stablecoin: null,
      observations: [
        {
          asset: A,
          kind: 'secondary_market',
          value: '10',
          unit: 'USDC',
          observedAt: '2026-08-01T23:00:00Z',
          source: 'x',
        },
      ],
    }).priceAt(A, at);
    expect(!unit.ok && unit.issue.code).toBe('price_unit_mismatch');
    const none = createPriceLookup({ currency: 'USD', stablecoin: null, observations: [] }).priceAt(
      A,
      at,
    );
    expect(!none.ok && none.issue.code).toBe('no_observation');
  });

  it('values the stablecoin at par as a stated assumption and flags a depeg', () => {
    const par = createPriceLookup({
      currency: 'USD',
      stablecoin: { asset: USDC },
      observations: [],
    }).priceAt(USDC, at);
    expect(par.ok && par.price.value).toBe('1');
    expect(par.ok && par.caveats).toEqual(['stablecoin_par']);
    const depeg = createPriceLookup({
      currency: 'USD',
      stablecoin: { asset: USDC },
      observations: [
        {
          asset: USDC,
          kind: 'secondary_market',
          value: '0.99',
          unit: 'USD',
          observedAt: '2026-08-01T23:00:00Z',
          source: 'x',
        },
      ],
    }).priceAt(USDC, at);
    expect(depeg.ok && depeg.caveats).toEqual(['stablecoin_depeg']);
    expect(depeg.ok && depeg.price.value).toBe('0.99');
  });
});

describe('valuation', () => {
  const at = new Date('2026-08-02T00:00:00Z');
  const scaled: AssetFacts = {
    asset: A,
    symbol: 'XS',
    decimals: 8,
    scaled: true,
    multipliers: [{ effectiveAt: '2026-08-05T00:00:00Z', multiplier: '2' }],
  };
  it('never assumes a multiplier and reports a negative quantity', () => {
    expect(multiplierAt(scaled, at)).toBeNull();
    expect(multiplierAt({ ...scaled, scaled: false }, at)?.toDecimal(0)).toBe('1');
    const prices = createPriceLookup({
      currency: 'USD',
      stablecoin: null,
      observations: [
        {
          asset: A,
          kind: 'secondary_market',
          value: '10',
          unit: 'USD',
          observedAt: '2026-08-01T12:00:00Z',
          source: 'x',
        },
      ],
    });
    const unknown = valuePositions([{ facts: scaled, raw: 100n }], at, prices);
    expect(unknown.complete).toBe(false);
    expect(unknown.value).toBeNull();
    expect(unknown.issues.map((issue) => issue.code)).toEqual(['multiplier_unknown']);
    const negative = valuePositions(
      [{ facts: { ...scaled, scaled: false }, raw: -5n }],
      at,
      prices,
    );
    expect(negative.issues.map((issue) => issue.code)).toEqual(['negative_quantity']);
    const zero = valuePositions([{ facts: { ...scaled, scaled: false }, raw: 0n }], at, prices);
    expect(zero.positions).toEqual([]);
    expect(zero.value?.toDecimal(6)).toBe('0.000000');
  });

  it('puts a point on every midnight, the ends and every flow time', () => {
    const times = gridTimes(new Date('2026-08-01T10:00:00Z'), new Date('2026-08-03T06:00:00Z'), [
      new Date('2026-08-02T12:30:00Z'),
      new Date('2026-08-09T00:00:00Z'),
    ]).map((time) => time.toISOString());
    expect(times).toEqual([
      '2026-08-01T10:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      '2026-08-02T12:30:00.000Z',
      '2026-08-03T00:00:00.000Z',
      '2026-08-03T06:00:00.000Z',
    ]);
  });

  it('rounds half to even exactly once', () => {
    expect(Rational.fromDecimal('2.5').toDecimal(0)).toBe('2');
    expect(Rational.fromDecimal('3.5').toDecimal(0)).toBe('4');
    expect(Rational.fromDecimal('-0.0000004').toDecimal(6)).toBe('0.000000');
    expect(Rational.of(1n, 3n).toDecimal(8)).toBe('0.33333333');
    expect(Rational.of(2n, 3n).rounded(2).toDecimal(4)).toBe('0.6700');
  });
});

const _caveat: ValuationCaveatCode = 'stablecoin_par';
void _caveat;
