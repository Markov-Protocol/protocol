import type {
  Completeness,
  DiscoveryPerformance,
  DiscoveryPeriod,
  DiscoverySort,
  DiscoveryVersion,
  FollowListResponse,
  Issuer,
  RankingEntry,
  RankingIneligibilityReason,
  VersionDiff,
} from '@markov/contracts';
import { formatBasisPoints, formatInstant } from '@markov/formatters';
import { ISSUER_LABELS } from '../markets/labels';
import { formatReturn } from '../portfolio/portfolio-model';
import { type DiffableVersion, diffVersions } from '../publishing/publication-state';

/**
 * Pure helpers behind the explorer, the rankings and the creator page.
 * Everything here reads the backend's projection and phrases it; nothing
 * here computes a return, invents a count or fills a missing rank.
 */

export const PERIOD_LABELS: Readonly<Record<DiscoveryPeriod, string>> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 365 days',
};

export const SORT_LABELS: Readonly<Record<DiscoverySort, string>> = {
  rank: 'Rank (model series)',
  newest: 'Newest registration',
  followers: 'Most followed',
};

/** Why an entry is listed without a rank, in the methodology's words. */
export function describeIneligibility(
  reasons: readonly RankingIneligibilityReason[],
  minHistoryDays: number,
): string {
  const text: Record<RankingIneligibilityReason, string> = {
    insufficient_history: `less than ${minHistoryDays} days of complete history`,
    incomplete_window: 'a day in the window has no usable price',
    stale_end: 'the latest price is older than the freshness rule',
    zero_base: 'the series has no positive starting value',
    no_series: 'no priced point since the freeze',
    not_model_series: 'not a model series',
  };
  if (reasons.length === 0) {
    return 'not ranked';
  }
  return reasons.map((reason) => text[reason]).join('; ');
}

export type PerformanceSummary =
  | {
      readonly kind: 'ranked';
      readonly rank: number;
      readonly returnText: string;
      readonly drawdownText: string;
      readonly historyText: string;
    }
  | {
      readonly kind: 'unranked';
      readonly reasonText: string;
      readonly historyText: string;
    };

export function historyText(days: number): string {
  if (days <= 0) {
    return 'no history yet';
  }
  return `${days} day${days === 1 ? '' : 's'} of history`;
}

function drawdownText(maxDrawdown: string | null): string {
  if (maxDrawdown === null) {
    return 'drawdown not reported';
  }
  const magnitude = formatReturn(maxDrawdown).replace(/^[+-]/, '');
  return magnitude === '0.00%' ? 'no drawdown' : `-${magnitude} max drawdown`;
}

/** The ranking entry as a row shows it: a rank with its return, or the reason and no number. */
export function summarizePerformance(
  performance: Pick<
    DiscoveryPerformance,
    'rank' | 'timeWeightedReturn' | 'maxDrawdown' | 'historyDays' | 'reasons'
  >,
  minHistoryDays: number,
): PerformanceSummary {
  const history = historyText(performance.historyDays);
  if (performance.rank !== null && performance.timeWeightedReturn !== null) {
    return {
      kind: 'ranked',
      rank: performance.rank,
      returnText: formatReturn(performance.timeWeightedReturn),
      drawdownText: drawdownText(performance.maxDrawdown),
      historyText: history,
    };
  }
  return {
    kind: 'unranked',
    reasonText: describeIneligibility(performance.reasons, minHistoryDays),
    historyText: history,
  };
}

export function summarizeEntry(entry: RankingEntry, minHistoryDays: number): PerformanceSummary {
  return summarizePerformance(entry, minHistoryDays);
}

export function issuerMixText(issuers: readonly Issuer[]): string {
  if (issuers.length === 0) {
    return 'no constituents';
  }
  return issuers.map((issuer) => ISSUER_LABELS[issuer]).join(' · ');
}

/**
 * The universe column of the reference screen, derived from the issuers
 * only (PreStocks issues pre-IPO exposure, xStocks listed stocks); it is a
 * label for the issuer mix, not a claim about any company.
 */
export function universeText(issuers: readonly Issuer[]): string {
  const set = new Set(issuers);
  if (set.size === 0) {
    return 'No constituents';
  }
  if (set.size === 1 && set.has('prestocks')) {
    return 'Pre-IPO exposure';
  }
  if (set.size === 1 && set.has('xstocks')) {
    return 'Listed stocks';
  }
  if (set.size === 1 && set.has('tessera')) {
    return 'Tessera exposure';
  }
  return 'Mixed exposure';
}

export function allocationText(
  version: Pick<DiscoveryVersion, 'legCount' | 'cashWeightBps'>,
): string {
  const assets = `${version.legCount} asset${version.legCount === 1 ? '' : 's'}`;
  return version.cashWeightBps === 0
    ? `${assets} · fully invested`
    : `${assets} · ${formatBasisPoints(version.cashWeightBps)} cash`;
}

export function completenessText(completeness: Completeness | null): string {
  if (completeness === null) {
    return 'no points valued';
  }
  return `${completeness.completePoints} of ${completeness.expectedPoints} points valued`;
}

/** Strategy ids the person follows; empty when signed out or not loaded, never guessed. */
export function followedStrategyIds(follows: FollowListResponse | undefined): ReadonlySet<string> {
  return new Set((follows?.follows ?? []).map((entry) => entry.strategyId));
}

/** The readable difference a follower sees before accepting a proposed version; the backend's rules. */
export function proposalDiff(from: DiffableVersion, to: DiffableVersion): VersionDiff {
  return diffVersions(from, to);
}

/** The footer of a public listing: what the rows are and when the ranking was read. */
export function listingSourceLine(input: {
  readonly asOf: string;
  readonly methodologyVersion: string;
  readonly minHistoryDays: number;
}): string {
  return `Registered on chain, listed by Markov · model series under ${input.methodologyVersion}, ranked after ${input.minHistoryDays} days of complete history · read ${formatInstant(input.asOf)} UTC`;
}
