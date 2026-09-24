import { parseIssuerFeed } from '@markov/catalog';
import { describe, expect, it } from 'vitest';
import {
  createPrestocksFixtureSource,
  createPrestocksUrlSource,
  IssuerSourceError,
} from '../src/index.js';

describe('PreStocks issuer sources', () => {
  it('serves the synthetic fixtures as valid version 1 feeds, and the drift fixture as invalid', async () => {
    const good = await createPrestocksFixtureSource('default').fetch();
    expect(good.sourceRef).toBe('fixture:default');
    const parsed = parseIssuerFeed(good.payload, 'prestocks');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.feed.products.map((product) => product.symbol)).toEqual([
        'FXAERO',
        'FXBIO',
        'FXGRID',
        'FXDRFT',
      ]);
      expect(parsed.feed.products.every((product) => product.symbol.startsWith('FX'))).toBe(true);
    }
    const drift = await createPrestocksFixtureSource('drift').fetch();
    expect(parseIssuerFeed(drift.payload, 'prestocks').ok).toBe(false);
  });

  it('refuses insecure or credentialed URLs and bounds the configured source', async () => {
    expect(() => createPrestocksUrlSource({ url: 'http://feed.example/v1' })).toThrow(
      IssuerSourceError,
    );
    expect(() => createPrestocksUrlSource({ url: 'https://user:pw@feed.example/v1' })).toThrow(
      IssuerSourceError,
    );
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          schemaVersion: '1',
          issuer: 'prestocks',
          generatedAt: '2026-09-24T00:00:00Z',
          products: [],
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;
    const source = createPrestocksUrlSource({
      url: 'https://feed.example/v1?token=secret',
      fetchImpl,
    });
    const result = await source.fetch();
    expect(result.sourceRef).toBe('https://feed.example/v1');
    expect(calls[0]).toBe('https://feed.example/v1?token=secret');
    expect(parseIssuerFeed(result.payload, 'prestocks').ok).toBe(true);

    const big = createPrestocksUrlSource({
      url: 'https://feed.example/v1',
      maxBytes: 10,
      fetchImpl: (async () => new Response('x'.repeat(50))) as typeof fetch,
    });
    await expect(big.fetch()).rejects.toMatchObject({ kind: 'oversized' });
    const down = createPrestocksUrlSource({
      url: 'https://feed.example/v1',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(down.fetch()).rejects.toMatchObject({ kind: 'unreachable' });
    const notJson = createPrestocksUrlSource({
      url: 'https://feed.example/v1',
      fetchImpl: (async () => new Response('<html>')) as typeof fetch,
    });
    await expect(notJson.fetch()).rejects.toMatchObject({ kind: 'malformed' });
  });
});
