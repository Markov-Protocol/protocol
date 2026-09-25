import {
  type FlowKind,
  PERFORMANCE_METHODOLOGY_VERSION,
  type PerformanceSeries,
  RETURN_SCALE,
  type SeriesKind,
  type SeriesSubject,
  VALUATION_CURRENCY,
  VALUE_SCALE,
  type ValuationCaveatCode,
  type ValuationIssue,
  type ValuationPoint,
  type ValuationPosition,
  type ValuedFlow,
} from '@markov/contracts';
import type { PriceLookup } from './prices.js';
import { Rational } from './rational.js';
import {
  type AssetFacts,
  dedupeCaveats,
  multiplierAt,
  type PositionInput,
  scaledQuantity,
  valuePositions,
} from './valuation.js';

/**
 * Valuation series. Points sit on every UTC midnight between the start and
 * the end, plus the start, the end and the exact time of every external
 * flow, so each flow closes its own subperiod and the chained return needs
 * no assumption about when inside a day money moved. The chain
 * `r_k = (V_k − F_k) / V_{k−1} − 1` is broken, never bridged, by an
 * incomplete point or a non-positive base.
 */

export const DAY_MS = 86_400_000;
export const INDEX_START = Rational.of(100n);

export interface BalanceChange {
  readonly at: string;
  readonly asset: string;
  readonly deltaRaw: bigint;
  /** Set when the change is value entering or leaving the subject (never a trade between two of its assets). */
  readonly flow: { readonly kind: FlowKind; readonly ref: string } | null;
}

export interface SeriesCore {
  readonly kind: SeriesKind;
  readonly subject: SeriesSubject;
  readonly assets: ReadonlyMap<string, AssetFacts>;
  readonly changes: readonly BalanceChange[];
  readonly prices: PriceLookup;
  readonly start: Date | null;
  readonly end: Date;
  readonly caveats: readonly ValuationCaveatCode[];
}

/** Every UTC midnight strictly between start and end, plus start, end and the extra times, ascending and unique. */
export function gridTimes(start: Date, end: Date, extra: readonly Date[] = []): Date[] {
  const times = new Set<number>([start.getTime(), end.getTime()]);
  const firstMidnight = Math.floor(start.getTime() / DAY_MS) * DAY_MS + DAY_MS;
  for (let t = firstMidnight; t < end.getTime(); t += DAY_MS) {
    times.add(t);
  }
  for (const time of extra) {
    const t = time.getTime();
    if (t >= start.getTime() && t <= end.getTime()) {
      times.add(t);
    }
  }
  return [...times].sort((a, b) => a - b).map((t) => new Date(t));
}

function emptySeries(core: SeriesCore): PerformanceSeries {
  return {
    kind: core.kind,
    subject: core.subject,
    methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
    currency: VALUATION_CURRENCY,
    start: null,
    end: core.end.toISOString(),
    points: [],
    flows: [],
    latest: [],
  };
}

function valueFlow(
  change: BalanceChange,
  facts: AssetFacts,
  prices: PriceLookup,
): { value: Rational | null; issue: ValuationIssue | null } {
  const at = new Date(change.at);
  const multiplier = multiplierAt(facts, at);
  const resolved = prices.priceAt(facts.asset, at);
  if (multiplier === null) {
    return {
      value: null,
      issue: {
        code: 'unpriced_flow',
        asset: facts.asset,
        detail: 'the flow cannot be valued: no multiplier evidence at its time',
      },
    };
  }
  if (!resolved.ok) {
    return {
      value: null,
      issue: {
        code: 'unpriced_flow',
        asset: facts.asset,
        detail: `the flow cannot be valued: ${resolved.issue.detail}`,
      },
    };
  }
  return {
    value: scaledQuantity(change.deltaRaw, facts.decimals, multiplier)
      .multiply(resolved.value)
      .rounded(VALUE_SCALE),
    issue: null,
  };
}

/** Builds the series from balance changes; the start defaults to the first change. */
export function buildSeries(core: SeriesCore): PerformanceSeries {
  const changes = [...core.changes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = changes[0];
  if (first === undefined) {
    return emptySeries(core);
  }
  const start = core.start ?? new Date(first.at);
  const end = core.end.getTime() < start.getTime() ? start : core.end;
  const flowChanges = changes.filter(
    (change) =>
      change.flow !== null &&
      Date.parse(change.at) > start.getTime() &&
      Date.parse(change.at) <= end.getTime(),
  );
  const grid = gridTimes(
    start,
    end,
    flowChanges.map((change) => new Date(change.at)),
  );
  const flows: ValuedFlow[] = [];
  const points: ValuationPoint[] = [];
  let latest: readonly ValuationPosition[] = [];
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousValue: Rational | null = null;
  let previousIndex: Rational | null = null;
  let previousComplete = false;
  for (const at of grid) {
    const cutoff = at.getTime();
    const balances = new Map<string, bigint>();
    for (const change of changes) {
      if (Date.parse(change.at) > cutoff) {
        break;
      }
      balances.set(change.asset, (balances.get(change.asset) ?? 0n) + change.deltaRaw);
    }
    const inputs: PositionInput[] = [];
    for (const [asset, raw] of balances) {
      const facts = core.assets.get(asset);
      if (facts === undefined) {
        throw new Error(`no asset facts for ${asset}`);
      }
      inputs.push({ facts, raw });
    }
    const valued = valuePositions(inputs, at, core.prices);
    const issues: ValuationIssue[] = [...valued.issues];
    let netFlow: Rational | null = Rational.zero();
    for (const change of flowChanges) {
      const time = Date.parse(change.at);
      if (time <= previousTime || time > cutoff || change.flow === null) {
        continue;
      }
      const facts = core.assets.get(change.asset);
      if (facts === undefined) {
        throw new Error(`no asset facts for ${change.asset}`);
      }
      const { value, issue } = valueFlow(change, facts, core.prices);
      flows.push({
        at: change.at,
        kind: change.flow.kind,
        asset: change.asset,
        raw: change.deltaRaw.toString(),
        value: value === null ? null : value.toDecimal(VALUE_SCALE),
        ref: change.flow.ref,
      });
      if (value === null) {
        netFlow = null;
        if (issue !== null) {
          issues.push(issue);
        }
      } else if (netFlow !== null) {
        netFlow = netFlow.add(value);
      }
    }
    let complete = valued.complete && netFlow !== null;
    let index: Rational | null = null;
    if (complete && valued.value !== null) {
      if (points.length === 0) {
        index = INDEX_START;
      } else if (previousComplete && previousValue !== null && netFlow !== null) {
        if (!previousValue.isPositive()) {
          issues.push({
            code: 'zero_base',
            asset: null,
            detail: 'the previous valuation is not positive; no return can be chained through it',
          });
          complete = false;
        } else if (previousIndex !== null) {
          const growth = valued.value.subtract(netFlow).divide(previousValue);
          index = previousIndex.multiply(growth);
        }
      }
    }
    points.push({
      at: at.toISOString(),
      value: valued.value === null ? null : valued.value.toDecimal(VALUE_SCALE),
      complete,
      netFlow: netFlow === null ? null : netFlow.toDecimal(VALUE_SCALE),
      index: index === null ? null : index.toDecimal(RETURN_SCALE),
      issues,
      caveats: dedupeCaveats([...valued.caveats, ...core.caveats]),
    });
    latest = valued.positions;
    previousTime = cutoff;
    previousValue = valued.value;
    previousIndex = index;
    previousComplete = complete;
  }
  return {
    kind: core.kind,
    subject: core.subject,
    methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
    currency: VALUATION_CURRENCY,
    start: start.toISOString(),
    end: end.toISOString(),
    points,
    flows,
    latest: [...latest],
  };
}

export interface ActualSeriesInput {
  readonly subject: SeriesSubject;
  readonly assets: ReadonlyMap<string, AssetFacts>;
  readonly changes: readonly BalanceChange[];
  readonly prices: PriceLookup;
  readonly end: Date;
  readonly start?: Date | null;
}

/** A person's executed holdings: the journal's balance changes, external flows valued at their time. */
export function buildActualSeries(input: ActualSeriesInput): PerformanceSeries {
  return buildSeries({
    kind: 'actual',
    subject: input.subject,
    assets: input.assets,
    changes: input.changes,
    prices: input.prices,
    start: input.start ?? null,
    end: input.end,
    caveats: [],
  });
}

export interface ModelLeg {
  readonly facts: AssetFacts;
  readonly weightBps: number;
}

export interface ModelSeriesInput {
  readonly subject: SeriesSubject;
  readonly legs: readonly ModelLeg[];
  /** The cash allocation held as the stablecoin at its resolved price (par without an observation). */
  readonly cash: { readonly facts: AssetFacts; readonly weightBps: number } | null;
  readonly frozenAt: Date;
  readonly end: Date;
  readonly prices: PriceLookup;
  /** Opening notional in the valuation currency; the series is an index, so it only fixes rounding. */
  readonly notional?: string;
}

export const MODEL_NOTIONAL = '10000';
export const MODEL_CAVEATS: readonly ValuationCaveatCode[] = [
  'model_no_costs',
  'model_buy_and_hold',
];
const TOTAL_BPS = 10_000n;

/**
 * A published recipe held from its start: whole base units bought at the
 * first time at or after the freeze where every leg is priced and every
 * multiplier known, then held unchanged (no rebalancing, no fees, no
 * slippage). A split changes the multiplier and the price together and
 * leaves the value alone.
 */
export function buildModelSeries(input: ModelSeriesInput): PerformanceSeries {
  const subject = input.subject;
  const notional = Rational.fromDecimal(input.notional ?? MODEL_NOTIONAL);
  const assets = new Map<string, AssetFacts>();
  for (const leg of input.legs) {
    assets.set(leg.facts.asset, leg.facts);
  }
  if (input.cash !== null) {
    assets.set(input.cash.facts.asset, input.cash.facts);
  }
  const candidates = gridTimes(input.frozenAt, input.end);
  for (const start of candidates) {
    const changes: BalanceChange[] = [];
    let priced = true;
    for (const leg of input.legs) {
      const multiplier = multiplierAt(leg.facts, start);
      const resolved = input.prices.priceAt(leg.facts.asset, start);
      if (multiplier === null || !resolved.ok || !resolved.value.isPositive()) {
        priced = false;
        break;
      }
      // weight × notional / (price × multiplier) scaled units of 10^decimals, as whole base units.
      const raw = Rational.of(BigInt(leg.weightBps), TOTAL_BPS)
        .multiply(notional)
        .multiply(Rational.of(10n ** BigInt(leg.facts.decimals)))
        .divide(resolved.value.multiply(multiplier))
        .toBigInt('half_even');
      changes.push({ at: start.toISOString(), asset: leg.facts.asset, deltaRaw: raw, flow: null });
    }
    if (!priced) {
      continue;
    }
    if (input.cash !== null) {
      const resolved = input.prices.priceAt(input.cash.facts.asset, start);
      if (!resolved.ok) {
        continue;
      }
      const raw = Rational.of(BigInt(input.cash.weightBps), TOTAL_BPS)
        .multiply(notional)
        .multiply(Rational.of(10n ** BigInt(input.cash.facts.decimals)))
        .divide(resolved.value)
        .toBigInt('half_even');
      changes.push({
        at: start.toISOString(),
        asset: input.cash.facts.asset,
        deltaRaw: raw,
        flow: null,
      });
    }
    return buildSeries({
      kind: 'model',
      subject,
      assets,
      changes,
      prices: input.prices,
      start,
      end: input.end,
      caveats: MODEL_CAVEATS,
    });
  }
  return {
    kind: 'model',
    subject,
    methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
    currency: VALUATION_CURRENCY,
    start: null,
    end: input.end.toISOString(),
    points: [],
    flows: [],
    latest: [],
  };
}
