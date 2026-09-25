import {
  type PerformanceSeries,
  RANKING_MIN_HISTORY_DAYS,
  type RankingEntry,
  type RankingIneligibilityReason,
  type WindowMetrics,
} from '@markov/contracts';
import { Rational } from './rational.js';

/**
 * Ranking of model series only. An entry ranks when its window is complete
 * to the end, its end price is fresh and its history is at least the
 * product threshold; everything else is listed without a rank and without
 * a return, so an incomplete or short history never shows a number next
 * to a position. Deposits cannot exist in a model series, and an actual
 * series is refused by kind.
 */

export interface RankingCandidate {
  readonly strategyId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly title: string;
  readonly series: PerformanceSeries;
  readonly metrics: WindowMetrics;
}

export interface RankingOptions {
  readonly minHistoryDays?: number;
}

export function eligibilityOf(
  candidate: RankingCandidate,
  options: RankingOptions = {},
): RankingIneligibilityReason[] {
  const minHistoryDays = options.minHistoryDays ?? RANKING_MIN_HISTORY_DAYS;
  const reasons = new Set<RankingIneligibilityReason>();
  if (candidate.series.kind !== 'model') {
    reasons.add('not_model_series');
  }
  const { metrics } = candidate;
  if (candidate.series.points.length === 0 || candidate.series.start === null) {
    reasons.add('no_series');
  }
  if (metrics.completeness.historyDays < minHistoryDays) {
    reasons.add('insufficient_history');
  }
  for (const reason of metrics.reasons) {
    switch (reason) {
      case 'insufficient_history':
        reasons.add('insufficient_history');
        break;
      case 'incomplete_points':
      case 'unpriced_flow':
        reasons.add('incomplete_window');
        break;
      case 'zero_base':
        reasons.add('zero_base');
        break;
      case 'stale_end':
        reasons.add('stale_end');
        break;
      case 'no_series':
        reasons.add('no_series');
        break;
    }
  }
  if (!metrics.completeness.endFresh && !reasons.has('no_series')) {
    reasons.add('stale_end');
  }
  if (metrics.timeWeightedReturn === null && reasons.size === 0) {
    reasons.add('incomplete_window');
  }
  return [...reasons];
}

/** Eligible entries by time-weighted return (desc), then drawdown (asc), then version id; the rest unranked. */
export function rankModelSeries(
  candidates: readonly RankingCandidate[],
  options: RankingOptions = {},
): RankingEntry[] {
  const eligible: { candidate: RankingCandidate; twr: Rational; drawdown: Rational }[] = [];
  const unranked: RankingEntry[] = [];
  for (const candidate of candidates) {
    const reasons = eligibilityOf(candidate, options);
    if (reasons.length === 0 && candidate.metrics.timeWeightedReturn !== null) {
      eligible.push({
        candidate,
        twr: Rational.fromDecimal(candidate.metrics.timeWeightedReturn),
        drawdown: Rational.fromDecimal(candidate.metrics.maxDrawdown?.value ?? '0'),
      });
    } else {
      unranked.push({
        rank: null,
        strategyId: candidate.strategyId,
        versionId: candidate.versionId,
        versionNumber: candidate.versionNumber,
        title: candidate.title,
        kind: 'model',
        timeWeightedReturn: null,
        maxDrawdown: null,
        historyDays: candidate.metrics.completeness.historyDays,
        completeness: candidate.series.points.length === 0 ? null : candidate.metrics.completeness,
        eligible: false,
        reasons,
      });
    }
  }
  eligible.sort((a, b) => {
    const byReturn = b.twr.compare(a.twr);
    if (byReturn !== 0) {
      return byReturn;
    }
    const byDrawdown = a.drawdown.compare(b.drawdown);
    if (byDrawdown !== 0) {
      return byDrawdown;
    }
    return a.candidate.versionId < b.candidate.versionId ? -1 : 1;
  });
  unranked.sort((a, b) => (a.versionId < b.versionId ? -1 : 1));
  const ranked: RankingEntry[] = eligible.map((entry, position) => ({
    rank: position + 1,
    strategyId: entry.candidate.strategyId,
    versionId: entry.candidate.versionId,
    versionNumber: entry.candidate.versionNumber,
    title: entry.candidate.title,
    kind: 'model',
    timeWeightedReturn: entry.candidate.metrics.timeWeightedReturn,
    maxDrawdown: entry.candidate.metrics.maxDrawdown?.value ?? null,
    historyDays: entry.candidate.metrics.completeness.historyDays,
    completeness: entry.candidate.metrics.completeness,
    eligible: true,
    reasons: [],
  }));
  return [...ranked, ...unranked];
}
