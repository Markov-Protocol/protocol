import type { PreparedTransaction } from '@markov/contracts';
import {
  base64ToBytes,
  checkSignedTransaction,
  parseWireTransaction,
} from '../wallets/transaction-bytes';
import { sha256Hex } from './sha256';

/**
 * Byte checks around the wallet handoff: the unsigned bytes must hash to
 * the message the API validated and simulated, and the wallet's output must
 * be that same message with the owner's signature filled in. The API
 * repeats both checks at submission; these keep a wrong transaction from
 * reaching the wallet or a mutated one from leaving the browser.
 */

/** SHA-256 (hex) of the message part of an unsigned wire transaction; null when the bytes are not one. */
export function messageHashOf(unsignedTransaction: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(unsignedTransaction);
  } catch {
    return null;
  }
  const parsed = parseWireTransaction(bytes);
  return parsed === null ? null : sha256Hex(parsed.message);
}

export type SignedCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The signed bytes against the prepared transaction: same message, the
 * fee-payer slot filled, and the message hash the API published.
 */
export function checkSignedAgainstPrepared(
  prepared: Pick<PreparedTransaction, 'unsignedTransaction' | 'messageHash'>,
  signedTransaction: string,
): SignedCheck {
  let unsigned: Uint8Array;
  let signed: Uint8Array;
  try {
    unsigned = base64ToBytes(prepared.unsignedTransaction);
    signed = base64ToBytes(signedTransaction);
  } catch {
    return { ok: false, reason: 'the wallet returned bytes that are not base64' };
  }
  const structural = checkSignedTransaction(unsigned, signed);
  if (!structural.ok) {
    return structural;
  }
  const parsed = parseWireTransaction(signed);
  if (parsed === null || sha256Hex(parsed.message) !== prepared.messageHash) {
    return {
      ok: false,
      reason: 'the signed message does not hash to the message the API validated',
    };
  }
  return { ok: true };
}
