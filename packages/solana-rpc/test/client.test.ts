import { startFakeJsonRpcServer } from '@markov/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { SolanaRpcClient, SolanaRpcError, verifyNetworkIdentity } from '../src/index.js';

const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const OTHER = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function fake(options: Parameters<typeof startFakeJsonRpcServer>[0]) {
  const server = await startFakeJsonRpcServer(options);
  closers.push(server.close);
  return server;
}

function client(
  url: string,
  overrides: Partial<{ timeoutMs: number; maxResponseBytes: number }> = {},
) {
  return new SolanaRpcClient({ url, timeoutMs: 500, maxResponseBytes: 4096, ...overrides });
}

async function failureKind(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof SolanaRpcError ? error.kind : `unexpected:${String(error)}`;
  }
}

describe('SolanaRpcClient', () => {
  it('performs a JSON-RPC 2.0 call and validates the result', async () => {
    const server = await fake({
      handlers: {
        getGenesisHash: () => GENESIS,
        getVersion: () => ({ 'solana-core': '2.3.0', 'feature-set': 123 }),
        getHealth: () => 'ok',
        getSlot: () => 42,
      },
    });
    const rpc = client(server.url);
    expect(await rpc.getGenesisHash()).toBe(GENESIS);
    expect(await rpc.getVersion()).toEqual({ solanaCore: '2.3.0', featureSet: 123 });
    expect(await rpc.getHealth()).toEqual({ healthy: true, detail: 'ok' });
    expect(await rpc.getSlot('confirmed')).toBe(42);
    expect(server.requests[0]).toMatchObject({ method: 'getGenesisHash', params: [] });
    expect(server.requests[3]).toMatchObject({
      method: 'getSlot',
      params: [{ commitment: 'confirmed' }],
    });
  });

  it('classifies node-unhealthy rpc errors from getHealth without throwing', async () => {
    const server = await fake({
      handlers: {
        getHealth: () => ({ rpcError: { code: -32005, message: 'Node is behind by 150 slots' } }),
      },
    });
    expect(await client(server.url).getHealth()).toEqual({
      healthy: false,
      detail: expect.stringContaining('behind'),
    });
  });

  it('classifies timeouts, http errors, malformed bodies, oversized bodies and shape mismatches', async () => {
    const slow = await fake({ handlers: { getGenesisHash: () => GENESIS }, delayMs: 300 });
    expect(await failureKind(client(slow.url, { timeoutMs: 50 }).getGenesisHash())).toBe('timeout');

    const http = await fake({
      handlers: {},
      rawResponse: { status: 502, body: 'bad gateway', contentType: 'text/plain' },
    });
    expect(await failureKind(client(http.url).getGenesisHash())).toBe('http');

    const malformed = await fake({ handlers: {}, rawResponse: { status: 200, body: '<html>' } });
    expect(await failureKind(client(malformed.url).getGenesisHash())).toBe('malformed');

    const wrongEnvelope = await fake({
      handlers: {},
      rawResponse: { status: 200, body: '{"ok":true}' },
    });
    expect(await failureKind(client(wrongEnvelope.url).getGenesisHash())).toBe('malformed');

    const oversized = await fake({
      handlers: {},
      rawResponse: {
        status: 200,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(10_000) }),
      },
    });
    expect(await failureKind(client(oversized.url).getGenesisHash())).toBe('oversized');

    const badShape = await fake({ handlers: { getGenesisHash: () => 12345 } });
    expect(await failureKind(client(badShape.url).getGenesisHash())).toBe('malformed');

    expect(await failureKind(client('http://127.0.0.1:1').getGenesisHash())).toBe('network');
  });

  it('rejects responses whose id does not match the request', async () => {
    const server = await fake({
      handlers: {},
      rawResponse: {
        status: 200,
        body: JSON.stringify({ jsonrpc: '2.0', id: 999, result: GENESIS }),
      },
    });
    expect(await failureKind(client(server.url).getGenesisHash())).toBe('malformed');
  });
});

describe('verifyNetworkIdentity', () => {
  it('is verified when every reachable endpoint agrees with the expectation', async () => {
    const a = await fake({ handlers: { getGenesisHash: () => GENESIS } });
    const b = await fake({ handlers: { getGenesisHash: () => GENESIS } });
    const result = await verifyNetworkIdentity([client(a.url), client(b.url)], GENESIS);
    expect(result.status).toBe('verified');
    expect(result.observedGenesisHash).toBe(GENESIS);
    expect(result.endpoints.map((endpoint) => endpoint.status)).toEqual(['verified', 'verified']);
  });

  it('fails closed when any endpoint contradicts the expectation', async () => {
    const good = await fake({ handlers: { getGenesisHash: () => GENESIS } });
    const wrong = await fake({ handlers: { getGenesisHash: () => OTHER } });
    const result = await verifyNetworkIdentity([client(good.url), client(wrong.url)], GENESIS);
    expect(result.status).toBe('mismatch');
    expect(result.observedGenesisHash).toBeNull();
  });

  it('fails closed when endpoints disagree with each other even without an expectation', async () => {
    const a = await fake({ handlers: { getGenesisHash: () => GENESIS } });
    const b = await fake({ handlers: { getGenesisHash: () => OTHER } });
    expect((await verifyNetworkIdentity([client(a.url), client(b.url)], null)).status).toBe(
      'mismatch',
    );
  });

  it('is unavailable, not failed, when no endpoint answers', async () => {
    const result = await verifyNetworkIdentity([client('http://127.0.0.1:1')], GENESIS);
    expect(result.status).toBe('unavailable');
    expect(result.endpoints[0]?.detail).toContain('network');
  });

  it('is verified with the observed hash recorded when one endpoint answers and none contradict', async () => {
    const a = await fake({ handlers: { getGenesisHash: () => GENESIS } });
    const result = await verifyNetworkIdentity(
      [client(a.url), client('http://127.0.0.1:1')],
      GENESIS,
    );
    expect(result.status).toBe('verified');
    expect(result.observedGenesisHash).toBe(GENESIS);
  });
});
