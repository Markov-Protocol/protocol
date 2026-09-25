import { createHash } from 'node:crypto';
import { FIXTURE_ROUTE_PROGRAM_ID } from './programs.js';

/**
 * The instruction layout of the fixture route program (`fixture-amm`): the
 * synthetic venue's on-chain counterpart, executed only by the fixture chain
 * of local and test modes. It exists so the whole build → validate →
 * simulate → sign → submit → reconcile path can be exercised with real
 * bytes; the program id exists on no network.
 *
 * `swap_exact_in` accounts, in order:
 *   0 owner            signer, writable (pays fees, owns both token accounts)
 *   1 source           writable token account of the input mint, owned by `owner`
 *   2 destination      writable token account of the output mint, owned by `owner`
 *   3 input mint       read-only
 *   4 output mint      read-only
 *   5 input token program   read-only
 *   6 output token program  read-only
 * Data: 8-byte discriminator, u64 in amount, u64 minimum out, u16 slippage bps, u8 layout version.
 */
export const FIXTURE_SWAP_LAYOUT_VERSION = 1;
export const FIXTURE_SWAP_DATA_LENGTH = 8 + 8 + 8 + 2 + 1;
export const FIXTURE_SWAP_ACCOUNT_COUNT = 7;

export const FIXTURE_SWAP_DISCRIMINATOR: Uint8Array = new Uint8Array(
  createHash('sha256').update('markov-fixture-amm:swap_exact_in').digest().subarray(0, 8),
);

/** Custom error codes of the fixture route program. */
export const FIXTURE_ROUTE_ERRORS = {
  SlippageExceeded: 6000,
  InsufficientInput: 6001,
  UnsupportedMint: 6002,
  AccountMismatch: 6003,
  NotSigner: 6004,
} as const;

export interface FixtureSwapArgs {
  readonly inAmountRaw: bigint;
  readonly minimumOutRaw: bigint;
  readonly slippageBps: number;
}

export interface FixtureSwapAccounts {
  readonly owner: string;
  readonly source: string;
  readonly destination: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inputTokenProgram: string;
  readonly outputTokenProgram: string;
}

function u64le(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${value}`);
  }
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function readU64le(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(data[offset + i] as number);
  }
  return value;
}

export function encodeFixtureSwapData(args: FixtureSwapArgs): Uint8Array {
  if (!Number.isInteger(args.slippageBps) || args.slippageBps < 0 || args.slippageBps > 0xffff) {
    throw new Error('slippage bps out of range');
  }
  const out = new Uint8Array(FIXTURE_SWAP_DATA_LENGTH);
  out.set(FIXTURE_SWAP_DISCRIMINATOR, 0);
  out.set(u64le(args.inAmountRaw), 8);
  out.set(u64le(args.minimumOutRaw), 16);
  out[24] = args.slippageBps & 0xff;
  out[25] = args.slippageBps >>> 8;
  out[26] = FIXTURE_SWAP_LAYOUT_VERSION;
  return out;
}

/** Decode swap data, or null when the bytes are not a `swap_exact_in` of the supported layout. */
export function decodeFixtureSwapData(data: Uint8Array): FixtureSwapArgs | null {
  if (data.length !== FIXTURE_SWAP_DATA_LENGTH) {
    return null;
  }
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== FIXTURE_SWAP_DISCRIMINATOR[i]) {
      return null;
    }
  }
  if (data[26] !== FIXTURE_SWAP_LAYOUT_VERSION) {
    return null;
  }
  return {
    inAmountRaw: readU64le(data, 8),
    minimumOutRaw: readU64le(data, 16),
    slippageBps: (data[24] as number) | ((data[25] as number) << 8),
  };
}

/** The instruction as account metas and data, ready to compile into a message. */
export function fixtureSwapInstruction(
  accounts: FixtureSwapAccounts,
  args: FixtureSwapArgs,
): {
  readonly programId: string;
  readonly accounts: readonly {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }[];
  readonly data: Uint8Array;
} {
  return {
    programId: FIXTURE_ROUTE_PROGRAM_ID,
    accounts: [
      { pubkey: accounts.owner, isSigner: true, isWritable: true },
      { pubkey: accounts.source, isSigner: false, isWritable: true },
      { pubkey: accounts.destination, isSigner: false, isWritable: true },
      { pubkey: accounts.inputMint, isSigner: false, isWritable: false },
      { pubkey: accounts.outputMint, isSigner: false, isWritable: false },
      { pubkey: accounts.inputTokenProgram, isSigner: false, isWritable: false },
      { pubkey: accounts.outputTokenProgram, isSigner: false, isWritable: false },
    ],
    data: encodeFixtureSwapData(args),
  };
}

/** Name the accounts of a decoded instruction by position; null when the count is wrong. */
export function fixtureSwapAccountsOf(keys: readonly string[]): FixtureSwapAccounts | null {
  if (keys.length !== FIXTURE_SWAP_ACCOUNT_COUNT) {
    return null;
  }
  const [owner, source, destination, inputMint, outputMint, inputTokenProgram, outputTokenProgram] =
    keys as [string, string, string, string, string, string, string];
  return {
    owner,
    source,
    destination,
    inputMint,
    outputMint,
    inputTokenProgram,
    outputTokenProgram,
  };
}
