import type { WebEnv } from '../../config/web-env';
import { readSessionCookie, sessionCookiePolicy } from '../auth/cookies';
import { checkSameOrigin, isJsonRequest } from '../auth/origin';
import { apiPathFrom, matchRoute, safeQuery } from './allowlist';

export interface ProxyDeps {
  readonly env: WebEnv;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly forwardedFor: (request: Request) => string | null;
}

const NO_STORE = { 'cache-control': 'no-store', vary: 'Cookie' } as const;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

function envelope(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, requestId: 'web-proxy' } },
    { status, headers: NO_STORE },
  );
}

/**
 * Forward an allowlisted API call for the signed-in person. The browser
 * never holds the session token: it lives in the HttpOnly cookie, and this
 * server attaches it as the bearer. Mutations must come from this origin,
 * bodies must be small JSON, responses are never cached, and upstream
 * headers are dropped so nothing but the JSON body reaches the page.
 */
export async function handleProxy(
  request: Request,
  segments: readonly string[],
  deps: ProxyDeps,
): Promise<Response> {
  const path = apiPathFrom(segments);
  const route = path === null ? null : matchRoute(request.method, path);
  if (path === null || route === null) {
    return envelope(404, 'NOT_FOUND', 'no such operation');
  }
  const search = new URL(request.url).search;
  const query = route.query ? safeQuery(search) : search === '' ? '' : null;
  if (query === null) {
    return envelope(400, 'VALIDATION_FAILED', 'unacceptable query string');
  }
  const mutation = request.method !== 'GET';
  if (mutation) {
    const origin = checkSameOrigin(request, deps.env.appOrigin);
    if (!origin.ok) {
      return envelope(403, 'FORBIDDEN', `refused: ${origin.reason}`);
    }
  }
  const policy = sessionCookiePolicy(deps.env);
  const token = readSessionCookie(request.headers.get('cookie'), policy.name);
  if (token === null && !route.public) {
    return envelope(401, 'AUTH_REQUIRED', 'sign in to continue');
  }

  let body: string | null = null;
  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    if (!isJsonRequest(request)) {
      return envelope(415, 'VALIDATION_FAILED', 'a JSON body is required');
    }
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return envelope(413, 'VALIDATION_FAILED', 'body too large');
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return envelope(413, 'VALIDATION_FAILED', 'body too large');
    }
    try {
      JSON.parse(text);
    } catch {
      return envelope(400, 'VALIDATION_FAILED', 'body is not valid JSON');
    }
    body = text;
  }

  const headers = new Headers({ accept: 'application/json' });
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (body !== null) {
    headers.set('content-type', 'application/json');
  }
  const forwardedFor = deps.forwardedFor(request);
  if (forwardedFor) {
    headers.set('x-forwarded-for', forwardedFor);
  }
  let upstream: Response;
  try {
    upstream = await deps.fetch(
      new Request(`${deps.env.apiOrigin}${path}${query}`, {
        method: request.method,
        headers,
        ...(body !== null ? { body } : {}),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        redirect: 'error',
      }),
    );
  } catch {
    return envelope(503, 'PROVIDER_UNAVAILABLE', 'Markov cannot reach its backend right now');
  }
  if (upstream.status === 204) {
    return new Response(null, { status: 204, headers: NO_STORE });
  }
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...NO_STORE, 'content-type': 'application/json' },
  });
}
