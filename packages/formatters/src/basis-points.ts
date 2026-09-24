import { BASIS_POINTS_TOTAL } from '@markov/contracts';
import { formatDecimalString, localeSeparators } from './decimal';

export { BASIS_POINTS_TOTAL };

/** Format integer basis points as a percentage with exactly two decimals: 1234 -> "12.34%". */
export function formatBasisPoints(
  bps: number,
  options: { readonly locale?: string; readonly maximumFractionDigits?: number } = {},
): string {
  if (!Number.isInteger(bps)) {
    throw new TypeError(`basis points must be an integer, received ${bps}`);
  }
  const negative = bps < 0;
  const digits = Math.abs(bps).toString().padStart(3, '0');
  const value = `${digits.slice(0, -2)}.${digits.slice(-2)}`;
  const formatted = formatDecimalString(value, {
    minimumFractionDigits: options.maximumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
    ...(options.locale ? { locale: options.locale } : {}),
  });
  return `${negative ? '-' : ''}${formatted}%`;
}

export type PercentParseResult =
  | { readonly ok: true; readonly bps: number }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'invalid' | 'negative' | 'too-many-decimals' | 'out-of-range';
    };

/**
 * Parse a percentage typed by a user ("12.5", "33,33") into integer basis
 * points. More than two decimals cannot be represented exactly and are
 * rejected rather than rounded.
 */
export function parsePercentToBasisPoints(
  input: string,
  options: { readonly locale?: string } = {},
): PercentParseResult {
  const separators = localeSeparators(options.locale);
  const trimmed = input.trim().replace(/%$/, '').trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }
  const withoutGrouping = trimmed.split(separators.group).join('');
  const canonical =
    separators.decimal === '.'
      ? withoutGrouping
      : withoutGrouping.split(separators.decimal).join('.');
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(canonical);
  if (!match || ((match[2] ?? '') === '' && (match[3] ?? '') === '')) {
    return { ok: false, reason: 'invalid' };
  }
  if (match[1] === '-') {
    return { ok: false, reason: 'negative' };
  }
  const fraction = match[3] ?? '';
  if (fraction.length > 2) {
    return { ok: false, reason: 'too-many-decimals' };
  }
  const bps = Number.parseInt(`${match[2] || '0'}${fraction.padEnd(2, '0')}`, 10);
  if (bps > BASIS_POINTS_TOTAL) {
    return { ok: false, reason: 'out-of-range' };
  }
  return { ok: true, bps };
}

/** Sum basis points exactly; throws on non-integers. */
export function sumBasisPoints(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isInteger(value)) {
      throw new TypeError(`basis points must be integers, received ${value}`);
    }
    return total + value;
  }, 0);
}

/** Remaining basis points to reach exactly 10,000; negative when over-allocated. */
export function remainingBasisPoints(values: readonly number[]): number {
  return BASIS_POINTS_TOTAL - sumBasisPoints(values);
}
