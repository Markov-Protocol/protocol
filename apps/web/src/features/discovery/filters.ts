import {
  DISCOVERY_PERIODS,
  DISCOVERY_SORTS,
  type DiscoveryPeriod,
  type DiscoverySort,
  ISSUERS,
  type Issuer,
} from '@markov/contracts';
import { looksLikeSolanaAddress } from '@markov/formatters';

/**
 * Explorer filter state that lives in the URL: validated enum values, a
 * bounded search text, an instrument id and a creator wallet that look
 * like what they claim. Anything else is dropped rather than forwarded.
 */
export interface StrategyFilters {
  readonly q: string;
  readonly issuer: Issuer | null;
  readonly instrumentId: string | null;
  readonly creator: string | null;
  readonly period: DiscoveryPeriod;
  readonly sort: DiscoverySort;
}

export const EMPTY_STRATEGY_FILTERS: StrategyFilters = {
  q: '',
  issuer: null,
  instrumentId: null,
  creator: null,
  period: '30d',
  sort: 'rank',
};
export const STRATEGY_QUERY_MAX = 60;
export const STRATEGY_PAGE_SIZE = 25;
/** Bounded pagination: at most this many pages before asking for a narrower search. */
export const STRATEGY_MAX_PAGES = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseStrategyFilters(params: URLSearchParams): StrategyFilters {
  const issuer = params.get('issuer');
  const instrumentId = params.get('instrumentId');
  const creator = params.get('creator');
  const period = params.get('period');
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, STRATEGY_QUERY_MAX),
    issuer: (ISSUERS as readonly string[]).includes(issuer ?? '') ? (issuer as Issuer) : null,
    instrumentId: instrumentId && UUID.test(instrumentId) ? instrumentId : null,
    creator: creator && looksLikeSolanaAddress(creator) ? creator : null,
    period: (DISCOVERY_PERIODS as readonly string[]).includes(period ?? '')
      ? (period as DiscoveryPeriod)
      : '30d',
    sort: (DISCOVERY_SORTS as readonly string[]).includes(sort ?? '')
      ? (sort as DiscoverySort)
      : 'rank',
  };
}

/** Query string for the URL bar and the API (the same names); defaults are left out. */
export function serializeStrategyFilters(
  filters: StrategyFilters,
  extra: { readonly tab?: string; readonly cursor?: string | null; readonly limit?: number } = {},
): string {
  const params = new URLSearchParams();
  if (extra.tab) {
    params.set('tab', extra.tab);
  }
  if (filters.q !== '') {
    params.set('q', filters.q);
  }
  if (filters.issuer) {
    params.set('issuer', filters.issuer);
  }
  if (filters.instrumentId) {
    params.set('instrumentId', filters.instrumentId);
  }
  if (filters.creator) {
    params.set('creator', filters.creator);
  }
  if (filters.period !== '30d') {
    params.set('period', filters.period);
  }
  if (filters.sort !== 'rank') {
    params.set('sort', filters.sort);
  }
  if (extra.limit) {
    params.set('limit', String(extra.limit));
  }
  if (extra.cursor) {
    params.set('cursor', extra.cursor);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export function sameStrategyFilters(a: StrategyFilters, b: StrategyFilters): boolean {
  return (
    a.q === b.q &&
    a.issuer === b.issuer &&
    a.instrumentId === b.instrumentId &&
    a.creator === b.creator &&
    a.period === b.period &&
    a.sort === b.sort
  );
}
