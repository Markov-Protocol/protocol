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
import { FIXTURE_ROUTE_PROGRAM_ID } from '@markov/planning';
import { type FixtureLedger, fetchForLedger, FixtureLedger as Ledger } from '@markov/registry';
import {
  FIXTURE_PRICES,
  fixtureRouteProgramExecutor,
  fixtureSwapOutput,
} from '@markov/venue-jupiter';

export const GENESIS = KNOWN_GENESIS_HASHES.devnet;
/** Synthetic stablecoin mint of local and test funding reads; not a real token. */
export const FIXTURE_STABLECOIN_MINT = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
/** Development placeholder registry program id (programs/strategy-registry/src/lib.rs); never deployed. */
export const FIXTURE_REGISTRY_PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';

interface FixtureMint {
  symbol: string;
  mint: string;
  decimals: number;
  tokenProgram: 'spl-token' | 'token-2022';
  extensions?: Record<string, unknown>[];
}

function loadMints(file: string): FixtureMint[] {
  return (
    JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as { mints: FixtureMint[] }
  ).mints;
}

const prestocksMints = loadMints(
  '../../../../packages/issuer-prestocks/fixtures/fixture-mints.json',
);
const xstocksMints = loadMints('../../../../packages/issuer-xstocks/fixtures/fixture-mints.json');
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

/** The PreStocks fixture mints as real-shaped accounts; FXGRID is deliberately absent. */
export function prestocksFixtureMintAccounts(): Map<string, { owner: string; data: Uint8Array }> {
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
  return accounts;
}

export interface FixtureChainOptions {
  readonly registryProgramId?: string;
  readonly genesisHash?: string;
  /** Unix seconds the chain stamps blocks with; defaults to the wall clock. */
  readonly now?: () => number;
  /** Test control read on every execution of the fixture route program. */
  readonly fillShiftBps?: () => number;
}

/**
 * Registers the fixture mints (PreStocks and xStocks with their extension
 * data; FXGRID known but absent on chain), the synthetic stablecoin and the
 * fixture route program executing the venue's synthetic prices on a chain.
 */
export function installFixtures(
  chain: FixtureLedger,
  options: Pick<FixtureChainOptions, 'fillShiftBps'> = {},
): FixtureLedger {
  const programOf = (item: FixtureMint) =>
    item.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
  const accounts = new Map([...prestocksFixtureMintAccounts(), ...xstocksFixtureMintAccounts()]);
  for (const item of [...prestocksMints, ...xstocksMints]) {
    const account = accounts.get(item.mint);
    chain.registerMint(item.mint, {
      decimals: item.decimals,
      tokenProgram: programOf(item),
      ...(account ? { data: account.data } : {}),
    });
  }
  chain.registerMint(FIXTURE_STABLECOIN_MINT, { decimals: 6, tokenProgram: SPL_TOKEN_PROGRAM_ID });
  const prices = new Map(FIXTURE_PRICES.map((price) => [price.mint, price]));
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
      ...(options.fillShiftBps ? { fillShiftBps: options.fillShiftBps } : {}),
    }),
    'fixture-amm',
  );
  return chain;
}

/**
 * A fixture chain with the fixtures installed and the registry program
 * registered. Funding is set through `setLamports`/`setTokenBalance`;
 * balances then move only through landed transactions.
 */
export function createFixtureChain(options: FixtureChainOptions = {}): FixtureLedger {
  const chain = new Ledger({
    programId: options.registryProgramId ?? FIXTURE_REGISTRY_PROGRAM_ID,
    genesisHash: options.genesisHash ?? GENESIS,
    ...(options.now ? { now: options.now } : {}),
  });
  return installFixtures(chain, options);
}

/**
 * JSON-RPC stand-in over a fixture chain with the fixtures installed. A
 * ledger a test constructed itself (registry tests) gets the fixture mints
 * installed on the way; without one a fresh chain is created.
 */
export function prestocksFixtureRpcFetch(ledger?: FixtureLedger): typeof fetch {
  return fetchForLedger(ledger ? installFixtures(ledger) : createFixtureChain());
}
