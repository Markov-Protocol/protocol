/**
 * Same-origin enforcement for every state-changing request the app's own
 * server accepts. SameSite=Lax cookies already keep cross-site POSTs
 * credential-less; this check refuses them outright and also refuses
 * non-browser callers that present no origin.
 */
export type OriginVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function expectedOrigins(request: Request, appOrigin: string | null): ReadonlySet<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // an unparsable request URL contributes nothing
  }
  if (appOrigin) {
    origins.add(appOrigin);
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto');
  if (host && proto && (proto === 'https' || proto === 'http')) {
    origins.add(`${proto}://${host}`);
  }
  return origins;
}

export function checkSameOrigin(request: Request, appOrigin: string | null): OriginVerdict {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin') {
    return { ok: false, reason: `cross-site request (Sec-Fetch-Site: ${fetchSite})` };
  }
  const origin = request.headers.get('origin');
  if (origin === null) {
    return fetchSite === 'same-origin'
      ? { ok: true }
      : { ok: false, reason: 'missing Origin header' };
  }
  if (!expectedOrigins(request, appOrigin).has(origin)) {
    return { ok: false, reason: 'origin is not this application' };
  }
  return { ok: true };
}

/** JSON bodies must be declared as such; a simple form post is never accepted. */
export function isJsonRequest(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return /^application\/json\b/i.test(type);
}
