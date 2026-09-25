import { randomBytes } from 'node:crypto';
import { encodeBase58 } from '@markov/contracts';
import { ByteReader, base64ToBytes, bytesEqual, bytesToBase64 } from './bytes.js';
import {
  pubkeyBytes,
  SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from './pubkey.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  COMPUTE_BUDGET_PROGRAM_ID,
  decodeTokenAccount,
  encodeTokenAccount,
  isTokenProgram,
  looksLikeTokenAccount,
  TOKEN_ACCOUNT_LENGTH,
} from './token.js';
import {
  decodeAddressLookupTable,
  parseTransaction,
  type ResolvedAccount,
  type ResolvedInstruction,
  resolveInstructions,
  resolveMessageAccounts,
  type Transaction,
  transactionSignature,
  verifyTransactionSignatures,
} from './transaction.js';

/**
 * An in-memory stand-in for the parts of a Solana cluster the product
 * touches: accounts, blockhashes with validity, transactions with
 * signatures, confirmation depth and finality, and the execution of
 * registered program semantics (the registry program of `@markov/registry`,
 * the fixture route program of the fixture venue). The system program,
 * compute-budget program, associated-token-account program and the token
 * programs' transfers are built in.
 *
 * It is a fixture: FIXTURE_VERIFIED evidence only, never reachable from a
 * production configuration. Program behaviour under the real runtime is
 * proven elsewhere (`programs/strategy-registry/tests`); nothing here is a
 * claim about a live cluster.
 */

/** Base fee per signature (agave `LAMPORTS_PER_SIGNATURE`). */
export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** Rent-exempt minimum at the default rent parameters (3,480 lamports per byte-year, two years, 128 bytes of overhead). */
export function rentExemptMinimum(space: number): bigint {
  return BigInt(space + 128) * 3_480n * 2n;
}
/** Slots after landing at which a transaction counts as finalized here. */
export const FINALITY_DEPTH = 32;
/** Block heights a blockhash stays valid (agave `MAX_PROCESSING_AGE`). */
export const BLOCKHASH_VALIDITY = 150;
/** Default compute units per instruction and the transaction-wide cap (agave defaults). */
export const DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION = 200_000;
export const MAX_COMPUTE_UNITS = 1_400_000;
/** Anchor framework error codes programs written with Anchor rely on. */
export const ANCHOR_ERRORS = {
  InstructionFallbackNotFound: 101,
  ConstraintSeeds: 2006,
  AccountDiscriminatorMismatch: 3002,
  AccountOwnedByWrongProgram: 3007,
  InvalidProgramId: 3008,
  AccountNotSigner: 3010,
  AccountNotInitialized: 3012,
} as const;

export interface ChainAccount {
  readonly owner: string;
  readonly lamports: bigint;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export type ChainError =
  | { readonly InstructionError: readonly [number, { readonly Custom: number } | string] }
  | string;

export interface TokenBalanceRecord {
  readonly accountIndex: number;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
  readonly amount: bigint;
  readonly decimals: number;
}

export interface ChainTransaction {
  readonly signature: string;
  readonly slot: number;
  readonly blockHeight: number;
  readonly blockTime: number;
  readonly err: ChainError | null;
  readonly logs: readonly string[];
  /** Every account of the transaction in index order (static keys, then loaded addresses). */
  readonly accountKeys: readonly string[];
  readonly staticKeys: readonly string[];
  readonly loadedWritable: readonly string[];
  readonly loadedReadonly: readonly string[];
  readonly version: 'legacy' | 0;
  readonly fee: bigint;
  readonly preBalances: readonly bigint[];
  readonly postBalances: readonly bigint[];
  readonly preTokenBalances: readonly TokenBalanceRecord[];
  readonly postTokenBalances: readonly TokenBalanceRecord[];
  readonly computeUnitsConsumed: number;
}

export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export class ChainRpcError extends Error {
  readonly rpcError: RpcError;

  constructor(rpcError: RpcError) {
    super(rpcError.message);
    this.rpcError = rpcError;
  }
}

/** Thrown by an executor to fail the transaction; the chain answers it as a node would. */
export class ProgramFailure extends Error {
  constructor(
    readonly err: ChainError,
    readonly logs: readonly string[],
  ) {
    super('program failure');
  }
}

/** What an executor sees of one instruction and the chain state it may change. */
export interface ProgramContext {
  readonly programId: string;
  readonly instructionIndex: number;
  readonly accounts: readonly ResolvedAccount[];
  readonly data: Uint8Array;
  readonly slot: number;
  readonly blockHeight: number;
  readonly unixTime: number;
  isSigner(address: string): boolean;
  isWritable(address: string): boolean;
  /** Reads see the writes of earlier instructions in the same transaction. */
  read(address: string): ChainAccount | null;
  write(address: string, account: ChainAccount): void;
  log(line: string): void;
  /** Fail with a program error: a custom code, or an agave `InstructionError` variant name. */
  fail(error: number | string, reason?: string): never;
  /** Decimals of a registered mint, or of a mint account the chain holds; null when unknown. */
  mintDecimals(mint: string): number | null;
}

export type ProgramExecutor = (ctx: ProgramContext) => void;

export interface FixtureChainOptions {
  readonly genesisHash: string;
  readonly initialSlot?: number;
  /** Unix seconds; defaults to the wall clock. */
  readonly now?: () => number;
}

interface RegisteredBlockhash {
  readonly lastValidBlockHeight: number;
}

interface MintInfo {
  readonly decimals: number;
  readonly tokenProgram: string;
}

interface ComputeBudget {
  unitLimit: number | null;
  unitPriceMicroLamports: bigint;
  heapFrameBytes: number | null;
}

export function customError(index: number, code: number): ChainError {
  return { InstructionError: [index, { Custom: code }] };
}

function hexCode(code: number): string {
  return `0x${code.toString(16)}`;
}

function u32le(data: Uint8Array, offset: number): number {
  return new ByteReader(data.subarray(offset, offset + 4)).u32();
}

function u64le(data: Uint8Array, offset: number): bigint {
  return new ByteReader(data.subarray(offset, offset + 8)).u64();
}

/** A one-shot fault for the next submission of one fee payer. */
export type PayerFault =
  | { readonly kind: 'drop' }
  | { readonly kind: 'land-error'; readonly code: number }
  | { readonly kind: 'lose-response' };

export class FixtureChain {
  readonly genesisHash: string;
  private readonly now: () => number;
  private slot: number;
  private blockHeight: number;
  private readonly accounts = new Map<string, ChainAccount>();
  private readonly transactions = new Map<string, ChainTransaction>();
  private readonly blockhashes = new Map<string, RegisteredBlockhash>();
  private readonly mints = new Map<string, MintInfo>();
  private readonly programs = new Map<string, { executor: ProgramExecutor; label: string }>();
  /** Test controls. The `…Next` ones apply to the next submission from anyone. */
  outage = false;
  dropNext = false;
  landNextWithError: number | null = null;
  /** The next `sendTransaction` executes, but its response is lost in transit (`fetchForChain` throws). */
  loseNextResponse = false;
  /**
   * One-shot faults for the next submission paid by one fee payer, so tests
   * that share this chain in parallel never receive each other's faults.
   */
  private readonly payerFaults = new Map<string, PayerFault>();
  /** Set by a submission whose payer asked for a lost response; the transport drops that answer. */
  private lostResponse = false;

  constructor(options: FixtureChainOptions) {
    this.genesisHash = options.genesisHash;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.slot = options.initialSlot ?? 4242;
    this.blockHeight = this.slot;
    for (const [programId, label] of [
      [SYSTEM_PROGRAM_ID, 'system'],
      [COMPUTE_BUDGET_PROGRAM_ID, 'compute-budget'],
      [ASSOCIATED_TOKEN_PROGRAM_ID, 'associated-token-account'],
      [SPL_TOKEN_PROGRAM_ID, 'spl-token'],
      [TOKEN_2022_PROGRAM_ID, 'token-2022'],
    ] as const) {
      this.accounts.set(programId, {
        owner: 'NativeLoader1111111111111111111111111111111',
        lamports: 1n,
        data: new Uint8Array(0),
        executable: true,
      });
      this.programs.set(programId, { executor: () => undefined, label });
    }
  }

  get currentSlot(): number {
    return this.slot;
  }

  get currentBlockHeight(): number {
    return this.blockHeight;
  }

  /* ------------------------------------------------------------ programs */

  /** Make a program id executable with the given semantics. */
  registerProgram(programId: string, executor: ProgramExecutor, label = programId): void {
    pubkeyBytes(programId);
    this.accounts.set(programId, {
      owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
      lamports: 1n,
      data: new Uint8Array(0),
      executable: true,
    });
    this.programs.set(programId, { executor, label });
  }

  /* ------------------------------------------------------------ accounts */

  /** Give an address lamports (a system account). */
  fund(address: string, lamports: bigint): void {
    pubkeyBytes(address);
    const existing = this.accounts.get(address);
    this.accounts.set(address, {
      owner: existing?.owner ?? SYSTEM_PROGRAM_ID,
      lamports: (existing?.lamports ?? 0n) + lamports,
      data: existing?.data ?? new Uint8Array(0),
      executable: false,
    });
  }

  /** Set an address's lamports exactly. */
  setLamports(address: string, lamports: bigint): void {
    pubkeyBytes(address);
    const existing = this.accounts.get(address);
    this.accounts.set(address, {
      owner: existing?.owner ?? SYSTEM_PROGRAM_ID,
      lamports,
      data: existing?.data ?? new Uint8Array(0),
      executable: existing?.executable ?? false,
    });
  }

  account(address: string): ChainAccount | null {
    return this.accounts.get(address) ?? null;
  }

  setAccount(address: string, account: ChainAccount): void {
    pubkeyBytes(address);
    this.accounts.set(address, account);
  }

  /** Every account a program owns, as `getProgramAccounts` would list them. */
  programAccounts(
    programId: string,
  ): readonly { readonly pubkey: string; readonly account: ChainAccount }[] {
    return [...this.accounts.entries()]
      .filter(([, account]) => account.owner === programId)
      .map(([pubkey, account]) => ({ pubkey, account }));
  }

  /* --------------------------------------------------------------- tokens */

  /** Tell the chain about a mint: its decimals and token program, and optionally its account bytes. */
  registerMint(
    mint: string,
    info: { readonly decimals: number; readonly tokenProgram: string; readonly data?: Uint8Array },
  ): void {
    pubkeyBytes(mint);
    this.mints.set(mint, { decimals: info.decimals, tokenProgram: info.tokenProgram });
    if (info.data) {
      this.accounts.set(mint, {
        owner: info.tokenProgram,
        lamports: rentExemptMinimum(info.data.length),
        data: info.data,
        executable: false,
      });
    }
  }

  mintInfo(mint: string): MintInfo | null {
    return this.mints.get(mint) ?? null;
  }

  /** The associated token account address of an owner for a registered mint. */
  tokenAccountAddress(owner: string, mint: string): string {
    const info = this.mints.get(mint);
    if (!info) {
      throw new Error(`mint ${mint} is not registered with the fixture chain`);
    }
    return associatedTokenAddress(owner, mint, info.tokenProgram).address;
  }

  /** Set the owner's associated token account balance exactly, creating the account when needed. */
  setTokenBalance(owner: string, mint: string, amount: bigint): void {
    const info = this.mints.get(mint);
    if (!info) {
      throw new Error(`mint ${mint} is not registered with the fixture chain`);
    }
    const address = this.tokenAccountAddress(owner, mint);
    this.accounts.set(address, {
      owner: info.tokenProgram,
      lamports: rentExemptMinimum(TOKEN_ACCOUNT_LENGTH),
      data: encodeTokenAccount({ mint, owner, amount }),
      executable: false,
    });
  }

  tokenBalance(owner: string, mint: string): bigint {
    return this.tokenAccountsByOwner(owner, { mint }).reduce(
      (sum, entry) => sum + entry.account.amount,
      0n,
    );
  }

  tokenAccountsByOwner(
    owner: string,
    filter: { readonly mint?: string; readonly programId?: string } = {},
  ): readonly {
    readonly pubkey: string;
    readonly account: ReturnType<typeof decodeTokenAccount>;
    readonly raw: ChainAccount;
  }[] {
    const out: {
      readonly pubkey: string;
      readonly account: ReturnType<typeof decodeTokenAccount>;
      readonly raw: ChainAccount;
    }[] = [];
    for (const [pubkey, raw] of this.accounts) {
      if (!isTokenProgram(raw.owner) || !looksLikeTokenAccount(raw.data)) {
        continue;
      }
      if (filter.programId && raw.owner !== filter.programId) {
        continue;
      }
      let account: ReturnType<typeof decodeTokenAccount>;
      try {
        account = decodeTokenAccount(raw.data);
      } catch {
        continue;
      }
      if (account.owner !== owner || (filter.mint && account.mint !== filter.mint)) {
        continue;
      }
      out.push({ pubkey, account, raw });
    }
    return out;
  }

  /* -------------------------------------------------------------- chain */

  transaction(signature: string): ChainTransaction | null {
    return this.transactions.get(signature) ?? null;
  }

  /** Advance the chain; confirmation levels follow from the distance to each landing slot. */
  advance(slots = 1): void {
    this.slot += slots;
    this.blockHeight += slots;
  }

  /** Schedule a one-shot fault for the next submission this fee payer pays for. */
  scheduleFault(feePayer: string, fault: PayerFault): void {
    this.payerFaults.set(feePayer, fault);
  }

  /** True once after a submission whose fee payer asked for its response to be lost. */
  takeLostResponse(): boolean {
    const lost = this.lostResponse;
    this.lostResponse = false;
    return lost;
  }

  /** Advance far enough for everything landed so far to be finalized. */
  finalize(): void {
    this.advance(FINALITY_DEPTH);
  }

  latestBlockhash(): { readonly blockhash: string; readonly lastValidBlockHeight: number } {
    const blockhash = encodeBase58(new Uint8Array(randomBytes(32)));
    const lastValidBlockHeight = this.blockHeight + BLOCKHASH_VALIDITY;
    this.blockhashes.set(blockhash, { lastValidBlockHeight });
    return { blockhash, lastValidBlockHeight };
  }

  isBlockhashValid(blockhash: string): boolean {
    const known = this.blockhashes.get(blockhash);
    return known !== undefined && known.lastValidBlockHeight >= this.blockHeight;
  }

  confirmationStatus(landed: ChainTransaction): 'processed' | 'confirmed' | 'finalized' {
    const depth = this.slot - landed.slot;
    if (depth >= FINALITY_DEPTH) {
      return 'finalized';
    }
    return depth >= 1 ? 'confirmed' : 'processed';
  }

  signatureStatus(signature: string): {
    readonly slot: number;
    readonly confirmations: number | null;
    readonly err: ChainError | null;
    readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  } | null {
    const landed = this.transactions.get(signature);
    if (!landed) {
      return null;
    }
    const status = this.confirmationStatus(landed);
    return {
      slot: landed.slot,
      confirmations: status === 'finalized' ? null : this.slot - landed.slot,
      err: landed.err,
      confirmationStatus: status,
    };
  }

  /* ---------------------------------------------------------- execution */

  private parse(transactionBase64: string): Transaction {
    try {
      return parseTransaction(base64ToBytes(transactionBase64));
    } catch (error) {
      throw new ChainRpcError({
        code: -32602,
        message: `invalid transaction: ${error instanceof Error ? error.message : 'unparseable'}`,
      });
    }
  }

  private lookupTables(parsed: Transaction): Map<string, readonly string[]> {
    const tables = new Map<string, readonly string[]>();
    if (parsed.message.version === 0) {
      for (const lookup of parsed.message.addressTableLookups) {
        const account = this.accounts.get(lookup.accountKey);
        if (!account) {
          throw new ProgramFailure('AddressLookupTableNotFound', []);
        }
        try {
          tables.set(lookup.accountKey, decodeAddressLookupTable(account.data).addresses);
        } catch {
          throw new ProgramFailure('InvalidAddressLookupTableData', []);
        }
      }
    }
    return tables;
  }

  private feeFor(parsed: Transaction, budget: ComputeBudget, instructionCount: number): bigint {
    const base = LAMPORTS_PER_SIGNATURE * BigInt(parsed.signatures.length);
    const limit = BigInt(
      budget.unitLimit ??
        Math.min(MAX_COMPUTE_UNITS, DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION * instructionCount),
    );
    const priority = (limit * budget.unitPriceMicroLamports + 999_999n) / 1_000_000n;
    return base + priority;
  }

  /**
   * Run every instruction on an overlay of the state. Throws `ProgramFailure`
   * when an instruction fails; nothing is written to the chain here.
   */
  private execute(parsed: Transaction): {
    readonly accounts: readonly ResolvedAccount[];
    readonly writes: Map<string, ChainAccount>;
    readonly logs: string[];
    readonly unitsConsumed: number;
    readonly budget: ComputeBudget;
  } {
    const tables = this.lookupTables(parsed);
    let accounts: readonly ResolvedAccount[];
    let instructions: readonly ResolvedInstruction[];
    try {
      accounts = resolveMessageAccounts(parsed.message, tables);
      instructions = resolveInstructions(parsed.message, accounts);
    } catch {
      throw new ProgramFailure('InvalidAddressLookupTableIndex', []);
    }
    const writes = new Map<string, ChainAccount>();
    const logs: string[] = [];
    const budget: ComputeBudget = {
      unitLimit: null,
      unitPriceMicroLamports: 0n,
      heapFrameBytes: null,
    };
    let unitsConsumed = 0;
    const read = (address: string) => writes.get(address) ?? this.accounts.get(address) ?? null;
    for (const instruction of instructions) {
      const program = this.programs.get(instruction.programId);
      const programAccount = read(instruction.programId);
      if (!program || !programAccount?.executable) {
        throw new ProgramFailure('ProgramAccountNotFound', [
          ...logs,
          `fixture chain: ${instruction.programId} is not an executable program here`,
        ]);
      }
      const depth = `Program ${instruction.programId} invoke [1]`;
      logs.push(depth);
      const ctx: ProgramContext = {
        programId: instruction.programId,
        instructionIndex: instruction.index,
        accounts: instruction.accounts,
        data: instruction.data,
        slot: this.slot,
        blockHeight: this.blockHeight,
        unixTime: this.now(),
        isSigner: (address) => accounts.some((entry) => entry.pubkey === address && entry.isSigner),
        isWritable: (address) =>
          accounts.some((entry) => entry.pubkey === address && entry.isWritable),
        read,
        write: (address, account) => {
          writes.set(address, account);
        },
        log: (line) => {
          logs.push(line);
        },
        fail: (error, reason) => {
          if (typeof error === 'number') {
            if (reason) {
              logs.push(
                `Program log: AnchorError occurred. Error Code: ${reason}. Error Number: ${error}.`,
              );
            }
            logs.push(
              `Program ${instruction.programId} failed: custom program error: ${hexCode(error)}`,
            );
            throw new ProgramFailure(customError(instruction.index, error), logs);
          }
          logs.push(`Program ${instruction.programId} failed: ${reason ?? error}`);
          throw new ProgramFailure({ InstructionError: [instruction.index, error] }, logs);
        },
        mintDecimals: (mint) => this.decimalsOf(mint, read),
      };
      this.builtin(ctx, budget) || program.executor(ctx);
      unitsConsumed +=
        this.programs.has(instruction.programId) && this.isBuiltin(instruction.programId)
          ? 150
          : 20_000;
      logs.push(`Program ${instruction.programId} success`);
    }
    const limit =
      budget.unitLimit ??
      Math.min(MAX_COMPUTE_UNITS, DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION * instructions.length);
    if (unitsConsumed > limit) {
      throw new ProgramFailure(
        { InstructionError: [instructions.length - 1, 'ComputationalBudgetExceeded'] },
        logs,
      );
    }
    return { accounts, writes, logs, unitsConsumed, budget };
  }

  private isBuiltin(programId: string): boolean {
    return (
      programId === SYSTEM_PROGRAM_ID ||
      programId === COMPUTE_BUDGET_PROGRAM_ID ||
      programId === ASSOCIATED_TOKEN_PROGRAM_ID ||
      isTokenProgram(programId)
    );
  }

  private decimalsOf(mint: string, read: (address: string) => ChainAccount | null): number | null {
    const registered = this.mints.get(mint);
    if (registered) {
      return registered.decimals;
    }
    const account = read(mint);
    if (account && isTokenProgram(account.owner) && account.data.length >= 45) {
      return account.data[44] as number; // spl-token Mint layout: decimals at offset 44
    }
    return null;
  }

  /** Built-in programs; answers false when the program is not one of them. */
  private builtin(ctx: ProgramContext, budget: ComputeBudget): boolean {
    switch (ctx.programId) {
      case SYSTEM_PROGRAM_ID:
        this.executeSystem(ctx);
        return true;
      case COMPUTE_BUDGET_PROGRAM_ID:
        this.executeComputeBudget(ctx, budget);
        return true;
      case ASSOCIATED_TOKEN_PROGRAM_ID:
        this.executeAssociatedToken(ctx);
        return true;
      case SPL_TOKEN_PROGRAM_ID:
      case TOKEN_2022_PROGRAM_ID:
        this.executeToken(ctx);
        return true;
      default:
        return false;
    }
  }

  private executeSystem(ctx: ProgramContext): void {
    if (ctx.data.length < 4) {
      ctx.fail('InvalidInstructionData');
    }
    const variant = u32le(ctx.data, 0);
    if (variant !== 2 || ctx.data.length !== 12) {
      // Only `Transfer` is modelled; account creation happens through the ATA program here.
      ctx.fail('InvalidInstructionData', 'fixture chain models system transfers only');
    }
    const lamports = u64le(ctx.data, 4);
    const [from, to] = ctx.accounts;
    if (!from || !to) {
      ctx.fail('NotEnoughAccountKeys');
    }
    if (!ctx.isSigner(from.pubkey)) {
      ctx.fail('MissingRequiredSignature');
    }
    const source = ctx.read(from.pubkey);
    if (!source || source.lamports < lamports) {
      ctx.log('Program log: Transfer: insufficient lamports');
      ctx.fail(1, 'InsufficientFunds');
    }
    if (source.owner !== SYSTEM_PROGRAM_ID) {
      ctx.fail('InvalidAccountOwner');
    }
    const destination = ctx.read(to.pubkey) ?? {
      owner: SYSTEM_PROGRAM_ID,
      lamports: 0n,
      data: new Uint8Array(0),
      executable: false,
    };
    ctx.write(from.pubkey, { ...source, lamports: source.lamports - lamports });
    ctx.write(to.pubkey, { ...destination, lamports: destination.lamports + lamports });
  }

  private executeComputeBudget(ctx: ProgramContext, budget: ComputeBudget): void {
    const variant = ctx.data[0];
    if (variant === 2 && ctx.data.length === 5) {
      budget.unitLimit = Math.min(MAX_COMPUTE_UNITS, u32le(ctx.data, 1));
      return;
    }
    if (variant === 3 && ctx.data.length === 9) {
      budget.unitPriceMicroLamports = u64le(ctx.data, 1);
      return;
    }
    if (variant === 1 && ctx.data.length === 5) {
      budget.heapFrameBytes = u32le(ctx.data, 1);
      return;
    }
    ctx.fail('InvalidInstructionData');
  }

  private executeAssociatedToken(ctx: ProgramContext): void {
    const variant = ctx.data.length === 0 ? 0 : ctx.data[0];
    if (variant !== 0 && variant !== 1) {
      ctx.fail('InvalidInstructionData', 'fixture chain models Create and CreateIdempotent only');
    }
    const [payer, ata, owner, mint, systemProgram, tokenProgram] = ctx.accounts;
    if (!payer || !ata || !owner || !mint || !systemProgram || !tokenProgram) {
      ctx.fail('NotEnoughAccountKeys');
    }
    if (systemProgram.pubkey !== SYSTEM_PROGRAM_ID || !isTokenProgram(tokenProgram.pubkey)) {
      ctx.fail('IncorrectProgramId');
    }
    if (!ctx.isSigner(payer.pubkey)) {
      ctx.fail('MissingRequiredSignature');
    }
    const expected = associatedTokenAddress(owner.pubkey, mint.pubkey, tokenProgram.pubkey).address;
    if (ata.pubkey !== expected) {
      ctx.fail('InvalidSeeds', 'associated token address does not match owner and mint');
    }
    const mintInfo = this.mints.get(mint.pubkey);
    const mintAccount = ctx.read(mint.pubkey);
    if (!mintInfo && !(mintAccount && mintAccount.owner === tokenProgram.pubkey)) {
      ctx.fail('IncorrectProgramId', 'mint is unknown or owned by another token program');
    }
    if (mintInfo && mintInfo.tokenProgram !== tokenProgram.pubkey) {
      ctx.fail('IncorrectProgramId', 'mint belongs to the other token program');
    }
    const existing = ctx.read(ata.pubkey);
    if (existing && existing.data.length > 0) {
      if (variant === 1) {
        try {
          const decoded = decodeTokenAccount(existing.data);
          if (decoded.mint === mint.pubkey && decoded.owner === owner.pubkey) {
            return; // idempotent create of an existing account
          }
        } catch {
          // falls through to the failure below
        }
        ctx.fail('IllegalOwner', 'existing account is not the associated token account');
      }
      ctx.log(
        `Program log: Allocate: account Address { address: ${ata.pubkey}, base: None } already in use`,
      );
      ctx.fail(0, 'already in use');
    }
    const rent = rentExemptMinimum(TOKEN_ACCOUNT_LENGTH);
    const payerAccount = ctx.read(payer.pubkey);
    if (!payerAccount || payerAccount.lamports < rent) {
      ctx.log(`Program log: Transfer: insufficient lamports, need ${rent}`);
      ctx.fail(1, 'InsufficientFunds');
    }
    ctx.write(payer.pubkey, { ...payerAccount, lamports: payerAccount.lamports - rent });
    ctx.write(ata.pubkey, {
      owner: tokenProgram.pubkey,
      lamports: rent,
      data: encodeTokenAccount({ mint: mint.pubkey, owner: owner.pubkey, amount: 0n }),
      executable: false,
    });
  }

  private executeToken(ctx: ProgramContext): void {
    const variant = ctx.data[0];
    let amount: bigint;
    let source: ResolvedAccount | undefined;
    let destination: ResolvedAccount | undefined;
    let authority: ResolvedAccount | undefined;
    let mint: ResolvedAccount | undefined;
    let decimals: number | null = null;
    if (variant === 3 && ctx.data.length === 9) {
      amount = u64le(ctx.data, 1);
      [source, destination, authority] = ctx.accounts;
    } else if (variant === 12 && ctx.data.length === 10) {
      amount = u64le(ctx.data, 1);
      decimals = ctx.data[9] as number;
      [source, mint, destination, authority] = ctx.accounts;
    } else {
      ctx.fail(
        'InvalidInstructionData',
        'fixture chain models Transfer and TransferChecked only; approvals, authority changes and closures are refused',
      );
    }
    if (!source || !destination || !authority) {
      ctx.fail('NotEnoughAccountKeys');
    }
    const sourceAccount = ctx.read(source.pubkey);
    const destinationAccount = ctx.read(destination.pubkey);
    if (!sourceAccount || !destinationAccount) {
      ctx.fail('AccountNotFound');
    }
    if (sourceAccount.owner !== ctx.programId || destinationAccount.owner !== ctx.programId) {
      ctx.fail('IncorrectProgramId');
    }
    let from: ReturnType<typeof decodeTokenAccount>;
    let to: ReturnType<typeof decodeTokenAccount>;
    try {
      from = decodeTokenAccount(sourceAccount.data);
      to = decodeTokenAccount(destinationAccount.data);
    } catch {
      ctx.fail('InvalidAccountData');
    }
    if (from.owner !== authority.pubkey || !ctx.isSigner(authority.pubkey)) {
      ctx.fail(4, 'OwnerMismatch');
    }
    if (from.mint !== to.mint || (mint && mint.pubkey !== from.mint)) {
      ctx.fail(3, 'MintMismatch');
    }
    if (decimals !== null && ctx.mintDecimals(from.mint) !== decimals) {
      ctx.fail(18, 'MintDecimalsMismatch');
    }
    if (from.amount < amount) {
      ctx.fail(1, 'InsufficientFunds');
    }
    if (source.pubkey === destination.pubkey) {
      return;
    }
    ctx.write(source.pubkey, {
      ...sourceAccount,
      data: encodeTokenAccount({ ...from, amount: from.amount - amount }),
    });
    ctx.write(destination.pubkey, {
      ...destinationAccount,
      data: encodeTokenAccount({ ...to, amount: to.amount + amount }),
    });
  }

  private tokenBalancesOf(
    keys: readonly string[],
    read: (address: string) => ChainAccount | null,
  ): TokenBalanceRecord[] {
    const out: TokenBalanceRecord[] = [];
    keys.forEach((pubkey, accountIndex) => {
      const account = read(pubkey);
      if (!account || !isTokenProgram(account.owner) || !looksLikeTokenAccount(account.data)) {
        return;
      }
      try {
        const decoded = decodeTokenAccount(account.data);
        out.push({
          accountIndex,
          mint: decoded.mint,
          owner: decoded.owner,
          programId: account.owner,
          amount: decoded.amount,
          decimals: this.decimalsOf(decoded.mint, read) ?? 0,
        });
      } catch {
        // not a token account after all
      }
    });
    return out;
  }

  private preflight(
    parsed: Transaction,
    options: { readonly sigVerify: boolean; readonly checkBlockhash: boolean },
  ) {
    if (options.sigVerify && !verifyTransactionSignatures(parsed).allValid) {
      throw new ChainRpcError({
        code: -32003,
        message: 'Transaction signature verification failure',
      });
    }
    if (options.checkBlockhash && !this.isBlockhashValid(parsed.message.recentBlockhash)) {
      throw new ChainRpcError({
        code: -32002,
        message: 'Transaction simulation failed: Blockhash not found',
        data: { err: 'BlockhashNotFound', logs: [] },
      });
    }
  }

  private simulationError(error: ProgramFailure, unitsConsumed = 0): ChainRpcError {
    const detail =
      typeof error.err === 'object' && 'InstructionError' in error.err
        ? typeof error.err.InstructionError[1] === 'object'
          ? `Error processing Instruction ${error.err.InstructionError[0]}: custom program error: ${hexCode(error.err.InstructionError[1].Custom)}`
          : `Error processing Instruction ${error.err.InstructionError[0]}: ${error.err.InstructionError[1]}`
        : error.err;
    return new ChainRpcError({
      code: -32002,
      message: `Transaction simulation failed: ${detail}`,
      data: { err: error.err, logs: error.logs, unitsConsumed },
    });
  }

  /**
   * Submit a wire transaction (base64) with preflight: signatures, blockhash
   * and fee-payer balance are checked, then every instruction is executed on
   * a copy of the state; a failing program leaves nothing behind and the
   * call answers the simulation error, as a node would.
   */
  send(transactionBase64: string, options: { readonly skipPreflight?: boolean } = {}): string {
    this.requireOnline();
    const parsed = this.parse(transactionBase64);
    this.preflight(parsed, { sigVerify: true, checkBlockhash: true });
    const signature = transactionSignature(parsed);
    if (this.transactions.has(signature)) {
      return signature; // an identical resend is idempotent
    }
    const feePayer = parsed.message.accountKeys[0] as string;
    const payerAccount = this.accounts.get(feePayer);
    const minimumFee = LAMPORTS_PER_SIGNATURE * BigInt(parsed.signatures.length);
    if (!payerAccount || payerAccount.lamports < minimumFee) {
      throw new ChainRpcError({
        code: -32002,
        message:
          'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.',
        data: { err: 'AccountNotFound', logs: [] },
      });
    }
    let outcome: ReturnType<FixtureChain['execute']>;
    try {
      outcome = this.execute(parsed);
    } catch (error) {
      if (error instanceof ProgramFailure && !options.skipPreflight) {
        throw this.simulationError(error);
      }
      if (error instanceof ProgramFailure) {
        // Skipped preflight: the transaction lands with the error and pays its fee.
        const accounts = this.safeResolve(parsed);
        const budget: ComputeBudget = {
          unitLimit: null,
          unitPriceMicroLamports: 0n,
          heapFrameBytes: null,
        };
        this.land(
          parsed,
          accounts,
          signature,
          this.feeFor(parsed, budget, parsed.message.instructions.length),
          error.err,
          error.logs,
          new Map(),
          0,
        );
        return signature;
      }
      throw error;
    }
    const fee = this.feeFor(parsed, outcome.budget, parsed.message.instructions.length);
    if (payerAccount.lamports < fee) {
      throw new ChainRpcError({
        code: -32002,
        message: 'Transaction simulation failed: Insufficient funds for fee',
        data: { err: 'InsufficientFundsForFee', logs: [] },
      });
    }
    const scoped = this.payerFaults.get(feePayer);
    this.payerFaults.delete(feePayer);
    if (scoped?.kind === 'lose-response') {
      this.lostResponse = true;
    }
    if (scoped?.kind === 'drop' || this.dropNext) {
      if (scoped?.kind !== 'drop') this.dropNext = false;
      return signature; // accepted by the node, never lands
    }
    const errorCode = scoped?.kind === 'land-error' ? scoped.code : this.landNextWithError;
    if (errorCode !== null) {
      if (scoped?.kind !== 'land-error') this.landNextWithError = null;
      const code = errorCode;
      const last = parsed.message.instructions.length - 1;
      this.land(
        parsed,
        outcome.accounts,
        signature,
        fee,
        customError(last, code),
        [...outcome.logs, `Program failed: custom program error: ${hexCode(code)}`],
        new Map(),
        outcome.unitsConsumed,
      );
      return signature;
    }
    this.land(
      parsed,
      outcome.accounts,
      signature,
      fee,
      null,
      outcome.logs,
      outcome.writes,
      outcome.unitsConsumed,
    );
    return signature;
  }

  /** Execute without landing; the shape `simulateTransaction` answers. */
  simulate(
    transactionBase64: string,
    options: { readonly sigVerify?: boolean; readonly replaceRecentBlockhash?: boolean } = {},
  ): {
    readonly err: ChainError | null;
    readonly logs: readonly string[];
    readonly unitsConsumed: number;
  } {
    this.requireOnline();
    const parsed = this.parse(transactionBase64);
    if (options.sigVerify && options.replaceRecentBlockhash) {
      throw new ChainRpcError({
        code: -32602,
        message: 'sigVerify may not be used with replaceRecentBlockhash',
      });
    }
    try {
      this.preflight(parsed, {
        sigVerify: options.sigVerify === true,
        checkBlockhash: options.replaceRecentBlockhash !== true,
      });
    } catch (error) {
      if (error instanceof ChainRpcError && error.rpcError.code === -32002) {
        return { err: 'BlockhashNotFound', logs: [], unitsConsumed: 0 };
      }
      throw error;
    }
    try {
      const outcome = this.execute(parsed);
      return { err: null, logs: outcome.logs, unitsConsumed: outcome.unitsConsumed };
    } catch (error) {
      if (error instanceof ProgramFailure) {
        return { err: error.err, logs: error.logs, unitsConsumed: 0 };
      }
      throw error;
    }
  }

  private safeResolve(parsed: Transaction): readonly ResolvedAccount[] {
    try {
      return resolveMessageAccounts(parsed.message, this.lookupTables(parsed));
    } catch {
      return resolveMessageAccounts({
        ...parsed.message,
        version: 'legacy',
      } as Transaction['message']);
    }
  }

  private land(
    parsed: Transaction,
    accounts: readonly ResolvedAccount[],
    signature: string,
    fee: bigint,
    err: ChainError | null,
    logs: readonly string[],
    writes: Map<string, ChainAccount>,
    unitsConsumed: number,
  ): void {
    const keys = accounts.map((entry) => entry.pubkey);
    const readBefore = (address: string) => this.accounts.get(address) ?? null;
    const preBalances = keys.map((key) => readBefore(key)?.lamports ?? 0n);
    const preTokenBalances = this.tokenBalancesOf(keys, readBefore);
    for (const [address, account] of writes) {
      this.accounts.set(address, account);
    }
    const feePayer = parsed.message.accountKeys[0] as string;
    const payer = this.accounts.get(feePayer) as ChainAccount;
    this.accounts.set(feePayer, { ...payer, lamports: payer.lamports - fee });
    const readAfter = (address: string) => this.accounts.get(address) ?? null;
    const postBalances = keys.map((key) => readAfter(key)?.lamports ?? 0n);
    const postTokenBalances = this.tokenBalancesOf(keys, readAfter);
    const loadedWritable = accounts
      .filter((a) => a.source === 'lookup' && a.isWritable)
      .map((a) => a.pubkey);
    const loadedReadonly = accounts
      .filter((a) => a.source === 'lookup' && !a.isWritable)
      .map((a) => a.pubkey);
    this.transactions.set(signature, {
      signature,
      slot: this.slot,
      blockHeight: this.blockHeight,
      blockTime: this.now(),
      err,
      logs,
      accountKeys: keys,
      staticKeys: parsed.message.accountKeys,
      loadedWritable,
      loadedReadonly,
      version: parsed.message.version,
      fee,
      preBalances,
      postBalances,
      preTokenBalances,
      postTokenBalances,
      computeUnitsConsumed: unitsConsumed,
    });
  }

  private requireOnline(): void {
    if (this.outage) {
      throw new ChainRpcError({ code: -32005, message: 'Node is unhealthy' });
    }
  }

  /* ------------------------------------------------------------- JSON-RPC */

  /**
   * Answer a JSON-RPC method with the shapes agave returns, or an
   * `{ rpcError }` object. Wire it into any JSON-RPC stand-in.
   */
  handle(method: string, params: unknown): unknown {
    try {
      return this.dispatch(method, Array.isArray(params) ? params : []);
    } catch (error) {
      if (error instanceof ChainRpcError) {
        return { rpcError: error.rpcError };
      }
      throw error;
    }
  }

  private accountValue(account: ChainAccount) {
    return {
      data: [bytesToBase64(account.data), 'base64'],
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.owner,
      rentEpoch: 0,
      space: account.data.length,
    };
  }

  private tokenBalanceValue(record: TokenBalanceRecord) {
    const whole = record.amount / 10n ** BigInt(record.decimals);
    const fraction = (record.amount % 10n ** BigInt(record.decimals))
      .toString()
      .padStart(record.decimals, '0');
    const uiAmountString =
      record.decimals === 0
        ? whole.toString()
        : `${whole}.${fraction}`.replace(/\.?0+$/, '') || '0';
    return {
      accountIndex: record.accountIndex,
      mint: record.mint,
      owner: record.owner,
      programId: record.programId,
      uiTokenAmount: {
        amount: record.amount.toString(),
        decimals: record.decimals,
        uiAmount: Number(uiAmountString),
        uiAmountString,
      },
    };
  }

  private dispatch(method: string, params: readonly unknown[]): unknown {
    const context = { slot: this.slot };
    switch (method) {
      case 'getGenesisHash':
        return this.genesisHash;
      case 'getHealth':
        this.requireOnline();
        return 'ok';
      case 'getVersion':
        return { 'solana-core': 'fixture-chain' };
      case 'getSlot':
        this.requireOnline();
        return this.slot;
      case 'getBlockHeight':
        this.requireOnline();
        return this.blockHeight;
      case 'getMinimumBalanceForRentExemption':
        this.requireOnline();
        return Number(rentExemptMinimum(Number(params[0] ?? 0)));
      case 'getBalance': {
        this.requireOnline();
        const account = this.accounts.get(String(params[0]));
        return { context, value: account ? Number(account.lamports) : 0 };
      }
      case 'getLatestBlockhash': {
        this.requireOnline();
        return { context, value: this.latestBlockhash() };
      }
      case 'isBlockhashValid':
        this.requireOnline();
        return { context, value: this.isBlockhashValid(String(params[0])) };
      case 'sendTransaction': {
        const config = (params[1] ?? {}) as { encoding?: string; skipPreflight?: boolean };
        if (config.encoding !== 'base64') {
          throw new ChainRpcError({
            code: -32602,
            message: 'fixture chain accepts base64-encoded transactions only',
          });
        }
        return this.send(String(params[0]), { skipPreflight: config.skipPreflight === true });
      }
      case 'simulateTransaction': {
        const config = (params[1] ?? {}) as {
          encoding?: string;
          sigVerify?: boolean;
          replaceRecentBlockhash?: boolean;
        };
        if (config.encoding !== 'base64') {
          throw new ChainRpcError({
            code: -32602,
            message: 'fixture chain accepts base64-encoded transactions only',
          });
        }
        const outcome = this.simulate(String(params[0]), {
          sigVerify: config.sigVerify === true,
          replaceRecentBlockhash: config.replaceRecentBlockhash === true,
        });
        return {
          context,
          value: {
            err: outcome.err,
            logs: outcome.logs,
            unitsConsumed: outcome.unitsConsumed,
            accounts: null,
            returnData: null,
            innerInstructions: null,
          },
        };
      }
      case 'getSignatureStatuses': {
        this.requireOnline();
        const signatures = Array.isArray(params[0]) ? (params[0] as unknown[]) : [];
        return {
          context,
          value: signatures.map((signature) => {
            const status = this.signatureStatus(String(signature));
            return status
              ? { ...status, status: status.err ? { Err: status.err } : { Ok: null } }
              : null;
          }),
        };
      }
      case 'getTransaction': {
        this.requireOnline();
        const landed = this.transactions.get(String(params[0]));
        if (!landed) {
          return null;
        }
        return {
          slot: landed.slot,
          blockTime: landed.blockTime,
          meta: {
            err: landed.err,
            fee: Number(landed.fee),
            logMessages: landed.logs,
            status: landed.err ? { Err: landed.err } : { Ok: null },
            preBalances: landed.preBalances.map(Number),
            postBalances: landed.postBalances.map(Number),
            preTokenBalances: landed.preTokenBalances.map((record) =>
              this.tokenBalanceValue(record),
            ),
            postTokenBalances: landed.postTokenBalances.map((record) =>
              this.tokenBalanceValue(record),
            ),
            computeUnitsConsumed: landed.computeUnitsConsumed,
            loadedAddresses: { writable: landed.loadedWritable, readonly: landed.loadedReadonly },
            innerInstructions: [],
            rewards: [],
          },
          transaction: {
            signatures: [landed.signature],
            message: { accountKeys: landed.staticKeys },
          },
          version: landed.version,
        };
      }
      case 'getAccountInfo': {
        this.requireOnline();
        const account = this.accounts.get(String(params[0]));
        return { context, value: account ? this.accountValue(account) : null };
      }
      case 'getMultipleAccounts': {
        this.requireOnline();
        const addresses = Array.isArray(params[0]) ? (params[0] as unknown[]) : [];
        return {
          context,
          value: addresses.map((address) => {
            const account = this.accounts.get(String(address));
            return account ? this.accountValue(account) : null;
          }),
        };
      }
      case 'getTokenAccountsByOwner': {
        this.requireOnline();
        const owner = String(params[0]);
        const filter = (params[1] ?? {}) as { mint?: string; programId?: string };
        const entries = this.tokenAccountsByOwner(owner, {
          ...(filter.mint ? { mint: filter.mint } : {}),
          ...(filter.programId ? { programId: filter.programId } : {}),
        });
        return {
          context,
          value: entries.map((entry) => ({
            pubkey: entry.pubkey,
            account: this.accountValue(entry.raw),
          })),
        };
      }
      case 'getProgramAccounts': {
        this.requireOnline();
        const programId = String(params[0]);
        const config = (params[1] ?? {}) as {
          filters?: { dataSize?: number; memcmp?: { offset: number; bytes: string } }[];
          withContext?: boolean;
        };
        const entries = [...this.accounts.entries()]
          .filter(([, account]) => account.owner === programId)
          .filter(([, account]) =>
            (config.filters ?? []).every((filter) => {
              if (filter.dataSize !== undefined && account.data.length !== filter.dataSize) {
                return false;
              }
              if (filter.memcmp) {
                const wanted = pubkeyBytesLoose(filter.memcmp.bytes);
                const slice = account.data.subarray(
                  filter.memcmp.offset,
                  filter.memcmp.offset + wanted.length,
                );
                return bytesEqual(slice, wanted);
              }
              return true;
            }),
          )
          .map(([pubkey, account]) => ({ pubkey, account: this.accountValue(account) }));
        return config.withContext ? { context, value: entries } : entries;
      }
      default:
        throw new ChainRpcError({ code: -32601, message: `method not found: ${method}` });
    }
  }
}

/** Base58 bytes of any length (memcmp filters carry a discriminator, not a key). */
function pubkeyBytesLoose(text: string): Uint8Array {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  let leading = 0;
  let counting = true;
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new ChainRpcError({ code: -32602, message: 'memcmp bytes are not base58' });
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

/**
 * A `fetch` stand-in that answers JSON-RPC requests from a chain, delegating
 * methods the chain does not know (catalog mint reads) to `fallback` when one
 * is given. For tests and the local fixture RPC only.
 */
export function fetchForChain(
  chain: FixtureChain,
  fallback?: (method: string, params: unknown) => unknown,
): typeof fetch {
  const answer = (method: string, params: unknown): unknown => {
    const own = chain.handle(method, params);
    if (!fallback) {
      return own;
    }
    const unknownMethod =
      typeof own === 'object' &&
      own !== null &&
      'rpcError' in own &&
      (own as { rpcError: { code: number } }).rpcError.code === -32601;
    if (unknownMethod) {
      return fallback(method, params);
    }
    const first = Array.isArray(params) ? String(params[0]) : '';
    if (method === 'getAccountInfo' && chain.account(first) === null) {
      // Chain accounts first, then whatever the fallback knows (fixture mints).
      return fallback(method, params);
    }
    return own;
  };
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown };
    const result = answer(body.method, body.params);
    if (body.method === 'sendTransaction') {
      const scopedLoss = chain.takeLostResponse();
      if (scopedLoss || chain.loseNextResponse) {
        if (!scopedLoss) chain.loseNextResponse = false;
        throw new TypeError('fetch failed: connection reset after the request was sent');
      }
    }
    const envelope =
      typeof result === 'object' && result !== null && 'rpcError' in result
        ? { jsonrpc: '2.0', id: body.id, error: (result as { rpcError: unknown }).rpcError }
        : { jsonrpc: '2.0', id: body.id, result };
    return new Response(JSON.stringify(envelope), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}
