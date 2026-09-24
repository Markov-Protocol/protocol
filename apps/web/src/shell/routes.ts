/**
 * Route inventory for the shell: navigation targets, page titles and the
 * session that delivers each area. A target that is not delivered yet
 * renders an honest unavailable page instead of a decorative control.
 */
export interface RouteInfo {
  readonly title: string;
  /** Session that delivers the real feature; null when delivered. */
  readonly arrivesWith: string | null;
  readonly needsBackend: string | null;
}

export const ROUTE_INFO: Readonly<Record<string, RouteInfo>> = {
  '/': { title: 'Home', arrivesWith: null, needsBackend: null },
  '/explore': { title: 'Explore', arrivesWith: 'F05 and F12', needsBackend: 'B03 to B05 and B14' },
  '/strategies/new': { title: 'Build a strategy', arrivesWith: 'F07', needsBackend: 'B07' },
  '/portfolio': { title: 'Portfolio', arrivesWith: 'F11', needsBackend: 'B12 and B13' },
  '/activity': { title: 'Activity', arrivesWith: 'F10', needsBackend: 'B10 to B12' },
  '/rankings': { title: 'Rankings', arrivesWith: 'F12', needsBackend: 'B13 and B14' },
  '/automations': { title: 'Automations', arrivesWith: 'F13', needsBackend: 'B16' },
  '/settings': { title: 'Settings', arrivesWith: 'F16', needsBackend: 'B02 and B15' },
  '/sign-in': { title: 'Sign in', arrivesWith: null, needsBackend: null },
  '/auth/callback': { title: 'Sign-in callback', arrivesWith: null, needsBackend: null },
  '/status': { title: 'Status', arrivesWith: 'F19', needsBackend: 'B18' },
  '/dev/components': {
    title: 'Component reference (internal)',
    arrivesWith: null,
    needsBackend: null,
  },
};

export function routeInfoFor(pathname: string): RouteInfo {
  const exact = ROUTE_INFO[pathname];
  if (exact) {
    return exact;
  }
  const prefix = Object.keys(ROUTE_INFO)
    .filter((key) => key !== '/' && pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix
    ? (ROUTE_INFO[prefix] as RouteInfo)
    : { title: 'Markov', arrivesWith: null, needsBackend: null };
}
