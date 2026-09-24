import { describe, expect, it } from 'vitest';
import { decodeBase58, encodeBase58, isSolanaAddress } from '../src/index.js';

describe('base58', () => {
  it('round-trips known vectors', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['00', '1'],
      ['0000', '11'],
      ['61', '2g'],
      ['626262', 'a3gV'],
      ['636363', 'aPEr'],
      ['73696d706c792061206c6f6e6720737472696e67', '2cFupjhnEsSn59qHXstmK2ffpLv2'],
      ['00eb15231dfceb60925886b67d065299925915aeb172c06647', '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L'],
      [
        '0000000000000000000000000000000000000000000000000000000000000000',
        '11111111111111111111111111111111',
      ],
    ];
    for (const [hex, text] of vectors) {
      const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
      expect(encodeBase58(bytes)).toBe(text);
      expect(Buffer.from(decodeBase58(text)).toString('hex')).toBe(hex);
    }
  });

  it('rejects invalid characters and recognises 32-byte addresses', () => {
    expect(() => decodeBase58('0OIl')).toThrow(TypeError);
    expect(isSolanaAddress('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toBe(true);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddress('abc')).toBe(false);
  });
});
