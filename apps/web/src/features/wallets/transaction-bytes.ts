/**
 * Byte-level checks on a legacy Solana wire transaction:
 * `[compact-u16 signature count][64-byte signatures…][message]`.
 * The app never builds or edits a transaction. It hands the wallet exactly
 * the bytes Markov prepared and verifies that what comes back carries the
 * same message with the fee-payer signature filled, so a wallet (or an
 * extension in between) cannot swap the instruction under the person's
 * approval.
 */

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

/** Decodes a compact-u16 length prefix: the value and the bytes it occupies, or null when malformed. */
export function readCompactU16(
  bytes: Uint8Array,
  offset = 0,
): { readonly value: number; readonly size: number } | null {
  let value = 0;
  let size = 0;
  for (let index = 0; index < 3; index += 1) {
    const byte = bytes[offset + size];
    if (byte === undefined) {
      return null;
    }
    size += 1;
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) {
      return { value, size };
    }
  }
  return null;
}

export interface WireTransaction {
  readonly signatures: readonly Uint8Array[];
  readonly message: Uint8Array;
}

export const SIGNATURE_LENGTH = 64;

/** Splits a wire transaction into its signature slots and message; null when it is not one. */
export function parseWireTransaction(bytes: Uint8Array): WireTransaction | null {
  const count = readCompactU16(bytes);
  if (!count || count.value === 0) {
    return null;
  }
  const end = count.size + SIGNATURE_LENGTH * count.value;
  if (bytes.length <= end) {
    return null;
  }
  const signatures: Uint8Array[] = [];
  for (let index = 0; index < count.value; index += 1) {
    const start = count.size + SIGNATURE_LENGTH * index;
    signatures.push(bytes.slice(start, start + SIGNATURE_LENGTH));
  }
  return { signatures, message: bytes.slice(end) };
}

export function isZeroSignature(signature: Uint8Array): boolean {
  return signature.every((byte) => byte === 0);
}

export type SignedTransactionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * The wallet's output must be the prepared message, unchanged, with the
 * fee-payer slot (the publisher wallet) carrying a signature. Whether that
 * signature verifies is the API's job; it refuses anything else before
 * the node sees it.
 */
export function checkSignedTransaction(
  unsigned: Uint8Array,
  signed: Uint8Array,
): SignedTransactionCheck {
  const before = parseWireTransaction(unsigned);
  const after = parseWireTransaction(signed);
  if (!before) {
    return { ok: false, reason: 'the prepared transaction could not be parsed' };
  }
  if (!after) {
    return { ok: false, reason: 'the wallet returned bytes that are not a transaction' };
  }
  if (after.signatures.length !== before.signatures.length) {
    return { ok: false, reason: 'the wallet changed the number of signatures' };
  }
  if (!bytesEqual(after.message, before.message)) {
    return { ok: false, reason: 'the wallet changed the message before signing it' };
  }
  const first = after.signatures[0];
  if (!first || isZeroSignature(first)) {
    return { ok: false, reason: 'the fee-payer signature is missing' };
  }
  return { ok: true };
}
