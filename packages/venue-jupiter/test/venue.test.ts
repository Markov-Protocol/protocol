import { venueQuoteSchema } from '@markov/contracts';
import { checkQuote, FIXTURE_ROUTE_PROGRAM_ID, VenueQuoteError } from '@markov/planning';
import { describe, expect, it } from 'vitest';
import {
  createConfiguredUrlVenue,
  createFixtureVenue,
  FIXTURE_PRICES,
  FIXTURE_SPREAD_BPS,
} from '../src/index.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AERO = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const DRIFT = 'FKDSPRewziVn1g1iC6BcgdqvHCBGWgqXjHQTT3RBZRGo';
const NOW = new Date('2026-09-25T10:00:00.000Z');

const request = {
  schemaVersion: '1' as const,
  venue: 'jupiter' as const,
  inputMint: USDC,
  outputMint: AERO,
  inAmountRaw: '1825000000',
  slippageBps: 50,
  swapMode: 'exact_in' as const,
};

describe('fixture venue', () => {
  const venue = createFixtureVenue({ stablecoin: { mint: USDC, decimals: 6 }, now: () => NOW });

  it('answers deterministic contract quotes at the synthetic price less spread and impact', async () => {
    const quote = await venue.quote(request);
    expect(venueQuoteSchema.safeParse(quote).success).toBe(true);
    // 1,825 USDC at 18.25 → 100 FXAERO whole units, less 30 bps spread and 1 bps impact (1,825 units / 1,000).
    expect(quote.priceImpactBps).toBe(1);
    expect(quote.outAmountRaw).toBe(
      ((100n * 10n ** 6n * BigInt(10_000 - FIXTURE_SPREAD_BPS - 1)) / 10_000n).toString(),
    );
    expect(quote.otherAmountThresholdRaw).toBe(
      ((BigInt(quote.outAmountRaw) * 9_950n) / 10_000n).toString(),
    );
    expect(quote.routePlan).toEqual([
      { programId: FIXTURE_ROUTE_PROGRAM_ID, label: 'fixture-amm', percent: 100 },
    ]);
    expect(quote.expiresAt).toBe('2026-09-25T10:00:30.000Z');
    expect(quote.mode).toBe('fixture');
    expect(await venue.quote(request)).toEqual(quote);
    expect(
      checkQuote(quote, {
        inputMint: USDC,
        outputMint: AERO,
        targetInputRaw: 1_825_000_000n,
        slippageBps: 50,
        maxSlippageBps: 100,
        maxQuoteAgeSeconds: 60,
        maxPriceImpactBps: 300,
        mode: 'fixture',
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('refuses unsupported mints, sub-minimum inputs and simulated outages', async () => {
    await expect(venue.quote({ ...request, outputMint: DRIFT })).rejects.toMatchObject({
      kind: 'unsupported_mint',
    });
    // A sell (instrument in, stablecoin out) is routed; an unpriced instrument is not.
    const sell = await venue.quote({ ...request, inputMint: AERO, outputMint: USDC });
    expect(sell.inputMint).toBe(AERO);
    expect(BigInt(sell.outAmountRaw) > 0n).toBe(true);
    await expect(
      venue.quote({ ...request, inputMint: DRIFT, outputMint: USDC }),
    ).rejects.toMatchObject({ kind: 'unsupported_mint' });
    await expect(venue.quote({ ...request, inAmountRaw: '999999' })).rejects.toMatchObject({
      kind: 'no_route',
    });
    expect(venue.minimumInputRaw).toBe(1_000_000n);
    const down = createFixtureVenue({
      stablecoin: { mint: USDC, decimals: 6 },
      outage: () => true,
    });
    await expect(down.quote(request)).rejects.toBeInstanceOf(VenueQuoteError);
    expect(FIXTURE_PRICES.some((price) => price.mint === DRIFT)).toBe(false);
  });
});

describe('configured URL venue', () => {
  const answer =
    (body: unknown, init: ResponseInit = {}) =>
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      });
  const fixtureQuote = async () =>
    createFixtureVenue({ stablecoin: { mint: USDC, decimals: 6 }, now: () => NOW }).quote(request);

  it('refuses insecure URLs and embedded credentials', () => {
    expect(() => createConfiguredUrlVenue({ url: 'http://gateway.example.test/quote' })).toThrow(
      /https/,
    );
    expect(() =>
      createConfiguredUrlVenue({ url: 'https://user:pw@gateway.example.test/quote' }),
    ).toThrow(/credentials/);
    expect(
      createConfiguredUrlVenue({ url: 'http://127.0.0.1:1/quote', allowInsecure: true }).sourceRef,
    ).toBe('http://127.0.0.1:1/quote');
  });

  it('posts the request with the bearer key and validates the contract answer', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const base = {
      ...(await fixtureQuote()),
      mode: 'configured_url' as const,
      sourceRef: 'gateway-says-so',
    };
    const venue = createConfiguredUrlVenue({
      url: 'https://gateway.example.test/v1/quote?token=should-not-leak',
      apiKey: 'k-secret',
      fetchImpl: async (input, init) => {
        seen.push({ url: String(input), init: init ?? {} });
        return answer(base)();
      },
    });
    const quote = await venue.quote(request);
    expect(seen).toHaveLength(1);
    const sent = seen[0] as { url: string; init: RequestInit };
    expect(sent.init.method).toBe('POST');
    expect((sent.init.headers as Record<string, string>)['authorization']).toBe('Bearer k-secret');
    expect(JSON.parse(sent.init.body as string)).toEqual(request);
    expect(quote.sourceRef).toBe('https://gateway.example.test/v1/quote');
    expect(venue.sourceRef).not.toContain('token');
    expect(quote.outAmountRaw).toBe(base.outAmountRaw);
  });

  it('fails closed on HTTP errors, oversized, malformed and wrong-mode answers', async () => {
    const make = (fetchImpl: typeof fetch) =>
      createConfiguredUrlVenue({
        url: 'https://gateway.example.test/quote',
        fetchImpl,
        maxBytes: 2_048,
      });
    await expect(make(answer({}, { status: 502 })).quote(request)).rejects.toMatchObject({
      kind: 'http',
    });
    await expect(
      make(async () => new Response('x'.repeat(4_096))).quote(request),
    ).rejects.toMatchObject({ kind: 'oversized' });
    await expect(make(async () => new Response('not json')).quote(request)).rejects.toMatchObject({
      kind: 'malformed',
    });
    await expect(make(answer({ hello: 'world' })).quote(request)).rejects.toMatchObject({
      kind: 'malformed',
    });
    await expect(make(answer(await fixtureQuote())).quote(request)).rejects.toMatchObject({
      kind: 'malformed',
    });
    await expect(
      make(async () => {
        throw new Error('ECONNREFUSED');
      }).quote(request),
    ).rejects.toMatchObject({ kind: 'unreachable' });
  });
});
