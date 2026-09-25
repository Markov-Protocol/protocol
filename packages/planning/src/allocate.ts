import type { BudgetMode } from '@markov/contracts';

/**
 * Integer base-unit allocation of a stablecoin budget across a recipe's
 * constituents and cash, by the largest-remainder method: every entry gets
 * floor(investable × weight / 10,000) and the units the floors leave over
 * go, one each, to the entries with the largest fractional remainders (ties
 * by position). The targets always sum to the investable amount exactly;
 * nothing is rounded away and no weight is ever changed on the person's
 * behalf. A budget too small for a route minimum is refused with the
 * smallest budget that would work instead of being reshaped.
 */
export const TOTAL_BPS = 10_000n;

export interface AllocationLegInput {
  readonly key: string;
  readonly weightBps: number;
  /** Route minimum for this leg's input, raw base units; null when the venue states none. */
  readonly minimumInputRaw: bigint | null;
}

export interface AllocationInput {
  readonly budgetRaw: bigint;
  readonly mode: BudgetMode;
  readonly legs: readonly AllocationLegInput[];
  readonly cashWeightBps: number;
  /** Stablecoin-denominated fees to set aside before allocating; 0 under the beta fee policy. */
  readonly feeReserveRaw: bigint;
}

export interface AllocationEntry {
  readonly key: string;
  readonly weightBps: number;
  readonly exactFloorRaw: bigint;
  readonly roundingRaw: bigint;
  readonly targetRaw: bigint;
}

export interface Allocation {
  readonly ok: true;
  readonly investableRaw: bigint;
  /** What leaves the wallet in stablecoin: the budget (all-in) or budget plus fee reserve (investable notional). */
  readonly totalSpendRaw: bigint;
  readonly feeReserveRaw: bigint;
  readonly legs: readonly AllocationEntry[];
  readonly cash: AllocationEntry;
  readonly sumRaw: bigint;
}

export interface AllocationRefusal {
  readonly ok: false;
  readonly code: 'WEIGHTS_TOTAL' | 'BUDGET_TOO_SMALL';
  readonly message: string;
  /** The smallest budget (same mode) that satisfies every minimum; null when weights are the problem. */
  readonly minimumBudgetRaw: bigint | null;
  readonly shortfalls: readonly { key: string; targetRaw: bigint; minimumInputRaw: bigint }[];
}

export type AllocationResult = Allocation | AllocationRefusal;

function ceilDiv(numerator: bigint, divisor: bigint): bigint {
  return (numerator + divisor - 1n) / divisor;
}

export function allocateBudget(input: AllocationInput): AllocationResult {
  const weightSum =
    input.legs.reduce((sum, leg) => sum + BigInt(leg.weightBps), 0n) + BigInt(input.cashWeightBps);
  if (weightSum !== TOTAL_BPS || input.legs.some((leg) => leg.weightBps <= 0)) {
    return {
      ok: false,
      code: 'WEIGHTS_TOTAL',
      message: `leg weights plus cash must equal exactly ${TOTAL_BPS} basis points with every leg above zero`,
      minimumBudgetRaw: null,
      shortfalls: [],
    };
  }
  if (input.budgetRaw < 0n || input.feeReserveRaw < 0n) {
    return {
      ok: false,
      code: 'BUDGET_TOO_SMALL',
      message: 'budget and fee reserve must be non-negative',
      minimumBudgetRaw: null,
      shortfalls: [],
    };
  }
  const investableRaw =
    input.mode === 'all_in_stablecoin' ? input.budgetRaw - input.feeReserveRaw : input.budgetRaw;
  // Smallest investable amount whose floors satisfy every route minimum.
  let minimumInvestable = 1n;
  for (const leg of input.legs) {
    if (leg.minimumInputRaw !== null && leg.minimumInputRaw > 0n) {
      minimumInvestable = max(
        minimumInvestable,
        ceilDiv(leg.minimumInputRaw * TOTAL_BPS, BigInt(leg.weightBps)),
      );
    }
  }
  const minimumBudgetRaw =
    input.mode === 'all_in_stablecoin'
      ? minimumInvestable + input.feeReserveRaw
      : minimumInvestable;
  if (investableRaw <= 0n) {
    return {
      ok: false,
      code: 'BUDGET_TOO_SMALL',
      message: 'nothing is left to invest after the fee reserve',
      minimumBudgetRaw,
      shortfalls: [],
    };
  }
  const entries: { key: string; weightBps: number }[] = [
    ...input.legs.map((leg) => ({ key: leg.key, weightBps: leg.weightBps })),
    { key: 'cash', weightBps: input.cashWeightBps },
  ];
  const floors = entries.map((entry) => (investableRaw * BigInt(entry.weightBps)) / TOTAL_BPS);
  const remainders = entries.map((entry) => (investableRaw * BigInt(entry.weightBps)) % TOTAL_BPS);
  let leftover = investableRaw - floors.reduce((sum, value) => sum + value, 0n);
  const order = entries
    .map((_, index) => index)
    .sort((a, b) => {
      const left = remainders[a] as bigint;
      const right = remainders[b] as bigint;
      if (left === right) {
        return a - b;
      }
      return right > left ? 1 : -1;
    });
  const rounding = entries.map(() => 0n);
  for (const index of order) {
    if (leftover === 0n) {
      break;
    }
    rounding[index] = 1n;
    leftover -= 1n;
  }
  const allocated: AllocationEntry[] = entries.map((entry, index) => ({
    key: entry.key,
    weightBps: entry.weightBps,
    exactFloorRaw: floors[index] as bigint,
    roundingRaw: rounding[index] as bigint,
    targetRaw: (floors[index] as bigint) + (rounding[index] as bigint),
  }));
  const cash = allocated[allocated.length - 1] as AllocationEntry;
  const legs = allocated.slice(0, -1);
  const shortfalls = input.legs.flatMap((leg, index) => {
    const target = (legs[index] as AllocationEntry).targetRaw;
    return leg.minimumInputRaw !== null && target < leg.minimumInputRaw
      ? [{ key: leg.key, targetRaw: target, minimumInputRaw: leg.minimumInputRaw }]
      : [];
  });
  if (shortfalls.length > 0) {
    return {
      ok: false,
      code: 'BUDGET_TOO_SMALL',
      message: `the budget is below the route minimum of ${shortfalls.length} constituent${shortfalls.length === 1 ? '' : 's'}; the weights were not changed`,
      minimumBudgetRaw,
      shortfalls,
    };
  }
  const sumRaw = allocated.reduce((sum, entry) => sum + entry.targetRaw, 0n);
  return {
    ok: true,
    investableRaw,
    totalSpendRaw:
      input.mode === 'all_in_stablecoin' ? input.budgetRaw : input.budgetRaw + input.feeReserveRaw,
    feeReserveRaw: input.feeReserveRaw,
    legs,
    cash,
    sumRaw,
  };
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
