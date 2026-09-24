import { encodeBase58, type OnChainMint, type TokenProgram } from '@markov/contracts';

/**
 * SPL Token and Token-2022 mint account layout, from the program sources
 * (solana-program/token `interface/src/state.rs`, solana-program/token-2022
 * `interface/src/extension/mod.rs`; see docs/markov/source-register.md).
 *
 * Mint (82 bytes): mint_authority COption<Pubkey> (4 + 32), supply u64 LE,
 * decimals u8, is_initialized u8, freeze_authority COption<Pubkey> (4 + 32).
 * A Token-2022 mint with extensions pads the base to 165 bytes, stores the
 * account type (1 = Mint) at byte 165 and TLV entries (u16 type, u16 length,
 * value) from byte 166.
 */
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const MINT_BASE_LENGTH = 82;
export const ACCOUNT_BASE_LENGTH = 165;
export const ACCOUNT_TYPE_MINT = 1;

/** `ExtensionType` discriminants (`#[repr(u16)]`, sequential) as of the verified source revision. */
export const TOKEN_2022_EXTENSION_NAMES: ReadonlyMap<number, string> = new Map<number, string>([
  [0, 'Uninitialized'],
  [1, 'TransferFeeConfig'],
  [2, 'TransferFeeAmount'],
  [3, 'MintCloseAuthority'],
  [4, 'ConfidentialTransferMint'],
  [5, 'ConfidentialTransferAccount'],
  [6, 'DefaultAccountState'],
  [7, 'ImmutableOwner'],
  [8, 'MemoTransfer'],
  [9, 'NonTransferable'],
  [10, 'InterestBearingConfig'],
  [11, 'CpiGuard'],
  [12, 'PermanentDelegate'],
  [13, 'NonTransferableAccount'],
  [14, 'TransferHook'],
  [15, 'TransferHookAccount'],
  [16, 'ConfidentialTransferFeeConfig'],
  [17, 'ConfidentialTransferFeeAmount'],
  [18, 'MetadataPointer'],
  [19, 'TokenMetadata'],
  [20, 'GroupPointer'],
  [21, 'TokenGroup'],
  [22, 'GroupMemberPointer'],
  [23, 'TokenGroupMember'],
  [24, 'ConfidentialMintBurn'],
  [25, 'ScaledUiAmount'],
  [26, 'Pausable'],
  [27, 'PausableAccount'],
  [28, 'PermissionedBurn'],
]);

/**
 * Extensions that change what holding or transferring the token means.
 * Their presence never blocks parsing, but B04 must evaluate compatibility
 * before any such instrument can be traded; the catalog records them.
 */
export const REVIEW_REQUIRED_EXTENSIONS: ReadonlySet<string> = new Set([
  'TransferFeeConfig',
  'ConfidentialTransferMint',
  'DefaultAccountState',
  'NonTransferable',
  'InterestBearingConfig',
  'PermanentDelegate',
  'TransferHook',
  'ConfidentialMintBurn',
  'ScaledUiAmount',
  'Pausable',
  'PermissionedBurn',
]);

export type MintParseResult =
  | { readonly ok: true; readonly mint: OnChainMint }
  | {
      readonly ok: false;
      readonly reason: 'unknown_program' | 'not_a_mint';
      readonly detail: string;
    };

export function tokenProgramForOwner(owner: string): TokenProgram {
  if (owner === SPL_TOKEN_PROGRAM_ID) {
    return 'spl-token';
  }
  if (owner === TOKEN_2022_PROGRAM_ID) {
    return 'token-2022';
  }
  return 'unknown';
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function readU16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function readCOptionKey(
  data: Uint8Array,
  offset: number,
): { ok: true; key: string | null } | { ok: false } {
  const tag = readU32(data, offset);
  if (tag === 0) {
    return { ok: true, key: null };
  }
  if (tag === 1) {
    return { ok: true, key: encodeBase58(data.subarray(offset + 4, offset + 36)) };
  }
  return { ok: false };
}

/** Parse raw account bytes owned by `owner` as a mint. Never throws on untrusted bytes. */
export function parseMintAccount(owner: string, data: Uint8Array): MintParseResult {
  const tokenProgram = tokenProgramForOwner(owner);
  if (tokenProgram === 'unknown') {
    return {
      ok: false,
      reason: 'unknown_program',
      detail: `owner ${owner} is not a token program`,
    };
  }
  if (data.length < MINT_BASE_LENGTH) {
    return {
      ok: false,
      reason: 'not_a_mint',
      detail: `account holds ${data.length} bytes, a mint needs ${MINT_BASE_LENGTH}`,
    };
  }
  const mintAuthority = readCOptionKey(data, 0);
  const freezeAuthority = readCOptionKey(data, 46);
  const initializedByte = data[45];
  if (
    !mintAuthority.ok ||
    !freezeAuthority.ok ||
    (initializedByte !== 0 && initializedByte !== 1)
  ) {
    return { ok: false, reason: 'not_a_mint', detail: 'base layout has invalid option tags' };
  }
  const base = {
    tokenProgram,
    decimals: data[44] ?? 0,
    supply: readU64(data, 36).toString(),
    mintAuthority: mintAuthority.key,
    freezeAuthority: freezeAuthority.key,
    isInitialized: initializedByte === 1,
  };
  if (data.length === MINT_BASE_LENGTH) {
    return { ok: true, mint: { ...base, extensions: [], unknownExtensionTypes: [] } };
  }
  if (tokenProgram !== 'token-2022') {
    return {
      ok: false,
      reason: 'not_a_mint',
      detail: `spl-token mint must be exactly ${MINT_BASE_LENGTH} bytes`,
    };
  }
  if (data.length < ACCOUNT_BASE_LENGTH + 1) {
    return {
      ok: false,
      reason: 'not_a_mint',
      detail: 'token-2022 account too short for an account type',
    };
  }
  for (let index = MINT_BASE_LENGTH; index < ACCOUNT_BASE_LENGTH; index += 1) {
    if (data[index] !== 0) {
      return { ok: false, reason: 'not_a_mint', detail: 'token-2022 padding is not zero' };
    }
  }
  if (data[ACCOUNT_BASE_LENGTH] !== ACCOUNT_TYPE_MINT) {
    return {
      ok: false,
      reason: 'not_a_mint',
      detail: `token-2022 account type ${data[ACCOUNT_BASE_LENGTH]} is not a mint`,
    };
  }
  const extensions: string[] = [];
  const unknownExtensionTypes: number[] = [];
  let offset = ACCOUNT_BASE_LENGTH + 1;
  while (offset + 4 <= data.length) {
    const type = readU16(data, offset);
    const length = readU16(data, offset + 2);
    if (type === 0) {
      break;
    }
    if (offset + 4 + length > data.length) {
      return {
        ok: false,
        reason: 'not_a_mint',
        detail: `extension ${type} claims ${length} bytes beyond the account`,
      };
    }
    const name = TOKEN_2022_EXTENSION_NAMES.get(type);
    if (name === undefined) {
      unknownExtensionTypes.push(type);
    } else {
      extensions.push(name);
    }
    offset += 4 + length;
  }
  return { ok: true, mint: { ...base, extensions, unknownExtensionTypes } };
}

export interface DeclaredMint {
  readonly decimals: number;
  readonly tokenProgram: TokenProgram;
}

/** Differences between what the issuer feed declares and what the chain holds. Empty means the mint matches. */
export function compareMint(declared: DeclaredMint, onChain: OnChainMint): string[] {
  const mismatches: string[] = [];
  if (!onChain.isInitialized) {
    mismatches.push('mint is not initialized');
  }
  if (declared.decimals !== onChain.decimals) {
    mismatches.push(`decimals: declared ${declared.decimals}, on-chain ${onChain.decimals}`);
  }
  if (declared.tokenProgram !== 'unknown' && declared.tokenProgram !== onChain.tokenProgram) {
    mismatches.push(
      `token program: declared ${declared.tokenProgram}, on-chain ${onChain.tokenProgram}`,
    );
  }
  if (onChain.unknownExtensionTypes.length > 0) {
    mismatches.push(
      `unrecognised token-2022 extensions: ${onChain.unknownExtensionTypes.join(', ')}`,
    );
  }
  return mismatches;
}

export interface MintAccountFixture {
  readonly decimals: number;
  readonly supply: bigint;
  readonly mintAuthority: Uint8Array | null;
  readonly freezeAuthority: Uint8Array | null;
  readonly isInitialized?: boolean;
  /** Token-2022 TLV extensions to append; empty produces a plain 82-byte mint. */
  readonly extensions?: readonly { readonly type: number; readonly data: Uint8Array }[];
}

/** Encode a mint account for fixtures and tests (the inverse of `parseMintAccount`). */
export function encodeMintAccount(fixture: MintAccountFixture): Uint8Array {
  const extensions = fixture.extensions ?? [];
  const tlvLength = extensions.reduce((sum, extension) => sum + 4 + extension.data.length, 0);
  const length = extensions.length === 0 ? MINT_BASE_LENGTH : ACCOUNT_BASE_LENGTH + 1 + tlvLength;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  if (fixture.mintAuthority) {
    view.setUint32(0, 1, true);
    out.set(fixture.mintAuthority, 4);
  }
  view.setBigUint64(36, fixture.supply, true);
  out[44] = fixture.decimals;
  out[45] = fixture.isInitialized === false ? 0 : 1;
  if (fixture.freezeAuthority) {
    view.setUint32(46, 1, true);
    out.set(fixture.freezeAuthority, 50);
  }
  if (extensions.length > 0) {
    out[ACCOUNT_BASE_LENGTH] = ACCOUNT_TYPE_MINT;
    let offset = ACCOUNT_BASE_LENGTH + 1;
    for (const extension of extensions) {
      view.setUint16(offset, extension.type, true);
      view.setUint16(offset + 2, extension.data.length, true);
      out.set(extension.data, offset + 4);
      offset += 4 + extension.data.length;
    }
  }
  return out;
}
