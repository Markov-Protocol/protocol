import { ByteReader, ByteWriter } from './bytes.js';
import {
  findProgramAddress,
  PUBLIC_KEY_LENGTH,
  pubkeyBase58,
  pubkeyBytes,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from './pubkey.js';

/**
 * SPL token accounts and associated token addresses, from the layouts of
 * `spl-token` (`Account`, 165 bytes) and the seed convention of
 * `spl-associated-token-account`. Token-2022 accounts carry the same base
 * layout followed by an account-type byte and TLV extensions; only the base
 * is decoded here.
 */
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
export const TOKEN_ACCOUNT_LENGTH = 165;
/** Token-2022 account type byte at offset 165: 2 = token account. */
const ACCOUNT_TYPE_TOKEN_ACCOUNT = 2;

export const TOKEN_PROGRAM_IDS: readonly string[] = [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

export function isTokenProgram(programId: string): boolean {
  return TOKEN_PROGRAM_IDS.includes(programId);
}

export interface TokenAccount {
  readonly mint: string;
  readonly owner: string;
  readonly amount: bigint;
  readonly delegate: string | null;
  /** 0 uninitialized, 1 initialized, 2 frozen. */
  readonly state: number;
  readonly isNative: bigint | null;
  readonly delegatedAmount: bigint;
  readonly closeAuthority: string | null;
}

function readOption(reader: ByteReader): Uint8Array | null {
  const tag = reader.u32();
  const bytes = reader.take(PUBLIC_KEY_LENGTH);
  return tag === 1 ? bytes : null;
}

export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  if (data.length < TOKEN_ACCOUNT_LENGTH) {
    throw new Error(`a token account is at least ${TOKEN_ACCOUNT_LENGTH} bytes`);
  }
  if (
    data.length > TOKEN_ACCOUNT_LENGTH &&
    data[TOKEN_ACCOUNT_LENGTH] !== ACCOUNT_TYPE_TOKEN_ACCOUNT
  ) {
    throw new Error('not a token account (Token-2022 account type byte)');
  }
  const reader = new ByteReader(data.subarray(0, TOKEN_ACCOUNT_LENGTH));
  const mint = pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH));
  const owner = pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH));
  const amount = reader.u64();
  const delegate = readOption(reader);
  const state = reader.u8();
  const isNativeTag = reader.u32();
  const isNativeValue = reader.u64();
  const delegatedAmount = reader.u64();
  const closeAuthority = readOption(reader);
  return {
    mint,
    owner,
    amount,
    delegate: delegate ? pubkeyBase58(delegate) : null,
    state,
    isNative: isNativeTag === 1 ? isNativeValue : null,
    delegatedAmount,
    closeAuthority: closeAuthority ? pubkeyBase58(closeAuthority) : null,
  };
}

function writeOption(writer: ByteWriter, value: string | null): void {
  writer.u32(value ? 1 : 0);
  writer.bytes(value ? pubkeyBytes(value) : new Uint8Array(PUBLIC_KEY_LENGTH));
}

export function encodeTokenAccount(input: {
  readonly mint: string;
  readonly owner: string;
  readonly amount: bigint;
  readonly delegate?: string | null;
  readonly state?: number;
  readonly delegatedAmount?: bigint;
  readonly closeAuthority?: string | null;
}): Uint8Array {
  const writer = new ByteWriter();
  writer.bytes(pubkeyBytes(input.mint));
  writer.bytes(pubkeyBytes(input.owner));
  writer.u64(input.amount);
  writeOption(writer, input.delegate ?? null);
  writer.u8(input.state ?? 1);
  writer.u32(0);
  writer.u64(0n);
  writer.u64(input.delegatedAmount ?? 0n);
  writeOption(writer, input.closeAuthority ?? null);
  const out = writer.finish();
  if (out.length !== TOKEN_ACCOUNT_LENGTH) {
    throw new Error('token account encoding length mismatch');
  }
  return out;
}

/** Whether `data` can be a token account of either token program. */
export function looksLikeTokenAccount(data: Uint8Array): boolean {
  if (data.length === TOKEN_ACCOUNT_LENGTH) {
    return true;
  }
  return (
    data.length > TOKEN_ACCOUNT_LENGTH && data[TOKEN_ACCOUNT_LENGTH] === ACCOUNT_TYPE_TOKEN_ACCOUNT
  );
}

/** The associated token address: PDA of [owner, token program, mint] under the ATA program. */
export function associatedTokenAddress(
  owner: string,
  mint: string,
  tokenProgram: string,
): { readonly address: string; readonly bump: number } {
  const derived = findProgramAddress(
    [pubkeyBytes(owner), pubkeyBytes(tokenProgram), pubkeyBytes(mint)],
    pubkeyBytes(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return { address: pubkeyBase58(derived.address), bump: derived.bump };
}
