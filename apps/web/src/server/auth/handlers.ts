import {
  attempt,
  expect as expectContract,
  type MarkovApiClient,
  MarkovApiError,
  MarkovApiUnreachableError,
  MarkovContractMismatchError,
} from '@markov/api-client';
import { sessionResponseSchema } from '@markov/contracts';
import { z } from 'zod';
import type { WebEnv } from '../../config/web-env';
import { safeReturnPath } from '../../features/auth/return-path';
import type {
  SessionSnapshot,
  SignInResponse,
  SignOutResponse,
} from '../../features/auth/session-types';
import {
  readSessionCookie,
  sessionCookieClear,
  sessionCookiePolicy,
  sessionCookieSet,
} from './cookies';
import { checkSameOrigin, isJsonRequest } from './origin';
import { resolvePlatform, resolveSession } from './session';
import { mintDevelopmentIdentityToken } from './test-issuer';

export interface AuthHandlerDeps {
  readonly env: WebEnv;
  /** Client factory per principal; `forwardedFor` lets the API rate-limit per person behind this server. */
  readonly api: (
    bearer: string | null,
    context: { forwardedFor: string | null },
  ) => MarkovApiClient;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly forwardedFor: (request: Request) => string | null;
}

const NO_STORE = { 'cache-control': 'no-store', vary: 'Cookie' } as const;

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

function failure(status: number, code: string, message: string): Response {
  const body: SignInResponse = { ok: false, code, message };
  return json(body, status);
}

const signInBodySchema = z.object({
  provider: z.literal('test'),
  subject: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(/^[A-Za-z0-9:._@+-]+$/, 'letters, digits and : . _ @ + - only'),
  next: z.string().max(2048).optional(),
});

/** `GET /api/auth/session`: the verified session for the client, never cached, never private data beyond the account summary. */
export async function handleSessionGet(request: Request, deps: AuthHandlerDeps): Promise<Response> {
  const policy = sessionCookiePolicy(deps.env);
  const token = readSessionCookie(request.headers.get('cookie'), policy.name);
  const forwardedFor = deps.forwardedFor(request);
  const resolved = await resolveSession(token, (bearer) => deps.api(bearer, { forwardedFor }));
  const headers: Record<string, string> = {};
  if (
    resolved.clearCookie ||
    (token === null && request.headers.get('cookie')?.includes(`${policy.name}=`))
  ) {
    headers['set-cookie'] = sessionCookieClear(policy);
  }
  const body: SessionSnapshot = resolved.snapshot;
  return json(body, 200, headers);
}

/** `POST /api/auth/sign-in`: same-origin JSON only; exchanges an identity token for the HttpOnly session cookie. */
export async function handleSignIn(request: Request, deps: AuthHandlerDeps): Promise<Response> {
  const origin = checkSameOrigin(request, deps.env.appOrigin);
  if (!origin.ok) {
    return failure(403, 'FORBIDDEN', `Sign-in refused: ${origin.reason}.`);
  }
  if (!isJsonRequest(request)) {
    return failure(415, 'VALIDATION_FAILED', 'Sign-in expects a JSON body.');
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return failure(400, 'VALIDATION_FAILED', 'Sign-in body is not valid JSON.');
  }
  const parsed = signInBodySchema.safeParse(raw);
  if (!parsed.success) {
    return failure(400, 'VALIDATION_FAILED', 'Enter a subject such as did:test:alice.');
  }
  const forwardedFor = deps.forwardedFor(request);
  const api = (bearer: string | null) => deps.api(bearer, { forwardedFor });

  // The development issuer is a nonproduction capability twice over: the web
  // environment must be local or test, and the API must report it.
  const isDev = deps.env.markovEnv === 'local' || deps.env.markovEnv === 'test';
  if (!isDev) {
    return failure(403, 'FORBIDDEN', 'The development issuer is not available in this deployment.');
  }
  const platform = await resolvePlatform(api);
  if (platform.state === 'unreachable') {
    return failure(
      503,
      'PROVIDER_UNAVAILABLE',
      'Markov cannot reach its backend right now. Try again shortly.',
    );
  }
  if (platform.identityProvider !== 'test') {
    return failure(
      403,
      'FORBIDDEN',
      'The backend runs a hosted identity provider; the development issuer is off.',
    );
  }
  const minted = await mintDevelopmentIdentityToken(
    deps.env.apiOrigin,
    parsed.data.subject,
    deps.fetch,
    forwardedFor,
  ).catch(() => ({
    ok: false as const,
    status: 503,
    message: 'the development issuer did not answer',
  }));
  if (!minted.ok) {
    return failure(
      minted.status === 404 ? 403 : 503,
      minted.status === 404 ? 'FORBIDDEN' : 'PROVIDER_UNAVAILABLE',
      `Sign-in could not start: ${minted.message}.`,
    );
  }

  let session: z.infer<typeof sessionResponseSchema>;
  try {
    session = await attempt('POST /v1/auth/sessions', async () =>
      expectContract(
        'POST /v1/auth/sessions',
        await api(null).POST('/v1/auth/sessions', {
          body: { identityToken: minted.identityToken },
        }),
        sessionResponseSchema,
      ),
    );
  } catch (error) {
    if (error instanceof MarkovApiError) {
      if (error.code === 'RATE_LIMITED') {
        return failure(429, error.code, 'Too many sign-in attempts. Wait a minute and try again.');
      }
      return failure(
        error.status === 401 ? 401 : 502,
        error.code,
        'The identity token was not accepted.',
      );
    }
    if (error instanceof MarkovContractMismatchError) {
      return failure(502, 'CONTRACT_MISMATCH', 'The backend answered in an unexpected shape.');
    }
    if (error instanceof MarkovApiUnreachableError) {
      return failure(
        503,
        'PROVIDER_UNAVAILABLE',
        'Markov cannot reach its backend right now. Try again shortly.',
      );
    }
    throw error;
  }

  // Account change: a previous session on this browser is revoked server-side
  // so it cannot be replayed after the switch. Failure to revoke never blocks
  // the new sign-in; the old session still expires on its own.
  const policy = sessionCookiePolicy(deps.env);
  const previous = readSessionCookie(request.headers.get('cookie'), policy.name);
  if (previous && previous !== session.sessionToken) {
    await api(previous)
      .DELETE('/v1/auth/sessions/current')
      .catch(() => undefined);
  }

  const resolved = await resolveSession(session.sessionToken, api);
  if (resolved.snapshot.state !== 'signed-in') {
    return failure(502, 'SESSION_UNVERIFIED', 'The new session could not be verified.');
  }
  const body: SignInResponse = {
    ok: true,
    next: safeReturnPath(parsed.data.next),
    account: resolved.snapshot.account,
  };
  return json(body, 200, {
    'set-cookie': sessionCookieSet(policy, session.sessionToken, new Date(session.expiresAt)),
  });
}

/** `POST /api/auth/sign-out`: revokes the API session and clears the cookie. */
export async function handleSignOut(request: Request, deps: AuthHandlerDeps): Promise<Response> {
  const origin = checkSameOrigin(request, deps.env.appOrigin);
  if (!origin.ok) {
    return failure(403, 'FORBIDDEN', `Sign-out refused: ${origin.reason}.`);
  }
  const policy = sessionCookiePolicy(deps.env);
  const token = readSessionCookie(request.headers.get('cookie'), policy.name);
  let revoked = true;
  if (token) {
    const forwardedFor = deps.forwardedFor(request);
    try {
      const outcome = await deps.api(token, { forwardedFor }).DELETE('/v1/auth/sessions/current');
      // 401 means the session was already invalid; that is a completed sign-out.
      revoked = outcome.response.ok || outcome.response.status === 401;
    } catch {
      revoked = false;
    }
  }
  const body: SignOutResponse = { ok: true, revoked };
  return json(body, 200, { 'set-cookie': sessionCookieClear(policy) });
}
