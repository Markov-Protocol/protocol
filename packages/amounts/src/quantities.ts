import { Decimal, type RoundingMode } from './decimal.js';

/**
 * Raw base units are what the chain moves. A scaled (display) quantity is
 * raw × multiplier / 10^decimals; it is never stored as the source of
 * truth and never multiplied twice. Every conversion records how it
 * rounded and what multiplier it used.
 */
export interface ScaledQuantity {
  readonly raw: string;
  readonly decimals: number;
  readonly multiplier: string;
  /** Scaled amount rounded to `displayScale` digits. */
  readonly scaled: string;
  /** Exact scaled amount before rounding (may have many digits). */
  readonly scaledExact: string;
  readonly displayScale: number;
  readonly rounding: RoundingMode;
  /** True when rounding lost information (`scaled` differs from `scaledExact`). */
  readonly rounded: boolean;
}

const RAW_PATTERN = /^\d+$/;

export function assertRawAmount(raw: string): bigint {
  if (!RAW_PATTERN.test(raw)) {
    throw new RangeError(
      `raw amount must be a non-negative integer string, got ${JSON.stringify(raw)}`,
    );
  }
  return BigInt(raw);
}

export interface ScaleOptions {
  readonly raw: string;
  readonly decimals: number;
  /** Decimal string; "1" for tokens without a scaled UI amount. */
  readonly multiplier: string;
  readonly displayScale?: number;
  readonly rounding?: RoundingMode;
}

/** raw → scaled, exactly then rounded once with the stated mode. */
export function rawToScaled(options: ScaleOptions): ScaledQuantity {
  const rawValue = assertRawAmount(options.raw);
  const multiplier = Decimal.fromString(options.multiplier);
  if (multiplier.isNegative()) {
    throw new RangeError('multiplier must not be negative');
  }
  const displayScale = options.displayScale ?? options.decimals;
  const rounding = options.rounding ?? 'down';
  const exact = Decimal.of(rawValue, options.decimals).multiply(multiplier);
  const rounded = exact.toScale(displayScale, rounding);
  return {
    raw: options.raw,
    decimals: options.decimals,
    multiplier: multiplier.toString(),
    scaled: rounded.toString(),
    scaledExact: exact.toString(),
    displayScale,
    rounding,
    rounded: !rounded.equals(exact),
  };
}

export interface UnscaleOptions {
  readonly scaled: string;
  readonly decimals: number;
  readonly multiplier: string;
  readonly rounding?: RoundingMode;
}

export interface RawQuantity {
  readonly raw: string;
  readonly rawExact: string;
  readonly rounding: RoundingMode;
  readonly rounded: boolean;
}

/** scaled → raw: raw = scaled × 10^decimals / multiplier, rounded once. Refuses a zero multiplier. */
export function scaledToRaw(options: UnscaleOptions): RawQuantity {
  const scaled = Decimal.fromString(options.scaled);
  const multiplier = Decimal.fromString(options.multiplier);
  if (multiplier.isZero() || multiplier.isNegative()) {
    throw new RangeError('multiplier must be positive');
  }
  if (scaled.isNegative()) {
    throw new RangeError('scaled amount must not be negative');
  }
  const rounding = options.rounding ?? 'down';
  // raw = scaled × 10^decimals / multiplier = (scaled.unscaled × 10^(decimals + multiplier.scale - scaled.scale)) / multiplier.unscaled
  const shift = options.decimals + multiplier.scale - scaled.scale;
  const numerator = shift >= 0 ? scaled.unscaled * 10n ** BigInt(shift) : scaled.unscaled;
  const denominator =
    shift >= 0 ? multiplier.unscaled : multiplier.unscaled * 10n ** BigInt(-shift);
  const exact = Decimal.of(numerator, 0).divideByInteger(denominator, 30, 'down');
  const raw = Decimal.of(numerator, 0).divideByInteger(denominator, 0, rounding);
  return {
    raw: raw.toString(),
    rawExact: exact.toString(),
    rounding,
    rounded: !raw.equals(exact),
  };
}

/**
 * Mirror of Token-2022's `amount_to_ui_amount` for scaled UI amounts, which
 * multiplies in f64 and formats with the mint's decimals. It exists only to
 * measure where the on-chain helper's floating-point result diverges from
 * the exact conversion; Markov never uses it for accounting.
 */
export function tokenProgramUiAmount(raw: string, decimals: number, multiplier: number): string {
  const rawValue = assertRawAmount(raw);
  // `amount_to_ui_amount`: trunc(amount as f64 × multiplier) / 10^decimals, formatted with `decimals` digits, trailing zeros trimmed.
  const truncated = Math.trunc(Number(rawValue) * multiplier) / 10 ** decimals;
  const fixed = truncated.toFixed(decimals);
  return decimals === 0 ? fixed : fixed.replace(/\.?0+$/, '');
}

/** Mirror of `try_ui_amount_into_amount`: parse as f64, divide by multiplier / 10^decimals, truncate. */
export function tokenProgramRawAmount(ui: string, decimals: number, multiplier: number): string {
  const amount = Number.parseFloat(ui) / (multiplier / 10 ** decimals);
  if (!Number.isFinite(amount) || amount < 0 || amount > 2 ** 64) {
    throw new RangeError('ui amount does not convert to a u64');
  }
  return BigInt(Math.trunc(amount)).toString();
}
