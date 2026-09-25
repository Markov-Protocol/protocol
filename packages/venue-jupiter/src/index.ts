import { createHash } from 'node:crypto';
import {
  type VenueBuildRequestPayload,
  type VenueQuote,
  type VenueQuoteRequest,
  venueBuildRequestSchema,
  venueBuildResponseSchema,
  venueQuoteRequestSchema,
  venueQuoteSchema,
} from '@markov/contracts';
import {
  canonicalJson,
  FIXTURE_ROUTE_PROGRAM_ID,
  fixtureSwapInstruction,
  minimumOutputFor,
  type VenueAdapter,
  type VenueBuild,
  type VenueBuildRequest,
  type VenueComposeRequest,
  VenueQuoteError,
} from '@markov/planning';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  bytesToBase64,
  COMPUTE_BUDGET_PROGRAM_ID,
  compileLegacyMessage,
  type Instruction,
  SYSTEM_PROGRAM_ID,
  unsignedTransaction,
} from '@markov/solana-codec';

export * from './fixture-program.js';

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
  /** Test control: shifts every quote's output by this many basis points (negative worsens the terms). */
  readonly quoteShiftBps?: () => number;
  /** Test control: the most legs `compose` puts in one transaction; more answers `no_route` so plans stay staged. */
  readonly composeMaxLegs?: () => number | null;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Synthetic price impact for an input expressed in whole units of its own mint. */
function impactBpsFor(wholeUnits: bigint): number {
  return Number(
    wholeUnits / FIXTURE_IMPACT_UNIT > BigInt(FIXTURE_MAX_IMPACT_BPS)
      ? BigInt(FIXTURE_MAX_IMPACT_BPS)
      : wholeUnits / FIXTURE_IMPACT_UNIT,
  );
}

/**
 * The fixture venue's price function, shared by its quotes and by the
 * fixture route program's execution: exact-in output for a stablecoin →
 * instrument buy or an instrument → stablecoin sell at the synthetic price
 * less the fixed spread and the input-proportional impact. Null when the
 * pair is not routed.
 */
export function fixtureSwapOutput(input: {
  readonly stablecoin: { readonly mint: string; readonly decimals: number };
  readonly prices: ReadonlyMap<string, FixturePrice>;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmountRaw: bigint;
}): { readonly outAmountRaw: bigint; readonly impactBps: number } | null {
  const { stablecoin, inAmountRaw } = input;
  if (input.inputMint === stablecoin.mint) {
    const price = input.prices.get(input.outputMint);
    if (!price) {
      return null;
    }
    const impactBps = impactBpsFor(inAmountRaw / pow10(stablecoin.decimals));
    const factorBps = BigInt(10_000 - FIXTURE_SPREAD_BPS - impactBps);
    return {
      outAmountRaw:
        (inAmountRaw * pow10(price.decimals) * price.priceDenominator * factorBps) /
        (pow10(stablecoin.decimals) * price.priceNumerator * 10_000n),
      impactBps,
    };
  }
  if (input.outputMint === stablecoin.mint) {
    const price = input.prices.get(input.inputMint);
    if (!price) {
      return null;
    }
    // Impact scales with the stablecoin value of the input.
    const notionalWhole =
      (inAmountRaw * price.priceNumerator) / (price.priceDenominator * pow10(price.decimals));
    const impactBps = impactBpsFor(notionalWhole);
    const factorBps = BigInt(10_000 - FIXTURE_SPREAD_BPS - impactBps);
    return {
      outAmountRaw:
        (inAmountRaw * pow10(stablecoin.decimals) * price.priceNumerator * factorBps) /
        (pow10(price.decimals) * price.priceDenominator * 10_000n),
      impactBps,
    };
  }
  return null;
}

/**
 * Deterministic synthetic quotes: exact-in at the synthetic price less a
 * fixed spread and an input-proportional price impact, one route step
 * through the fixture program, a 30-second validity. The same request at
 * the same instant yields the same quote and reference. Buys consume the
 * stablecoin; sells consume an instrument for the stablecoin.
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
      const sell = request.outputMint === stablecoin.mint && request.inputMint !== stablecoin.mint;
      if (!sell && request.inputMint !== stablecoin.mint) {
        throw new VenueQuoteError(
          'unsupported_mint',
          `the fixture venue only routes against ${stablecoin.mint}; input ${request.inputMint} is unsupported`,
        );
      }
      const price = prices.get(sell ? request.inputMint : request.outputMint);
      if (!price) {
        throw new VenueQuoteError(
          'unsupported_mint',
          `the fixture venue has no route for ${sell ? 'input' : 'output'} mint ${sell ? request.inputMint : request.outputMint}`,
        );
      }
      const inAmount = BigInt(request.inAmountRaw);
      if (!sell && inAmount < pow10(stablecoin.decimals)) {
        throw new VenueQuoteError(
          'no_route',
          `the fixture venue routes at least ${pow10(stablecoin.decimals)} raw input; ${inAmount} is below the minimum`,
        );
      }
      const priced = fixtureSwapOutput({
        stablecoin,
        prices,
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmountRaw: inAmount,
      });
      if (!priced) {
        throw new VenueQuoteError('no_route', 'the fixture venue has no route for this pair');
      }
      const shift = BigInt(options.quoteShiftBps?.() ?? 0);
      const outAmount = (priced.outAmountRaw * (10_000n + shift)) / 10_000n;
      const { impactBps } = priced;
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
    async build(request) {
      if (options.outage?.()) {
        throw new VenueQuoteError('unreachable', 'the fixture venue is in a simulated outage');
      }
      return buildFixtureSwapTransaction(request);
    },
    async compose(request) {
      if (options.outage?.()) {
        throw new VenueQuoteError('unreachable', 'the fixture venue is in a simulated outage');
      }
      const limit = options.composeMaxLegs?.() ?? null;
      if (limit !== null && request.legs.length > limit) {
        throw new VenueQuoteError(
          'no_route',
          `the fixture venue composes at most ${limit} legs into one transaction`,
        );
      }
      return composeFixtureSwapTransaction(request);
    },
  };
}

/**
 * The fixture venue's transaction for a quote: compute budget, an idempotent
 * creation of the owner's output token account when asked, and the swap
 * through the fixture route program. A legacy message with the owner as the
 * only signer; every byte is decoded again by the execution validator.
 */
export function buildFixtureSwapTransaction(request: VenueBuildRequest): VenueBuild {
  const { quote, owner } = request;
  const source = associatedTokenAddress(owner, quote.inputMint, request.inputTokenProgram).address;
  const destination = associatedTokenAddress(
    owner,
    quote.outputMint,
    request.outputTokenProgram,
  ).address;
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, request.computeUnitLimit, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, request.computeUnitPriceMicroLamports, true);
  const instructions: Instruction[] = [
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: limit },
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: price },
  ];
  if (request.createOutputAccount) {
    instructions.push({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      accounts: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: quote.outputMint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: request.outputTokenProgram, isSigner: false, isWritable: false },
      ],
      data: Uint8Array.of(1),
    });
  }
  instructions.push(
    fixtureSwapInstruction(
      {
        owner,
        source,
        destination,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inputTokenProgram: request.inputTokenProgram,
        outputTokenProgram: request.outputTokenProgram,
      },
      {
        inAmountRaw: BigInt(quote.inAmountRaw),
        minimumOutRaw: BigInt(quote.otherAmountThresholdRaw),
        slippageBps: quote.slippageBps,
      },
    ),
  );
  const message = compileLegacyMessage({
    feePayer: owner,
    instructions,
    recentBlockhash: request.recentBlockhash,
  });
  return {
    unsignedTransaction: bytesToBase64(unsignedTransaction(message)),
    version: 'legacy',
    sourceRef: 'fixture:venue',
  };
}

/**
 * Every leg of a basket in one legacy transaction: compute budget, then
 * the idempotent creations of the owner's output token accounts that are
 * missing, then one swap per leg in leg order. The swaps share the owner's
 * input account, so the fixture chain executes them sequentially over one
 * state and the whole message is measured and simulated before a plan
 * calls itself atomic. Nothing is closed afterwards: there is no wrapped
 * SOL and no temporary account in this route.
 */
export function composeFixtureSwapTransaction(request: VenueComposeRequest): VenueBuild {
  const { owner } = request;
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, request.computeUnitLimit, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, request.computeUnitPriceMicroLamports, true);
  const instructions: Instruction[] = [
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: limit },
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: price },
  ];
  const created = new Set<string>();
  for (const leg of request.legs) {
    const destination = associatedTokenAddress(
      owner,
      leg.quote.outputMint,
      leg.outputTokenProgram,
    ).address;
    if (leg.createOutputAccount && !created.has(destination)) {
      created.add(destination);
      instructions.push({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: leg.quote.outputMint, isSigner: false, isWritable: false },
          { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: leg.outputTokenProgram, isSigner: false, isWritable: false },
        ],
        data: Uint8Array.of(1),
      });
    }
  }
  for (const leg of request.legs) {
    instructions.push(
      fixtureSwapInstruction(
        {
          owner,
          source: associatedTokenAddress(owner, leg.quote.inputMint, leg.inputTokenProgram).address,
          destination: associatedTokenAddress(owner, leg.quote.outputMint, leg.outputTokenProgram)
            .address,
          inputMint: leg.quote.inputMint,
          outputMint: leg.quote.outputMint,
          inputTokenProgram: leg.inputTokenProgram,
          outputTokenProgram: leg.outputTokenProgram,
        },
        {
          inAmountRaw: BigInt(leg.quote.inAmountRaw),
          minimumOutRaw: BigInt(leg.quote.otherAmountThresholdRaw),
          slippageBps: leg.quote.slippageBps,
        },
      ),
    );
  }
  const message = compileLegacyMessage({
    feePayer: owner,
    instructions,
    recentBlockhash: request.recentBlockhash,
  });
  return {
    unsignedTransaction: bytesToBase64(unsignedTransaction(message)),
    version: 'legacy',
    sourceRef: 'fixture:venue',
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
  /** Gateway that builds transactions for its quotes; absent means execution is unavailable. */
  readonly buildUrl?: string | null;
}

function sourceRefOf(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/**
 * POST the Markov quote request (and, when a build URL is configured, the
 * build request) to a configured gateway and validate the answer against the
 * contract, with the same bounds as every other outbound call: https only
 * outside local/test, no redirects, a timeout and a byte cap. The gateway's
 * `sourceRef` is replaced by ours and its `mode` must say `configured_url`;
 * every economic field is still checked by the planner before anything is
 * built on it, and every built byte is decoded by the execution validator.
 */
export function createConfiguredUrlVenue(options: ConfiguredUrlVenueOptions): VenueAdapter {
  const url = checkedUrl(options.url, options.allowInsecure === true);
  const buildUrl = options.buildUrl
    ? checkedUrl(options.buildUrl, options.allowInsecure === true)
    : null;
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
  const post = async (target: URL, body: unknown): Promise<unknown> => {
    const ref = sourceRefOf(target);
    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (cause) {
      throw new VenueQuoteError('unreachable', `venue ${ref} did not answer`, cause);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new VenueQuoteError('http', `venue ${ref} answered HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new VenueQuoteError('oversized', `venue declares ${declared} bytes, limit ${maxBytes}`);
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
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (cause) {
      throw new VenueQuoteError('malformed', `venue ${ref} is not JSON`, cause);
    }
  };
  return {
    venue: 'jupiter',
    mode: 'configured_url',
    sourceRef,
    minimumInputRaw: options.minimumInputRaw ?? null,
    async quote(input) {
      const request: VenueQuoteRequest = venueQuoteRequestSchema.parse(input);
      const payload = await post(url, request);
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
      if (parsed.data.mode !== 'configured_url') {
        throw new VenueQuoteError(
          'malformed',
          `venue ${sourceRef} answered mode ${parsed.data.mode}; a configured gateway must say configured_url`,
        );
      }
      return { ...parsed.data, sourceRef };
    },
    // Whole-basket composition through a gateway is not part of the build contract yet (OD-21): baskets stay staged.
    compose: null,
    build:
      buildUrl === null
        ? null
        : async (request) => {
            const payload: VenueBuildRequestPayload = venueBuildRequestSchema.parse({
              schemaVersion: '1',
              quote: request.quote,
              owner: request.owner,
              inputTokenProgram: request.inputTokenProgram,
              outputTokenProgram: request.outputTokenProgram,
              recentBlockhash: request.recentBlockhash,
              computeUnitLimit: request.computeUnitLimit,
              computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports.toString(),
              createOutputAccount: request.createOutputAccount,
            });
            const answer = await post(buildUrl, payload);
            const parsed = venueBuildResponseSchema.safeParse(answer);
            if (!parsed.success) {
              throw new VenueQuoteError(
                'malformed',
                `venue ${sourceRefOf(buildUrl)} did not answer the build contract: ${parsed.error.issues
                  .slice(0, 3)
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; ')}`,
              );
            }
            return {
              unsignedTransaction: parsed.data.unsignedTransaction,
              version: parsed.data.version,
              sourceRef: sourceRefOf(buildUrl),
            };
          },
  };
}

function checkedUrl(text: string, allowInsecure: boolean): URL {
  const url = new URL(text);
  if (url.username || url.password) {
    throw new VenueQuoteError('insecure_url', 'venue URL must not embed credentials');
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) {
    throw new VenueQuoteError('insecure_url', 'venue URL must use https');
  }
  return url;
}
