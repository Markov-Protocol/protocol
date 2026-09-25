#!/usr/bin/env node
/**
 * Fixture Solana JSON-RPC used by the headless startup check and the web
 * app's browser tests: the in-memory fixture chain of @markov/solana-codec
 * (through the @markov/registry ledger) answering every method the services
 * call with the shapes agave returns.
 *
 * Installed on the chain: the devnet genesis identity, the synthetic catalog
 * fixture mints (packages/issuer-<issuer>/fixtures/fixture-mints.json)
 * encoded in the real SPL Token / Token-2022 mint layouts with their
 * extension data (FXGRID is known but absent so verification reports
 * not_found), the synthetic stablecoin, the strategy registry program (B08)
 * for MARKOV_FIXTURE_REGISTRY_PROGRAM_ID (default: the development
 * placeholder id) and the fixture route program (B10) executing the fixture
 * venue's synthetic prices. Blockhashes, submissions with preflight, signature
 * statuses, transactions with balance changes and program accounts all come
 * from the chain; balances move only through landed transactions.
 *
 * Test controls:
 *   POST /fixture/funding { address, lamports, stablecoinRaw }  sets a wallet's
 *     lamports and stablecoin balance exactly (unknown addresses hold nothing).
 *   POST /fixture/chain { action }  (also served at /fixture/registry):
 *     advance (slots), finalize, drop-next, land-error (code), lose-next-response,
 *     outage, online, fund (address, lamports).
 *   POST /fixture/ready raises the readiness flag the browser tests wait on.
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
const { FixtureLedger } = await import(resolve(root, 'packages/registry/dist/index.js'));
const { FIXTURE_ROUTE_PROGRAM_ID } = await import(resolve(root, 'packages/planning/dist/index.js'));
const { FIXTURE_PRICES, fixtureRouteProgramExecutor, fixtureSwapOutput } = await import(
  resolve(root, 'packages/venue-jupiter/dist/index.js')
);

const port = Number(process.argv[2]);
/** Synthetic stablecoin mint for local and test funding reads; not a real token. */
export const FIXTURE_STABLECOIN_MINT = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
const genesis = process.argv[3] ?? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
/** Development placeholder program id (programs/strategy-registry/src/lib.rs); never a deployed program. */
const registryProgramId =
  process.env.MARKOV_FIXTURE_REGISTRY_PROGRAM_ID ?? '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const chain = new FixtureLedger({ programId: registryProgramId, genesisHash: genesis });
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

for (const file of [
  'packages/issuer-prestocks/fixtures/fixture-mints.json',
  'packages/issuer-xstocks/fixtures/fixture-mints.json',
]) {
  const fixtures = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  for (const item of fixtures.mints) {
    const tokenProgram =
      item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
    if (item.symbol === 'FXGRID') {
      chain.registerMint(item.mint, { decimals: item.decimals, tokenProgram }); // absent on chain on purpose
      continue;
    }
    const extensions = (item.extensions ?? []).map((spec) => {
      const name = typeof spec === 'string' ? spec : spec.name;
      const full = extensionSpec(typeof spec === 'string' ? { name } : spec);
      return { type: EXTENSION_TYPE_BY_NAME[name], data: encodeExtensionData(full) };
    });
    chain.registerMint(item.mint, {
      decimals: item.decimals,
      tokenProgram,
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
chain.registerMint(FIXTURE_STABLECOIN_MINT, { decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM_ID });
const prices = new Map(FIXTURE_PRICES.map((price) => [price.mint, price]));
let fillShiftBps = 0;
chain.registerProgram(
  FIXTURE_ROUTE_PROGRAM_ID,
  fixtureRouteProgramExecutor({
    outputFor: (inputMint, outputMint, inAmountRaw) =>
      fixtureSwapOutput({
        stablecoin: { mint: FIXTURE_STABLECOIN_MINT, decimals: 6 },
        prices,
        inputMint,
        outputMint,
        inAmountRaw,
      })?.outAmountRaw ?? null,
    fillShiftBps: () => fillShiftBps,
  }),
  'fixture-amm',
);

function control(action) {
  switch (action.action) {
    case 'advance':
      chain.advance(Number(action.slots ?? 1));
      break;
    case 'finalize':
      chain.finalize();
      break;
    case 'drop-next':
      chain.dropNext = true;
      break;
    case 'land-error':
      chain.landNextWithError = Number(action.code ?? 0);
      break;
    case 'lose-next-response':
      chain.loseNextResponse = true;
      break;
    case 'fill-shift':
      fillShiftBps = Number(action.bps ?? 0);
      break;
    case 'outage':
      chain.outage = true;
      break;
    case 'online':
      chain.outage = false;
      break;
    case 'fund':
      chain.fund(String(action.address), BigInt(action.lamports ?? 0));
      break;
    default:
      throw new Error('unknown action');
  }
}

let ready = false;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      // Readiness flag the e2e API script raises once the catalog is seeded; Playwright waits on it.
      if (req.url === '/fixture/ready') {
        if (req.method === 'POST') {
          ready = true;
        }
        res.statusCode = ready ? 200 : 503;
        res.end(JSON.stringify({ ready }));
        return;
      }
      if (
        req.method === 'POST' &&
        (req.url === '/fixture/chain' || req.url === '/fixture/registry')
      ) {
        try {
          control(JSON.parse(body || '{}'));
          res.end(
            JSON.stringify({
              ok: true,
              slot: chain.currentSlot,
              blockHeight: chain.currentBlockHeight,
              records: chain.programAccounts().length,
            }),
          );
        } catch {
          res.statusCode = 400;
          res.end('{"ok":false}');
        }
        return;
      }
      if (req.method === 'POST' && req.url === '/fixture/funding') {
        try {
          const entry = JSON.parse(body || '{}');
          const address = String(entry.address);
          chain.setLamports(address, BigInt(entry.lamports ?? 0));
          const stablecoinRaw = BigInt(entry.stablecoinRaw ?? '0');
          if (stablecoinRaw > 0n || chain.tokenBalance(address, FIXTURE_STABLECOIN_MINT) > 0n) {
            chain.setTokenBalance(address, FIXTURE_STABLECOIN_MINT, stablecoinRaw);
          }
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.statusCode = 400;
          res.end('{"ok":false}');
        }
        return;
      }
      let id = null;
      try {
        const request = JSON.parse(body || '{}');
        id = request.id ?? null;
        if (request.method === 'sendTransaction' && chain.loseNextResponse) {
          // The node executes the submission but its answer never reaches the caller.
          chain.loseNextResponse = false;
          chain.handle(request.method, request.params);
          req.socket.destroy();
          return;
        }
        const answer = chain.handle(request.method, request.params);
        if (answer && typeof answer === 'object' && 'rpcError' in answer) {
          res.end(JSON.stringify({ jsonrpc: '2.0', id, error: answer.rpcError }));
        } else {
          res.end(JSON.stringify({ jsonrpc: '2.0', id, result: answer }));
        }
      } catch (error) {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: error instanceof Error ? error.message : 'internal' },
          }),
        );
      }
    });
  })
  .listen(port, '127.0.0.1', () => {
    process.stdout.write(`fixture rpc listening on 127.0.0.1:${port} (genesis ${genesis})\n`);
  });
