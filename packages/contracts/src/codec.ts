/**
 * Base58 (Bitcoin/Solana alphabet) without dependencies. Used for Solana
 * addresses, signatures and hashes. Pure functions with test vectors.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += ALPHABET[digits[i] as number];
  }
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  if (text.length === 0) {
    return new Uint8Array(0);
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') {
    zeros += 1;
  }
  const bytes: number[] = [];
  for (let i = zeros; i < text.length; i += 1) {
    const value = ALPHABET_MAP.get(text[i] as string);
    if (value === undefined) {
      throw new TypeError(`invalid base58 character ${JSON.stringify(text[i])}`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += (bytes[j] as number) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[zeros + i] = bytes[bytes.length - 1 - i] as number;
  }
  return out;
}

/** True when the text decodes to exactly 32 bytes (an Ed25519 public key / Solana address). */
export function isSolanaAddress(text: string): boolean {
  try {
    return decodeBase58(text).length === 32;
  } catch {
    return false;
  }
}

/**
 * Company identity for matching and concentration: lowercase, punctuation
 * collapsed, common legal suffixes dropped, so "Fixture Alpha Inc." and
 * "FIXTURE ALPHA INC" are one company. Deterministic and reversible enough
 * to explain; never a fuzzy guess.
 */
export function companyKey(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /\b(inc|incorporated|corp|corporation|ltd|limited|plc|ag|sa|nv|llc|co|holdings|group)\b/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}
