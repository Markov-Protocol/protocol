export type RoundingMode = 'truncate' | 'half-up';

export interface FormatAmountOptions {
  /** Fewest fraction digits to show (default 0). */
  readonly minimumFractionDigits?: number;
  /** Most fraction digits to show (default: all significant digits). */
  readonly maximumFractionDigits?: number;
  /** Rounding when digits are dropped (default truncate: never show more than exists). */
  readonly rounding?: RoundingMode;
  /** Group integer digits (default true). */
  readonly grouping?: boolean;
  /** Locale for separators (default en-US). Only the separators come from the locale. */
  readonly locale?: string;
}

export interface LocaleSeparators {
  readonly group: string;
  readonly decimal: string;
}

const separatorCache = new Map<string, LocaleSeparators>();

export function localeSeparators(locale = 'en-US'): LocaleSeparators {
  const cached = separatorCache.get(locale);
  if (cached) {
    return cached;
  }
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  const group = parts.find((part) => part.type === 'group')?.value ?? ',';
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const result = { group, decimal };
  separatorCache.set(locale, result);
  return result;
}

function assertDigits(value: string, what: string): void {
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${what} must be a string of digits, received ${JSON.stringify(value)}`);
  }
}

function groupDigits(integer: string, separator: string): string {
  let out = '';
  for (let i = 0; i < integer.length; i += 1) {
    const fromEnd = integer.length - i;
    out += integer[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) {
      out += separator;
    }
  }
  return out;
}

/**
 * Split a raw base-unit amount into exact integer and fraction digit strings.
 * `raw` is a bigint or a string of digits; `decimals` is the token scale.
 */
export function splitRawAmount(
  raw: string | bigint,
  decimals: number,
): { integer: string; fraction: string } {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new RangeError(`decimals must be an integer between 0 and 38, received ${decimals}`);
  }
  const digits = typeof raw === 'bigint' ? raw.toString() : raw;
  assertDigits(digits, 'raw amount');
  const normalized = digits.replace(/^0+(?=\d)/, '');
  if (decimals === 0) {
    return { integer: normalized, fraction: '' };
  }
  const padded = normalized.padStart(decimals + 1, '0');
  return { integer: padded.slice(0, -decimals), fraction: padded.slice(-decimals) };
}

function roundDigits(
  integer: string,
  fraction: string,
  keep: number,
  mode: RoundingMode,
): { integer: string; fraction: string } {
  if (fraction.length <= keep) {
    return { integer, fraction };
  }
  const kept = fraction.slice(0, keep);
  const dropped = fraction.slice(keep);
  if (mode === 'truncate' || (dropped[0] ?? '0') < '5') {
    return { integer, fraction: kept };
  }
  const scale = 10n ** BigInt(keep);
  const bumped = BigInt(integer) * scale + BigInt(kept === '' ? '0' : kept) + 1n;
  const bumpedDigits = bumped.toString().padStart(keep + 1, '0');
  return keep === 0
    ? { integer: bumpedDigits, fraction: '' }
    : { integer: bumpedDigits.slice(0, -keep), fraction: bumpedDigits.slice(-keep) };
}

/**
 * Format a raw base-unit amount for display without ever converting it to a
 * float. `formatRawAmount('500000000', 6)` is `500`; `('1', 9)` is
 * `0.000000001`.
 */
export function formatRawAmount(
  raw: string | bigint,
  decimals: number,
  options: FormatAmountOptions = {},
): string {
  const { integer, fraction } = splitRawAmount(raw, decimals);
  return composeDecimal(integer, fraction, options);
}

/**
 * Format a decimal string (for example a typed price) with exact digit
 * handling: grouping, minimum/maximum fraction digits and explicit rounding.
 */
export function formatDecimalString(value: string, options: FormatAmountOptions = {}): string {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new TypeError(`value must be a decimal string, received ${JSON.stringify(value)}`);
  }
  const sign = match[1] ?? '';
  const integer = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = match[3] ?? '';
  const formatted = composeDecimal(integer, fraction, options);
  return sign && formatted !== '0' && !/^0(\.0+)?$/.test(formatted)
    ? `${sign}${formatted}`
    : formatted;
}

function composeDecimal(
  integerDigits: string,
  fractionDigits: string,
  options: FormatAmountOptions,
): string {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits =
    options.maximumFractionDigits ?? Math.max(fractionDigits.length, minimumFractionDigits);
  if (minimumFractionDigits > maximumFractionDigits) {
    throw new RangeError('minimumFractionDigits cannot exceed maximumFractionDigits');
  }
  const rounded = roundDigits(
    integerDigits,
    fractionDigits,
    maximumFractionDigits,
    options.rounding ?? 'truncate',
  );
  let fraction = rounded.fraction.replace(/0+$/, '');
  if (fraction.length < minimumFractionDigits) {
    fraction = fraction.padEnd(minimumFractionDigits, '0');
  }
  const separators = localeSeparators(options.locale);
  const integer =
    options.grouping === false ? rounded.integer : groupDigits(rounded.integer, separators.group);
  return fraction.length > 0 ? `${integer}${separators.decimal}${fraction}` : integer;
}

export type ParseDecimalFailure = 'empty' | 'invalid' | 'negative' | 'too-many-decimals';

export type ParseDecimalResult =
  | { readonly ok: true; readonly raw: string; readonly normalized: string }
  | { readonly ok: false; readonly reason: ParseDecimalFailure };

export interface ParseDecimalOptions {
  readonly locale?: string;
  readonly allowNegative?: boolean;
}

/**
 * Parse user input such as "1,234.50" into an exact raw base-unit amount for
 * the given token scale. Grouping separators of the locale are ignored;
 * anything else that is not a plain decimal is rejected. Digits beyond the
 * token scale are rejected rather than silently rounded.
 */
export function parseDecimalToRaw(
  input: string,
  decimals: number,
  options: ParseDecimalOptions = {},
): ParseDecimalResult {
  const separators = localeSeparators(options.locale);
  const trimmed = input.trim();
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
  if (match[1] === '-' && !options.allowNegative) {
    return { ok: false, reason: 'negative' };
  }
  const integer = (match[2] ?? '').replace(/^0+(?=\d)/, '') || '0';
  const fraction = match[3] ?? '';
  if (fraction.length > decimals) {
    return { ok: false, reason: 'too-many-decimals' };
  }
  const raw = `${integer}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  const sign = match[1] === '-' && raw !== '0' ? '-' : '';
  return {
    ok: true,
    raw: `${sign}${raw}`,
    normalized: `${sign}${integer}${fraction ? `.${fraction}` : ''}`,
  };
}

/** Compare two decimal strings exactly. Returns -1, 0 or 1. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const parse = (value: string) => {
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) {
      throw new TypeError(`value must be a decimal string, received ${JSON.stringify(value)}`);
    }
    return { negative: match[1] === '-', integer: match[2] ?? '0', fraction: match[3] ?? '' };
  };
  const left = parse(a);
  const right = parse(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const toBig = (part: ReturnType<typeof parse>) => {
    const magnitude = BigInt(`${part.integer}${part.fraction.padEnd(scale, '0')}`);
    return part.negative ? -magnitude : magnitude;
  };
  const l = toBig(left);
  const r = toBig(right);
  return l < r ? -1 : l > r ? 1 : 0;
}
