import { INSTRUMENT_KINDS, type InstrumentKind, ISSUERS, type Issuer } from '@markov/contracts';

/**
 * Filter state that lives in the URL: only validated enum values and a
 * bounded search text. Anything else is dropped rather than forwarded.
 */
export interface InstrumentFilters {
  readonly q: string;
  readonly issuer: Issuer | null;
  readonly kind: InstrumentKind | null;
}

export const EMPTY_FILTERS: InstrumentFilters = { q: '', issuer: null, kind: null };
export const MAX_QUERY_LENGTH = 60;
export const PAGE_SIZE = 25;
/** Bounded pagination: at most this many pages before asking for a narrower search. */
export const MAX_PAGES = 8;

export type ExploreTab = 'instruments' | 'watchlist' | 'strategies';
const TABS: readonly ExploreTab[] = ['instruments', 'watchlist', 'strategies'];

export function parseFilters(params: URLSearchParams): InstrumentFilters {
  const issuer = params.get('issuer');
  const kind = params.get('kind');
  const q = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  return {
    q,
    issuer: (ISSUERS as readonly string[]).includes(issuer ?? '') ? (issuer as Issuer) : null,
    kind: (INSTRUMENT_KINDS as readonly string[]).includes(kind ?? '')
      ? (kind as InstrumentKind)
      : null,
  };
}

export function parseTab(params: URLSearchParams): ExploreTab {
  const tab = params.get('tab');
  return TABS.includes(tab as ExploreTab) ? (tab as ExploreTab) : 'instruments';
}

/** Query string for the URL bar (and the API, which takes the same names). */
export function serializeFilters(
  filters: InstrumentFilters,
  extra: {
    readonly tab?: ExploreTab;
    readonly cursor?: string | null;
    readonly limit?: number;
  } = {},
): string {
  const params = new URLSearchParams();
  if (extra.tab && extra.tab !== 'instruments') {
    params.set('tab', extra.tab);
  }
  if (filters.q !== '') {
    params.set('q', filters.q);
  }
  if (filters.issuer) {
    params.set('issuer', filters.issuer);
  }
  if (filters.kind) {
    params.set('kind', filters.kind);
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

export function sameFilters(a: InstrumentFilters, b: InstrumentFilters): boolean {
  return a.q === b.q && a.issuer === b.issuer && a.kind === b.kind;
}
