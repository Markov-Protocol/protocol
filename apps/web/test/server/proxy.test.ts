import { describe, expect, it } from 'vitest';
import { parseWebEnv } from '../../src/config/web-env';
import { apiPathFrom, matchRoute, safeQuery } from '../../src/server/proxy/allowlist';
import { handleProxy, type ProxyDeps } from '../../src/server/proxy/handler';

const APP = 'http://127.0.0.1:3100';
const API = 'http://127.0.0.1:3000';
const WALLET = '11111111-1111-4111-8111-111111111111';
const parsed = parseWebEnv({
  MARKOV_ENV: 'test',
  NEXT_PUBLIC_APP_ORIGIN: APP,
  MARKOV_API_ORIGIN: API,
});
if (!parsed.ok) {
  throw new Error('test env invalid');
}
const env = parsed.value;

interface Upstream {
  readonly calls: Request[];
  readonly deps: ProxyDeps;
}

function upstream(
  respond: (request: Request) => Response | Promise<Response> = () =>
    Response.json({ wallets: [] }),
  unreachable = false,
): Upstream {
  const calls: Request[] = [];
  return {
    calls,
    deps: {
      env,
      fetch: async (request) => {
        calls.push(request);
        if (unreachable) {
          throw new TypeError('fetch failed');
        }
        return respond(request);
      },
      forwardedFor: (request) => request.headers.get('x-forwarded-for'),
    },
  };
}

function request(
  method: string,
  path: string,
  init: {
    cookie?: string;
    body?: string;
    origin?: string;
    contentType?: string;
    xff?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (init.cookie) {
    headers.set('cookie', init.cookie);
  }
  if (init.origin) {
    headers.set('origin', init.origin);
  }
  if (init.contentType) {
    headers.set('content-type', init.contentType);
  }
  if (init.xff) {
    headers.set('x-forwarded-for', init.xff);
  }
  return new Request(`${APP}/api/markov${path}`, {
    method,
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

const COOKIE = `__Host-markov_session=mkv_ss_abcdefgh_${'A'.repeat(43)}`;
const segments = (path: string) => path.split('/').filter(Boolean);

describe('proxy allowlist', () => {
  it('matches exactly the operations the app needs and refuses odd segments', () => {
    expect(matchRoute('GET', '/v1/me/wallets')?.method).toBe('GET');
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/funding`)).not.toBeNull();
    expect(matchRoute('DELETE', `/v1/me/wallets/${WALLET}`)).not.toBeNull();
    expect(matchRoute('GET', '/v1/terms/current')?.public).toBe(true);
    expect(matchRoute('GET', '/v1/me/api-credentials')).toBeNull();
    expect(matchRoute('DELETE', '/v1/me/wallets/not-a-uuid')).toBeNull();
    expect(matchRoute('PUT', '/v1/me/limits')).toBeNull();
    expect(matchRoute('GET', '/v1/ops/policy/participants')).toBeNull();
    expect(apiPathFrom(['v1', 'me', 'wallets'])).toBe('/v1/me/wallets');
    expect(apiPathFrom(['v1', '..', 'me'])).toBeNull();
    expect(apiPathFrom(['v1', 'me%2Fwallets'])).toBeNull();
    expect(apiPathFrom([])).toBeNull();
  });

  it('allows the public catalog reads and the watchlist operations added in F05', () => {
    expect(matchRoute('GET', '/v1/catalog/instruments')).toMatchObject({
      public: true,
      query: true,
    });
    expect(matchRoute('GET', `/v1/catalog/instruments/${WALLET}`)?.public).toBe(true);
    expect(matchRoute('GET', `/v1/catalog/instruments/${WALLET}/corporate-actions`)?.public).toBe(
      true,
    );
    expect(matchRoute('GET', `/v1/catalog/instruments/${WALLET}/multipliers`)?.public).toBe(true);
    expect(matchRoute('GET', `/v1/catalog/instruments/${WALLET}/quantities`)).toBeNull();
    expect(matchRoute('GET', '/v1/ops/catalog/instruments')).toBeNull();
    expect(matchRoute('GET', '/v1/me/watchlist')?.public).toBeUndefined();
    expect(matchRoute('PUT', `/v1/me/watchlist/items/${WALLET}`)).not.toBeNull();
    expect(matchRoute('DELETE', `/v1/me/watchlist/items/${WALLET}`)?.query).toBe(true);
    expect(matchRoute('POST', `/v1/me/watchlist/items/${WALLET}`)).toBeNull();
  });

  it('allows the research and strategy-draft operations added in F06', () => {
    expect(matchRoute('GET', '/v1/me/theses')).toMatchObject({ query: true });
    expect(matchRoute('POST', '/v1/me/theses')).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/theses/${WALLET}`)?.public).toBeUndefined();
    expect(matchRoute('PATCH', `/v1/me/theses/${WALLET}`)).not.toBeNull();
    expect(matchRoute('DELETE', `/v1/me/theses/${WALLET}`)).toBeNull();
    expect(matchRoute('POST', `/v1/me/theses/${WALLET}/revisions`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/theses/${WALLET}/revisions`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/theses/${WALLET}/sources`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/theses/${WALLET}/sources`)).not.toBeNull();
    expect(matchRoute('POST', '/v1/me/research/mappings')).not.toBeNull();
    expect(matchRoute('POST', '/v1/me/research/runs')).not.toBeNull();
    expect(matchRoute('GET', '/v1/me/research/runs')).toMatchObject({ query: true });
    expect(matchRoute('GET', `/v1/me/research/runs/${WALLET}`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/research/runs/${WALLET}/cancel`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/research/theses/${WALLET}`)?.public).toBe(true);
    expect(matchRoute('GET', '/v1/strategies/limits')?.public).toBe(true);
    expect(matchRoute('GET', '/v1/me/strategies')).not.toBeNull();
    expect(matchRoute('POST', '/v1/me/strategies')).not.toBeNull();
    // Nothing that pins or reaches operator routes.
    expect(matchRoute('POST', `/v1/me/instances/${WALLET}/pin`)).toBeNull();
    expect(matchRoute('GET', '/v1/ops/research')).toBeNull();
  });

  it('allows the basket builder operations added in F07 and nothing that pins', () => {
    expect(matchRoute('GET', `/v1/me/strategies/${WALLET}`)).not.toBeNull();
    expect(matchRoute('PATCH', `/v1/me/strategies/${WALLET}`)).not.toBeNull();
    expect(matchRoute('PUT', `/v1/me/strategies/${WALLET}/draft`)).not.toBeNull();
    expect(matchRoute('DELETE', `/v1/me/strategies/${WALLET}`)).toBeNull();
    expect(matchRoute('GET', `/v1/me/strategies/${WALLET}/versions`)).toBeNull();
    expect(matchRoute('GET', '/v1/me/limits')).not.toBeNull();
    expect(matchRoute('PUT', '/v1/me/limits')).toBeNull();
  });

  it('allows the publishing operations added in F08 and nothing that pins, lists records or diffs', () => {
    const RECORD = '4uFNLZ8GKBUywsX48vYhMeGjgpjdQC2iN6pQxo1JTG3X';
    expect(matchRoute('GET', '/v1/registry')?.public).toBe(true);
    expect(matchRoute('POST', `/v1/me/strategies/${WALLET}/versions`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/strategies/${WALLET}/versions/${WALLET}`)).not.toBeNull();
    expect(
      matchRoute('POST', `/v1/me/strategies/${WALLET}/versions/${WALLET}/publication`),
    ).not.toBeNull();
    expect(
      matchRoute('GET', `/v1/me/strategies/${WALLET}/versions/${WALLET}/publication`)?.public,
    ).toBeUndefined();
    expect(
      matchRoute('POST', `/v1/me/strategies/${WALLET}/versions/${WALLET}/status-changes`),
    ).not.toBeNull();
    expect(
      matchRoute('GET', `/v1/me/strategies/${WALLET}/versions/${WALLET}/status-changes`),
    ).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/publications/${WALLET}/submit`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/publications/${WALLET}`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/strategies/${WALLET}/forks`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/strategies/${WALLET}`)?.public).toBe(true);
    expect(matchRoute('GET', `/v1/strategies/${WALLET}/versions/${WALLET}`)?.public).toBe(true);
    expect(matchRoute('GET', `/v1/registry/records/${RECORD}`)?.public).toBe(true);
    expect(matchRoute('GET', '/v1/registry/records/not-an-address')).toBeNull();
    expect(matchRoute('GET', '/v1/me/follows')).not.toBeNull();
    expect(matchRoute('PUT', `/v1/me/follows/${WALLET}`)).not.toBeNull();
    expect(matchRoute('DELETE', `/v1/me/follows/${WALLET}`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/strategies/${WALLET}/versions/${WALLET}/diff`)).toBeNull();
    expect(matchRoute('DELETE', `/v1/me/publications/${WALLET}`)).toBeNull();
    expect(matchRoute('POST', `/v1/me/instances/${WALLET}/pin`)).toBeNull();
    expect(matchRoute('GET', '/v1/registry/records')).toBeNull();
  });

  it('allows the review operations added in F09 and nothing that signs, submits or reads another owner', () => {
    expect(matchRoute('POST', '/v1/me/intents')).not.toBeNull();
    expect(matchRoute('GET', '/v1/me/intents')).not.toBeNull();
    expect(matchRoute('GET', '/v1/me/intents')?.query).toBeUndefined();
    expect(matchRoute('GET', `/v1/me/intents/${WALLET}`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/intents/${WALLET}/plans`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/intents/${WALLET}/plans/${WALLET}`)).not.toBeNull();
    expect(
      matchRoute('POST', `/v1/me/intents/${WALLET}/plans/${WALLET}/acknowledgements`),
    ).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/intents/${WALLET}/cancel`)).not.toBeNull();
    for (const route of [
      ['GET', `/v1/me/intents/${WALLET}/plans`],
      ['DELETE', `/v1/me/intents/${WALLET}`],
      ['POST', `/v1/me/intents/${WALLET}/plans/${WALLET}/submit`],
      ['POST', `/v1/me/intents/${WALLET}/plans/${WALLET}/signatures`],
      ['GET', `/v1/me/intents/not-an-id`],
      ['GET', '/v1/intents'],
    ] as const) {
      expect(matchRoute(route[0], route[1]), route.join(' ')).toBeNull();
    }
    expect(matchRoute('POST', '/v1/me/intents')?.public).toBeUndefined();
  });

  it('allows the execution and receipt operations added in F10 and nothing that bypasses the API', () => {
    expect(matchRoute('POST', `/v1/me/intents/${WALLET}/transactions`)).not.toBeNull();
    expect(
      matchRoute('POST', `/v1/me/intents/${WALLET}/transactions/0/submissions`),
    ).not.toBeNull();
    expect(
      matchRoute('POST', `/v1/me/intents/${WALLET}/transactions/31/submissions`),
    ).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/intents/${WALLET}/execution`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/intents/${WALLET}/execution/reconciliations`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/intents/${WALLET}/receipts`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/intents/${WALLET}/receipts`)).not.toBeNull();
    expect(matchRoute('GET', '/v1/me/receipts')).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/receipts/${WALLET}/visibility`)).not.toBeNull();
    expect(matchRoute('GET', '/v1/receipts/keys')?.public).toBe(true);
    expect(matchRoute('GET', `/v1/receipts/${WALLET}`)?.public).toBe(true);
    expect(matchRoute('GET', `/v1/me/intents/${WALLET}/execution`)?.public).toBeUndefined();
    for (const route of [
      ['GET', `/v1/me/intents/${WALLET}/transactions`],
      ['POST', `/v1/me/intents/${WALLET}/transactions/32/submissions`],
      ['POST', `/v1/me/intents/${WALLET}/transactions/x/submissions`],
      ['POST', `/v1/me/intents/${WALLET}/transactions/0/submissions/retry`],
      ['DELETE', `/v1/me/receipts/${WALLET}`],
      ['GET', `/v1/receipts/${WALLET}/keys`],
      ['GET', '/v1/receipts'],
    ] as const) {
      expect(matchRoute(route[0], route[1]), route.join(' ')).toBeNull();
    }
    expect(apiPathFrom(segments(`/v1/me/intents/${WALLET}/transactions/0/submissions`))).toBe(
      `/v1/me/intents/${WALLET}/transactions/0/submissions`,
    );
  });

  it('allows the portfolio operations added in F11 and nothing that pins, values or ranks', () => {
    expect(matchRoute('GET', '/v1/me/instances')).not.toBeNull();
    expect(matchRoute('POST', '/v1/me/instances')).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/instances/${WALLET}`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/holdings`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/wallets/${WALLET}/reconciliations`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/journal`)).not.toBeNull();
    expect(matchRoute('POST', `/v1/me/journal/${WALLET}/acknowledgements`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/instances/${WALLET}/holdings`)).not.toBeNull();
    expect(matchRoute('GET', `/v1/me/instances/${WALLET}/performance`)?.query).toBe(true);
    expect(matchRoute('GET', `/v1/me/instances/${WALLET}/performance/export`)?.query).toBe(true);
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/performance`)?.query).toBe(true);
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/performance/export`)?.query).toBe(true);
    const model = matchRoute('GET', `/v1/strategies/${WALLET}/versions/1/performance`);
    expect(model?.public).toBe(true);
    expect(model?.query).toBe(true);
    expect(
      matchRoute('GET', `/v1/strategies/${WALLET}/versions/12/performance/export`)?.public,
    ).toBe(true);
    expect(matchRoute('GET', '/v1/performance/methodology')?.public).toBe(true);
    expect(matchRoute('GET', `/v1/me/wallets/${WALLET}/holdings`)?.public).toBeUndefined();
    for (const route of [
      ['POST', `/v1/me/instances/${WALLET}/pin`],
      ['DELETE', `/v1/me/instances/${WALLET}`],
      ['POST', `/v1/me/instances/${WALLET}/holdings`],
      ['POST', `/v1/me/journal/projections`],
      ['GET', `/v1/me/journal/${WALLET}`],
      ['GET', `/v1/strategies/${WALLET}/versions/0/performance`],
      ['GET', `/v1/strategies/${WALLET}/versions/${WALLET}/performance`],
      ['GET', '/v1/rankings/model'],
      ['POST', '/v1/operator/prices/observations'],
      ['GET', '/v1/prices/sol'],
    ] as const) {
      expect(matchRoute(route[0], route[1]), route.join(' ')).toBeNull();
    }
  });

  it('re-encodes a bounded query string and refuses the rest', () => {
    expect(safeQuery('')).toBe('');
    expect(safeQuery('?q=Fixture%20Aero&issuer=prestocks&limit=25')).toBe(
      '?q=Fixture+Aero&issuer=prestocks&limit=25',
    );
    expect(safeQuery('?q=a%3Cscript%3E')).toBe('?q=a%3Cscript%3E');
    expect(safeQuery('?q=%00')).toBeNull();
    expect(safeQuery('?bad-key=1')).toBeNull();
    expect(safeQuery(`?q=${'a'.repeat(201)}`)).toBeNull();
    expect(safeQuery(`?${Array.from({ length: 9 }, (_, i) => `k${i}=1`).join('&')}`)).toBeNull();
    expect(safeQuery(`?q=${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('proxy handler', () => {
  it('forwards an allowlisted read with the cookie as bearer, the client address and no-store', async () => {
    const api = upstream(() =>
      Response.json(
        { wallets: [{ walletId: WALLET }] },
        { headers: { 'set-cookie': 'leak=1', 'x-upstream': 'secret' } },
      ),
    );
    const response = await handleProxy(
      request('GET', '/v1/me/wallets', { cookie: COOKIE, xff: '10.1.2.3' }),
      segments('/v1/me/wallets'),
      api.deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wallets: [{ walletId: WALLET }] });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-upstream')).toBeNull();
    const call = api.calls[0];
    expect(call?.url).toBe(`${API}/v1/me/wallets`);
    expect(call?.headers.get('authorization')).toBe(`Bearer mkv_ss_abcdefgh_${'A'.repeat(43)}`);
    expect(call?.headers.get('x-forwarded-for')).toBe('10.1.2.3');
    expect(call?.headers.get('cookie')).toBeNull();
  });

  it('forwards a public catalog search anonymously with its query and refuses queries elsewhere', async () => {
    const api = upstream(() => Response.json({ instruments: [], nextCursor: null }));
    const response = await handleProxy(
      request('GET', '/v1/catalog/instruments?q=Fixture%20Aero&issuer=prestocks&x=%3Cb%3E'),
      segments('/v1/catalog/instruments'),
      api.deps,
    );
    expect(response.status).toBe(200);
    expect(api.calls[0]?.url).toBe(
      `${API}/v1/catalog/instruments?q=Fixture+Aero&issuer=prestocks&x=%3Cb%3E`,
    );
    expect(api.calls[0]?.headers.get('authorization')).toBeNull();
    const refused = await handleProxy(
      request('GET', '/v1/me/wallets?debug=1', { cookie: COOKIE }),
      segments('/v1/me/wallets'),
      api.deps,
    );
    expect(refused.status).toBe(400);
    expect(api.calls).toHaveLength(1);
    const tooMany = await handleProxy(
      request(
        'GET',
        `/v1/catalog/instruments?${Array.from({ length: 9 }, (_, i) => `k${i}=1`).join('&')}`,
      ),
      segments('/v1/catalog/instruments'),
      api.deps,
    );
    expect(tooMany.status).toBe(400);
    expect(api.calls).toHaveLength(1);
  });

  it('answers 404 for anything outside the allowlist before touching the session', async () => {
    const api = upstream();
    for (const [method, path] of [
      ['GET', '/v1/me/api-credentials'],
      ['GET', '/v1/ops/policy/participants'],
      ['POST', '/v1/auth/sessions'],
      ['GET', '/v1/me/wallets/../devices'],
    ] as const) {
      const response = await handleProxy(
        request(method, path, {
          cookie: COOKIE,
          origin: APP,
          ...(method === 'GET' ? {} : { contentType: 'application/json', body: '{}' }),
        }),
        segments(path),
        api.deps,
      );
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(api.calls).toHaveLength(0);
  });

  it('requires a session for private operations and lets the current terms through anonymously', async () => {
    const api = upstream(() => Response.json({ documents: [] }));
    expect(
      (
        await handleProxy(
          request('GET', '/v1/me/eligibility'),
          segments('/v1/me/eligibility'),
          api.deps,
        )
      ).status,
    ).toBe(401);
    expect(api.calls).toHaveLength(0);
    const terms = await handleProxy(
      request('GET', '/v1/terms/current'),
      segments('/v1/terms/current'),
      api.deps,
    );
    expect(terms.status).toBe(200);
    expect(api.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('refuses cross-origin, non-JSON, malformed and oversized mutations without calling the API', async () => {
    const api = upstream();
    const path = '/v1/me/wallets/challenges';
    const crossOrigin = await handleProxy(
      request('POST', path, {
        cookie: COOKIE,
        origin: 'https://evil.example',
        contentType: 'application/json',
        body: '{}',
      }),
      segments(path),
      api.deps,
    );
    expect(crossOrigin.status).toBe(403);
    const form = await handleProxy(
      request('POST', path, {
        cookie: COOKIE,
        origin: APP,
        contentType: 'application/x-www-form-urlencoded',
        body: 'a=1',
      }),
      segments(path),
      api.deps,
    );
    expect(form.status).toBe(415);
    const malformed = await handleProxy(
      request('POST', path, {
        cookie: COOKIE,
        origin: APP,
        contentType: 'application/json',
        body: '{oops',
      }),
      segments(path),
      api.deps,
    );
    expect(malformed.status).toBe(400);
    const huge = await handleProxy(
      request('POST', path, {
        cookie: COOKIE,
        origin: APP,
        contentType: 'application/json',
        body: JSON.stringify({ pad: 'x'.repeat(70_000) }),
      }),
      segments(path),
      api.deps,
    );
    expect(huge.status).toBe(413);
    expect(api.calls).toHaveLength(0);
  });

  it('passes upstream error envelopes and status codes through unchanged', async () => {
    const api = upstream(() =>
      Response.json(
        { error: { code: 'WALLET_ALREADY_LINKED', message: 'linked elsewhere', requestId: 'r1' } },
        { status: 409 },
      ),
    );
    const response = await handleProxy(
      request('POST', '/v1/me/wallets', {
        cookie: COOKIE,
        origin: APP,
        contentType: 'application/json',
        body: '{"challengeId":"x"}',
      }),
      segments('/v1/me/wallets'),
      api.deps,
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('WALLET_ALREADY_LINKED');
    expect(await api.calls[0]?.text()).toBe('{"challengeId":"x"}');
    const noContent = await handleProxy(
      request('DELETE', `/v1/me/wallets/${WALLET}`, { cookie: COOKIE, origin: APP }),
      segments(`/v1/me/wallets/${WALLET}`),
      upstream(() => new Response(null, { status: 204 })).deps,
    );
    expect(noContent.status).toBe(204);
  });

  it('forwards a PATCH with its JSON body under the same mutation rules and lets a public thesis through anonymously', async () => {
    const api = upstream(() => Response.json({ thesis: { visibility: 'public' } }));
    const response = await handleProxy(
      request('PATCH', `/v1/me/theses/${WALLET}`, {
        cookie: COOKIE,
        origin: APP,
        contentType: 'application/json',
        body: JSON.stringify({ visibility: 'public' }),
      }),
      segments(`/v1/me/theses/${WALLET}`),
      api.deps,
    );
    expect(response.status).toBe(200);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('PATCH');
    expect(await api.calls[0]?.text()).toBe('{"visibility":"public"}');
    expect(api.calls[0]?.headers.get('authorization')).toMatch(/^Bearer mkv_ss_/);

    const notJson = await handleProxy(
      request('PATCH', `/v1/me/theses/${WALLET}`, {
        cookie: COOKIE,
        origin: APP,
        body: 'visibility=public',
      }),
      segments(`/v1/me/theses/${WALLET}`),
      api.deps,
    );
    expect(notJson.status).toBe(415);
    const crossOrigin = await handleProxy(
      request('PATCH', `/v1/me/theses/${WALLET}`, {
        cookie: COOKIE,
        origin: 'https://evil.example',
        contentType: 'application/json',
        body: '{}',
      }),
      segments(`/v1/me/theses/${WALLET}`),
      api.deps,
    );
    expect(crossOrigin.status).toBe(403);
    expect(api.calls).toHaveLength(1);

    const publicThesis = upstream(() => Response.json({ thesisId: WALLET }));
    const anonymous = await handleProxy(
      request('GET', `/v1/research/theses/${WALLET}`),
      segments(`/v1/research/theses/${WALLET}`),
      publicThesis.deps,
    );
    expect(anonymous.status).toBe(200);
    expect(publicThesis.calls[0]?.headers.get('authorization')).toBeNull();
    const privateList = await handleProxy(
      request('GET', '/v1/me/theses?instrumentId=abc'),
      segments('/v1/me/theses'),
      publicThesis.deps,
    );
    expect(privateList.status).toBe(401);
  });

  it('reports an unreachable backend as 503 instead of pretending', async () => {
    const api = upstream(undefined, true);
    const response = await handleProxy(
      request('GET', '/v1/me/wallets', { cookie: COOKIE }),
      segments('/v1/me/wallets'),
      api.deps,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});
