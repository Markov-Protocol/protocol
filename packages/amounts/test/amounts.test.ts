import { describe, expect, it } from 'vitest';
import {
  Decimal,
  decimalsOfDouble,
  divideRounded,
  exactDecimalOfDouble,
  f64FromLeBytes,
  rawToScaled,
  scaledToRaw,
  shortestDecimalOfDouble,
  tokenProgramRawAmount,
  tokenProgramUiAmount,
} from '../src/index.js';

describe('Decimal', () => {
  it('parses, prints and compares without floating point', () => {
    expect(Decimal.fromString('12.50').toString()).toBe('12.5');
    expect(Decimal.fromString('-0.000').toString()).toBe('0');
    expect(Decimal.fromString('0.1').add(Decimal.fromString('0.2')).toString()).toBe('0.3');
    expect(Decimal.fromString('1.5').multiply(Decimal.fromString('2')).toString()).toBe('3');
    expect(Decimal.fromString('10').compare(Decimal.fromString('9.999999999999999999999'))).toBe(1);
    expect(() => Decimal.fromString('1e5')).toThrow(RangeError);
    expect(() => Decimal.fromString('1,000')).toThrow(RangeError);
  });

  it('rounds with every mode at the exact boundaries', () => {
    const cases: [string, string, string, string][] = [
      // value, down, up, half_up (to 0 digits)
      ['2.5', '2', '3', '3'],
      ['3.5', '3', '4', '4'],
      ['-2.5', '-2', '-3', '-3'],
      ['2.4999999999', '2', '3', '2'],
      ['2.0000000001', '2', '3', '2'],
    ];
    for (const [value, down, up, halfUp] of cases) {
      expect(Decimal.fromString(value).toScale(0, 'down').toString()).toBe(down);
      expect(Decimal.fromString(value).toScale(0, 'up').toString()).toBe(up);
      expect(Decimal.fromString(value).toScale(0, 'half_up').toString()).toBe(halfUp);
    }
    expect(Decimal.fromString('2.5').toScale(0, 'half_even').toString()).toBe('2');
    expect(Decimal.fromString('3.5').toScale(0, 'half_even').toString()).toBe('4');
    expect(divideRounded(7n, 2n, 'half_even')).toBe(4n);
    expect(divideRounded(-7n, 2n, 'down')).toBe(-3n);
    expect(Decimal.fromString('1').divideByInteger(3n, 5, 'down').toString()).toBe('0.33333');
    expect(Decimal.fromString('1').toFixed(4, 'down')).toBe('1.0000');
  });
});

describe('doubles', () => {
  it('expands doubles exactly and prints the shortest round trip', () => {
    expect(exactDecimalOfDouble(1.5).toString()).toBe('1.5');
    expect(exactDecimalOfDouble(0.1).toString()).toBe(
      '0.1000000000000000055511151231257827021181583404541015625',
    );
    expect(decimalsOfDouble(0.1).shortest).toBe('0.1');
    expect(shortestDecimalOfDouble(1e21)).toBe('1000000000000000000000');
    expect(shortestDecimalOfDouble(1.5e-7)).toBe('0.00000015');
    expect(exactDecimalOfDouble(-2).toString()).toBe('-2');
    expect(exactDecimalOfDouble(0).toString()).toBe('0');
    const bytes = new Uint8Array(new Float64Array([2.5]).buffer);
    expect(f64FromLeBytes(bytes)).toBe(2.5);
    expect(() => exactDecimalOfDouble(Number.NaN)).toThrow(RangeError);
  });
});

describe('raw and scaled quantities', () => {
  it('converts raw to scaled exactly and reports rounding', () => {
    expect(rawToScaled({ raw: '1500000', decimals: 6, multiplier: '1' })).toMatchObject({
      scaled: '1.5',
      scaledExact: '1.5',
      rounded: false,
    });
    expect(rawToScaled({ raw: '1', decimals: 6, multiplier: '3', displayScale: 6 })).toMatchObject({
      scaled: '0.000003',
      rounded: false,
    });
    const third = rawToScaled({ raw: '1', decimals: 2, multiplier: '0.3333', displayScale: 2 });
    expect(third).toMatchObject({
      scaled: '0',
      scaledExact: '0.003333',
      rounded: true,
      rounding: 'down',
    });
    expect(
      rawToScaled({ raw: '1', decimals: 2, multiplier: '0.3333', displayScale: 2, rounding: 'up' })
        .scaled,
    ).toBe('0.01');
    expect(() => rawToScaled({ raw: '-1', decimals: 2, multiplier: '1' })).toThrow(RangeError);
    expect(() => rawToScaled({ raw: '1.5', decimals: 2, multiplier: '1' })).toThrow(RangeError);
  });

  it('converts scaled back to raw with explicit rounding and never a zero multiplier', () => {
    expect(scaledToRaw({ scaled: '1.5', decimals: 6, multiplier: '1' })).toMatchObject({
      raw: '1500000',
      rounded: false,
    });
    expect(scaledToRaw({ scaled: '3', decimals: 0, multiplier: '2' })).toMatchObject({
      raw: '1',
      rawExact: '1.5',
      rounded: true,
    });
    expect(
      scaledToRaw({ scaled: '3', decimals: 0, multiplier: '2', rounding: 'half_up' }).raw,
    ).toBe('2');
    expect(() => scaledToRaw({ scaled: '1', decimals: 0, multiplier: '0' })).toThrow(RangeError);
  });

  it('round-trips raw → scaled → raw for every multiplier and rounding with down rounding never exceeding the original', () => {
    let seed = 42;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let index = 0; index < 500; index += 1) {
      const decimals = next() % 10;
      const raw = String(BigInt(next()) * BigInt(next() % 1000) + BigInt(next() % 7));
      const multiplier = `${next() % 50}.${String(next() % 100000).padStart(5, '0')}`;
      if (Decimal.fromString(multiplier).isZero()) {
        continue;
      }
      const scaled = rawToScaled({ raw, decimals, multiplier, displayScale: decimals + 12 });
      const back = scaledToRaw({
        scaled: scaled.scaledExact,
        decimals,
        multiplier,
        rounding: 'half_even',
      });
      expect(back.raw).toBe(raw);
      const truncated = scaledToRaw({
        scaled: scaled.scaled,
        decimals,
        multiplier,
        rounding: 'down',
      });
      expect(BigInt(truncated.raw) <= BigInt(raw)).toBe(true);
    }
  });

  it('shows where the on-chain floating-point helper diverges from exact conversion', () => {
    // Exact: 0.3 × 3 = 0.9; the f64 helper computes trunc(3 × 0.3) = trunc(0.8999999999999999) = 0.
    expect(rawToScaled({ raw: '3', decimals: 1, multiplier: '0.3', displayScale: 2 }).scaled).toBe(
      '0.09',
    );
    expect(
      rawToScaled({ raw: '3', decimals: 1, multiplier: '0.3', displayScale: 1 }),
    ).toMatchObject({ scaled: '0', rounded: true });
    expect(
      rawToScaled({ raw: '3', decimals: 0, multiplier: '0.3', displayScale: 0 }),
    ).toMatchObject({ scaledExact: '0.9', scaled: '0', rounded: true });
    expect(tokenProgramUiAmount('3', 0, 0.3)).toBe('0');
    expect(tokenProgramUiAmount('1500000', 6, 1)).toBe('1.5');
    expect(tokenProgramRawAmount('1.5', 6, 1)).toBe('1500000');
    // A large raw amount above 2^53 loses precision in f64 but not in the exact path.
    const big = '9007199254740993';
    expect(rawToScaled({ raw: big, decimals: 0, multiplier: '1' }).scaled).toBe(big);
    expect(tokenProgramUiAmount(big, 0, 1)).not.toBe(big);
  });
});
