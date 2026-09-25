import {
  type Holding,
  type InstanceHoldingsResponse,
  type JournalAttribution,
  type JournalEntry,
  type MetricUnavailableReason,
  type PerformancePeriod,
  type PerformanceSeries,
  type PricePoint,
  RETURN_SCALE,
  type ReceiptBody,
  VALUE_SCALE,
  type ValuationPoint,
  type ValuationPosition,
  type WindowMetrics,
} from '@markov/contracts';
import { formatDecimalString, formatInstant, formatRawAmount } from '@markov/formatters';

/**
 * Pure portfolio arithmetic and wording. Every figure that reaches a screen
 * comes from the API's canonical DTOs; this module only combines them
 * exactly (BigInt on the API's own scales), never re-values a position,
 * never multiplies a valuation by a multiplier the API already applied,
 * and states what is unknown instead of filling it in.
 */

/* ------------------------------------------------------- exact decimals */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** A decimal string as an integer at `scale` fraction digits; refuses more digits than the scale (nothing is rounded silently). */
export function parseScaled(value: string, scale: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) {
    throw new TypeError(`not a decimal string: ${value}`);
  }
  const [, sign, integer = '0', fraction = ''] = match;
  if (fraction.length > scale) {
    throw new RangeError(`${value} has more than ${scale} fraction digits`);
  }
  const scaled =
    BigInt(integer) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  return sign ? -scaled : scaled;
}

/** The integer at `scale` back to a canonical decimal string with exactly `scale` fraction digits. */
export function scaledToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${integer}${scale > 0 ? `.${fraction}` : ''}`;
}

/** Exact sum of decimal strings at the valuation scale; null when any addend is unknown. */
export function addDecimals(
  values: readonly (string | null)[],
  scale: number = VALUE_SCALE,
): string | null {
  let total = 0n;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    total += parseScaled(value, scale);
  }
  return scaledToDecimal(total, scale);
}

/** Trim trailing fraction zeros ("300.000000" → "300", "1.500000" → "1.5"). */
export function trimDecimal(value: string): string {
  if (!value.includes('.')) {
    return value;
  }
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * raw × multiplier ÷ 10^decimals, exact. The multiplier is the one the API
 * reports for the point (`1` for an unscaled token); null when it is
 * unknown, in which case no quantity is claimed.
 */
export function displayQuantity(
  raw: string,
  decimals: number,
  multiplier: string | null,
): string | null {
  if (multiplier === null) {
    return null;
  }
  const match = DECIMAL.exec(multiplier);
  if (!match) {
    throw new TypeError(`not a decimal multiplier: ${multiplier}`);
  }
  const [, sign, integer = '0', fraction = ''] = match;
  const numerator = BigInt(integer + fraction) * BigInt(raw);
  const scale = decimals + fraction.length;
  const signed = sign ? -numerator : numerator;
  return trimDecimal(scaledToDecimal(signed, scale));
}

function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  // Half-up rounding for positive denominators, exact in BigInt.
  const twice = numerator * 2n + (numerator < 0n ? -denominator : denominator);
  return twice / (denominator * 2n);
}

/** A valuation ("5007.500000") as money with two fraction digits, rounded half-up; the exact string stays in the inspection panel. */
export function formatValue(value: string | null, currency = 'USD'): string {
  if (value === null) {
    return 'Unpriced';
  }
  const negative = value.startsWith('-');
  const magnitude = formatDecimalString(negative ? value.slice(1) : value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    rounding: 'half-up',
  });
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${negative ? '-' : ''}${symbol}${magnitude}`;
}

/** A return fraction ("0.03500000") as a signed percentage with two fraction digits, half-up. */
export function formatReturn(fraction: string | null): string {
  if (fraction === null) {
    return 'Not reported';
  }
  const scaled = parseScaled(fraction, RETURN_SCALE);
  const percent = scaledToDecimal(scaled * 100n, RETURN_SCALE);
  const negative = percent.startsWith('-');
  const magnitude = formatDecimalString(negative ? percent.slice(1) : percent, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    rounding: 'half-up',
  });
  return `${negative ? '-' : '+'}${magnitude}%`;
}

export function formatBps(bps: number): string {
  const negative = bps < 0;
  const magnitude = Math.abs(bps);
  const integer = Math.floor(magnitude / 100);
  const fraction = String(magnitude % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}%`;
}

/* ---------------------------------------------------------- quantities */

export interface QuantityDisplay {
  /** What to show; base units when the multiplier is unknown. */
  readonly text: string;
  readonly scaled: boolean;
  readonly multiplier: string | null;
  readonly note: string | null;
}

/**
 * The quantity of a holding for display. With the API's valuation position
 * the multiplier in force is known and the scaled quantity is exact; without
 * it only the base units are known and they are shown as such.
 */
export function quantityDisplay(
  raw: string,
  decimals: number,
  position: ValuationPosition | null,
): QuantityDisplay {
  const multiplier = position?.multiplier ?? null;
  const quantity = displayQuantity(raw, decimals, multiplier);
  if (quantity === null) {
    return {
      text: `${formatRawAmount(raw.startsWith('-') ? raw.slice(1) : raw, 0)} base units`,
      scaled: false,
      multiplier: null,
      note:
        position === null
          ? 'multiplier not confirmed for this point; base units shown'
          : 'multiplier unknown at this point; base units shown',
    };
  }
  const negative = quantity.startsWith('-');
  const text = `${negative ? '-' : ''}${formatDecimalString(negative ? quantity.slice(1) : quantity)}`;
  return {
    text,
    scaled: true,
    multiplier,
    note: multiplier === '1' ? null : `×${trimDecimal(multiplier as string)} multiplier applied`,
  };
}

/* ------------------------------------------------------------ holdings */

export const HOLDING_STATUS_LABELS: Record<Holding['status'], string> = {
  matched: 'Matched',
  unobserved: 'Not yet observed',
  stale: 'Stale observation',
  needs_reconciliation: 'Needs reconciliation',
  unassigned_asset: 'Unexplained asset',
};

export type HoldingTone = 'success' | 'neutral' | 'attention' | 'error' | 'pending';

export const HOLDING_STATUS_TONES: Record<Holding['status'], HoldingTone> = {
  matched: 'success',
  unobserved: 'neutral',
  stale: 'attention',
  needs_reconciliation: 'attention',
  unassigned_asset: 'error',
};

export interface AttributionShare {
  readonly attribution: JournalAttribution;
  readonly instanceId: string | null;
  readonly label: string;
  readonly raw: string;
}

export interface HoldingRow {
  readonly asset: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly status: Holding['status'];
  readonly statusLabel: string;
  readonly tone: HoldingTone;
  readonly ledgerRaw: string;
  readonly chainRaw: string | null;
  readonly differenceRaw: string | null;
  readonly observedAt: string | null;
  readonly quantity: QuantityDisplay;
  /** The API's valuation of the position; null with the reason when unpriced. */
  readonly value: string | null;
  readonly valueNote: string | null;
  readonly price: PricePoint | null;
  readonly attribution: readonly AttributionShare[];
}

function positionFor(
  positions: readonly ValuationPosition[] | null,
  asset: string,
): ValuationPosition | null {
  return positions?.find((position) => position.asset === asset) ?? null;
}

function attributionLabel(
  share: Holding['attribution'][number],
  labels: ReadonlyMap<string, string>,
): string {
  if (share.attribution === 'instance') {
    return share.instanceId ? (labels.get(share.instanceId) ?? 'Strategy instance') : 'Strategy';
  }
  return share.attribution === 'unassigned' ? 'Wallet (no strategy)' : 'Awaiting explanation';
}

/** Holdings with the valuation the API attached to the same assets; wallet totals stay separate from strategy totals. */
export function holdingRows(
  holdings: readonly Holding[],
  positions: readonly ValuationPosition[] | null,
  labels: ReadonlyMap<string, string> = new Map(),
): readonly HoldingRow[] {
  return holdings.map((holding) => {
    const position = positionFor(positions, holding.asset);
    const issue = position?.issues[0] ?? null;
    return {
      asset: holding.asset,
      symbol: holding.symbol,
      decimals: holding.decimals,
      status: holding.status,
      statusLabel: HOLDING_STATUS_LABELS[holding.status],
      tone: HOLDING_STATUS_TONES[holding.status],
      ledgerRaw: holding.ledgerRaw,
      chainRaw: holding.chainRaw,
      differenceRaw: holding.differenceRaw,
      observedAt: holding.observedAt,
      quantity: quantityDisplay(holding.ledgerRaw, holding.decimals, position),
      value: position?.value ?? null,
      valueNote:
        position === null
          ? 'not valued: no valuation point covers this asset'
          : position.value === null
            ? (issue?.detail ?? 'unpriced at the latest point')
            : null,
      price: position?.price ?? null,
      attribution: holding.attribution.map((share) => ({
        attribution: share.attribution,
        instanceId: share.instanceId,
        label: attributionLabel(share, labels),
        raw: share.raw,
      })),
    };
  });
}

/** The wallet's valued total: the sum of the API's position values, or null with the assets that are unpriced. */
export function valuedTotal(rows: readonly HoldingRow[]): {
  readonly value: string | null;
  readonly unpriced: readonly string[];
} {
  const unpriced = rows.filter((row) => row.value === null).map((row) => row.symbol);
  return {
    value: unpriced.length > 0 ? null : addDecimals(rows.map((row) => row.value)),
    unpriced,
  };
}

/* --------------------------------------------------------- allocations */

export interface AllocationLeg {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly mint: string;
  readonly weightBps: number;
}

export interface AllocationRow {
  readonly symbol: string;
  readonly mint: string;
  /** The recipe's weight of the whole basket, cash included. */
  readonly targetBps: number;
  /** The recipe's weight among the invested legs (cash excluded), which is what the instance can hold. */
  readonly investedTargetBps: number;
  readonly attributedRaw: string;
  readonly quantity: QuantityDisplay;
  readonly value: string | null;
  readonly actualBps: number | null;
  readonly driftBps: number | null;
  readonly note: string | null;
}

export interface AllocationSummary {
  readonly rows: readonly AllocationRow[];
  readonly cashBps: number;
  readonly totalValue: string | null;
  readonly complete: boolean;
  readonly largestDriftBps: number | null;
  readonly reasons: readonly string[];
}

/**
 * Target against actual for one instance. Actual weights are shares of the
 * instance's own valued holdings; the recipe's cash share is held in the
 * wallet and not attributed, so targets are compared among the invested
 * legs. Any unpriced leg leaves every actual weight and drift unknown.
 */
export function allocationSummary(input: {
  readonly legs: readonly AllocationLeg[];
  readonly cashWeightBps: number;
  readonly holdings: InstanceHoldingsResponse['holdings'];
  readonly positions: readonly ValuationPosition[] | null;
}): AllocationSummary {
  const investedBps = 10_000 - input.cashWeightBps;
  const reasons: string[] = [];
  const byAsset = new Map(input.holdings.map((holding) => [holding.asset, holding]));
  const legRows = input.legs.map((leg) => {
    const holding = byAsset.get(leg.mint) ?? null;
    const position = positionFor(input.positions, leg.mint);
    const raw = holding?.attributedRaw ?? '0';
    const decimals = holding?.decimals ?? position?.decimals ?? 0;
    const value = holding === null ? '0.000000' : (position?.value ?? null);
    if (holding !== null && value === null) {
      reasons.push(
        `${leg.symbol}: ${position?.issues[0]?.detail ?? 'unpriced at the latest point'}`,
      );
    }
    return {
      leg,
      raw,
      decimals,
      position: holding === null ? null : position,
      value,
      held: holding !== null,
    };
  });
  const extras = input.holdings
    .filter((holding) => !input.legs.some((leg) => leg.mint === holding.asset))
    .map((holding) => {
      const position = positionFor(input.positions, holding.asset);
      if (position?.value === null || position === null) {
        reasons.push(`${holding.symbol}: unpriced at the latest point`);
      }
      return { holding, position, value: position?.value ?? null };
    });
  const values = [...legRows.map((row) => row.value), ...extras.map((row) => row.value)];
  const totalValue = addDecimals(values);
  const total = totalValue === null ? null : parseScaled(totalValue, VALUE_SCALE);
  const complete = total !== null;
  const actualOf = (value: string | null): number | null =>
    total === null || total === 0n || value === null
      ? null
      : Number(roundedDiv(parseScaled(value, VALUE_SCALE) * 10_000n, total));
  const rows: AllocationRow[] = legRows.map(({ leg, raw, decimals, position, value, held }) => {
    const investedTargetBps =
      investedBps === 0
        ? 0
        : Number(roundedDiv(BigInt(leg.weightBps) * 10_000n, BigInt(investedBps)));
    const actualBps = actualOf(value);
    return {
      symbol: leg.symbol,
      mint: leg.mint,
      targetBps: leg.weightBps,
      investedTargetBps,
      attributedRaw: raw,
      quantity: held
        ? quantityDisplay(raw, decimals, position)
        : { text: '0', scaled: true, multiplier: '1', note: null },
      value,
      actualBps,
      driftBps: actualBps === null ? null : actualBps - investedTargetBps,
      note: held ? null : 'not held by this instance',
    };
  });
  for (const { holding, position, value } of extras) {
    const actualBps = actualOf(value);
    rows.push({
      symbol: holding.symbol,
      mint: holding.asset,
      targetBps: 0,
      investedTargetBps: 0,
      attributedRaw: holding.attributedRaw,
      quantity: quantityDisplay(holding.attributedRaw, holding.decimals, position),
      value,
      actualBps,
      driftBps: actualBps,
      note: 'not in the pinned recipe',
    });
  }
  if (total === 0n) {
    reasons.push('nothing valued yet: the instance holds no priced position');
  }
  const drifts = rows.map((row) => row.driftBps).filter((drift): drift is number => drift !== null);
  return {
    rows,
    cashBps: input.cashWeightBps,
    totalValue,
    complete: complete && total !== 0n,
    largestDriftBps:
      drifts.length === 0 ? null : Math.max(...drifts.map((drift) => Math.abs(drift))),
    reasons,
  };
}

/* --------------------------------------------------------- performance */

export const PERIOD_LABELS: Record<PerformancePeriod, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '365d': '1 year',
  all: 'Since start',
};

export const REASON_TEXT: Record<MetricUnavailableReason, string> = {
  no_series: 'nothing to measure yet: the series has no start',
  insufficient_history: 'the history is shorter than this period',
  incomplete_points: 'some points of the window could not be valued',
  zero_base: 'the window starts from a zero valuation',
  unpriced_flow: 'a flow in the window could not be valued',
  stale_end: 'the latest price is older than the methodology allows',
};

export function seriesLabel(series: PerformanceSeries): string {
  const kind = series.kind === 'model' ? 'Model (buy and hold)' : 'Personal (actual)';
  return `${kind} · ${series.methodologyVersion} · ${series.currency}`;
}

export interface MetricLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** The exact string behind the display, for inspection. */
  readonly exact: string | null;
  readonly note: string | null;
}

function unavailableNote(metrics: WindowMetrics): string | null {
  if (metrics.available) {
    return null;
  }
  const reasons = metrics.reasons.map((reason) => REASON_TEXT[reason]);
  return reasons.length > 0 ? reasons.join('; ') : 'not reported';
}

/** The window's figures as labelled lines; every unknown is stated with its reason, never as zero. */
export function metricLines(metrics: WindowMetrics, currency = 'USD'): readonly MetricLine[] {
  const note = unavailableNote(metrics);
  const money = (value: string | null) => formatValue(value, currency);
  return [
    {
      key: 'twr',
      label: 'Time-weighted return',
      value: formatReturn(metrics.timeWeightedReturn),
      exact: metrics.timeWeightedReturn,
      note:
        metrics.timeWeightedReturn === null
          ? note
          : 'deposits and withdrawals are flows, never return',
    },
    {
      key: 'mwr',
      label: 'Money-weighted return',
      value: formatReturn(metrics.moneyWeightedReturn),
      exact: metrics.moneyWeightedReturn,
      note: metrics.moneyWeightedReturn === null ? note : 'Modified Dietz over the window',
    },
    {
      key: 'drawdown',
      label: 'Largest drawdown',
      value:
        metrics.maxDrawdown === null
          ? 'Not reported'
          : `${formatReturn(metrics.maxDrawdown.value).replace('+', '-')}`,
      exact: metrics.maxDrawdown?.value ?? null,
      note:
        metrics.maxDrawdown === null
          ? note
          : `peak ${formatInstant(metrics.maxDrawdown.peakAt)} UTC, trough ${formatInstant(metrics.maxDrawdown.troughAt)} UTC`,
    },
    {
      key: 'start',
      label: 'Value at start',
      value: money(metrics.startValue),
      exact: metrics.startValue,
      note: metrics.start ? `${formatInstant(metrics.start)} UTC` : note,
    },
    {
      key: 'end',
      label: 'Value at end',
      value: money(metrics.endValue),
      exact: metrics.endValue,
      note: `${formatInstant(metrics.end)} UTC`,
    },
    {
      key: 'flows',
      label: 'Net external flows',
      value: money(metrics.netFlows),
      exact: metrics.netFlows,
      note: 'money that entered or left; counted in value, never in return',
    },
    {
      key: 'realized',
      label: 'Realized P&L',
      value: money(metrics.realizedPnl),
      exact: metrics.realizedPnl,
      note: 'from FIFO lots (bookkeeping, not tax advice)',
    },
    {
      key: 'unrealized',
      label: 'Unrealized P&L',
      value: money(metrics.unrealizedPnl),
      exact: metrics.unrealizedPnl,
      note: 'open lots at the end valuation against their cost',
    },
    {
      key: 'fees',
      label: 'Network fees',
      value: `${formatRawAmount(metrics.fees.lamports, 9)} SOL${metrics.fees.value === null ? '' : ` (${money(metrics.fees.value)})`}`,
      exact: metrics.fees.lamports,
      note: metrics.fees.value === null ? 'not valued: no SOL price at the end' : null,
    },
    {
      key: 'turnover',
      label: 'Turnover',
      value:
        metrics.turnover === null
          ? 'Not reported'
          : formatReturn(metrics.turnover).replace('+', ''),
      exact: metrics.turnover,
      note: 'traded value over the average valuation',
    },
    {
      key: 'completeness',
      label: 'Completeness',
      value: `${metrics.completeness.completePoints} of ${metrics.completeness.expectedPoints} points`,
      exact: metrics.completeness.ratio,
      note: `${metrics.completeness.historyDays} days of history; latest price ${metrics.completeness.endFresh ? 'fresh' : 'stale'}`,
    },
  ];
}

export interface ChartExtreme {
  readonly at: string;
  readonly value: string;
}

export interface ChartSummary {
  readonly points: number;
  readonly complete: number;
  readonly first: ChartExtreme | null;
  readonly last: ChartExtreme | null;
  readonly lowest: ChartExtreme | null;
  readonly highest: ChartExtreme | null;
  readonly flows: number;
  /** One sentence a screen reader can read instead of the drawing. */
  readonly text: string;
}

/** What the chart shows, in words and exact figures. */
export function chartSummary(series: PerformanceSeries, currency = 'USD'): ChartSummary {
  const valued = series.points.filter(
    (point): point is ValuationPoint & { value: string } => point.value !== null,
  );
  let lowest: ChartExtreme | null = null;
  let highest: ChartExtreme | null = null;
  for (const point of valued) {
    const scaled = parseScaled(point.value, VALUE_SCALE);
    if (lowest === null || scaled < parseScaled(lowest.value, VALUE_SCALE)) {
      lowest = { at: point.at, value: point.value };
    }
    if (highest === null || scaled > parseScaled(highest.value, VALUE_SCALE)) {
      highest = { at: point.at, value: point.value };
    }
  }
  const first = valued[0] ? { at: valued[0].at, value: valued[0].value } : null;
  const lastPoint = valued[valued.length - 1];
  const last = lastPoint ? { at: lastPoint.at, value: lastPoint.value } : null;
  const incomplete = series.points.length - valued.length;
  const text =
    series.points.length === 0 || first === null || last === null
      ? 'No valued points: nothing is drawn.'
      : `${series.points.length} points from ${formatInstant(series.points[0]?.at ?? first.at)} to ${formatInstant(series.end)} UTC; value ${formatValue(first.value, currency)} at the start and ${formatValue(last.value, currency)} at the end; lowest ${formatValue(lowest?.value ?? null, currency)}, highest ${formatValue(highest?.value ?? null, currency)}${incomplete > 0 ? `; ${incomplete} point${incomplete === 1 ? '' : 's'} could not be valued` : ''}${series.flows.length > 0 ? `; ${series.flows.length} external flow${series.flows.length === 1 ? '' : 's'}` : ''}.`;
  return {
    points: series.points.length,
    complete: valued.length,
    first,
    last,
    lowest,
    highest,
    flows: series.flows.length,
    text,
  };
}

export interface Sparkline {
  /** SVG path over the valued points; a gap breaks the line. */
  readonly path: string;
  readonly gaps: number;
}

/** A drawing of the valued points on a width × height box; unvalued points break the line instead of being bridged. */
export function sparkline(
  points: readonly ValuationPoint[],
  width: number,
  height: number,
): Sparkline {
  const valued = points
    .map((point, index) => ({ index, value: point.value }))
    .filter((point): point is { index: number; value: string } => point.value !== null);
  if (valued.length === 0 || points.length === 0) {
    return { path: '', gaps: points.length };
  }
  const scaled = valued.map(
    (point) => Number(parseScaled(point.value, VALUE_SCALE)) / 10 ** VALUE_SCALE,
  );
  const min = Math.min(...scaled);
  const max = Math.max(...scaled);
  const span = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  let path = '';
  let gaps = 0;
  let previousIndex = -2;
  valued.forEach((point, position) => {
    const x = (points.length > 1 ? point.index * stepX : width / 2).toFixed(2);
    const y = (height - (((scaled[position] as number) - min) / span) * height).toFixed(2);
    const contiguous = point.index === previousIndex + 1;
    if (!contiguous && previousIndex >= 0) {
      gaps += 1;
    }
    path += `${contiguous ? 'L' : 'M'}${x} ${y} `;
    previousIndex = point.index;
  });
  return { path: path.trim(), gaps };
}

/* ------------------------------------------------------------- journal */

export const ENTRY_KIND_LABELS: Record<JournalEntry['kind'], string> = {
  fill: 'Fill',
  network_fee: 'Network fee',
  rent: 'Rent',
  external_inflow: 'Inflow from outside Markov',
  external_outflow: 'Outflow from this wallet',
  correction: 'Correction',
  lifecycle_adjustment: 'Corporate action adjustment',
};

export interface JournalRow {
  readonly entryId: string;
  readonly instanceId: string | null;
  readonly occurredAt: string;
  readonly kind: JournalEntry['kind'];
  readonly kindLabel: string;
  readonly description: string;
  readonly attribution: JournalAttribution;
  readonly attributionLabel: string;
  readonly needsAcknowledgement: boolean;
  readonly acknowledgement: string | null;
  readonly memo: string;
  readonly sourceRef: string;
  readonly lines: JournalEntry['lines'];
}

function signedAmount(deltaRaw: string, decimals: number, symbol: string): string {
  const negative = deltaRaw.startsWith('-');
  const magnitude = negative ? deltaRaw.slice(1) : deltaRaw;
  return `${negative ? '-' : '+'}${formatRawAmount(magnitude, decimals)} ${symbol}`;
}

/** The wallet-side movements of an entry in words; base units divided by the token's decimals, no multiplier. */
export function describeEntry(entry: JournalEntry): string {
  const wallet = entry.lines.filter((line) => line.account === 'wallet');
  const movements = wallet.map((line) => signedAmount(line.deltaRaw, line.decimals, line.symbol));
  if (movements.length === 0) {
    const first = entry.lines[0];
    return first
      ? `${ENTRY_KIND_LABELS[entry.kind]}: ${signedAmount(first.deltaRaw, first.decimals, first.symbol)} (${first.account.replace('_', ' ')})`
      : ENTRY_KIND_LABELS[entry.kind];
  }
  return `${ENTRY_KIND_LABELS[entry.kind]}: ${movements.join(', ')}`;
}

const ACKNOWLEDGEMENT_LABELS = {
  deposit: 'a deposit',
  withdrawal: 'a withdrawal',
  transfer: 'a transfer you made',
  other: 'explained otherwise',
} as const;

/** Journal entries newest first, with what each one moved and whether the owner still has to explain it. */
export function journalRows(
  entries: readonly JournalEntry[],
  labels: ReadonlyMap<string, string> = new Map(),
): readonly JournalRow[] {
  return [...entries]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .map((entry) => ({
      entryId: entry.entryId,
      instanceId: entry.instanceId,
      occurredAt: entry.occurredAt,
      kind: entry.kind,
      kindLabel: ENTRY_KIND_LABELS[entry.kind],
      description: describeEntry(entry),
      attribution: entry.attribution,
      attributionLabel:
        entry.attribution === 'instance'
          ? (labels.get(entry.instanceId ?? '') ?? 'Strategy instance')
          : entry.attribution === 'unassigned'
            ? 'Wallet (no strategy)'
            : 'Awaiting your explanation',
      needsAcknowledgement:
        entry.attribution === 'needs_reconciliation' && entry.acknowledgement === null,
      acknowledgement: entry.acknowledgement
        ? `${ACKNOWLEDGEMENT_LABELS[entry.acknowledgement.kind]}${entry.acknowledgement.note ? ` (${entry.acknowledgement.note})` : ''}, ${formatInstant(entry.acknowledgement.acknowledgedAt)} UTC`
        : null,
      memo: entry.memo,
      sourceRef: `${entry.source.kind}:${entry.source.ref}`,
      lines: entry.lines,
    }));
}

/** The external flows the owner still has to explain. */
export function pendingFlows(entries: readonly JournalEntry[]): readonly JournalEntry[] {
  return entries.filter(
    (entry) => entry.attribution === 'needs_reconciliation' && entry.acknowledgement === null,
  );
}

/* ------------------------------------------------------------ receipts */

export interface ReceiptLegRow {
  readonly legIndex: number;
  readonly side: string;
  readonly approvedMaxInputRaw: string;
  readonly approvedMinimumOutputRaw: string;
  readonly filledInputRaw: string | null;
  readonly filledOutputRaw: string | null;
  readonly withinBounds: boolean | null;
  readonly signature: string | null;
  readonly status: 'filled' | 'not filled';
}

/** What was approved against what the chain recorded, leg by leg (raw units: the receipt carries no decimals). */
export function receiptLegRows(body: ReceiptBody): readonly ReceiptLegRow[] {
  return body.approved.legs.map((leg) => {
    const fill = body.fills.find((entry) => entry.legIndex === leg.legIndex) ?? null;
    return {
      legIndex: leg.legIndex,
      side: fill?.side ?? (body.subject.intentKind === 'single_sell' ? 'sell' : 'buy'),
      approvedMaxInputRaw: leg.maxInputRaw,
      approvedMinimumOutputRaw: leg.minimumOutputRaw,
      filledInputRaw: fill?.inputSpentRaw ?? null,
      filledOutputRaw: fill?.outputReceivedRaw ?? null,
      withinBounds: fill?.withinBounds ?? null,
      signature: fill?.signature ?? null,
      status: fill ? 'filled' : 'not filled',
    };
  });
}

/** Lamports actually spent across the fills against the approved network fee cap. */
export function receiptFeeSummary(body: ReceiptBody): {
  readonly spentLamports: string;
  readonly capLamports: string;
  readonly withinCap: boolean;
} {
  const spent = body.fills.reduce((sum, fill) => sum + BigInt(fill.feeLamports), 0n);
  const cap = BigInt(body.approved.networkFeeMaxLamports);
  return { spentLamports: spent.toString(), capLamports: cap.toString(), withinCap: spent <= cap };
}
