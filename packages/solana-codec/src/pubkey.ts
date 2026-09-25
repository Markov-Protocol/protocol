import { createHash } from 'node:crypto';
import { decodeBase58, encodeBase58 } from '@markov/contracts';
import { concatBytes } from './bytes.js';

/**
 * Solana public keys and program-derived addresses, implemented from the
 * definitions (ed25519 point decompression per RFC 8032 as curve25519-dalek
 * applies it, and the `ProgramDerivedAddress` hashing of `solana-pubkey`)
 * rather than from a provider SDK. `programs/strategy-registry/vectors`
 * records addresses derived by the Rust runtime; the tests prove this file
 * reproduces them.
 */
export const PUBLIC_KEY_LENGTH = 32;
export const MAX_SEED_LENGTH = 32;
export const MAX_SEEDS = 16;

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

export function pubkeyBytes(address: string): Uint8Array {
  const bytes = decodeBase58(address);
  if (bytes.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(`not a 32-byte public key: ${address}`);
  }
  return bytes;
}

export function pubkeyBase58(bytes: Uint8Array): string {
  if (bytes.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(`not a 32-byte public key (${bytes.length} bytes)`);
  }
  return encodeBase58(bytes);
}

export function isValidPubkey(address: string): boolean {
  try {
    pubkeyBytes(address);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- ed25519 field */

const P = (1n << 255n) - 19n;
const D = modP(-121665n * modInverse(121666n));
const SQRT_M1 = modPow(2n, (P - 1n) / 4n); // sqrt(-1) mod p

function modP(value: bigint): bigint {
  const result = value % P;
  return result < 0n ? result + P : result;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = modP(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % P;
    }
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

function modInverse(value: bigint): bigint {
  return modPow(value, P - 2n);
}

/**
 * Whether a compressed point decodes to a point on the edwards25519 curve,
 * exactly as `CompressedEdwardsY::decompress` decides it: the sign bit is
 * ignored for the square-root test and a non-canonical y is reduced, not
 * rejected. Program-derived addresses are, by construction, the bytes for
 * which this returns false.
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== PUBLIC_KEY_LENGTH) {
    return false;
  }
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) {
    y = (y << 8n) | BigInt(bytes[i] as number);
  }
  y &= (1n << 255n) - 1n;
  y = modP(y);
  const y2 = (y * y) % P;
  const u = modP(y2 - 1n);
  const v = modP(D * y2 + 1n);
  // x² = u / v has a solution iff (u/v) is a square; test via x = (u/v)^((p+3)/8).
  const v3 = (v * v * v) % P;
  const v7 = (v3 * v3 * v) % P;
  const x = (u * v3 * modPow(u * v7, (P - 5n) / 8n)) % P;
  const vx2 = (v * x * x) % P;
  if (vx2 === u) {
    return true;
  }
  if (vx2 === modP(-u)) {
    // x * sqrt(-1) is the root; still a valid point.
    return modP(v * ((x * SQRT_M1) % P) * ((x * SQRT_M1) % P)) === u;
  }
  return false;
}

/* ------------------------------------------------- program-derived addresses */

function checkSeeds(seeds: readonly Uint8Array[]): void {
  if (seeds.length > MAX_SEEDS) {
    throw new Error(`at most ${MAX_SEEDS} seeds are allowed`);
  }
  for (const seed of seeds) {
    if (seed.length > MAX_SEED_LENGTH) {
      throw new Error(`a seed is longer than ${MAX_SEED_LENGTH} bytes`);
    }
  }
}

/** `Pubkey::create_program_address`: the hash of seeds, program id and marker, which must be off the curve. */
export function createProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): Uint8Array | null {
  checkSeeds(seeds);
  const hash = createHash('sha256')
    .update(concatBytes(...seeds, programId, PDA_MARKER))
    .digest();
  const candidate = new Uint8Array(hash);
  return isOnCurve(candidate) ? null : candidate;
}

export interface ProgramAddress {
  readonly address: Uint8Array;
  readonly bump: number;
}

/** `Pubkey::find_program_address`: the first bump from 255 downwards whose address is off the curve. */
export function findProgramAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): ProgramAddress {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const address = createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
    if (address !== null) {
      return { address, bump };
    }
  }
  throw new Error('no viable program address bump');
}
