/**
 * Exact decimal arithmetic on BigInt: a value is `unscaled × 10^-scale`.
 * No floating point anywhere. Used for economic values (prices, scaled
 * quantities, multipliers); raw token amounts stay integer strings.
 */
export type RoundingMode = 'down' | 'up' | 'half_up' | 'half_even';

export const ROUNDING_MODES: readonly RoundingMode[] = ['down', 'up', 'half_up', 'half_even'];

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export class Decimal {
  readonly unscaled: bigint;
  readonly scale: number;

  private constructor(unscaled: bigint, scale: number) {
    if (!Number.isInteger(scale) || scale < 0 || scale > 400) {
      throw new RangeError(`scale ${scale} is out of range`);
    }
    this.unscaled = unscaled;
    this.scale = scale;
  }

  static of(unscaled: bigint, scale: number): Decimal {
    return new Decimal(unscaled, scale);
  }

  static fromString(text: string): Decimal {
    const match = DECIMAL_PATTERN.exec(text.trim());
    if (!match) {
      throw new RangeError(`not a decimal string: ${JSON.stringify(text)}`);
    }
    const [, sign, whole, fraction = ''] = match;
    const unscaled = BigInt(`${whole}${fraction}`) * (sign === '-' ? -1n : 1n);
    return new Decimal(unscaled, fraction.length);
  }

  static fromBigInt(value: bigint): Decimal {
    return new Decimal(value, 0);
  }

  static zero(): Decimal {
    return new Decimal(0n, 0);
  }

  isZero(): boolean {
    return this.unscaled === 0n;
  }

  isNegative(): boolean {
    return this.unscaled < 0n;
  }

  negate(): Decimal {
    return new Decimal(-this.unscaled, this.scale);
  }

  /** Same value expressed with at least `scale` fractional digits. */
  withScaleAtLeast(scale: number): Decimal {
    if (scale <= this.scale) {
      return this;
    }
    return new Decimal(this.unscaled * 10n ** BigInt(scale - this.scale), scale);
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(
      this.withScaleAtLeast(scale).unscaled + other.withScaleAtLeast(scale).unscaled,
      scale,
    );
  }

  subtract(other: Decimal): Decimal {
    return this.add(other.negate());
  }

  multiply(other: Decimal): Decimal {
    return new Decimal(this.unscaled * other.unscaled, this.scale + other.scale);
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const a = this.withScaleAtLeast(scale).unscaled;
    const b = other.withScaleAtLeast(scale).unscaled;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Divide by an integer power of ten and round to `scale` fractional
   * digits. Division is the only lossy operation; the rounding mode is
   * always explicit and returned to the caller as provenance.
   */
  toScale(scale: number, rounding: RoundingMode): Decimal {
    if (scale >= this.scale) {
      return this.withScaleAtLeast(scale);
    }
    const divisor = 10n ** BigInt(this.scale - scale);
    return new Decimal(divideRounded(this.unscaled, divisor, rounding), scale);
  }

  /** Exact division by a non-zero integer, rounded to `scale` digits. */
  divideByInteger(divisor: bigint, scale: number, rounding: RoundingMode): Decimal {
    if (divisor === 0n) {
      throw new RangeError('division by zero');
    }
    const lifted = this.withScaleAtLeast(scale);
    return new Decimal(divideRounded(lifted.unscaled, divisor, rounding), scale);
  }

  /** Canonical string: no exponent, no trailing zeros beyond the minimum, "-0" never appears. */
  toString(): string {
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString();
    if (this.scale === 0) {
      return `${negative ? '-' : ''}${digits}`;
    }
    const padded = digits.padStart(this.scale + 1, '0');
    const whole = padded.slice(0, padded.length - this.scale);
    let fraction = padded.slice(padded.length - this.scale).replace(/0+$/, '');
    if (fraction.length === 0) {
      return `${negative ? '-' : ''}${whole}`;
    }
    fraction = fraction.length === 0 ? '0' : fraction;
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  /** String with exactly `scale` fractional digits (after rounding). */
  toFixed(scale: number, rounding: RoundingMode): string {
    const value = this.toScale(scale, rounding);
    const negative = value.unscaled < 0n;
    const digits = (negative ? -value.unscaled : value.unscaled)
      .toString()
      .padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
  }
}

/** Integer division with an explicit rounding mode; exact for every input. */
export function divideRounded(numerator: bigint, divisor: bigint, rounding: RoundingMode): bigint {
  if (divisor === 0n) {
    throw new RangeError('division by zero');
  }
  const negative = numerator < 0n !== divisor < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = divisor < 0n ? -divisor : divisor;
  const quotient = n / d;
  const remainder = n % d;
  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }
  let rounded: bigint;
  switch (rounding) {
    case 'down':
      rounded = quotient;
      break;
    case 'up':
      rounded = quotient + 1n;
      break;
    case 'half_up': {
      rounded = remainder * 2n >= d ? quotient + 1n : quotient;
      break;
    }
    case 'half_even': {
      const twice = remainder * 2n;
      rounded = twice > d || (twice === d && quotient % 2n === 1n) ? quotient + 1n : quotient;
      break;
    }
  }
  return negative ? -rounded : rounded;
}
