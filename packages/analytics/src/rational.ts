import { divideRounded, type RoundingMode } from '@markov/amounts';

/**
 * Exact rational arithmetic on BigInt for the analytics: valuations,
 * returns and ratios are computed exactly and rounded once when reported.
 * Never a float.
 */
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

export class Rational {
  readonly numerator: bigint;
  /** Always positive. */
  readonly denominator: bigint;

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === 0n) {
      throw new RangeError('division by zero');
    }
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(numerator, denominator) || 1n;
    this.numerator = (sign * numerator) / divisor;
    this.denominator = (sign * denominator) / divisor;
  }

  static of(numerator: bigint, denominator = 1n): Rational {
    return new Rational(numerator, denominator);
  }

  static zero(): Rational {
    return new Rational(0n, 1n);
  }

  static one(): Rational {
    return new Rational(1n, 1n);
  }

  static fromDecimal(text: string): Rational {
    const match = DECIMAL_PATTERN.exec(text.trim());
    if (!match) {
      throw new RangeError(`not a decimal string: ${JSON.stringify(text)}`);
    }
    const [, sign, whole, fraction = ''] = match;
    const unscaled = BigInt(`${whole}${fraction}`) * (sign === '-' ? -1n : 1n);
    return new Rational(unscaled, 10n ** BigInt(fraction.length));
  }

  add(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  subtract(other: Rational): Rational {
    return this.add(other.negate());
  }

  multiply(other: Rational): Rational {
    return new Rational(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  divide(other: Rational): Rational {
    if (other.numerator === 0n) {
      throw new RangeError('division by zero');
    }
    return new Rational(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  negate(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  compare(other: Rational): -1 | 0 | 1 {
    const left = this.numerator * other.denominator;
    const right = other.numerator * this.denominator;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  isNegative(): boolean {
    return this.numerator < 0n;
  }

  isPositive(): boolean {
    return this.numerator > 0n;
  }

  /** The nearest integer under the rounding mode. */
  toBigInt(rounding: RoundingMode = 'half_even'): bigint {
    return divideRounded(this.numerator, this.denominator, rounding);
  }

  /** Decimal string with exactly `scale` fractional digits, rounded once. */
  toDecimal(scale: number, rounding: RoundingMode = 'half_even'): string {
    const unscaled = divideRounded(
      this.numerator * 10n ** BigInt(scale),
      this.denominator,
      rounding,
    );
    const negative = unscaled < 0n;
    const digits = (negative ? -unscaled : unscaled).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale);
    const text = scale === 0 ? whole : `${whole}.${fraction}`;
    return negative && unscaled !== 0n ? `-${text}` : text;
  }

  /** The value rounded to `scale` places as a new exact rational (what a reported number means). */
  rounded(scale: number, rounding: RoundingMode = 'half_even'): Rational {
    return Rational.fromDecimal(this.toDecimal(scale, rounding));
  }
}

export function sumRationals(values: readonly Rational[]): Rational {
  let total = Rational.zero();
  for (const value of values) {
    total = total.add(value);
  }
  return total;
}

export function maxRational(a: Rational, b: Rational): Rational {
  return a.compare(b) >= 0 ? a : b;
}
