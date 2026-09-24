/**
 * The only Markov API operations the browser may reach through this server.
 * Everything else answers 404 before any credential is attached. Paths are
 * matched exactly against the API contract (docs/markov/openapi.json).
 */
export type ProxyMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ProxyRoute {
  readonly method: ProxyMethod;
  readonly pattern: RegExp;
  /** Anonymous callers may reach it (no session cookie required). */
  readonly public?: boolean;
  /** A bounded query string is forwarded (re-encoded); otherwise any query is refused. */
  readonly query?: boolean;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const PROXY_ROUTES: readonly ProxyRoute[] = [
  // Public catalog reads (F05): admitted and paused instruments only; the API decides.
  { method: 'GET', pattern: /^\/v1\/catalog\/instruments$/, public: true, query: true },
  { method: 'GET', pattern: new RegExp(`^/v1/catalog/instruments/${UUID}$`), public: true },
  {
    method: 'GET',
    pattern: new RegExp(`^/v1/catalog/instruments/${UUID}/corporate-actions$`),
    public: true,
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/v1/catalog/instruments/${UUID}/multipliers$`),
    public: true,
  },
  { method: 'GET', pattern: /^\/v1\/me\/watchlist$/ },
  { method: 'PUT', pattern: new RegExp(`^/v1/me/watchlist/items/${UUID}$`) },
  { method: 'DELETE', pattern: new RegExp(`^/v1/me/watchlist/items/${UUID}$`), query: true },
  { method: 'GET', pattern: /^\/v1\/me\/wallets$/ },
  { method: 'POST', pattern: /^\/v1\/me\/wallets\/challenges$/ },
  { method: 'POST', pattern: /^\/v1\/me\/wallets$/ },
  { method: 'DELETE', pattern: new RegExp(`^/v1/me/wallets/${UUID}$`) },
  { method: 'GET', pattern: new RegExp(`^/v1/me/wallets/${UUID}/funding$`) },
  { method: 'GET', pattern: /^\/v1\/me\/eligibility$/ },
  { method: 'POST', pattern: /^\/v1\/me\/eligibility\/declarations$/ },
  { method: 'GET', pattern: /^\/v1\/terms\/current$/, public: true },
  { method: 'POST', pattern: /^\/v1\/me\/terms\/acknowledgements$/ },
  { method: 'GET', pattern: /^\/v1\/me\/limits$/ },
  { method: 'GET', pattern: new RegExp(`^/v1/me/instruments/${UUID}/availability$`) },
  // Research (F06): the person's theses, immutable revisions, source records retrieved by the
  // API under its safe-retrieval policy, deterministic mapping and bounded model runs.
  { method: 'GET', pattern: /^\/v1\/me\/theses$/, query: true },
  { method: 'POST', pattern: /^\/v1\/me\/theses$/ },
  { method: 'GET', pattern: new RegExp(`^/v1/me/theses/${UUID}$`) },
  { method: 'PATCH', pattern: new RegExp(`^/v1/me/theses/${UUID}$`) },
  { method: 'GET', pattern: new RegExp(`^/v1/me/theses/${UUID}/revisions$`) },
  { method: 'POST', pattern: new RegExp(`^/v1/me/theses/${UUID}/revisions$`) },
  { method: 'GET', pattern: new RegExp(`^/v1/me/theses/${UUID}/sources$`) },
  { method: 'POST', pattern: new RegExp(`^/v1/me/theses/${UUID}/sources$`) },
  { method: 'POST', pattern: /^\/v1\/me\/research\/mappings$/ },
  { method: 'GET', pattern: /^\/v1\/me\/research\/runs$/, query: true },
  { method: 'POST', pattern: /^\/v1\/me\/research\/runs$/ },
  { method: 'GET', pattern: new RegExp(`^/v1/me/research/runs/${UUID}$`) },
  { method: 'POST', pattern: new RegExp(`^/v1/me/research/runs/${UUID}/cancel$`) },
  { method: 'GET', pattern: new RegExp(`^/v1/research/theses/${UUID}$`), public: true },
  // Strategy drafts (F06 entry point; the builder itself is F07).
  { method: 'GET', pattern: /^\/v1\/strategies\/limits$/, public: true },
  { method: 'GET', pattern: /^\/v1\/me\/strategies$/ },
  { method: 'POST', pattern: /^\/v1\/me\/strategies$/ },
];

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SEGMENTS = 8;

/** Rebuild the API path from route segments, refusing anything that is not a plain segment. */
export function apiPathFrom(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) {
    return null;
  }
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      return null;
    }
  }
  return `/${segments.join('/')}`;
}

const MAX_QUERY_PARAMS = 8;
const MAX_QUERY_LENGTH = 512;
const QUERY_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

/**
 * Re-encode a query string for an allowlisted read: at most 8 plain keys,
 * 512 characters in total, values re-encoded so nothing but data reaches
 * the API. Returns null when the query is unacceptable.
 */
export function safeQuery(search: string): string | null {
  if (search === '' || search === '?') {
    return '';
  }
  if (search.length > MAX_QUERY_LENGTH) {
    return null;
  }
  const params = new URLSearchParams(search);
  const out = new URLSearchParams();
  let count = 0;
  for (const [key, value] of params) {
    count += 1;
    if (count > MAX_QUERY_PARAMS || !QUERY_KEY.test(key) || value.length > 200) {
      return null;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused on purpose
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      return null;
    }
    out.append(key, value);
  }
  const encoded = out.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export function matchRoute(method: string, path: string): ProxyRoute | null {
  return PROXY_ROUTES.find((route) => route.method === method && route.pattern.test(path)) ?? null;
}
