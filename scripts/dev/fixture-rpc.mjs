#!/usr/bin/env node
/**
 * Fixture Solana JSON-RPC used by the headless startup check and the web
 * app's browser tests. It answers getGenesisHash/getHealth/getVersion for
 * the devnet identity and getAccountInfo for the synthetic catalog fixture
 * mints (packages/issuer-prestocks/fixtures/fixture-mints.json), encoded in
 * the real SPL Token / Token-2022 mint layout. Every other address is
 * absent. Usage: node scripts/dev/fixture-rpc.mjs <port> [genesisHash]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2]);
const genesis = process.argv[3] ?? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(
    resolve(here, '../../packages/issuer-prestocks/fixtures/fixture-mints.json'),
    'utf8',
  ),
);

const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function encodeMint({ decimals, extensions }) {
  const tlv = (extensions ?? []).map((name) => ({
    type: name === 'MetadataPointer' ? 18 : 0,
    length: 64,
  }));
  const length = tlv.length === 0 ? 82 : 166 + tlv.reduce((sum, item) => sum + 4 + item.length, 0);
  const out = Buffer.alloc(length);
  out.writeUInt32LE(1, 0); // mint authority present
  createHash('sha256').update('fixture-authority').digest().copy(out, 4);
  out.writeBigUInt64LE(1_000_000n, 36);
  out[44] = decimals;
  out[45] = 1; // initialized
  out.writeUInt32LE(0, 46); // no freeze authority
  if (tlv.length > 0) {
    out[165] = 1; // AccountType::Mint
    let offset = 166;
    for (const item of tlv) {
      out.writeUInt16LE(item.type, offset);
      out.writeUInt16LE(item.length, offset + 2);
      offset += 4 + item.length;
    }
  }
  return out;
}

const accounts = new Map();
for (const item of fixtures.mints) {
  if (item.symbol === 'FXGRID') {
    continue; // deliberately absent so verification reports not_found
  }
  accounts.set(item.mint, {
    owner: item.tokenProgram === 'token-2022' ? TOKEN_2022 : SPL_TOKEN,
    data: encodeMint(item),
  });
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
                    data: [account.data.toString('base64'), 'base64'],
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
