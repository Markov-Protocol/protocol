#!/usr/bin/env node
/**
 * Fixture Solana JSON-RPC used by the headless startup check and the web
 * app's browser tests. It answers getGenesisHash/getHealth/getVersion for
 * the devnet identity and getAccountInfo for the synthetic catalog fixture
 * mints (packages/issuer-<issuer>/fixtures/fixture-mints.json), encoded in the real
 * SPL Token / Token-2022 mint layout with their extension data through the
 * built @markov/catalog encoders. Every other address is absent.
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
