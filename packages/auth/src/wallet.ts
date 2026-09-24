import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as signRaw,
  verify as verifyRaw,
} from 'node:crypto';
import { decodeBase58, encodeBase58 } from '@markov/contracts';

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface WalletChallengeParams {
  /** Origin host the challenge is bound to (for example markov.pet). */
  readonly domain: string;
  readonly address: string;
  readonly chain: 'solana';
  readonly genesisHash: string;
  /** Markov account the wallet will be linked to. */
  readonly userId: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Human-readable, canonical challenge text. Every field is part of the
 * signed message, so a signature from another domain, chain, account,
 * nonce or time window never verifies.
 */
export function buildWalletChallengeMessage(params: WalletChallengeParams): string {
  return [
    `${params.domain} wants you to prove that you own this Solana wallet for your Markov account.`,
    '',
    `Address: ${params.address}`,
    `Chain: ${params.chain}:${params.genesisHash}`,
    `Account: ${params.userId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expiresAt}`,
    '',
    'Signing links the wallet to your account. It approves no transaction and costs nothing.',
  ].join('\n');
}

export function generateChallengeNonce(): string {
  return encodeBase58(randomBytes(16));
}

/** Verify an Ed25519 signature (base58) over the exact message for a base58 Solana address. */
export function verifyWalletSignature(input: {
  readonly address: string;
  readonly message: string;
  readonly signature: string;
}): boolean {
  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKeyBytes = decodeBase58(input.address);
    signatureBytes = decodeBase58(input.signature);
  } catch {
    return false;
  }
  if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
    return false;
  }
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
      format: 'der',
      type: 'spki',
    });
    return verifyRaw(null, Buffer.from(input.message, 'utf8'), key, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}

export interface Ed25519TestWallet {
  readonly address: string;
  sign(message: string): string;
}

/**
 * An in-memory Ed25519 keypair for tests and the headless journey. Never a
 * production wallet: the private key lives only in this process.
 */
export function createEd25519TestWallet(): Ed25519TestWallet {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(ED25519_SPKI_PREFIX.length);
  return {
    address: encodeBase58(Uint8Array.from(raw)),
    sign: (message) =>
      encodeBase58(Uint8Array.from(signRaw(null, Buffer.from(message, 'utf8'), privateKey))),
  };
}
