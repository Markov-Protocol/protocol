import { describe, expect, it } from 'vitest';
import {
  compareDecimalStrings,
  describeStaleness,
  formatBasisPoints,
  formatDecimalString,
  formatInstant,
  formatPriceValue,
  formatRawAmount,
  formatRelativeAge,
  looksLikeSolanaAddress,
  parseDecimalToRaw,
  parsePercentToBasisPoints,
  remainingBasisPoints,
  shortenAddress,
  splitRawAmount,
  sumBasisPoints,
} from '../src/index';

describe('formatRawAmount', () => {
  it('formats base units exactly without floats', () => {
    expect(formatRawAmount('500000000', 6)).toBe('500');
    expect(formatRawAmount('1234567890123456', 6)).toBe('1,234,567,890.123456');
    expect(formatRawAmount('1', 9)).toBe('0.000000001');
    expect(formatRawAmount('0', 6)).toBe('0');
    expect(formatRawAmount(2n ** 70n, 0)).toBe('1,180,591,620,717,411,303,424');
    expect(formatRawAmount('000123', 2)).toBe('1.23');
  });

  it('truncates by default and rounds half-up only when asked', () => {
    expect(formatRawAmount('1999999', 6, { maximumFractionDigits: 2 })).toBe('1.99');
    expect(formatRawAmount('1999999', 6, { maximumFractionDigits: 2, rounding: 'half-up' })).toBe(
      '2',
    );
    expect(
      formatRawAmount('1999999', 6, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
        rounding: 'half-up',
      }),
    ).toBe('2.00');
    expect(formatRawAmount('999995', 6, { maximumFractionDigits: 5, rounding: 'half-up' })).toBe(
      '1',
    );
    expect(formatRawAmount('1005', 3, { maximumFractionDigits: 0, rounding: 'half-up' })).toBe('1');
    expect(formatRawAmount('1500', 3, { maximumFractionDigits: 0, rounding: 'half-up' })).toBe('2');
  });

  it('honours minimum fraction digits and grouping/locale', () => {
    expect(formatRawAmount('5000000', 6, { minimumFractionDigits: 2 })).toBe('5.00');
    expect(formatRawAmount('1234567', 2, { grouping: false })).toBe('12345.67');
    expect(formatRawAmount('1234567', 2, { locale: 'de-DE' })).toBe('12.345,67');
  });

  it('rejects non-digit input and impossible scales', () => {
    expect(() => formatRawAmount('12.5', 6)).toThrow(TypeError);
    expect(() => formatRawAmount('-1', 6)).toThrow(TypeError);
    expect(() => formatRawAmount('1', -1)).toThrow(RangeError);
    expect(() => splitRawAmount('1', 39)).toThrow(RangeError);
  });
});

describe('formatDecimalString', () => {
  it('formats typed decimal strings exactly', () => {
    expect(formatDecimalString('123.456789', { maximumFractionDigits: 4 })).toBe('123.4567');
    expect(formatDecimalString('-0.5', { minimumFractionDigits: 2 })).toBe('-0.50');
    expect(formatDecimalString('-0.001', { maximumFractionDigits: 2 })).toBe('0');
    expect(formatDecimalString('1000000')).toBe('1,000,000');
    expect(() => formatDecimalString('1e5')).toThrow(TypeError);
  });
});

describe('parseDecimalToRaw', () => {
  it('parses grouped input into exact raw amounts', () => {
    expect(parseDecimalToRaw('1,234.5', 6)).toEqual({
      ok: true,
      raw: '1234500000',
      normalized: '1234.5',
    });
    expect(parseDecimalToRaw('.5', 6)).toEqual({ ok: true, raw: '500000', normalized: '0.5' });
    expect(parseDecimalToRaw('0', 6)).toEqual({ ok: true, raw: '0', normalized: '0' });
    expect(parseDecimalToRaw('007', 0)).toEqual({ ok: true, raw: '7', normalized: '7' });
    expect(parseDecimalToRaw('12.345,67', 2, { locale: 'de-DE' })).toEqual({
      ok: true,
      raw: '1234567',
      normalized: '12345.67',
    });
  });

  it('rejects empty, invalid, negative and over-precise input', () => {
    expect(parseDecimalToRaw('', 6)).toEqual({ ok: false, reason: 'empty' });
    expect(parseDecimalToRaw('abc', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseDecimalToRaw('1.2.3', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseDecimalToRaw('1e3', 6)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseDecimalToRaw('-1', 6)).toEqual({ ok: false, reason: 'negative' });
    expect(parseDecimalToRaw('1.1234567', 6)).toEqual({ ok: false, reason: 'too-many-decimals' });
    expect(parseDecimalToRaw('-1', 6, { allowNegative: true })).toEqual({
      ok: true,
      raw: '-1000000',
      normalized: '-1',
    });
  });

  it('round-trips with formatRawAmount', () => {
    for (const [input, decimals] of [
      ['1234.56789', 9],
      ['0.000001', 6],
      ['98765432109876.5', 1],
    ] as const) {
      const parsed = parseDecimalToRaw(input, decimals);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(formatRawAmount(parsed.raw, decimals, { grouping: false })).toBe(input);
      }
    }
  });
});

describe('compareDecimalStrings', () => {
  it('compares exactly across scales and signs', () => {
    expect(compareDecimalStrings('1.10', '1.1')).toBe(0);
    expect(compareDecimalStrings('0.30000000000000004', '0.3')).toBe(1);
    expect(compareDecimalStrings('-2', '1')).toBe(-1);
    expect(
      compareDecimalStrings('123456789012345678901234567890', '123456789012345678901234567889'),
    ).toBe(1);
  });
});

describe('basis points', () => {
  it('formats and parses percentages exactly', () => {
    expect(formatBasisPoints(1234)).toBe('12.34%');
    expect(formatBasisPoints(5)).toBe('0.05%');
    expect(formatBasisPoints(10_000)).toBe('100.00%');
    expect(formatBasisPoints(-250)).toBe('-2.50%');
    expect(parsePercentToBasisPoints('12.5')).toEqual({ ok: true, bps: 1250 });
    expect(parsePercentToBasisPoints('33,33', { locale: 'de-DE' })).toEqual({
      ok: true,
      bps: 3333,
    });
    expect(parsePercentToBasisPoints('100%')).toEqual({ ok: true, bps: 10_000 });
    expect(parsePercentToBasisPoints('33.333')).toEqual({ ok: false, reason: 'too-many-decimals' });
    expect(parsePercentToBasisPoints('101')).toEqual({ ok: false, reason: 'out-of-range' });
    expect(parsePercentToBasisPoints('-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parsePercentToBasisPoints('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('sums exactly and reports the remainder to 10,000', () => {
    expect(sumBasisPoints([3333, 3333, 3334])).toBe(10_000);
    expect(remainingBasisPoints([2500, 2500])).toBe(5000);
    expect(remainingBasisPoints([6000, 5000])).toBe(-1000);
    expect(() => sumBasisPoints([0.5])).toThrow(TypeError);
  });
});

describe('prices, time and addresses', () => {
  it('formats typed prices with their unit and kind label', () => {
    expect(formatPriceValue({ value: '123.456789123', unit: 'USDC' })).toBe('123.456789 USDC');
    expect(formatPriceValue({ value: '5', unit: 'USD' })).toBe('5.00 USD');
  });

  it('formats instants with an explicit time zone and relative ages', () => {
    expect(formatInstant('2026-09-24T17:05:00Z')).toBe('Sep 24, 2026, 5:05 PM');
    expect(formatInstant('2026-09-24T17:05:00Z', { timeZone: 'Asia/Kolkata' })).toBe(
      'Sep 24, 2026, 10:35 PM',
    );
    expect(() => formatInstant('nope')).toThrow(TypeError);
    const now = '2026-09-24T17:05:00Z';
    expect(formatRelativeAge('2026-09-24T17:04:48Z', now)).toBe('12 s ago');
    expect(formatRelativeAge('2026-09-24T16:55:00Z', now)).toBe('10 min ago');
    expect(formatRelativeAge('2026-09-24T14:05:00Z', now)).toBe('3 h ago');
    expect(formatRelativeAge('2026-09-22T17:05:00Z', now)).toBe('2 d ago');
    expect(formatRelativeAge('2026-09-24T17:05:30Z', now)).toBe('in 30 s');
    expect(describeStaleness('2026-09-24T17:04:00Z', 30_000, now)).toEqual({
      ageMs: 60_000,
      stale: true,
    });
    expect(describeStaleness('2026-09-24T17:04:50Z', 30_000, now)).toEqual({
      ageMs: 10_000,
      stale: false,
    });
  });

  it('shortens addresses without losing the ends', () => {
    expect(shortenAddress('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toBe('5eyk…2N9d');
    expect(shortenAddress('short')).toBe('short');
    expect(looksLikeSolanaAddress('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toBe(true);
    expect(looksLikeSolanaAddress('0xabc')).toBe(false);
  });
});
