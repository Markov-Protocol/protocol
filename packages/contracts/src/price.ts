import { z } from 'zod';

/**
 * Typed prices. A reference price is not an executable offer, and a
 * company's implied valuation is not a token price. Every price carries its
 * unit, kind, observation time, source and freshness so no consumer can
 * treat an unexplained number as money.
 */
export const PRICE_KINDS = [
  'execution_quote',
  'secondary_market',
  'underlying_equity',
  'issuer_mark',
  'implied_valuation',
  'cost_basis',
] as const;
export const priceKindSchema = z.enum(PRICE_KINDS);
export type PriceKind = z.infer<typeof priceKindSchema>;

/** Human labels for price kinds; the UI never invents its own. */
export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  execution_quote: 'Quote',
  secondary_market: 'Market price',
  underlying_equity: 'Underlying equity price',
  issuer_mark: 'Issuer mark',
  implied_valuation: 'Implied valuation',
  cost_basis: 'Cost basis',
};

/** Decimal number encoded as a string: optional minus, digits, optional fraction. Never a float. */
export const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');
export type DecimalString = z.infer<typeof decimalStringSchema>;

/** Integer amount in token base units, as a string of digits. */
export const rawAmountSchema = z.string().regex(/^\d+$/, 'must be a non-negative integer string');
export type RawAmount = z.infer<typeof rawAmountSchema>;

/** Integer basis points; 10,000 basis points equal 100 percent. */
export const BASIS_POINTS_TOTAL = 10_000;
export const basisPointsSchema = z.number().int().min(0).max(BASIS_POINTS_TOTAL);

export const typedPriceSchema = z.object({
  value: decimalStringSchema,
  /** Quote unit such as USDC or USD. USDC and USD are different units. */
  unit: z.string().min(1).max(20),
  kind: priceKindSchema,
  observedAt: z.iso.datetime(),
  /** Secret-free source identifier (provider or venue name), never a URL with credentials. */
  source: z.string().min(1).max(200),
  stale: z.boolean(),
  /** When the value stops being usable for its purpose (quotes); null for reference prices. */
  expiresAt: z.iso.datetime().nullable(),
});
export type TypedPrice = z.infer<typeof typedPriceSchema>;
