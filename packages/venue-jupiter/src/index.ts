import { createHash } from 'node:crypto';
import {
  type VenueQuote,
  type VenueQuoteRequest,
  venueQuoteRequestSchema,
  venueQuoteSchema,
} from '@markov/contracts';
import {
  canonicalJson,
  FIXTURE_ROUTE_PROGRAM_ID,
  minimumOutputFor,
  type VenueAdapter,
  VenueQuoteError,
} from '@markov/planning';

/**
 * @markov/venue-jupiter
 *
 * The execution venue is Jupiter's aggregator; its current quote API,
 * response shape, route programs and terms are unverified from this build
 * environment (every Jupiter host is unreachable; open decision OD-21).
 * Nothing in this package is a claim about that API. Two adapters answer
 * Markov's own quote contract (`venueQuoteRequestSchema` →
 * `venueQuoteSchema`, version 1): a synthetic fixture venue for local and
 * test modes, and an operator-configured https gateway that must already
 * serve the contract. Mapping Jupiter's real response onto the contract is
 * the first task once its documentation is verified.
 */

export const FIXTURE_SPREAD_BPS = 30;
export const FIXTURE_QUOTE_TTL_MS = 30_000;
/** One basis point of synthetic price impact per this many whole stablecoin units of input. */
export const FIXTURE_IMPACT_UNIT = 1_000n;
export const FIXTURE_MAX_IMPACT_BPS = 500;

export interface FixturePrice {
  readonly mint: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Synthetic reference price in stablecoin units per whole token, as an exact fraction. */
  readonly priceNumerator: bigint;
  readonly priceDenominator: bigint;
}

/**
 * Synthetic prices for the fixture mints of the issuer fixtures. Where the
 * issuer fixture carries a reference price the same value is used; the
 * others are invented for the venue and exist nowhere else. FXDRFT is left
 * out on purpose so an unsupported mint has a test path.
 */
export const FIXTURE_PRICES: readonly FixturePrice[] = [
  {
    mint: '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv',
    symbol: 'FXAERO',
    decimals: 6,
    priceNumerator: 1825n,
    priceDenominator: 100n,
  },
  {
    mint: '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL',
    symbol: 'FXBIO',
    decimals: 8,
    priceNumerator: 410n,
    priceDenominator: 100n,
  },
  {
    mint: '7BSykwv45jYZnqgvufVjsbeUWoGAUajTdpzKXD1hXtf1',
    symbol: 'FXGRID',
    decimals: 6,
    priceNumerator: 750n,
    priceDenominator: 100n,
  },
  {
    mint: 'A8GviP6cWZxAKfpCoKfQCvtSejyPh975CoLjsVVqmumh',
    symbol: 'XSFXA',
    decimals: 8,
    priceNumerator: 10120n,
    priceDenominator: 100n,
  },
  {
    mint: '7DZtuqE57Dwhz9jxYXGmNEkgy5Xj5enc6Qv2S9jV2s34',
    symbol: 'XSFXB',
    decimals: 8,
    priceNumerator: 5430n,
    priceDenominator: 100n,
  },
  {
    mint: 'HbAAW6v4rNkFJnpF91RXkLchD4EAVxaedwDgexZEzgrz',
    symbol: 'XSFXC',
    decimals: 8,
    priceNumerator: 1280n,
    priceDenominator: 100n,
  },
  {
    mint: 'CozzycFVYWt2XYRQK5qf2r1ZcK1fhCncMC8QTPYzrvXZ',
    symbol: 'XSFXD',
    decimals: 8,
    priceNumerator: 25000n,
    priceDenominator: 100n,
  },
];

export interface FixtureVenueOptions {
  /** The stablecoin every fixture quote consumes; any other input mint is unsupported. */
  readonly stablecoin: { readonly mint: string; readonly decimals: number };
  readonly prices?: readonly FixturePrice[];
  readonly now?: () => Date;
  /** Test control: answer as if the venue were unreachable. */
  readonly outage?: () => boolean;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Deterministic synthetic quotes: exact-in at the synthetic price less a
 * fixed spread and an input-proportional price impact, one route step
 * through the fixture program, a 30-second validity. The same request at
 * the same instant yields the same quote and reference.
 */
export function createFixtureVenue(options: FixtureVenueOptions): VenueAdapter {
  const now = options.now ?? (() => new Date());
  const prices = new Map((options.prices ?? FIXTURE_PRICES).map((price) => [price.mint, price]));
  const stablecoin = options.stablecoin;
  return {
    venue: 'jupiter',
    mode: 'fixture',
    sourceRef: 'fixture:venue',
    minimumInputRaw: pow10(stablecoin.decimals),
    async quote(input) {
      const request = venueQuoteRequestSchema.parse(input);
      if (options.outage?.()) {
        throw new VenueQuoteError('unreachable', 'the fixture venue is in a simulated outage');
      }
      if (request.inputMint !== stablecoin.mint) {
        throw new VenueQuoteError(
          'unsupported_mint',
          `the fixture venue only consumes ${stablecoin.mint}; input ${request.inputMint} is unsupported`,
        );
      }
      const price = prices.get(request.outputMint);
      if (!price) {
        throw new VenueQuoteError(
          'unsupported_mint',
          `the fixture venue has no route for output mint ${request.outputMint}`,
        );
      }
      const inAmount = BigInt(request.inAmountRaw);
      if (inAmount < pow10(stablecoin.decimals)) {
        throw new VenueQuoteError(
          'no_route',
          `the fixture venue routes at least ${pow10(stablecoin.decimals)} raw input; ${inAmount} is below the minimum`,
        );
      }
      const wholeUnits = inAmount / pow10(stablecoin.decimals);
      const impactBps = Number(
        wholeUnits / FIXTURE_IMPACT_UNIT > BigInt(FIXTURE_MAX_IMPACT_BPS)
          ? BigInt(FIXTURE_MAX_IMPACT_BPS)
          : wholeUnits / FIXTURE_IMPACT_UNIT,
      );
      const factorBps = BigInt(10_000 - FIXTURE_SPREAD_BPS - impactBps);
      const outAmount =
        (inAmount * pow10(price.decimals) * price.priceDenominator * factorBps) /
        (pow10(stablecoin.decimals) * price.priceNumerator * 10_000n);
      if (outAmount === 0n) {
        throw new VenueQuoteError('no_route', 'the input is too small for one output unit');
      }
      const observedAt = now();
      const quoteRef = `fixture:${createHash('sha256')
        .update(canonicalJson({ request, observedAt: observedAt.toISOString() }))
        .digest('hex')
        .slice(0, 16)}`;
      const quote: VenueQuote = {
        schemaVersion: '1',
        venue: 'jupiter',
        mode: 'fixture',
        quoteRef,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmountRaw: inAmount.toString(),
        outAmountRaw: outAmount.toString(),
        otherAmountThresholdRaw: minimumOutputFor(outAmount, request.slippageBps).toString(),
        slippageBps: request.slippageBps,
        priceImpactBps: impactBps,
        routePlan: [{ programId: FIXTURE_ROUTE_PROGRAM_ID, label: 'fixture-amm', percent: 100 }],
        contextSlot: Math.floor(observedAt.getTime() / 400),
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + FIXTURE_QUOTE_TTL_MS).toISOString(),
        sourceRef: 'fixture:venue',
      };
      return venueQuoteSchema.parse(quote);
    },
  };
}

export interface ConfiguredUrlVenueOptions {
  readonly url: string;
  /** Sent as a bearer token; never logged and never part of a quote. */
  readonly apiKey?: string | null;
  /** Plain http is accepted only when the caller runs in local or test mode. */
  readonly allowInsecure?: boolean;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: typeof fetch;
  /** Route minimum the gateway documents, if any. */
  readonly minimumInputRaw?: bigint | null;
}

function sourceRefOf(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/**
 * POST the Markov quote request to a configured gateway and validate the
 * answer against the quote contract, with the same bounds as every other
 * outbound call: https only outside local/test, no redirects, a timeout
 * and a byte cap. The gateway's `sourceRef` is replaced by ours and its
 * `mode` must say `configured_url`; every economic field is still checked
 * by the planner before anything is built on it.
 */
export function createConfiguredUrlVenue(options: ConfiguredUrlVenueOptions): VenueAdapter {
  const url = new URL(options.url);
  if (url.username || url.password) {
    throw new VenueQuoteError('insecure_url', 'venue URL must not embed credentials');
  }
  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    throw new VenueQuoteError('insecure_url', 'venue URL must use https');
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sourceRef = sourceRefOf(url);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (options.apiKey) {
    headers['authorization'] = `Bearer ${options.apiKey}`;
  }
  return {
    venue: 'jupiter',
    mode: 'configured_url',
    sourceRef,
    minimumInputRaw: options.minimumInputRaw ?? null,
    async quote(input) {
      const request: VenueQuoteRequest = venueQuoteRequestSchema.parse(input);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (cause) {
        throw new VenueQuoteError('unreachable', `venue ${sourceRef} did not answer`, cause);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new VenueQuoteError('http', `venue ${sourceRef} answered HTTP ${response.status}`);
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new VenueQuoteError(
          'oversized',
          `venue declares ${declared} bytes, limit ${maxBytes}`,
        );
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const step = await reader.read();
          if (step.done) {
            break;
          }
          total += step.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new VenueQuoteError('oversized', `venue exceeded ${maxBytes} bytes`);
          }
          chunks.push(step.value);
        }
      }
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (cause) {
        throw new VenueQuoteError('malformed', `venue ${sourceRef} is not JSON`, cause);
      }
      const parsed = venueQuoteSchema.safeParse(payload);
      if (!parsed.success) {
        throw new VenueQuoteError(
          'malformed',
          `venue ${sourceRef} did not answer the quote contract: ${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      if (parsed.data.mode !== 'configured_url' || parsed.data.venue !== 'jupiter') {
        throw new VenueQuoteError(
          'malformed',
          `venue ${sourceRef} answered mode ${parsed.data.mode} for ${parsed.data.venue}; expected a configured_url jupiter quote`,
        );
      }
      return { ...parsed.data, sourceRef };
    },
  };
}
