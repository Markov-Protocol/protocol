import type { MultiplierSource } from '@markov/contracts';

export interface MultiplierPoint {
  readonly effectiveAt: string;
  readonly multiplier: string;
  readonly source: MultiplierSource;
}

export interface MultiplierAsOf {
  readonly multiplier: string | null;
  readonly effectiveAt: string | null;
  readonly source: MultiplierSource | null;
  readonly complete: boolean;
  readonly detail: string;
}

/**
 * The multiplier in force at `asOf` from recorded evidence, latest
 * effective point first. No evidence before `asOf` means the period is
 * incomplete: the caller must not assume 1, and analytics must mark the
 * period incomplete rather than compute a return.
 */
export function multiplierAsOf(history: readonly MultiplierPoint[], asOf: Date): MultiplierAsOf {
  const cutoff = asOf.getTime();
  let best: MultiplierPoint | null = null;
  for (const point of history) {
    const at = new Date(point.effectiveAt).getTime();
    if (at <= cutoff && (best === null || at > new Date(best.effectiveAt).getTime())) {
      best = point;
    }
  }
  if (best === null) {
    return {
      multiplier: null,
      effectiveAt: null,
      source: null,
      complete: false,
      detail:
        history.length === 0
          ? 'no multiplier evidence recorded for this instrument'
          : 'no multiplier evidence covers this time',
    };
  }
  return {
    multiplier: best.multiplier,
    effectiveAt: best.effectiveAt,
    source: best.source,
    complete: true,
    detail: `in force since ${best.effectiveAt} (${best.source})`,
  };
}
