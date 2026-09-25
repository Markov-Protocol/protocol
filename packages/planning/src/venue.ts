import type { VenueQuote, VenueQuoteMode, VenueQuoteRequest } from '@markov/contracts';

/**
 * A venue adapter answers Markov's quote contract and, when it can, builds
 * the transaction for a quote it gave. Implementations live in integration
 * packages (`@markov/venue-jupiter`); the planner only ever sees validated
 * quotes, and the execution validator decodes every built byte before it
 * is shown to anyone.
 */
export interface VenueBuildRequest {
  /** The exact quote the plan leg was built on. */
  readonly quote: VenueQuote;
  /** The wallet that pays, signs and owns both token accounts. */
  readonly owner: string;
  readonly inputTokenProgram: string;
  readonly outputTokenProgram: string;
  readonly recentBlockhash: string;
  /** Compute budget the builder may request; the validator refuses more. */
  readonly computeUnitLimit: number;
  readonly computeUnitPriceMicroLamports: bigint;
  /** Whether the owner's output token account must be created in the same transaction. */
  readonly createOutputAccount: boolean;
}

export interface VenueBuild {
  /** Base64 of the unsigned wire transaction (zeroed signature slots in front of the message). */
  readonly unsignedTransaction: string;
  readonly version: 'legacy' | 'v0';
  /** The adapter and endpoint (without credentials) the bytes came from. */
  readonly sourceRef: string;
}

/** One leg of a whole-basket composition. */
export interface VenueComposeLeg {
  readonly quote: VenueQuote;
  readonly inputTokenProgram: string;
  readonly outputTokenProgram: string;
  readonly createOutputAccount: boolean;
}

/**
 * Every leg in one transaction: account creations first, then the swaps in
 * leg order, sharing the owner's input account. The result is measured and
 * simulated as a whole before a plan is called atomic.
 */
export interface VenueComposeRequest {
  readonly legs: readonly VenueComposeLeg[];
  readonly owner: string;
  readonly recentBlockhash: string;
  readonly computeUnitLimit: number;
  readonly computeUnitPriceMicroLamports: bigint;
}

export interface VenueAdapter {
  readonly venue: 'jupiter';
  readonly mode: VenueQuoteMode;
  /** Endpoint or fixture name, without credentials; recorded as the quote's source. */
  readonly sourceRef: string;
  /** The venue's documented route minimum per leg input (raw stablecoin units), or null when none is known. */
  readonly minimumInputRaw: bigint | null;
  quote(request: VenueQuoteRequest): Promise<VenueQuote>;
  /** Null when this adapter cannot build transactions (a quote-only gateway): execution stays unavailable. */
  readonly build: ((request: VenueBuildRequest) => Promise<VenueBuild>) | null;
  /** Null when this adapter cannot compose several legs into one transaction: baskets stay staged. */
  readonly compose: ((request: VenueComposeRequest) => Promise<VenueBuild>) | null;
}

export type VenueQuoteFailureKind =
  | 'unsupported_mint'
  | 'no_route'
  | 'unreachable'
  | 'http'
  | 'oversized'
  | 'malformed'
  | 'insecure_url';

export class VenueQuoteError extends Error {
  override readonly name = 'VenueQuoteError';
  readonly kind: VenueQuoteFailureKind;

  constructor(kind: VenueQuoteFailureKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.kind = kind;
  }
}
