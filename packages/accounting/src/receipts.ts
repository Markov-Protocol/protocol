import {
  RECEIPT_DOMAIN,
  type Receipt,
  type ReceiptBody,
  type ReceiptVerificationKey,
  type ReceiptVerificationResult,
  receiptBodySchema,
} from '@markov/contracts';
import { canonicalJson, sha256Hex } from '@markov/planning';
import { base64ToBytes, bytesToBase64, verifyEd25519 } from '@markov/solana-codec';

/**
 * Receipts are canonical JSON documents signed with a versioned Ed25519
 * key. The signature proves the signer attested to the record; the chain
 * evidence the record references establishes settlement. Verification
 * needs only the receipt and the published keys, so the CLI and any SDK
 * can check one offline.
 */

const encoder = new TextEncoder();

/** The bytes that are hashed and signed: the domain, a zero byte, the canonical body. */
export function receiptCanonicalBytes(body: ReceiptBody): Uint8Array {
  return encoder.encode(`${RECEIPT_DOMAIN}\u0000${canonicalJson(body)}`);
}

export function receiptHash(body: ReceiptBody): string {
  return sha256Hex(receiptCanonicalBytes(body));
}

export interface ReceiptSigner {
  readonly keyId: string;
  readonly publicKey: string;
  sign(message: Uint8Array): Uint8Array;
}

export function signReceipt(
  body: ReceiptBody,
  signer: ReceiptSigner,
  options: { readonly public?: boolean; readonly ownerUserId?: string | null } = {},
): Receipt {
  const parsed = receiptBodySchema.parse(body);
  const bytes = receiptCanonicalBytes(parsed);
  return {
    ownerUserId: options.ownerUserId ?? null,
    body: parsed,
    canonicalHash: sha256Hex(bytes),
    signer: { keyId: signer.keyId, algorithm: 'ed25519', publicKey: signer.publicKey },
    signature: bytesToBase64(signer.sign(bytes)),
    public: options.public ?? false,
  };
}

export const RECEIPT_MEANING =
  'a valid signature proves the signer attested to this record; settlement is established by the chain evidence it references' as const;

/**
 * Verifies a receipt against the published keys: the body parses, the
 * canonical hash matches, the key is known, the receipt's signer matches
 * the key, and the Ed25519 signature verifies over the canonical bytes. A
 * retired key still verifies what it signed while it was active, and the
 * result says so.
 */
export function verifyReceipt(
  receipt: Receipt,
  keys: readonly ReceiptVerificationKey[],
): ReceiptVerificationResult {
  const issues: ReceiptVerificationResult['issues'][number][] = [];
  const parsed = receiptBodySchema.safeParse(receipt.body);
  let hashMatches = false;
  let signatureValid = false;
  const key = keys.find((entry) => entry.keyId === receipt.signer.keyId) ?? null;
  const keyStatus: ReceiptVerificationResult['keyStatus'] = key?.status ?? 'unknown';
  if (!parsed.success) {
    issues.push('BODY_INVALID');
  } else {
    const bytes = receiptCanonicalBytes(parsed.data);
    hashMatches = sha256Hex(bytes) === receipt.canonicalHash;
    if (!hashMatches) {
      issues.push('HASH_MISMATCH');
    }
    if (key === null) {
      issues.push('KEY_UNKNOWN');
    } else {
      if (key.status === 'retired') {
        issues.push('KEY_RETIRED');
      }
      if (key.publicKey !== receipt.signer.publicKey) {
        issues.push('SIGNER_MISMATCH');
      } else {
        try {
          signatureValid = verifyEd25519(key.publicKey, bytes, base64ToBytes(receipt.signature));
        } catch {
          signatureValid = false;
        }
        if (!signatureValid) {
          issues.push('SIGNATURE_INVALID');
        }
      }
    }
  }
  const blocking = issues.filter((issue) => issue !== 'KEY_RETIRED');
  return {
    valid: blocking.length === 0 && hashMatches && signatureValid,
    keyId: receipt.signer.keyId,
    keyStatus,
    hashMatches,
    signatureValid,
    issues,
    meaning: RECEIPT_MEANING,
  };
}
