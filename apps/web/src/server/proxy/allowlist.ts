/**
 * The only Markov API operations the browser may reach through this server.
 * Everything else answers 404 before any credential is attached. Paths are
 * matched exactly against the API contract (docs/markov/openapi.json).
 */
export type ProxyMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ProxyRoute {
  readonly method: ProxyMethod;
  readonly pattern: RegExp;
  /** Anonymous callers may reach it (no session cookie required). */
  readonly public?: boolean;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const PROXY_ROUTES: readonly ProxyRoute[] = [
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

export function matchRoute(method: string, path: string): ProxyRoute | null {
  return PROXY_ROUTES.find((route) => route.method === method && route.pattern.test(path)) ?? null;
}
