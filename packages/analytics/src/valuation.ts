import {
  VALUE_SCALE,
  type ValuationCaveatCode,
  type ValuationIssue,
  type ValuationPosition,
} from '@markov/contracts';
import type { PriceLookup } from './prices.js';
import { Rational, sumRationals } from './rational.js';

/**
 * Valuation of held quantities at a point in time: raw base units times the
 * multiplier in force at that time (exact, never applied twice) times the
 * resolved price. Anything that cannot be valued is reported, and one
 * unvalued position makes the whole point incomplete.
 */

export interface MultiplierInput {
  readonly effectiveAt: string;
  readonly multiplier: string;
  readonly source?: string;
}

export interface AssetFacts {
  readonly asset: string;
  readonly symbol: string;
  readonly decimals: number;
  /** A Token-2022 mint with the scaled-amount extension: the multiplier history decides its display quantity. */
  readonly scaled: boolean;
  readonly multipliers: readonly MultiplierInput[];
}

export interface PositionInput {
  readonly facts: AssetFacts;
  readonly raw: bigint;
}

export interface ValuationResult {
  readonly positions: readonly ValuationPosition[];
  /** Sum of the position values rounded to VALUE_SCALE; null when any position is unvalued. */
  readonly value: Rational | null;
  readonly complete: boolean;
  readonly issues: readonly ValuationIssue[];
  readonly caveats: readonly ValuationCaveatCode[];
}

/** The multiplier in force at `at`: 1 for an unscaled token, the latest evidence otherwise, null when none covers the time. */
export function multiplierAt(facts: AssetFacts, at: Date): Rational | null {
  if (!facts.scaled) {
    return Rational.one();
  }
  const cutoff = at.getTime();
  let best: MultiplierInput | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const point of facts.multipliers) {
    const effective = Date.parse(point.effectiveAt);
    if (effective <= cutoff && effective >= bestAt) {
      best = point;
      bestAt = effective;
    }
  }
  return best === null ? null : Rational.fromDecimal(best.multiplier);
}

/** raw × multiplier / 10^decimals, exact. */
export function scaledQuantity(raw: bigint, decimals: number, multiplier: Rational): Rational {
  return Rational.of(raw, 10n ** BigInt(decimals)).multiply(multiplier);
}

export function dedupeCaveats(caveats: readonly ValuationCaveatCode[]): ValuationCaveatCode[] {
  return [...new Set(caveats)];
}

export function valuePositions(
  inputs: readonly PositionInput[],
  at: Date,
  prices: PriceLookup,
): ValuationResult {
  const positions: ValuationPosition[] = [];
  const values: Rational[] = [];
  const issues: ValuationIssue[] = [];
  const caveats: ValuationCaveatCode[] = [];
  let complete = true;
  for (const input of inputs) {
    if (input.raw === 0n) {
      continue;
    }
    const positionIssues: ValuationIssue[] = [];
    const positionCaveats: ValuationCaveatCode[] = [];
    const multiplier = multiplierAt(input.facts, at);
    if (multiplier === null) {
      positionIssues.push({
        code: 'multiplier_unknown',
        asset: input.facts.asset,
        detail: 'no multiplier evidence covers this time; nothing assumes 1',
      });
    }
    if (input.raw < 0n) {
      positionIssues.push({
        code: 'negative_quantity',
        asset: input.facts.asset,
        detail: 'the record holds less than nothing of this asset; a reconciliation is needed',
      });
    }
    const quantity =
      multiplier === null ? null : scaledQuantity(input.raw, input.facts.decimals, multiplier);
    const resolved = prices.priceAt(input.facts.asset, at);
    let value: Rational | null = null;
    if (resolved.ok) {
      positionCaveats.push(...resolved.caveats);
      if (quantity !== null) {
        value = quantity.multiply(resolved.value);
      }
    } else {
      positionIssues.push(resolved.issue);
    }
    if (positionIssues.length > 0) {
      complete = false;
    } else if (value !== null) {
      values.push(value);
    }
    issues.push(...positionIssues);
    caveats.push(...positionCaveats);
    positions.push({
      asset: input.facts.asset,
      symbol: input.facts.symbol,
      decimals: input.facts.decimals,
      raw: input.raw.toString(),
      multiplier: multiplier === null ? null : multiplier.toDecimal(18).replace(/\.?0+$/, ''),
      scaledQuantity: quantity === null ? null : quantity.toDecimal(18).replace(/\.?0+$/, ''),
      price: resolved.ok ? resolved.price : null,
      value: value === null ? null : value.toDecimal(VALUE_SCALE),
      issues: positionIssues,
      caveats: dedupeCaveats(positionCaveats),
    });
  }
  return {
    positions,
    value: complete ? sumRationals(values).rounded(VALUE_SCALE) : null,
    complete,
    issues,
    caveats: dedupeCaveats(caveats),
  };
}
