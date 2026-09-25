import type { VenueQuote, VenueQuoteMode, VenueQuoteRequest } from '@markov/contracts';

/**
 * A venue adapter answers Markov's quote contract. Implementations live in
 * integration packages (`@markov/venue-jupiter`); the planner only ever
 * sees validated quotes and never a provider SDK.
 */
export interface VenueAdapter {
  readonly venue: 'jupiter';
  readonly mode: VenueQuoteMode;
  /** Endpoint or fixture name, without credentials; recorded as the quote's source. */
  readonly sourceRef: string;
  /** The venue's documented route minimum per leg input (raw stablecoin units), or null when none is known. */
  readonly minimumInputRaw: bigint | null;
  quote(request: VenueQuoteRequest): Promise<VenueQuote>;
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
