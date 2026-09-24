import { parseCorporateActionFeed, parseIssuerFeed } from '@markov/catalog';
import { describe, expect, it } from 'vitest';
import {
  createXstocksFixtureSource,
  createXstocksUrlSource,
  IssuerSourceError,
} from '../src/index.js';

describe('xStocks issuer sources', () => {
  it('serves synthetic products and events as valid version 1 feeds and flags drift', async () => {
    const products = await createXstocksFixtureSource('products').fetch();
    const parsedProducts = parseIssuerFeed(products.payload, 'xstocks');
    expect(parsedProducts.ok).toBe(true);
    if (parsedProducts.ok) {
      expect(parsedProducts.feed.products.map((product) => product.symbol)).toEqual([
        'XSFXA',
        'XSFXB',
        'XSFXC',
        'XSFXD',
      ]);
      expect(
        parsedProducts.feed.products.every(
          (product) =>
            product.kind === 'listed_stock' && product.underlying?.ticker.startsWith('FX'),
        ),
      ).toBe(true);
    }
    const events = await createXstocksFixtureSource('events').fetch();
    const parsedEvents = parseCorporateActionFeed(events.payload, 'xstocks');
    expect(parsedEvents.ok).toBe(true);
    if (parsedEvents.ok) {
      expect(parsedEvents.feed.events).toHaveLength(8);
    }
    const drift = await createXstocksFixtureSource('events-drift').fetch();
    expect(parseCorporateActionFeed(drift.payload, 'xstocks').ok).toBe(false);
  });

  it('bounds the configured sources like every other issuer feed', async () => {
    expect(() =>
      createXstocksUrlSource({ url: 'http://feed.example/events', kind: 'corporate_actions' }),
    ).toThrow(IssuerSourceError);
    const source = createXstocksUrlSource({
      url: 'https://feed.example/events',
      kind: 'corporate_actions',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            schemaVersion: '1',
            issuer: 'xstocks',
            generatedAt: '2026-09-24T00:00:00Z',
            events: [],
          }),
        )) as typeof fetch,
    });
    const result = await source.fetch();
    expect(result.sourceRef).toBe('https://feed.example/events');
    expect(source.kind).toBe('corporate_actions');
  });
});
