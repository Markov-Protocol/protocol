import { createMarkovApiClient } from '@markov/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseWebEnv, type WebEnv } from '../../src/config/web-env';
import { safeReturnPath, signInHref } from '../../src/features/auth/return-path';
import {
  readSessionCookie,
  sessionCookieClear,
  sessionCookiePolicy,
  sessionCookieSet,
} from '../../src/server/auth/cookies';
import {
  type AuthHandlerDeps,
  handleSessionGet,
  handleSignIn,
  handleSignOut,
} from '../../src/server/auth/handlers';
import { checkSameOrigin } from '../../src/server/auth/origin';
import { resetPlatformCache } from '../../src/server/auth/session';

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const APP = 'http://127.0.0.1:3100';

interface FakeOptions {
  identityProvider?: 'test' | 'oidc';
  unreachable?: boolean;
  rateLimited?: boolean;
}

interface FakeSession {
  readonly sessionId: string;
  readonly subject: string;
  readonly expiresAt: Date;
  revoked: boolean;
}

/** In-memory stand-in for the Markov API identity routes, speaking the real envelopes. */
function fakeApi(options: FakeOptions = {}) {
  const sessions = new Map<string, FakeSession>();
  const calls: { key: string; headers: Headers }[] = [];
  let counter = 0;
  const envelope = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message, requestId: `req-${status}` } }, { status });
  const fetchImpl = async (request: Request): Promise<Response> => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    calls.push({ key, headers: request.headers });
    if (options.unreachable) {
      throw new TypeError('fetch failed');
    }
    const auth = request.headers.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    switch (key) {
      case 'GET /v1/platform':
        return Response.json({
          service: 'markov-api',
          version: 'test',
          contractSchemaVersion: '1',
          identity: { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
          identityProvider: options.identityProvider ?? 'test',
          executionWritesEnabled: false,
          capabilities: [],
        });
      case 'POST /v1/auth/test-tokens': {
        if ((options.identityProvider ?? 'test') !== 'test') {
          return envelope(404, 'NOT_FOUND', 'route not found');
        }
        const body = (await request.json()) as { subject: string };
        return Response.json(
          { identityToken: `idt.${body.subject}.${'x'.repeat(40)}` },
          { status: 201 },
        );
      }
      case 'POST /v1/auth/sessions': {
        if (options.rateLimited) {
          return envelope(429, 'RATE_LIMITED', 'slow down');
        }
        const body = (await request.json()) as { identityToken: string };
        const subject = body.identityToken.split('.')[1] ?? 'unknown';
        counter += 1;
        const token = `mkv_ss_sess${counter}abc_${'A'.repeat(43)}`;
        const sessionId = `00000000-0000-4000-8000-00000000000${counter}`;
        const expiresAt = new Date(Date.now() + 3600_000);
        sessions.set(token, { sessionId, subject, expiresAt, revoked: false });
        return Response.json(
          {
            sessionId,
            sessionToken: token,
            expiresAt: expiresAt.toISOString(),
            authTime: new Date().toISOString(),
          },
          { status: 201 },
        );
      }
      case 'GET /v1/me': {
        const session = bearer ? sessions.get(bearer) : undefined;
        if (!session || session.revoked || session.expiresAt.getTime() <= Date.now()) {
          return envelope(401, 'AUTH_REQUIRED', 'sign in');
        }
        return Response.json({
          principal: {
            class: 'user',
            id: '11111111-1111-4111-8111-111111111111',
            userId: '11111111-1111-4111-8111-111111111111',
            scopes: ['owner:*'],
            authTime: new Date().toISOString(),
            stepUpFresh: true,
          },
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            subject: session.subject,
            issuer: 'https://issuer.test',
            createdAt: new Date().toISOString(),
          },
          session: { sessionId: session.sessionId, expiresAt: session.expiresAt.toISOString() },
        });
      }
      case 'DELETE /v1/auth/sessions/current': {
        const session = bearer ? sessions.get(bearer) : undefined;
        if (!session || session.revoked) {
          return envelope(401, 'AUTH_REQUIRED', 'sign in');
        }
        session.revoked = true;
        return new Response(null, { status: 204 });
      }
      default:
        return envelope(404, 'NOT_FOUND', 'no route');
    }
  };
  return { fetchImpl, sessions, calls };
}

function envFor(overrides: Record<string, string> = {}): WebEnv {
  const result = parseWebEnv({ MARKOV_ENV: 'test', NEXT_PUBLIC_APP_ORIGIN: APP, ...overrides });
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.path).join(','));
  }
  return result.value;
}

function depsFor(fake: ReturnType<typeof fakeApi>, env: WebEnv = envFor()): AuthHandlerDeps {
  return {
    env,
    api: (bearer, context) =>
      createMarkovApiClient({
        baseUrl: env.apiOrigin,
        bearer,
        fetch: fake.fetchImpl,
        ...(context.forwardedFor ? { headers: { 'x-forwarded-for': context.forwardedFor } } : {}),
      }),
    fetch: fake.fetchImpl,
    forwardedFor: (request) => request.headers.get('x-forwarded-for'),
  };
}

function signInRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {},
  cookie?: string,
): Request {
  return new Request(`${APP}/api/auth/sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function sessionRequest(cookie?: string): Request {
  return new Request(`${APP}/api/auth/session`, { headers: cookie ? { cookie } : {} });
}

function signOutRequest(cookie?: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request(`${APP}/api/auth/sign-out`, {
    method: 'POST',
    headers: {
      origin: APP,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
  });
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

beforeEach(() => {
  resetPlatformCache();
});

describe('return paths', () => {
  it('accepts only local paths and refuses redirects elsewhere', () => {
    expect(safeReturnPath('/portfolio?tab=holdings#top')).toBe('/portfolio?tab=holdings#top');
    expect(safeReturnPath('/strategies/new')).toBe('/strategies/new');
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/portfolio\\@evil',
      '%2F%2Fevil.example',
      '/sign-in',
      '/sign-in?next=/x',
      '/auth/callback',
      '',
      ' /portfolio',
      '/port\nfolio',
      42,
      null,
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(safeReturnPath(bad)).toBe('/');
    }
  });

  it('builds sign-in links that keep a validated return path', () => {
    expect(signInHref('/portfolio')).toBe('/sign-in?next=%2Fportfolio');
    expect(signInHref('https://evil.example')).toBe('/sign-in');
    expect(signInHref(null)).toBe('/sign-in');
  });
});

describe('session cookie policy', () => {
  it('is host-only and secure everywhere except local http', () => {
    expect(sessionCookiePolicy({ markovEnv: 'local', appOrigin: null })).toEqual({
      name: 'markov_session',
      secure: false,
    });
    expect(
      sessionCookiePolicy({ markovEnv: 'local', appOrigin: 'https://dev.markov.pet' }),
    ).toEqual({
      name: '__Host-markov_session',
      secure: true,
    });
    expect(sessionCookiePolicy({ markovEnv: 'test', appOrigin: null }).name).toBe(
      '__Host-markov_session',
    );
    expect(
      sessionCookiePolicy({ markovEnv: 'production', appOrigin: 'https://markov.pet' }).secure,
    ).toBe(true);
  });

  it('serialises HttpOnly, SameSite=Lax, Path=/ cookies and clears them the same way', () => {
    const policy = sessionCookiePolicy({ markovEnv: 'test', appOrigin: null });
    const token = `mkv_ss_abcdefgh_${'B'.repeat(43)}`;
    const set = sessionCookieSet(policy, token, new Date('2026-09-25T10:00:00Z'));
    expect(set).toBe(
      `__Host-markov_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=Fri, 25 Sep 2026 10:00:00 GMT; Secure`,
    );
    expect(sessionCookieClear(policy)).toBe(
      '__Host-markov_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure',
    );
    expect(set).not.toContain('Domain=');
  });

  it('reads only well-formed session tokens', () => {
    const token = `mkv_ss_abcdefgh_${'C'.repeat(43)}`;
    expect(
      readSessionCookie(`other=1; __Host-markov_session=${token}; x=y`, '__Host-markov_session'),
    ).toBe(token);
    expect(readSessionCookie('__Host-markov_session=garbage', '__Host-markov_session')).toBeNull();
    expect(readSessionCookie(`markov_session=${token}`, '__Host-markov_session')).toBeNull();
    expect(readSessionCookie(null, '__Host-markov_session')).toBeNull();
  });
});

describe('same-origin guard', () => {
  const request = (headers: Record<string, string>) =>
    new Request(`${APP}/api/auth/sign-out`, { method: 'POST', headers });
  it('accepts same-origin browser requests and refuses everything else', () => {
    expect(checkSameOrigin(request({ origin: APP, 'sec-fetch-site': 'same-origin' }), APP).ok).toBe(
      true,
    );
    expect(checkSameOrigin(request({ 'sec-fetch-site': 'same-origin' }), APP).ok).toBe(true);
    expect(
      checkSameOrigin(
        request({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
        APP,
      ).ok,
    ).toBe(false);
    expect(checkSameOrigin(request({ origin: 'https://evil.example' }), APP).ok).toBe(false);
    expect(checkSameOrigin(request({}), APP).ok).toBe(false);
    expect(checkSameOrigin(request({ origin: APP, 'sec-fetch-site': 'same-site' }), APP).ok).toBe(
      false,
    );
    expect(
      checkSameOrigin(
        new Request('http://internal:3000/api/auth/sign-out', {
          method: 'POST',
          headers: {
            origin: 'https://markov.pet',
            'x-forwarded-host': 'markov.pet',
            'x-forwarded-proto': 'https',
          },
        }),
        null,
      ).ok,
    ).toBe(true);
  });
});

describe('sign-in, session and sign-out handlers', () => {
  it('signs in with the development issuer, resolves, signs out and refuses the replayed cookie', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    const signedIn = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      deps,
    );
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get('cache-control')).toBe('no-store');
    const setCookie = signedIn.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(
      /^__Host-markov_session=mkv_ss_[1-9A-HJ-NP-Za-km-z]+_[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Expires=.*; Secure$/,
    );
    const body = (await signedIn.json()) as {
      ok: true;
      next: string;
      account: { subject: string };
    };
    expect(body.next).toBe('/');
    expect(body.account.subject).toBe('did:test:alice');
    expect(JSON.stringify(body)).not.toContain('mkv_ss_');

    const cookie = cookieFrom(signedIn);
    const session = await handleSessionGet(sessionRequest(cookie), deps);
    expect(await session.json()).toMatchObject({
      state: 'signed-in',
      account: { subject: 'did:test:alice' },
    });
    expect(session.headers.get('set-cookie')).toBeNull();

    const signedOut = await handleSignOut(signOutRequest(cookie), deps);
    expect(await signedOut.json()).toEqual({ ok: true, revoked: true });
    expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0');

    const replayed = await handleSessionGet(sessionRequest(cookie), deps);
    expect(await replayed.json()).toEqual({ state: 'signed-out' });
    expect(replayed.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps only a validated local return path', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    const evil = await handleSignIn(
      signInRequest({
        provider: 'test',
        subject: 'did:test:alice',
        next: 'https://evil.example/steal',
      }),
      deps,
    );
    expect(((await evil.json()) as { next: string }).next).toBe('/');
    const local = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice', next: '/portfolio?tab=1' }),
      deps,
    );
    expect(((await local.json()) as { next: string }).next).toBe('/portfolio?tab=1');
  });

  it('refuses cross-origin, non-JSON and malformed sign-in attempts before touching the API', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    const crossSite = await handleSignIn(
      signInRequest(
        { provider: 'test', subject: 'did:test:alice' },
        { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      ),
      deps,
    );
    expect(crossSite.status).toBe(403);
    const form = await handleSignIn(
      new Request(`${APP}/api/auth/sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: APP,
          'sec-fetch-site': 'same-origin',
        },
        body: 'provider=test&subject=did:test:alice',
      }),
      deps,
    );
    expect(form.status).toBe(415);
    const malformed = await handleSignIn(signInRequest({ provider: 'test', subject: 'x' }), deps);
    expect(malformed.status).toBe(400);
    expect(fake.calls).toHaveLength(0);
    const crossSiteSignOut = await handleSignOut(
      signOutRequest(undefined, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      deps,
    );
    expect(crossSiteSignOut.status).toBe(403);
    expect(crossSiteSignOut.headers.get('set-cookie')).toBeNull();
  });

  it('reports honest failures: hosted provider, unreachable backend, rate limit, production environment', async () => {
    const hosted = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      depsFor(fakeApi({ identityProvider: 'oidc' })),
    );
    expect(hosted.status).toBe(403);
    expect(await hosted.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    resetPlatformCache();
    const unreachable = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      depsFor(fakeApi({ unreachable: true })),
    );
    expect(unreachable.status).toBe(503);
    expect(await unreachable.json()).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });

    resetPlatformCache();
    const limited = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      depsFor(fakeApi({ rateLimited: true })),
    );
    expect(limited.status).toBe(429);

    resetPlatformCache();
    const production = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      depsFor(
        fakeApi(),
        envFor({
          MARKOV_ENV: 'production',
          NEXT_PUBLIC_APP_ORIGIN: 'https://markov.pet',
          MARKOV_API_ORIGIN: 'https://api.markov.pet',
        }),
      ),
    );
    expect(production.status).toBe(403);
  });

  it('revokes the previous session on account change so it cannot be replayed', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    const alice = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      deps,
    );
    const aliceCookie = cookieFrom(alice);
    const bob = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:bob' }, {}, aliceCookie),
      deps,
    );
    const bobCookie = cookieFrom(bob);
    expect(bobCookie).not.toBe(aliceCookie);
    expect(fake.sessions.get(aliceCookie.split('=')[1] ?? '')?.revoked).toBe(true);
    expect(await (await handleSessionGet(sessionRequest(aliceCookie), deps)).json()).toEqual({
      state: 'signed-out',
    });
    expect(await (await handleSessionGet(sessionRequest(bobCookie), deps)).json()).toMatchObject({
      state: 'signed-in',
      account: { subject: 'did:test:bob' },
    });
  });

  it('treats a malformed cookie as signed out and clears it, and reports an unreachable backend honestly', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    const garbage = await handleSessionGet(
      sessionRequest('__Host-markov_session=not-a-token'),
      deps,
    );
    expect(await garbage.json()).toEqual({ state: 'signed-out' });
    expect(garbage.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(fake.calls).toHaveLength(0);

    const alice = await handleSignIn(
      signInRequest({ provider: 'test', subject: 'did:test:alice' }),
      deps,
    );
    const cookie = cookieFrom(alice);
    const down = depsFor(fakeApi({ unreachable: true }));
    const unavailable = await handleSessionGet(sessionRequest(cookie), down);
    expect(await unavailable.json()).toEqual({ state: 'unavailable', reason: 'api-unreachable' });
    expect(unavailable.headers.get('set-cookie')).toBeNull();
    const signedOut = await handleSignOut(signOutRequest(cookie), down);
    expect(await signedOut.json()).toEqual({ ok: true, revoked: false });
    expect(signedOut.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('forwards the client address to the API and never the cookie value in the body', async () => {
    const fake = fakeApi();
    const deps = depsFor(fake);
    await handleSignIn(
      signInRequest(
        { provider: 'test', subject: 'did:test:alice' },
        { 'x-forwarded-for': '203.0.113.9' },
      ),
      deps,
    );
    const exchange = fake.calls.find((call) => call.key === 'POST /v1/auth/sessions');
    expect(exchange?.headers.get('x-forwarded-for')).toBe('203.0.113.9');
    const mint = fake.calls.find((call) => call.key === 'POST /v1/auth/test-tokens');
    expect(mint?.headers.get('x-forwarded-for')).toBe('203.0.113.9');
  });
});
