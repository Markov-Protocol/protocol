import {
  type Completeness,
  type Drawdown,
  type MetricUnavailableReason,
  PERFORMANCE_PERIOD_DAYS,
  type PerformancePeriod,
  type PerformanceSeries,
  RETURN_SCALE,
  VALUE_SCALE,
  type ValuationPoint,
  type WindowMetrics,
} from '@markov/contracts';
import type { PriceLookup } from './prices.js';
import { Rational, sumRationals } from './rational.js';
import { DAY_MS, INDEX_START } from './series.js';

/**
 * Metrics of one window of a series. The time-weighted return chains the
 * subperiod returns between flows and is the only return a ranking may
 * use; the money-weighted return (Modified Dietz) weighs each flow by the
 * time it was in the portfolio and answers a different question. Both are
 * null, with the reason, whenever the window has an incomplete point.
 */

export interface TradeInput {
  readonly at: string;
  /** Traded value in the valuation currency (the stablecoin side of a fill at par). */
  readonly value: string;
}

export interface RealizedInput {
  readonly at: string;
  /** Proceeds minus the consumed lots' cost, in the valuation currency. */
  readonly value: string;
}

export interface FeeInput {
  readonly at: string;
  readonly lamports: bigint;
}

export interface MetricsContext {
  readonly trades?: readonly TradeInput[];
  readonly realized?: readonly RealizedInput[];
  /** Remaining cost of the open lots at the end, in the valuation currency; null when unknown or not applicable. */
  readonly openCost?: string | null;
  readonly fees?: readonly FeeInput[];
  /** Values the fees at the end (the `SOL` asset); fees stay in lamports without it. */
  readonly prices?: PriceLookup;
}

const LAMPORTS_PER_SOL = Rational.of(1_000_000_000n);
const MISSING_LIMIT = 30;

function rational(text: string | null): Rational | null {
  return text === null ? null : Rational.fromDecimal(text);
}

function inWindow(at: string, start: string, end: string, inclusiveStart: boolean): boolean {
  const t = Date.parse(at);
  const afterStart = inclusiveStart ? t >= Date.parse(start) : t > Date.parse(start);
  return afterStart && t <= Date.parse(end);
}

export function completenessOf(
  points: readonly ValuationPoint[],
  seriesStart: string | null,
  end: string,
): Completeness {
  const complete = points.filter((point) => point.complete).length;
  const missing = points
    .filter((point) => !point.complete)
    .slice(0, MISSING_LIMIT)
    .map((point) => ({ at: point.at, issues: point.issues }));
  const last = points[points.length - 1];
  return {
    expectedPoints: points.length,
    completePoints: complete,
    ratio:
      points.length === 0
        ? '0'
        : Rational.of(BigInt(complete), BigInt(points.length)).toDecimal(RETURN_SCALE),
    missing,
    historyDays:
      seriesStart === null
        ? 0
        : Math.max(0, Math.floor((Date.parse(end) - Date.parse(seriesStart)) / DAY_MS)),
    endFresh: last?.complete ?? false,
  };
}

/** Chained growth factors of consecutive complete points; null with the reason at the first break. */
export function chainGrowth(
  points: readonly ValuationPoint[],
): { ok: true; index: Rational[] } | { ok: false; reason: MetricUnavailableReason } {
  const index: Rational[] = [];
  let previous: Rational | null = null;
  let current = INDEX_START;
  for (const point of points) {
    if (!point.complete || point.value === null) {
      return {
        ok: false,
        reason: point.issues.some((issue) => issue.code === 'unpriced_flow')
          ? 'unpriced_flow'
          : point.issues.some((issue) => issue.code === 'zero_base')
            ? 'zero_base'
            : 'incomplete_points',
      };
    }
    const value = Rational.fromDecimal(point.value);
    if (previous !== null) {
      const flow = rational(point.netFlow);
      if (flow === null) {
        return { ok: false, reason: 'unpriced_flow' };
      }
      if (!previous.isPositive()) {
        return { ok: false, reason: 'zero_base' };
      }
      current = current.multiply(value.subtract(flow).divide(previous));
    }
    index.push(current);
    previous = value;
  }
  return { ok: true, index };
}

export function maxDrawdown(
  points: readonly ValuationPoint[],
  index: readonly Rational[],
): Drawdown | null {
  const first = index[0];
  const firstPoint = points[0];
  if (first === undefined || firstPoint === undefined) {
    return null;
  }
  let peak = first;
  let peakAt = firstPoint.at;
  let worst = Rational.zero();
  let worstPeakAt = firstPoint.at;
  let worstTroughAt = firstPoint.at;
  index.forEach((value, position) => {
    const point = points[position];
    if (point === undefined) {
      return;
    }
    if (value.compare(peak) > 0) {
      peak = value;
      peakAt = point.at;
    }
    const decline = peak.subtract(value).divide(peak);
    if (decline.compare(worst) > 0) {
      worst = decline;
      worstPeakAt = peakAt;
      worstTroughAt = point.at;
    }
  });
  return { value: worst.toDecimal(RETURN_SCALE), peakAt: worstPeakAt, troughAt: worstTroughAt };
}

/** Modified Dietz over the window: (V_end − V_start − ΣF) / (V_start + Σ F_k × w_k), w_k = (T_end − t_k) / (T_end − T_start). */
export function modifiedDietz(
  points: readonly ValuationPoint[],
  flows: readonly { at: string; value: Rational }[],
): Rational | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || first === last) {
    return null;
  }
  const startValue = rational(first.value);
  const endValue = rational(last.value);
  if (startValue === null || endValue === null) {
    return null;
  }
  const span = Date.parse(last.at) - Date.parse(first.at);
  if (span <= 0) {
    return null;
  }
  let netFlows = Rational.zero();
  let weighted = Rational.zero();
  for (const flow of flows) {
    netFlows = netFlows.add(flow.value);
    const weight = Rational.of(BigInt(Date.parse(last.at) - Date.parse(flow.at)), BigInt(span));
    weighted = weighted.add(flow.value.multiply(weight));
  }
  const denominator = startValue.add(weighted);
  if (!denominator.isPositive()) {
    return null;
  }
  return endValue.subtract(startValue).subtract(netFlows).divide(denominator);
}

export function windowMetrics(
  series: PerformanceSeries,
  period: PerformancePeriod,
  context: MetricsContext = {},
): WindowMetrics {
  const unavailable = (
    reasons: MetricUnavailableReason[],
    start: string | null,
    points: readonly ValuationPoint[],
  ): WindowMetrics => ({
    period,
    start,
    end: series.end,
    available: false,
    reasons,
    timeWeightedReturn: null,
    moneyWeightedReturn: null,
    maxDrawdown: null,
    startValue: start === null ? null : (points[0]?.value ?? null),
    endValue: points[points.length - 1]?.value ?? null,
    netFlows: null,
    turnover: null,
    tradedValue: null,
    realizedPnl: null,
    unrealizedPnl: null,
    fees: { lamports: '0', value: null },
    completeness: completenessOf(points, series.start, series.end),
  });

  const last = series.points[series.points.length - 1];
  if (last === undefined || series.start === null) {
    return unavailable(['no_series'], null, []);
  }
  const days = PERFORMANCE_PERIOD_DAYS[period];
  let startIndex = 0;
  if (days !== null) {
    const target = Date.parse(last.at) - days * DAY_MS;
    startIndex = -1;
    series.points.forEach((point, position) => {
      if (Date.parse(point.at) <= target) {
        startIndex = position;
      }
    });
    if (startIndex < 0) {
      return unavailable(['insufficient_history'], null, series.points);
    }
  }
  const points = series.points.slice(startIndex);
  const first = points[0] as ValuationPoint;
  const chained = chainGrowth(points);
  const reasons: MetricUnavailableReason[] = [];
  if (!chained.ok) {
    reasons.push(chained.reason);
  }
  if (!last.complete && last.issues.some((issue) => issue.code === 'stale_price')) {
    reasons.push('stale_end');
  }

  // Flows strictly after the window start and at or before its end, valued.
  const windowFlows = series.flows.filter((flow) => inWindow(flow.at, first.at, last.at, false));
  const flowValues = windowFlows.map((flow) => rational(flow.value));
  const flowsValued = flowValues.every((value): value is Rational => value !== null);
  const netFlows = flowsValued ? sumRationals(flowValues as Rational[]) : null;
  const dietz = flowsValued
    ? modifiedDietz(
        points,
        windowFlows.map((flow, position) => ({
          at: flow.at,
          value: flowValues[position] as Rational,
        })),
      )
    : null;

  const trades = (context.trades ?? []).filter((trade) =>
    inWindow(trade.at, first.at, last.at, true),
  );
  const tradedValue = sumRationals(trades.map((trade) => Rational.fromDecimal(trade.value)));
  const allComplete = points.every((point) => point.complete && point.value !== null);
  const average = allComplete
    ? sumRationals(points.map((point) => Rational.fromDecimal(point.value as string))).divide(
        Rational.of(BigInt(points.length)),
      )
    : null;
  const realized = sumRationals(
    (context.realized ?? [])
      .filter((entry) => inWindow(entry.at, first.at, last.at, false))
      .map((entry) => Rational.fromDecimal(entry.value)),
  );
  const feeLamports = (context.fees ?? [])
    .filter((fee) => inWindow(fee.at, first.at, last.at, false))
    .reduce((total, fee) => total + fee.lamports, 0n);
  let feeValue: string | null = null;
  if (feeLamports === 0n) {
    feeValue = '0';
  } else if (context.prices !== undefined) {
    const sol = context.prices.priceAt('SOL', new Date(last.at));
    if (sol.ok) {
      feeValue = Rational.of(feeLamports)
        .divide(LAMPORTS_PER_SOL)
        .multiply(sol.value)
        .toDecimal(VALUE_SCALE);
    }
  }
  const openCost = context.openCost ?? null;
  const endValue = rational(last.value);
  const unrealized =
    last.complete && endValue !== null && openCost !== null
      ? endValue.subtract(Rational.fromDecimal(openCost))
      : null;
  const timeWeighted = chained.ok
    ? (chained.index[chained.index.length - 1] as Rational)
        .divide(INDEX_START)
        .subtract(Rational.one())
    : null;
  return {
    period,
    start: first.at,
    end: last.at,
    available: chained.ok,
    reasons,
    timeWeightedReturn: timeWeighted === null ? null : timeWeighted.toDecimal(RETURN_SCALE),
    moneyWeightedReturn: dietz === null ? null : dietz.toDecimal(RETURN_SCALE),
    maxDrawdown: chained.ok ? maxDrawdown(points, chained.index) : null,
    startValue: first.value,
    endValue: last.value,
    netFlows: netFlows === null ? null : netFlows.toDecimal(VALUE_SCALE),
    turnover:
      average === null || !average.isPositive()
        ? null
        : tradedValue.divide(average).toDecimal(RETURN_SCALE),
    tradedValue: tradedValue.toDecimal(VALUE_SCALE),
    realizedPnl: series.kind === 'model' ? null : realized.toDecimal(VALUE_SCALE),
    unrealizedPnl:
      series.kind === 'model'
        ? null
        : unrealized === null
          ? null
          : unrealized.toDecimal(VALUE_SCALE),
    fees: { lamports: feeLamports.toString(), value: feeValue },
    completeness: completenessOf(points, series.start, series.end),
  };
}
