import {
  type ObservablePriceKind,
  PRICE_MAX_AGE_MS,
  type PricePoint,
  STABLECOIN_DEPEG_BPS,
  type ValuationCaveatCode,
  type ValuationIssue,
} from '@markov/contracts';
import { Rational } from './rational.js';

/**
 * Price resolution: which recorded observation values an asset at a point
 * in time, and when none may. A price is a typed observation with a kind,
 * a unit, a time and a source; the rules here decide precedence, freshness
 * and exclusions and report the reason whenever nothing qualifies.
 */

export interface ObservationInput {
  readonly asset: string;
  readonly kind: ObservablePriceKind;
  readonly value: string;
  readonly unit: string;
  readonly observedAt: string;
  readonly source: string;
}

export type PriceResolution =
  | {
      readonly ok: true;
      readonly price: PricePoint;
      readonly value: Rational;
      readonly caveats: readonly ValuationCaveatCode[];
    }
  | { readonly ok: false; readonly issue: ValuationIssue };

export interface PriceLookupOptions {
  readonly observations: readonly ObservationInput[];
  /** The valuation currency; observations in another unit never value anything. */
  readonly currency: string;
  readonly maxAgeMs?: number;
  /** The configured stablecoin: valued at par when no observation covers it. */
  readonly stablecoin: { readonly asset: string } | null;
}

export interface PriceLookup {
  readonly currency: string;
  readonly maxAgeMs: number;
  priceAt(asset: string, at: Date): PriceResolution;
  observationsOf(asset: string): readonly ObservationInput[];
}

/** Kinds that value a token, most direct first. An implied company valuation never prices a token. */
export const VALUATION_KIND_PRECEDENCE: readonly ObservablePriceKind[] = [
  'secondary_market',
  'issuer_mark',
  'underlying_equity',
];

const PAR_SOURCE = 'assumption:par';

function hours(ms: number): string {
  return (ms / 3_600_000).toFixed(1);
}

export function createPriceLookup(options: PriceLookupOptions): PriceLookup {
  const maxAgeMs = options.maxAgeMs ?? PRICE_MAX_AGE_MS;
  const byAsset = new Map<string, ObservationInput[]>();
  for (const observation of options.observations) {
    const list = byAsset.get(observation.asset) ?? [];
    list.push(observation);
    byAsset.set(observation.asset, list);
  }
  for (const list of byAsset.values()) {
    // Stable: equal times keep input order, and the later input wins below.
    list.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  const latestOfKind = (
    list: readonly ObservationInput[],
    kind: ObservablePriceKind,
    cutoff: number,
  ): ObservationInput | null => {
    let best: ObservationInput | null = null;
    for (const observation of list) {
      const at = Date.parse(observation.observedAt);
      if (at > cutoff) {
        break;
      }
      if (observation.kind === kind) {
        best = observation;
      }
    }
    return best;
  };

  const resolve = (
    asset: string,
    at: Date,
  ):
    | { ok: true; observation: ObservationInput; ageMs: number }
    | { ok: false; issue: ValuationIssue } => {
    const list = byAsset.get(asset) ?? [];
    const cutoff = at.getTime();
    let stale: { ageMs: number } | null = null;
    let unitMismatch: ObservationInput | null = null;
    let excluded = false;
    for (const kind of VALUATION_KIND_PRECEDENCE) {
      const observation = latestOfKind(list, kind, cutoff);
      if (observation === null) {
        continue;
      }
      if (observation.unit !== options.currency) {
        unitMismatch = observation;
        continue;
      }
      const ageMs = cutoff - Date.parse(observation.observedAt);
      if (ageMs > maxAgeMs) {
        if (stale === null || ageMs < stale.ageMs) {
          stale = { ageMs };
        }
        continue;
      }
      return { ok: true, observation, ageMs };
    }
    if (latestOfKind(list, 'implied_valuation', cutoff) !== null) {
      excluded = true;
    }
    if (stale !== null) {
      return {
        ok: false,
        issue: {
          code: 'stale_price',
          asset,
          detail: `the freshest usable observation is ${hours(stale.ageMs)} h old; the limit is ${hours(maxAgeMs)} h`,
        },
      };
    }
    if (unitMismatch !== null) {
      return {
        ok: false,
        issue: {
          code: 'price_unit_mismatch',
          asset,
          detail: `observations are in ${unitMismatch.unit}, the valuation currency is ${options.currency}`,
        },
      };
    }
    if (excluded) {
      return {
        ok: false,
        issue: {
          code: 'excluded_price_kind',
          asset,
          detail: 'only an implied company valuation is recorded, which is not a token price',
        },
      };
    }
    return {
      ok: false,
      issue: {
        code: 'no_observation',
        asset,
        detail: 'no price observation at or before this time',
      },
    };
  };

  return {
    currency: options.currency,
    maxAgeMs,
    observationsOf(asset) {
      return byAsset.get(asset) ?? [];
    },
    priceAt(asset, at) {
      const resolved = resolve(asset, at);
      const isStablecoin = options.stablecoin !== null && options.stablecoin.asset === asset;
      if (resolved.ok) {
        const value = Rational.fromDecimal(resolved.observation.value);
        const caveats: ValuationCaveatCode[] = [];
        if (resolved.observation.kind === 'underlying_equity') {
          caveats.push('underlying_as_token_price');
        }
        if (isStablecoin) {
          const deviationBps = value.subtract(Rational.one()).multiply(Rational.of(10_000n));
          const magnitude = deviationBps.isNegative() ? deviationBps.negate() : deviationBps;
          if (magnitude.compare(Rational.of(BigInt(STABLECOIN_DEPEG_BPS))) > 0) {
            caveats.push('stablecoin_depeg');
          }
        }
        return {
          ok: true,
          value,
          caveats,
          price: {
            value: resolved.observation.value,
            unit: resolved.observation.unit,
            kind: resolved.observation.kind,
            observedAt: resolved.observation.observedAt,
            source: resolved.observation.source,
            ageMs: resolved.ageMs,
          },
        };
      }
      if (isStablecoin) {
        return {
          ok: true,
          value: Rational.one(),
          caveats: ['stablecoin_par'],
          price: {
            value: '1',
            unit: options.currency,
            kind: 'secondary_market',
            observedAt: at.toISOString(),
            source: PAR_SOURCE,
            ageMs: 0,
          },
        };
      }
      return resolved;
    },
  };
}
