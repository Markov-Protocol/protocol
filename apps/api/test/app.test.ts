import { loadConfig } from '@markov/config';
import { createSilentLogger } from '@markov/observability';
import { baseTestEnv } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  type ApiProbes,
  buildApp,
  type CatalogService,
  type FundingService,
  type IdentityService,
  type NetworkIdentitySnapshot,
  type PolicyService,
  type RegistryService,
  type ResearchService,
  type StrategyService,
  type WatchlistService,
} from '../src/index.js';
import { unavailable } from './support/unavailable.js';

const unavailableIdentity = new Proxy({} as IdentityService, {
  get: () => () => {
    throw new Error('identity service is not part of this test');
  },
});
const unavailableFunding = new Proxy({} as FundingService, {
  get: () => () => {
    throw new Error('funding service is not part of this test');
  },
});
const unavailableResearch = new Proxy({} as ResearchService, {
  get: () => () => {
    throw new Error('research service is not part of this test');
  },
});
const unavailableWatchlists = new Proxy({} as WatchlistService, {
  get: () => () => {
    throw new Error('watchlist service is not part of this test');
  },
});
const unavailableStrategies = new Proxy({} as StrategyService, {
  get: () => () => {
    throw new Error('strategy service is not part of this test');
  },
});
const unavailablePolicy = new Proxy({} as PolicyService, {
  get: () => () => {
    throw new Error('policy service is not part of this test');
  },
});
const unavailableCatalog = new Proxy({} as CatalogService, {
  get: () => () => {
    throw new Error('catalog service is unavailable in this test');
  },
});

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const pass = { ok: true, detail: 'fine', durationMs: 1 };
const fail = { ok: false, detail: 'broken', durationMs: 1 };

function probes(overrides: Partial<ApiProbes> = {}): ApiProbes {
  return {
    database: async () => pass,
    schema: async () => ({ ...pass, latestTag: '0000_platform_identity' }),
    platformIdentity: async () => ({
      ...pass,
      identity: {
        markovEnv: 'test',
        solanaCluster: 'devnet',
        genesisHash: GENESIS,
        boundAt: '2026-09-24T00:00:00.000Z',
        boundBy: 'test',
      },
    }),
    capabilities: async () => [
      {
        capability: 'platform.api.health',
        status: 'IMPLEMENTED',
        summary: 'ok',
        evidence: {},
        updatedAt: '2026-09-24T00:00:00.000Z',
        updatedBy: 'test',
      },
    ],
    ...overrides,
  };
}

const verified: NetworkIdentitySnapshot = {
  status: 'verified',
  observedGenesisHash: GENESIS,
  detail: 'genesis hash matches',
  checkedAt: '2026-09-24T00:00:00.000Z',
  durationMs: 5,
};

async function makeApp(
  options: {
    probes?: ApiProbes;
    network?: NetworkIdentitySnapshot;
    env?: Record<string, string>;
  } = {},
) {
  const config = loadConfig(baseTestEnv(options.env));
  const app = await buildApp({
    config,
    logger: createSilentLogger(),
    service: { name: 'markov-api', version: 'test', startedAt: Date.now() - 5_000 },
    probes: options.probes ?? probes(),
    network: { snapshot: () => options.network ?? verified },
    expectedGenesisHash: GENESIS,
    identity: unavailableIdentity,
    catalog: unavailableCatalog,
    policy: unavailablePolicy,
    funding: unavailableFunding,
    research: unavailableResearch,
    watchlists: unavailableWatchlists,
    registry: unavailable<RegistryService>('registry'),
    strategies: unavailableStrategies,
    mintTestToken: null,
  });
  await app.ready();
  return app;
}

describe('liveness', () => {
  it('answers /healthz with the contract shape and a generated request id', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'markov-api', version: 'test' });
    expect(response.json().uptimeSeconds).toBeGreaterThanOrEqual(5);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it('echoes a well-formed caller request id and replaces a malformed one', async () => {
    const app = await makeApp();
    const echoed = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'trace-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('trace-123');
    const replaced = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': 'bad value with spaces and <html>' },
    });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
});

describe('readiness', () => {
  it('is ready only when every required check passes', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(Object.keys(body.checks).sort()).toEqual([
      'database',
      'platform_identity',
      'schema',
      'solana_rpc',
    ]);
    expect(body.platform).toEqual({
      markovEnv: 'test',
      solanaCluster: 'devnet',
      expectedGenesisHash: GENESIS,
      observedGenesisHash: GENESIS,
      schemaVersion: '0000_platform_identity',
    });
    await app.close();
  });

  it('reports 503 with the failing check when the database probe fails', async () => {
    const app = await makeApp({ probes: probes({ database: async () => fail }) });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.database).toMatchObject({
      status: 'fail',
      detail: 'broken',
      required: true,
    });
    expect(response.json().checks.schema.status).toBe('pass');
    await app.close();
  });

  it('distinguishes an unverified network from a contradicted one', async () => {
    const unverified = await makeApp({
      network: {
        status: 'unavailable',
        observedGenesisHash: null,
        detail: 'rpc down',
        checkedAt: null,
        durationMs: null,
      },
    });
    const first = await unverified.inject({ method: 'GET', url: '/readyz' });
    expect(first.statusCode).toBe(503);
    expect(first.json().checks.solana_rpc.status).toBe('unverified');
    await unverified.close();

    const mismatch = await makeApp({
      network: {
        ...verified,
        status: 'mismatch',
        observedGenesisHash: null,
        detail: 'wrong chain',
      },
    });
    const second = await mismatch.inject({ method: 'GET', url: '/readyz' });
    expect(second.statusCode).toBe(503);
    expect(second.json().checks.solana_rpc).toMatchObject({
      status: 'fail',
      detail: 'wrong chain',
    });
    await mismatch.close();
  });

  it('treats a throwing probe as a failed check instead of a crash', async () => {
    const app = await makeApp({
      probes: probes({
        schema: async () => {
          throw new Error('connection reset');
        },
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.schema.detail).toContain('schema probe threw');
    await app.close();
  });
});

describe('platform info and errors', () => {
  it('describes identity and capabilities without secrets', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/v1/platform' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractSchemaVersion: '1',
      identity: { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
      identityProvider: 'test',
      executionWritesEnabled: false,
      capabilities: [{ capability: 'platform.api.health', status: 'IMPLEMENTED' }],
    });
    await app.close();
  });

  it('returns the error envelope for unknown routes', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'req-1' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'no such route', requestId: 'req-1' },
    });
    await app.close();
  });

  it('rate limits with the error envelope', async () => {
    const app = await makeApp({ env: { API_RATE_LIMIT_MAX_PER_MINUTE: '2' } });
    await app.inject({ method: 'GET', url: '/healthz' });
    await app.inject({ method: 'GET', url: '/healthz' });
    const third = await app.inject({ method: 'GET', url: '/healthz' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
    await app.close();
  });

  it('publishes an OpenAPI document for the public routes only', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const paths = Object.keys(response.json().paths);
    expect(paths).toEqual(expect.arrayContaining(['/healthz', '/readyz', '/v1/platform']));
    expect(paths).not.toContain('/openapi.json');
    await app.close();
  });
});

describe('cors', () => {
  it('emits no CORS headers when no origins are configured', async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://markov.pet' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('allows only exact configured origins', async () => {
    const app = await makeApp({ env: { API_ALLOWED_ORIGINS: 'https://markov.pet' } });
    const allowed = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://markov.pet' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://markov.pet');
    const denied = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});
