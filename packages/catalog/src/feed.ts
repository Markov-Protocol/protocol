import { createHash } from 'node:crypto';
import {
  type CatalogPrice,
  decimalStringSchema,
  decodeBase58,
  INSTRUMENT_SYMBOL_PATTERN,
  type InstrumentKind,
  type Issuer,
  type IssuerFeed,
  type IssuerFeedProduct,
  issuerFeedSchema,
  type TokenProgram,
} from '@markov/contracts';

/** Reference prices older than this are marked stale; they are never quotes to begin with. */
export const REFERENCE_PRICE_STALE_AFTER_MS = 24 * 3600 * 1000;

export interface NormalizedProduct {
  readonly productId: string;
  readonly symbol: string;
  readonly name: string;
  readonly companyName: string;
  readonly kind: InstrumentKind;
  readonly mint: string;
  readonly decimals: number;
  readonly tokenProgram: TokenProgram;
  readonly website: string | null;
  readonly description: string | null;
  readonly referencePrice: CatalogPrice | null;
  /** Listed stocks: the underlying security as the issuer names it. */
  readonly underlying: { readonly ticker: string; readonly exchange: string | null } | null;
}

export type NormalizeOutcome =
  | { readonly ok: true; readonly product: NormalizedProduct }
  | {
      readonly ok: false;
      readonly productId: string;
      readonly symbol: string | null;
      readonly reasons: string[];
    };

/** Strip control characters and markup, collapse whitespace and bound the length. Never returns HTML. */
export function sanitizeText(value: string, max: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is removed
  const withoutControls = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  const withoutScripts = withoutControls.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]*>?/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeWebsite(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function isValidMint(value: string): boolean {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

/** Validate and sanitise one feed product. Invalid products are rejected with every reason, never repaired. */
export function normalizeProduct(raw: IssuerFeedProduct, now: Date): NormalizeOutcome {
  const reasons: string[] = [];
  const productId = sanitizeText(raw.productId, 100);
  const symbol = sanitizeText(raw.symbol, 40).toUpperCase();
  const name = sanitizeText(raw.name, 200);
  const companyName = sanitizeText(raw.companyName, 200);
  const mint = raw.mint.trim();
  if (productId.length === 0) {
    reasons.push('missing productId');
  }
  if (!INSTRUMENT_SYMBOL_PATTERN.test(symbol)) {
    reasons.push('symbol must be 1 to 12 uppercase letters, digits, dots or dashes');
  }
  if (name.length === 0) {
    reasons.push('missing name');
  }
  if (companyName.length === 0) {
    reasons.push('missing companyName');
  }
  if (!isValidMint(mint)) {
    reasons.push('mint is not a base58 32-byte address');
  }
  if (!Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 18) {
    reasons.push('decimals must be an integer between 0 and 18');
  }
  let referencePrice: CatalogPrice | null = null;
  if (raw.referencePrice) {
    const price = raw.referencePrice;
    const value = price.value.trim();
    if (!decimalStringSchema.safeParse(value).success || value.startsWith('-')) {
      reasons.push('referencePrice.value must be a non-negative decimal string');
    } else {
      const observed = new Date(price.observedAt);
      referencePrice = {
        value,
        unit: sanitizeText(price.unit, 20).toUpperCase(),
        kind: price.kind,
        observedAt: observed.toISOString(),
        source: sanitizeText(price.source, 200) || 'issuer',
        stale: now.getTime() - observed.getTime() > REFERENCE_PRICE_STALE_AFTER_MS,
        expiresAt: null,
      };
      if (referencePrice.unit.length === 0) {
        reasons.push('referencePrice.unit is required');
      }
    }
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      productId: productId || raw.productId.slice(0, 100),
      symbol: symbol.length > 0 ? symbol.slice(0, 12) : null,
      reasons,
    };
  }
  const description = raw.description ? sanitizeText(raw.description, 1000) : '';
  const ticker = raw.underlying ? sanitizeText(raw.underlying.ticker, 20).toUpperCase() : '';
  const exchange = raw.underlying?.exchange
    ? sanitizeText(raw.underlying.exchange, 40).toUpperCase()
    : '';
  return {
    ok: true,
    product: {
      productId,
      symbol,
      name,
      companyName,
      kind: raw.kind,
      mint,
      decimals: raw.decimals,
      tokenProgram: raw.tokenProgram ?? 'unknown',
      website: sanitizeWebsite(raw.website),
      description: description.length > 0 ? description : null,
      referencePrice,
      underlying:
        ticker.length > 0 ? { ticker, exchange: exchange.length > 0 ? exchange : null } : null,
    },
  };
}

export type FeedParseOutcome =
  | { readonly ok: true; readonly feed: IssuerFeed }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse an issuer payload against the feed contract. Any drift (unknown
 * schema version, renamed fields, wrong issuer) rejects the whole snapshot
 * so no partially understood data reaches the catalog.
 */
export function parseIssuerFeed(payload: unknown, expectedIssuer: Issuer): FeedParseOutcome {
  const parsed = issuerFeedSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    return { ok: false, reason: `feed does not match schema ${'1'}: ${issues.join('; ')}` };
  }
  if (parsed.data.issuer !== expectedIssuer) {
    return {
      ok: false,
      reason: `feed issuer ${parsed.data.issuer} does not match ${expectedIssuer}`,
    };
  }
  return { ok: true, feed: parsed.data };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

/** Stable SHA-256 of a JSON payload (keys sorted), used to detect identical snapshots. */
export function contentHash(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

/** Fingerprint of the fields the catalog stores for a product, to detect unchanged upstream records. */
export function productFingerprint(product: NormalizedProduct): string {
  return contentHash(product);
}
