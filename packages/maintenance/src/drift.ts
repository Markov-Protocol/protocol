import type { InstanceAllocation, OccurrenceReason, RebalanceLeg } from '@markov/contracts';

/**
 * Drift decisions and reviewed rebalance sizing (B16). A decision proposes a
 * rebalance review only when the allocation is complete, the largest drift
 * exceeds the threshold, no rebalance proposal is already open and the last
 * one is older than the minimum interval. Sizing turns the allocation into
 * ordinary sell and buy legs the owner reviews one intent at a time.
 */

export interface DriftDecisionInput {
  readonly allocation: InstanceAllocation;
  /** The schedule's threshold, or null to use the creator's suggestion carried on the allocation. */
  readonly thresholdBps: number | null;
  readonly lastProposalAt: Date | null;
  readonly minIntervalHours: number;
  readonly openProposalExists: boolean;
  readonly now: Date;
}

export interface DriftDecisionResult {
  readonly propose: boolean;
  readonly reason: OccurrenceReason | null;
  readonly thresholdBps: number | null;
  readonly largestDriftBps: number | null;
}

export function decideDrift(input: DriftDecisionInput): DriftDecisionResult {
  const thresholdBps = input.thresholdBps ?? input.allocation.driftThresholdBps;
  const largestDriftBps = input.allocation.largestDriftBps;
  if (thresholdBps === null) {
    return { propose: false, reason: 'threshold_unset', thresholdBps, largestDriftBps };
  }
  if (!input.allocation.complete || largestDriftBps === null) {
    return { propose: false, reason: 'target_unavailable', thresholdBps, largestDriftBps };
  }
  if (input.openProposalExists) {
    return { propose: false, reason: 'open_proposal_exists', thresholdBps, largestDriftBps };
  }
  if (
    input.lastProposalAt !== null &&
    input.now.getTime() - input.lastProposalAt.getTime() < input.minIntervalHours * 3_600_000
  ) {
    return { propose: false, reason: 'within_min_interval', thresholdBps, largestDriftBps };
  }
  if (largestDriftBps <= thresholdBps) {
    return { propose: false, reason: 'no_drift', thresholdBps, largestDriftBps };
  }
  return { propose: true, reason: null, thresholdBps, largestDriftBps };
}

/** Decimal strings are handled as integers scaled by 10^18: exact for every value this platform produces. */
const SCALE = 18n;
const SCALE_FACTOR = 10n ** SCALE;

export function decimalToScaled(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = `${whole}${fraction.padEnd(Number(SCALE), '0').slice(0, Number(SCALE))}`;
  const scaled = BigInt(digits.replace(/^0+(?=\d)/, '') || '0');
  return negative ? -scaled : scaled;
}

export function scaledToDecimal(value: bigint, fractionDigits = 6): string {
  const negative = value < 0n;
  const unsigned = negative ? -value : value;
  const whole = unsigned / SCALE_FACTOR;
  const fraction = (unsigned % SCALE_FACTOR).toString().padStart(Number(SCALE), '0');
  const trimmed = fraction.slice(0, fractionDigits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${trimmed.length > 0 ? `.${trimmed}` : ''}`;
}

export interface RebalanceSizingOptions {
  /** Decimals of the platform stablecoin buys are denominated in. */
  readonly stablecoinDecimals: number;
  /** Legs below this share of the invested total are dust and stay untouched (basis points). */
  readonly dustBps?: number;
}

/**
 * Sizes the legs that bring each constituent back to its invested target:
 * a constituent above target sells the excess (raw instrument units), one
 * below target buys the shortfall (raw stablecoin units). Rows the recipe
 * does not name are left alone. Returns no legs for an incomplete
 * allocation. Sells come first so the buys can be paid from them.
 */
export function sizeRebalanceLegs(
  allocation: InstanceAllocation,
  options: RebalanceSizingOptions,
): RebalanceLeg[] {
  if (!allocation.complete || allocation.totalValue === null) {
    return [];
  }
  const total = decimalToScaled(allocation.totalValue);
  if (total <= 0n) {
    return [];
  }
  const dustBps = BigInt(options.dustBps ?? 25);
  const stableFactor = 10n ** BigInt(options.stablecoinDecimals);
  const sells: RebalanceLeg[] = [];
  const buys: RebalanceLeg[] = [];
  for (const row of allocation.rows) {
    if (
      row.instrumentId === null ||
      row.value === null ||
      row.driftBps === null ||
      row.investedTargetBps === 0
    ) {
      continue;
    }
    const value = decimalToScaled(row.value);
    const target = (total * BigInt(row.investedTargetBps)) / 10_000n;
    const diff = value - target;
    const magnitude = diff < 0n ? -diff : diff;
    if (magnitude * 10_000n <= total * dustBps) {
      continue;
    }
    if (diff > 0n) {
      // Sell the share of the holding that exceeds the target, floored to whole raw units.
      const attributed = BigInt(row.attributedRaw);
      if (attributed <= 0n || value <= 0n) {
        continue;
      }
      const rawAmount = (attributed * diff) / value;
      if (rawAmount <= 0n) {
        continue;
      }
      sells.push({
        instrumentId: row.instrumentId,
        symbol: row.symbol,
        side: 'sell',
        driftBps: row.driftBps,
        rawAmount: rawAmount.toString(),
        value: scaledToDecimal(diff),
      });
    } else {
      const rawAmount = (magnitude * stableFactor) / SCALE_FACTOR;
      if (rawAmount <= 0n) {
        continue;
      }
      buys.push({
        instrumentId: row.instrumentId,
        symbol: row.symbol,
        side: 'buy',
        driftBps: row.driftBps,
        rawAmount: rawAmount.toString(),
        value: scaledToDecimal(magnitude),
      });
    }
  }
  return [...sells, ...buys];
}

/** Stable identity of a drift check: one proposal per schedule and interval bucket. */
export function driftDedupKey(scheduleId: string, sequence: number): string {
  return `drift:${scheduleId}:${sequence}`;
}
