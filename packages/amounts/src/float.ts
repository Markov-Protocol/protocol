import { Decimal } from './decimal.js';

/**
 * IEEE-754 doubles appear on chain (Token-2022 scaled UI amount
 * multipliers). They are converted once, exactly, into decimals; no later
 * arithmetic touches floating point.
 */
export interface DoubleDecimal {
  /** Exact decimal expansion of the double (can be long). */
  readonly exact: string;
  /** Shortest decimal that round-trips to the same double (what most tools display). */
  readonly shortest: string;
}

/** Read a little-endian f64 (as stored by Token-2022 `PodF64`). */
export function f64FromLeBytes(bytes: Uint8Array, offset = 0): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(offset, true);
}

/** Exact decimal expansion of a finite double using its binary mantissa and exponent. */
export function exactDecimalOfDouble(value: number): Decimal {
  if (!Number.isFinite(value)) {
    throw new RangeError('only finite doubles have a decimal expansion');
  }
  if (value === 0) {
    return Decimal.zero();
  }
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const high = buffer.getUint32(0);
  const low = buffer.getUint32(4);
  const negative = high >>> 31 === 1;
  const exponentBits = (high >>> 20) & 0x7ff;
  const mantissaHigh = high & 0xfffff;
  let mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(low);
  let exponent: number;
  if (exponentBits === 0) {
    exponent = -1074; // subnormal
  } else {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }
  let result: Decimal;
  if (exponent >= 0) {
    result = Decimal.fromBigInt(mantissa << BigInt(exponent));
  } else {
    // mantissa × 2^exponent = mantissa × 5^(-exponent) / 10^(-exponent)
    const shift = -exponent;
    result = Decimal.of(mantissa * 5n ** BigInt(shift), shift);
  }
  return negative ? result.negate() : result;
}

export function decimalsOfDouble(value: number): DoubleDecimal {
  const exact = exactDecimalOfDouble(value);
  return { exact: exact.toString(), shortest: shortestDecimalOfDouble(value) };
}

/** JavaScript's shortest round-trip representation, rewritten without an exponent. */
export function shortestDecimalOfDouble(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError('only finite doubles have a decimal representation');
  }
  const text = value.toString();
  if (!/e/i.test(text)) {
    return text === '-0' ? '0' : text;
  }
  const [mantissaText, exponentText] = text.split(/e/i) as [string, string];
  const exponent = Number.parseInt(exponentText, 10);
  const negative = mantissaText.startsWith('-');
  const digits = mantissaText.replace('-', '').replace('.', '');
  const pointIndex = mantissaText.replace('-', '').indexOf('.');
  const integerDigits = pointIndex === -1 ? digits.length : pointIndex;
  const newPoint = integerDigits + exponent;
  let out: string;
  if (newPoint <= 0) {
    out = `0.${'0'.repeat(-newPoint)}${digits}`;
  } else if (newPoint >= digits.length) {
    out = `${digits}${'0'.repeat(newPoint - digits.length)}`;
  } else {
    out = `${digits.slice(0, newPoint)}.${digits.slice(newPoint)}`;
  }
  out = out.replace(/\.?0+$/, (match) =>
    match.startsWith('.') ? '' : match.includes('.') ? '' : match,
  );
  return `${negative ? '-' : ''}${out}`;
}
