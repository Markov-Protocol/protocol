import { describe, expect, it } from 'vitest';
import { allocateBudget, TOTAL_BPS } from '../src/index.js';

/** Deterministic linear congruential generator (no fast-check in the workspace). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

function randomWeights(next: () => number, count: number): number[] {
  // Random positive weights summing to exactly 10,000 (cash takes the remainder, at least 0).
  const cuts = new Set<number>();
  while (cuts.size < count) {
    cuts.add(1 + (next() % 9_999));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const weights: number[] = [];
  let previous = 0;
  for (const cut of sorted) {
    weights.push(cut - previous);
    previous = cut;
  }
  return weights; // sums to the last cut; cash = 10,000 − last cut
}

describe('allocateBudget', () => {
  it('conserves the investable amount exactly under largest-remainder rounding', () => {
    const next = lcg(20260925);
    for (let round = 0; round < 500; round += 1) {
      const count = 1 + (next() % 10);
      const weights = randomWeights(next, count);
      const cashWeightBps = 10_000 - weights.reduce((sum, w) => sum + w, 0);
      const budgetRaw = BigInt(next() % 1_000_000_007) * BigInt(1 + (next() % 1000));
      const result = allocateBudget({
        budgetRaw,
        mode: 'all_in_stablecoin',
        legs: weights.map((weightBps, index) => ({
          key: `leg-${index}`,
          weightBps,
          minimumInputRaw: null,
        })),
        cashWeightBps,
        feeReserveRaw: 0n,
      });
      if (!result.ok) {
        expect(budgetRaw).toBe(0n);
        continue;
      }
      const sum =
        result.legs.reduce((total, entry) => total + entry.targetRaw, 0n) + result.cash.targetRaw;
      expect(sum).toBe(budgetRaw);
      expect(result.sumRaw).toBe(budgetRaw);
      for (const entry of [...result.legs, result.cash]) {
        expect(entry.roundingRaw === 0n || entry.roundingRaw === 1n).toBe(true);
        expect(entry.targetRaw).toBe(entry.exactFloorRaw + entry.roundingRaw);
        // Never more than one unit away from the exact share.
        const exact = (budgetRaw * BigInt(entry.weightBps)) / TOTAL_BPS;
        expect(entry.targetRaw - exact <= 1n && entry.targetRaw - exact >= 0n).toBe(true);
      }
    }
  });

  it('is deterministic and gives the leftover units to the largest remainders, ties by position', () => {
    const legs = [
      { key: 'a', weightBps: 3_333, minimumInputRaw: null },
      { key: 'b', weightBps: 3_333, minimumInputRaw: null },
      { key: 'c', weightBps: 3_334, minimumInputRaw: null },
    ];
    const first = allocateBudget({
      budgetRaw: 100n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    const second = allocateBudget({
      budgetRaw: 100n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    expect(first).toEqual(second);
    if (!first.ok) {
      throw new Error('expected an allocation');
    }
    // floors: 33, 33, 33 (remainders 3300, 3300, 3400); one unit left → c (largest remainder).
    expect(first.legs.map((entry) => entry.targetRaw)).toEqual([33n, 33n, 34n]);
    const tie = allocateBudget({
      budgetRaw: 101n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    if (!tie.ok) {
      throw new Error('expected an allocation');
    }
    // floors: 33, 33, 33 (remainders 6633, 6633, 6734) → c first, then a by position.
    expect(tie.legs.map((entry) => entry.targetRaw)).toEqual([34n, 33n, 34n]);
  });

  it('keeps cash as an explicit entry and applies the budget modes', () => {
    const legs = [{ key: 'a', weightBps: 6_000, minimumInputRaw: null }];
    const allIn = allocateBudget({
      budgetRaw: 1_000n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 4_000,
      feeReserveRaw: 10n,
    });
    const notional = allocateBudget({
      budgetRaw: 1_000n,
      mode: 'investable_notional',
      legs,
      cashWeightBps: 4_000,
      feeReserveRaw: 10n,
    });
    if (!allIn.ok || !notional.ok) {
      throw new Error('expected allocations');
    }
    expect(allIn.investableRaw).toBe(990n);
    expect(allIn.totalSpendRaw).toBe(1_000n);
    expect(allIn.legs[0]?.targetRaw).toBe(594n);
    expect(allIn.cash.targetRaw).toBe(396n);
    expect(notional.investableRaw).toBe(1_000n);
    expect(notional.totalSpendRaw).toBe(1_010n);
    expect(notional.legs[0]?.targetRaw).toBe(600n);
    expect(notional.cash.key).toBe('cash');
  });

  it('refuses weights that do not total 10,000 or a zero leg', () => {
    const short = allocateBudget({
      budgetRaw: 1_000n,
      mode: 'all_in_stablecoin',
      legs: [{ key: 'a', weightBps: 5_000, minimumInputRaw: null }],
      cashWeightBps: 4_000,
      feeReserveRaw: 0n,
    });
    expect(short.ok).toBe(false);
    expect(!short.ok && short.code).toBe('WEIGHTS_TOTAL');
    const zero = allocateBudget({
      budgetRaw: 1_000n,
      mode: 'all_in_stablecoin',
      legs: [
        { key: 'a', weightBps: 0, minimumInputRaw: null },
        { key: 'b', weightBps: 10_000, minimumInputRaw: null },
      ],
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    expect(!zero.ok && zero.code).toBe('WEIGHTS_TOTAL');
  });

  it('refuses a budget below a route minimum with the smallest workable budget, without changing weights', () => {
    const legs = [
      { key: 'a', weightBps: 2_500, minimumInputRaw: 1_000_000n },
      { key: 'b', weightBps: 7_500, minimumInputRaw: 500_000n },
    ];
    const refused = allocateBudget({
      budgetRaw: 2_000_000n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      throw new Error('expected a refusal');
    }
    expect(refused.code).toBe('BUDGET_TOO_SMALL');
    expect(refused.shortfalls).toEqual([
      { key: 'a', targetRaw: 500_000n, minimumInputRaw: 1_000_000n },
    ]);
    // a needs 1,000,000 at 25% → 4,000,000 investable.
    expect(refused.minimumBudgetRaw).toBe(4_000_000n);
    const accepted = allocateBudget({
      budgetRaw: refused.minimumBudgetRaw as bigint,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 0n,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error('expected an allocation');
    }
    expect(accepted.legs.map((entry) => entry.targetRaw)).toEqual([1_000_000n, 3_000_000n]);
    const withReserve = allocateBudget({
      budgetRaw: 100n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 7n,
    });
    expect(!withReserve.ok && withReserve.minimumBudgetRaw).toBe(4_000_007n);
    const nothingLeft = allocateBudget({
      budgetRaw: 5n,
      mode: 'all_in_stablecoin',
      legs,
      cashWeightBps: 0,
      feeReserveRaw: 5n,
    });
    expect(!nothingLeft.ok && nothingLeft.message).toMatch(/nothing is left/);
  });
});
