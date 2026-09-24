import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compareMint,
  encodeMintAccount,
  parseMintAccount,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../src/index.js';

interface LiveMint {
  label: string;
  address: string;
  owner: string;
  space: number;
  dataBase64: string;
}

const live = JSON.parse(
  readFileSync(new URL('./fixtures/live-mints.json', import.meta.url), 'utf8'),
) as {
  accounts: LiveMint[];
};

function bytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

describe('mint account parsing', () => {
  it('parses the recorded USDC mint (spl-token, 82 bytes)', () => {
    const account = live.accounts[0] as LiveMint;
    const data = bytes(account.dataBase64);
    expect(data.length).toBe(account.space);
    const parsed = parseMintAccount(account.owner, data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.mint.tokenProgram).toBe('spl-token');
    expect(parsed.mint.decimals).toBe(6);
    expect(parsed.mint.isInitialized).toBe(true);
    expect(parsed.mint.mintAuthority).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(parsed.mint.freezeAuthority).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(BigInt(parsed.mint.supply) > 0n).toBe(true);
    expect(parsed.mint.extensions).toEqual([]);
  });

  it('parses the recorded PYUSD mint (token-2022 with TLV extensions)', () => {
    const account = live.accounts[1] as LiveMint;
    const data = bytes(account.dataBase64);
    expect(data.length).toBe(account.space);
    const parsed = parseMintAccount(account.owner, data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.mint.tokenProgram).toBe('token-2022');
    expect(parsed.mint.decimals).toBe(6);
    expect(parsed.mint.isInitialized).toBe(true);
    expect(parsed.mint.unknownExtensionTypes).toEqual([]);
    expect(parsed.mint.extensions).toEqual(
      expect.arrayContaining([
        'MintCloseAuthority',
        'PermanentDelegate',
        'TransferFeeConfig',
        'MetadataPointer',
        'TokenMetadata',
      ]),
    );
    expect(compareMint({ decimals: 6, tokenProgram: 'token-2022' }, parsed.mint)).toEqual([]);
    expect(compareMint({ decimals: 8, tokenProgram: 'spl-token' }, parsed.mint)).toEqual([
      'decimals: declared 8, on-chain 6',
      'token program: declared spl-token, on-chain token-2022',
    ]);
  });

  it('round-trips synthetic mints and refuses non-mint bytes and foreign programs', () => {
    const authority = new Uint8Array(32).fill(7);
    const plain = encodeMintAccount({
      decimals: 9,
      supply: 123456789n,
      mintAuthority: authority,
      freezeAuthority: null,
    });
    expect(plain.length).toBe(82);
    const parsedPlain = parseMintAccount(SPL_TOKEN_PROGRAM_ID, plain);
    expect(parsedPlain).toMatchObject({
      ok: true,
      mint: { decimals: 9, supply: '123456789', freezeAuthority: null },
    });

    const extended = encodeMintAccount({
      decimals: 2,
      supply: 5n,
      mintAuthority: null,
      freezeAuthority: authority,
      extensions: [
        { type: 12, data: new Uint8Array(32) },
        { type: 999, data: new Uint8Array(3) },
      ],
    });
    const parsedExtended = parseMintAccount(TOKEN_2022_PROGRAM_ID, extended);
    expect(parsedExtended).toMatchObject({
      ok: true,
      mint: {
        decimals: 2,
        mintAuthority: null,
        extensions: ['PermanentDelegate'],
        unknownExtensionTypes: [999],
      },
    });
    if (parsedExtended.ok) {
      expect(compareMint({ decimals: 2, tokenProgram: 'unknown' }, parsedExtended.mint)).toEqual([
        'unrecognised token-2022 extensions: 999',
      ]);
    }

    expect(parseMintAccount(SPL_TOKEN_PROGRAM_ID, extended)).toMatchObject({
      ok: false,
      reason: 'not_a_mint',
    });
    expect(parseMintAccount('11111111111111111111111111111111', plain)).toMatchObject({
      ok: false,
      reason: 'unknown_program',
    });
    expect(parseMintAccount(SPL_TOKEN_PROGRAM_ID, plain.subarray(0, 40))).toMatchObject({
      ok: false,
      reason: 'not_a_mint',
    });
    const badTag = new Uint8Array(plain);
    badTag[0] = 9;
    expect(parseMintAccount(SPL_TOKEN_PROGRAM_ID, badTag)).toMatchObject({
      ok: false,
      reason: 'not_a_mint',
    });
    const truncatedTlv = new Uint8Array(extended.subarray(0, extended.length - 2));
    expect(parseMintAccount(TOKEN_2022_PROGRAM_ID, truncatedTlv)).toMatchObject({
      ok: false,
      reason: 'not_a_mint',
    });
    const uninitialized = encodeMintAccount({
      decimals: 6,
      supply: 0n,
      mintAuthority: null,
      freezeAuthority: null,
      isInitialized: false,
    });
    const parsedUninitialized = parseMintAccount(SPL_TOKEN_PROGRAM_ID, uninitialized);
    expect(
      parsedUninitialized.ok &&
        compareMint({ decimals: 6, tokenProgram: 'spl-token' }, parsedUninitialized.mint),
    ).toEqual(['mint is not initialized']);
  });
});
