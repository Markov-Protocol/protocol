import { readFileSync } from 'node:fs';
import {
  EXTENSION_TYPE_BY_NAME,
  type ExtensionFixtureSpec,
  encodeExtensionData,
  encodeMintAccount,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@markov/catalog';
import { KNOWN_GENESIS_HASHES } from '@markov/config';
import { decodeBase58 } from '@markov/contracts';
import { type FixtureLedger, fetchForLedger } from '@markov/registry';

export const GENESIS = KNOWN_GENESIS_HASHES.devnet;

interface FixtureMint {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: 'spl-token' | 'token-2022';
  extensions?: Record<string, unknown>[];
}

const prestocksMints = (
  JSON.parse(
    readFileSync(
      new URL('../../../../packages/issuer-prestocks/fixtures/fixture-mints.json', import.meta.url),
      'utf8',
    ),
  ) as { mints: FixtureMint[] }
).mints;

const xstocksMints = (
  JSON.parse(
    readFileSync(
      new URL('../../../../packages/issuer-xstocks/fixtures/fixture-mints.json', import.meta.url),
      'utf8',
    ),
  ) as { mints: FixtureMint[] }
).mints;
const xstocksAuthority = new Uint8Array(32).fill(7);

function xstocksExtension(raw: Record<string, unknown>): ExtensionFixtureSpec {
  switch (raw['name']) {
    case 'MetadataPointer':
      return {
        name: 'MetadataPointer',
        authority: xstocksAuthority,
        metadataAddress: xstocksAuthority,
      };
    case 'ScaledUiAmount':
      return {
        name: 'ScaledUiAmount',
        authority: xstocksAuthority,
        multiplier: Number(raw['multiplier']),
        newMultiplier: Number(raw['newMultiplier']),
        newMultiplierEffectiveAt: Number(raw['newMultiplierEffectiveAt'] ?? 0),
      };
    case 'Pausable':
      return { name: 'Pausable', authority: xstocksAuthority, paused: Boolean(raw['paused']) };
    case 'TransferFeeConfig':
      return {
        name: 'TransferFeeConfig',
        basisPoints: Number(raw['basisPoints']),
        maximumFee: BigInt(String(raw['maximumFee'])),
      };
    case 'PermanentDelegate':
      return { name: 'PermanentDelegate', delegate: raw['delegate'] ? xstocksAuthority : null };
    default:
      throw new Error(`unknown fixture extension ${String(raw['name'])}`);
  }
}

/** The xStocks fixture mints with their Token-2022 extension data, as `getAccountInfo` would serve them. */
export function xstocksFixtureMintAccounts(): Map<string, { owner: string; data: Uint8Array }> {
  const accounts = new Map<string, { owner: string; data: Uint8Array }>();
  for (const item of xstocksMints) {
    const extensions = (item.extensions ?? []).map((raw) => {
      const full = xstocksExtension(raw);
      return { type: EXTENSION_TYPE_BY_NAME[full.name], data: encodeExtensionData(full) };
    });
    accounts.set(item.mint, {
      owner: item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
      data: encodeMintAccount({
        decimals: item.decimals,
        supply: 5_000_000n,
        mintAuthority: xstocksAuthority,
        freezeAuthority: null,
        extensions,
      }),
    });
  }
  return accounts;
}

/**
 * JSON-RPC stand-in serving the PreStocks fixture mints as real-shaped
 * accounts; FXGRID is deliberately absent. With a ledger, registry methods
 * (blockhashes, submissions, statuses, records) are answered by it.
 */
export function prestocksFixtureRpcFetch(ledger?: FixtureLedger): typeof fetch {
  const accounts = new Map<string, { owner: string; data: Uint8Array }>();
  for (const item of prestocksMints) {
    if (item.symbol === 'FXGRID') {
      continue;
    }
    const authority = decodeBase58('11111111111111111111111111111111');
    const extensions =
      item.tokenProgram === 'token-2022' ? [{ type: 18, data: new Uint8Array(64) }] : [];
    accounts.set(item.mint, {
      owner: item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
      data: encodeMintAccount({
        decimals: item.decimals,
        supply: 1_000_000n,
        mintAuthority: authority,
        freezeAuthority: null,
        extensions,
      }),
    });
  }
  const answer = (method: string, params: unknown): unknown => {
    const list = Array.isArray(params) ? params : [];
    switch (method) {
      case 'getGenesisHash':
        return GENESIS;
      case 'getHealth':
        return 'ok';
      case 'getVersion':
        return { 'solana-core': 'fixture' };
      case 'getAccountInfo': {
        const account = accounts.get(String(list[0]));
        return {
          context: { slot: 4242 },
          value: account
            ? {
                data: [Buffer.from(account.data).toString('base64'), 'base64'],
                executable: false,
                lamports: 1,
                owner: account.owner,
                space: account.data.length,
              }
            : null,
        };
      }
      default:
        return null;
    }
  };
  if (ledger) {
    return fetchForLedger(ledger, answer);
  }
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    let result: unknown;
    switch (body.method) {
      case 'getGenesisHash':
        result = GENESIS;
        break;
      case 'getHealth':
        result = 'ok';
        break;
      case 'getVersion':
        result = { 'solana-core': 'fixture' };
        break;
      case 'getAccountInfo': {
        const account = accounts.get(String(body.params[0]));
        result = {
          context: { slot: 4242 },
          value: account
            ? {
                data: [Buffer.from(account.data).toString('base64'), 'base64'],
                executable: false,
                lamports: 1,
                owner: account.owner,
                space: account.data.length,
              }
            : null,
        };
        break;
      }
      default:
        result = null;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}
