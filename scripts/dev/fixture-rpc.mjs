#!/usr/bin/env node
/**
 * Fixture Solana JSON-RPC used by the headless startup check and the web
 * app's browser tests. It answers getGenesisHash/getHealth/getVersion for
 * the devnet identity and getAccountInfo for the synthetic catalog fixture
 * mints (packages/issuer-<issuer>/fixtures/fixture-mints.json), encoded in the real
 * SPL Token / Token-2022 mint layout with their extension data through the
 * built @markov/catalog encoders. Every other address is absent.
 * Funding reads (getBalance, getTokenAccountsByOwner,
 * getMinimumBalanceForRentExemption) answer from an in-memory table that the
 * browser tests fill through `POST /fixture/funding` with
 * `{ address, lamports, stablecoinRaw }`; unknown addresses hold nothing.
 * Usage: node scripts/dev/fixture-rpc.mjs <port> [genesisHash]
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const {
  encodeExtensionData,
  encodeMintAccount,
  EXTENSION_TYPE_BY_NAME,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} = await import(resolve(root, 'packages/catalog/dist/index.js'));

const port = Number(process.argv[2]);
/** Synthetic stablecoin mint for local and test funding reads; not a real token. */
export const FIXTURE_STABLECOIN_MINT = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
/** Rent-exempt minimum of a 165-byte token account at the default rent parameters. */
const RENT_EXEMPT_TOKEN_ACCOUNT = 2_039_280;
/** address -> { lamports, stablecoinRaw } filled by the test control endpoint. */
const funding = new Map();

function tokenAccountData(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(decodeBase58Loose(mint), 0);
  data.set(decodeBase58Loose(owner), 32);
  new DataView(data.buffer).setBigUint64(64, BigInt(amount), true);
  data[108] = 1; // state: initialized
  return data;
}

function decodeBase58Loose(text) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      return new Uint8Array(32);
    }
    value = value * 58n + BigInt(index);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  const out = new Uint8Array(32);
  out.set(bytes.slice(-32), 32 - Math.min(32, bytes.length));
  return out;
}
const genesis = process.argv[3] ?? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const authority = new Uint8Array(createHash('sha256').update('fixture-authority').digest());

function extensionSpec(spec) {
  switch (spec.name) {
    case 'MetadataPointer':
      return { name: 'MetadataPointer', authority, metadataAddress: authority };
    case 'ScaledUiAmount':
      return {
        name: 'ScaledUiAmount',
        authority,
        multiplier: spec.multiplier,
        newMultiplier: spec.newMultiplier,
        newMultiplierEffectiveAt: spec.newMultiplierEffectiveAt ?? 0,
      };
    case 'Pausable':
      return { name: 'Pausable', authority, paused: Boolean(spec.paused) };
    case 'TransferFeeConfig':
      return {
        name: 'TransferFeeConfig',
        basisPoints: spec.basisPoints,
        maximumFee: BigInt(spec.maximumFee),
      };
    case 'PermanentDelegate':
      return { name: 'PermanentDelegate', delegate: spec.delegate ? authority : null };
    case 'TransferHook':
      return { name: 'TransferHook', authority, programId: spec.programId ? authority : null };
    case 'DefaultAccountState':
      return { name: 'DefaultAccountState', frozen: Boolean(spec.frozen) };
    case 'InterestBearingConfig':
      return { name: 'InterestBearingConfig', rateBasisPoints: spec.rateBasisPoints ?? 0 };
    case 'MintCloseAuthority':
      return { name: 'MintCloseAuthority', closeAuthority: authority };
    case 'NonTransferable':
      return { name: 'NonTransferable' };
    default:
      throw new Error(`unknown fixture extension ${spec.name}`);
  }
}

const accounts = new Map();
for (const file of [
  'packages/issuer-prestocks/fixtures/fixture-mints.json',
  'packages/issuer-xstocks/fixtures/fixture-mints.json',
]) {
  const fixtures = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  for (const item of fixtures.mints) {
    if (item.symbol === 'FXGRID') {
      continue; // deliberately absent so verification reports not_found
    }
    const extensions = (item.extensions ?? []).map((spec) => {
      const name = typeof spec === 'string' ? spec : spec.name;
      const full = extensionSpec(typeof spec === 'string' ? { name } : spec);
      return { type: EXTENSION_TYPE_BY_NAME[name], data: encodeExtensionData(full) };
    });
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
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/fixture/funding') {
        try {
          const entry = JSON.parse(body || '{}');
          funding.set(String(entry.address), {
            lamports: Number(entry.lamports ?? 0),
            stablecoinRaw: String(entry.stablecoinRaw ?? '0'),
          });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, entries: funding.size }));
        } catch {
          res.statusCode = 400;
          res.end('{"ok":false}');
        }
        return;
      }
      let id = null;
      let result = null;
      try {
        const request = JSON.parse(body || '{}');
        id = request.id ?? null;
        switch (request.method) {
          case 'getGenesisHash':
            result = genesis;
            break;
          case 'getHealth':
            result = 'ok';
            break;
          case 'getVersion':
            result = { 'solana-core': 'fixture' };
            break;
          case 'getSlot':
            result = 4242;
            break;
          case 'getBalance': {
            const entry = funding.get(String(request.params?.[0]));
            result = { context: { slot: 4242 }, value: entry ? entry.lamports : 0 };
            break;
          }
          case 'getTokenAccountsByOwner': {
            const owner = String(request.params?.[0]);
            const mint = String(request.params?.[1]?.mint ?? '');
            const entry = funding.get(owner);
            const value =
              entry && BigInt(entry.stablecoinRaw) > 0n
                ? [
                    {
                      pubkey: 'FixtureTokenAccount111111111111111111111111',
                      account: {
                        data: [
                          Buffer.from(tokenAccountData(mint, owner, entry.stablecoinRaw)).toString(
                            'base64',
                          ),
                          'base64',
                        ],
                        executable: false,
                        lamports: RENT_EXEMPT_TOKEN_ACCOUNT,
                        owner: SPL_TOKEN_PROGRAM_ID,
                        space: 165,
                      },
                    },
                  ]
                : [];
            result = { context: { slot: 4242 }, value };
            break;
          }
          case 'getMinimumBalanceForRentExemption':
            result = RENT_EXEMPT_TOKEN_ACCOUNT;
            break;
          case 'getAccountInfo': {
            const account = accounts.get(String(request.params?.[0]));
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
      } catch {
        result = null;
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  })
  .listen(port, '127.0.0.1');
