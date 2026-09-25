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
  '/explore': { title: 'Explore', arrivesWith: null, needsBackend: null },
  '/markets': { title: 'Market', arrivesWith: null, needsBackend: null },
  '/research': { title: 'Research', arrivesWith: null, needsBackend: null },
  '/strategies': { title: 'Strategy', arrivesWith: null, needsBackend: null },
  '/strategies/new': { title: 'Build a strategy', arrivesWith: null, needsBackend: null },
  '/review': { title: 'Review', arrivesWith: null, needsBackend: null },
  '/review/new': { title: 'Review an investment', arrivesWith: null, needsBackend: null },
  '/portfolio': { title: 'Portfolio', arrivesWith: null, needsBackend: null },
  '/activity': { title: 'Activity', arrivesWith: null, needsBackend: null },
  '/receipts': { title: 'Receipt', arrivesWith: null, needsBackend: null },
  '/rankings': { title: 'Rankings', arrivesWith: null, needsBackend: null },
  '/creators': { title: 'Creator', arrivesWith: null, needsBackend: null },
  '/automations': { title: 'Automations', arrivesWith: 'P14', needsBackend: null },
  '/settings': { title: 'Settings', arrivesWith: null, needsBackend: null },
  '/settings/wallets': { title: 'Wallets', arrivesWith: null, needsBackend: null },
  '/settings/eligibility': {
    title: 'Eligibility and terms',
    arrivesWith: null,
    needsBackend: null,
  },
  '/sign-in': { title: 'Sign in', arrivesWith: null, needsBackend: null },
  '/auth/callback': { title: 'Sign-in callback', arrivesWith: null, needsBackend: null },
  '/status': { title: 'Status', arrivesWith: 'P18', needsBackend: null },
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
