import {
  decodeFixtureSwapData,
  FIXTURE_ROUTE_ERRORS,
  FIXTURE_ROUTE_PROGRAM_ID,
  fixtureSwapAccountsOf,
} from '@markov/planning';

/**
 * The fixture route program's on-chain semantics, as an executor for the
 * fixture chain (`FixtureChain.registerProgram`). It moves the exact input
 * out of the owner's source token account and credits the output the
 * synthetic price implies, or fails with the program's own error codes.
 * The price function is the one the fixture venue quotes with, so a quote
 * and its execution agree unless a test shifts the price on purpose.
 */

/** The subset of the chain's program context the executor needs (structurally typed; no dependency on the chain). */
export interface FixtureProgramContext {
  readonly programId: string;
  readonly accounts: readonly { readonly pubkey: string; readonly isWritable: boolean }[];
  readonly data: Uint8Array;
  isSigner(address: string): boolean;
  read(address: string): { readonly owner: string; readonly data: Uint8Array } | null;
  write(
    address: string,
    account: {
      readonly owner: string;
      readonly lamports: bigint;
      readonly data: Uint8Array;
      readonly executable: boolean;
    },
  ): void;
  log(line: string): void;
  fail(error: number | string, reason?: string): never;
}

export interface FixtureProgramOptions {
  /** Output for an exact input at the synthetic price; null when the pair is not routed. */
  readonly outputFor: (inputMint: string, outputMint: string, inAmountRaw: bigint) => bigint | null;
  /** Test control: shifts every execution's output by this many basis points (negative worsens the fill). */
  readonly fillShiftBps?: () => number;
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(data[offset + i] as number);
  }
  return value;
}

function writeU64(data: Uint8Array, offset: number, value: bigint): void {
  let rest = value;
  for (let i = 0; i < 8; i += 1) {
    data[offset + i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
}

const AMOUNT_OFFSET = 64;
const MINT_OFFSET = 0;
const OWNER_OFFSET = 32;

function tokenAccountView(data: Uint8Array): {
  mint: Uint8Array;
  owner: Uint8Array;
  amount: bigint;
} {
  return {
    mint: data.subarray(MINT_OFFSET, MINT_OFFSET + 32),
    owner: data.subarray(OWNER_OFFSET, OWNER_OFFSET + 32),
    amount: readU64(data, AMOUNT_OFFSET),
  };
}

function base58Bytes(address: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  let leading = 0;
  let counting = true;
  for (const char of address) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new Error('not base58');
    }
    if (counting && index === 0) {
      leading += 1;
    } else {
      counting = false;
    }
    value = value * 58n + BigInt(index);
  }
  const out: number[] = [];
  while (value > 0n) {
    out.unshift(Number(value % 256n));
    value /= 256n;
  }
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...out]);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export function fixtureRouteProgramExecutor(options: FixtureProgramOptions) {
  return (ctx: FixtureProgramContext): void => {
    if (ctx.programId !== FIXTURE_ROUTE_PROGRAM_ID) {
      ctx.fail('IncorrectProgramId');
    }
    ctx.log('Program log: Instruction: SwapExactIn');
    const args = decodeFixtureSwapData(ctx.data);
    if (!args) {
      ctx.fail('InvalidInstructionData');
    }
    const keys = fixtureSwapAccountsOf(ctx.accounts.map((account) => account.pubkey));
    if (!keys) {
      ctx.fail('NotEnoughAccountKeys');
    }
    if (!ctx.isSigner(keys.owner)) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.NotSigner, 'NotSigner');
    }
    const source = ctx.read(keys.source);
    const destination = ctx.read(keys.destination);
    if (!source || !destination) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.AccountMismatch, 'AccountMismatch');
    }
    if (source.owner !== keys.inputTokenProgram || destination.owner !== keys.outputTokenProgram) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.AccountMismatch, 'AccountMismatch');
    }
    const from = tokenAccountView(source.data);
    const to = tokenAccountView(destination.data);
    const ownerBytes = base58Bytes(keys.owner);
    if (
      !same(from.owner, ownerBytes) ||
      !same(to.owner, ownerBytes) ||
      !same(from.mint, base58Bytes(keys.inputMint)) ||
      !same(to.mint, base58Bytes(keys.outputMint))
    ) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.AccountMismatch, 'AccountMismatch');
    }
    if (from.amount < args.inAmountRaw) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.InsufficientInput, 'InsufficientInput');
    }
    const quoted = options.outputFor(keys.inputMint, keys.outputMint, args.inAmountRaw);
    if (quoted === null) {
      ctx.fail(FIXTURE_ROUTE_ERRORS.UnsupportedMint, 'UnsupportedMint');
    }
    const shift = BigInt(options.fillShiftBps?.() ?? 0);
    const out = (quoted * (10_000n + shift)) / 10_000n;
    if (out < args.minimumOutRaw) {
      ctx.log(`Program log: output ${out} is below the minimum ${args.minimumOutRaw}`);
      ctx.fail(FIXTURE_ROUTE_ERRORS.SlippageExceeded, 'SlippageExceeded');
    }
    const newSource = new Uint8Array(source.data);
    writeU64(newSource, AMOUNT_OFFSET, from.amount - args.inAmountRaw);
    const newDestination = new Uint8Array(destination.data);
    writeU64(newDestination, AMOUNT_OFFSET, to.amount + out);
    const sourceFull = ctx.read(keys.source) as {
      readonly owner: string;
      readonly data: Uint8Array;
      readonly lamports?: bigint;
      readonly executable?: boolean;
    };
    const destinationFull = ctx.read(keys.destination) as typeof sourceFull;
    ctx.write(keys.source, {
      owner: sourceFull.owner,
      lamports: sourceFull.lamports ?? 0n,
      data: newSource,
      executable: false,
    });
    ctx.write(keys.destination, {
      owner: destinationFull.owner,
      lamports: destinationFull.lamports ?? 0n,
      data: newDestination,
      executable: false,
    });
    ctx.log(`Program log: swapped ${args.inAmountRaw} for ${out}`);
  };
}
