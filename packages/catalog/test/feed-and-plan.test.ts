import type { IssuerFeedProduct } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  availabilityFor,
  contentHash,
  type ExistingInstrument,
  isPubliclyVisible,
  normalizeProduct,
  parseIssuerFeed,
  planIngestion,
  productFingerprint,
  sanitizeText,
} from '../src/index.js';

const NOW = new Date('2026-09-24T12:00:00Z');
const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MINT_C = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';

function product(overrides: Partial<IssuerFeedProduct> = {}): IssuerFeedProduct {
  return {
    productId: 'p-1',
    symbol: 'exa',
    name: 'Example Pre-IPO Exposure',
    companyName: 'Example Aerospace Inc',
    kind: 'pre_ipo_exposure',
    mint: MINT_A,
    decimals: 6,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingInstrument> = {}): ExistingInstrument {
  const normalized = normalizeProduct(product(), NOW);
  const fingerprint = normalized.ok ? productFingerprint(normalized.product) : 'x';
  return {
    instrumentId: '11111111-1111-4111-8111-111111111111',
    issuerProductId: 'p-1',
    symbol: 'EXA',
    mint: MINT_A,
    decimals: 6,
    status: 'admitted',
    fingerprint,
    ...overrides,
  };
}

describe('feed sanitisation and normalisation', () => {
  it('strips markup and control characters, uppercases symbols and drops insecure websites', () => {
    expect(sanitizeText('Hello <script>alert(1)</script>\u0000 world  ', 100)).toBe('Hello world');
    const out = normalizeProduct(
      product({
        symbol: ' exa ',
        website: 'http://example.com',
        description: '<b>Bold</b> claim',
        referencePrice: {
          value: '12.50',
          unit: 'usd',
          kind: 'issuer_mark',
          observedAt: '2026-09-24T11:00:00Z',
          source: 'fixture',
        },
      }),
      NOW,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(out.product.symbol).toBe('EXA');
    expect(out.product.website).toBeNull();
    expect(out.product.description).toBe('Bold claim');
    expect(out.product.referencePrice).toEqual({
      value: '12.50',
      unit: 'USD',
      kind: 'issuer_mark',
      observedAt: '2026-09-24T11:00:00.000Z',
      source: 'fixture',
      stale: false,
      expiresAt: null,
    });
  });

  it('rejects missing fields, bad mints, bad decimals and negative prices with every reason', () => {
    const out = normalizeProduct(
      product({
        name: '   ',
        mint: 'not-a-mint',
        decimals: 19,
        referencePrice: {
          value: '-1',
          unit: 'USD',
          kind: 'issuer_mark',
          observedAt: '2026-09-24T11:00:00Z',
          source: 'x',
        },
      }),
      NOW,
    );
    expect(out.ok).toBe(false);
    if (out.ok) {
      return;
    }
    expect(out.reasons).toEqual([
      'missing name',
      'mint is not a base58 32-byte address',
      'decimals must be an integer between 0 and 18',
      'referencePrice.value must be a non-negative decimal string',
    ]);
  });

  it('refuses schema drift and a foreign issuer as a whole', () => {
    expect(
      parseIssuerFeed(
        { schemaVersion: '2', issuer: 'prestocks', generatedAt: NOW.toISOString(), items: [] },
        'prestocks',
      ),
    ).toMatchObject({
      ok: false,
    });
    expect(
      parseIssuerFeed(
        { schemaVersion: '1', issuer: 'xstocks', generatedAt: NOW.toISOString(), products: [] },
        'prestocks',
      ),
    ).toMatchObject({
      ok: false,
      reason: 'feed issuer xstocks does not match prestocks',
    });
    expect(
      parseIssuerFeed(
        {
          schemaVersion: '1',
          issuer: 'prestocks',
          generatedAt: NOW.toISOString(),
          products: [product()],
        },
        'prestocks',
      ).ok,
    ).toBe(true);
  });

  it('hashes payloads independently of key order', () => {
    expect(contentHash({ a: 1, b: [{ d: 2, c: 3 }] })).toBe(
      contentHash({ b: [{ c: 3, d: 2 }], a: 1 }),
    );
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe('ingestion planning', () => {
  it('quarantines new products and leaves identical records unchanged', () => {
    const fresh = planIngestion([], [product()], NOW);
    expect(fresh.actions).toEqual([
      expect.objectContaining({ kind: 'insert', status: 'quarantined' }),
    ]);
    expect(fresh.counts).toEqual({ inserted: 1, updated: 0, unchanged: 0, rejected: 0, paused: 0 });
    const same = planIngestion([existing()], [product()], NOW);
    expect(same.actions).toEqual([expect.objectContaining({ kind: 'unchanged' })]);
  });

  it('rejects a counterfeit symbol, a reused mint and in-feed duplicates', () => {
    const plan = planIngestion(
      [existing()],
      [
        product({ productId: 'p-9', symbol: 'EXA', mint: MINT_B }),
        product({ productId: 'p-10', symbol: 'OTHER', mint: MINT_A }),
        product({ productId: 'p-11', symbol: 'DUP', mint: MINT_C }),
        product({ productId: 'p-11', symbol: 'DUP2', mint: MINT_B }),
      ],
      NOW,
    );
    expect(plan.products.map((item) => [item.issuerProductId, item.outcome])).toEqual([
      ['p-9', 'rejected'],
      ['p-10', 'rejected'],
      ['p-11', 'inserted'],
      ['p-11', 'rejected'],
    ]);
    expect(plan.products[0]?.reasons[0]).toMatch(/symbol EXA belongs to instrument/);
    expect(plan.products[1]?.reasons[0]).toMatch(/mint already bound/);
    expect(plan.products[3]?.reasons).toContain('duplicate productId in feed');
  });

  it('pauses an admitted instrument whose mint changed upstream and re-quarantines a rejected one that became valid', () => {
    const changed = planIngestion([existing()], [product({ mint: MINT_B })], NOW);
    expect(changed.actions).toEqual([
      expect.objectContaining({
        kind: 'update',
        newStatus: 'paused',
        reasons: ['upstream changed the mint'],
      }),
    ]);
    const revived = planIngestion(
      [existing({ status: 'rejected', fingerprint: 'old' })],
      [product()],
      NOW,
    );
    expect(revived.actions).toEqual([
      expect.objectContaining({ kind: 'update', newStatus: 'quarantined' }),
    ]);
    const delisted = planIngestion(
      [existing({ status: 'delisted' })],
      [product({ mint: MINT_B })],
      NOW,
    );
    expect(delisted.actions).toEqual([
      expect.objectContaining({ kind: 'unchanged', reasons: ['delisted'] }),
    ]);
    const invalidUpstream = planIngestion([existing()], [product({ decimals: 40 })], NOW);
    expect(invalidUpstream.products[0]).toMatchObject({ outcome: 'paused' });
    expect(invalidUpstream.actions[0]).toMatchObject({
      kind: 'invalid',
      currentStatus: 'admitted',
    });
  });
});

describe('availability', () => {
  it('never enables trading and hides everything but admitted and paused instruments', () => {
    expect(availabilityFor('admitted')).toEqual({
      research: true,
      strategy: true,
      trade: false,
      reasons: ['EXECUTION_NOT_ENABLED'],
    });
    expect(availabilityFor('paused').strategy).toBe(false);
    expect(availabilityFor('quarantined').research).toBe(false);
    expect(isPubliclyVisible('admitted')).toBe(true);
    expect(isPubliclyVisible('paused')).toBe(true);
    expect(isPubliclyVisible('quarantined')).toBe(false);
    expect(isPubliclyVisible('rejected')).toBe(false);
  });
});
