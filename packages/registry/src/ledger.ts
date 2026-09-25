import { createHash, randomBytes } from 'node:crypto';
import { encodeBase58 } from '@markov/contracts';
import { base64ToBytes, bytesEqual, bytesToBase64 } from './bytes.js';
import {
  DISCRIMINATOR_LENGTH,
  decodeRegisterVersionData,
  decodeSetStatusData,
  decodeVersionRecord,
  encodeVersionRecord,
  RECORD_LAYOUT_VERSION,
  RECORD_SPACE,
  REGISTER_VERSION_DISCRIMINATOR,
  RELATIONS,
  recordAddress,
  SET_STATUS_DISCRIMINATOR,
  VERSION_RECORD_DISCRIMINATOR,
} from './layout.js';
import { pubkeyBytes, SYSTEM_PROGRAM_ID } from './pubkey.js';
import { checkRegisterArgs, registryErrorCode } from './rules.js';
import {
  parseTransaction,
  type Transaction,
  transactionSignature,
  verifyTransactionSignatures,
} from './transaction.js';

/**
 * An in-memory stand-in for the parts of a Solana cluster the publication
 * flow touches, executing the registry program's semantics (the same rules,
 * the same Anchor error codes, the same account bytes) so the API, the
 * indexer and the browser tests can be exercised without a validator.
 *
 * It is a fixture: FIXTURE_VERIFIED evidence only. The program's behaviour
 * under the real runtime is proven by `programs/strategy-registry/tests`,
 * and nothing here is reachable from a production configuration.
 */

/** Anchor framework error codes the program relies on. */
export const ANCHOR_ERRORS = {
  InstructionFallbackNotFound: 101,
  ConstraintSeeds: 2006,
  AccountDiscriminatorMismatch: 3002,
  AccountOwnedByWrongProgram: 3007,
  InvalidProgramId: 3008,
  AccountNotSigner: 3010,
  AccountNotInitialized: 3012,
} as const;

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

export interface LedgerAccount {
  readonly owner: string;
  readonly lamports: bigint;
  readonly data: Uint8Array;
  readonly executable: boolean;
}

export type LedgerError =
  | { readonly InstructionError: readonly [number, { readonly Custom: number } | string] }
  | string;

export interface LedgerTransaction {
  readonly signature: string;
  readonly slot: number;
  readonly blockHeight: number;
  readonly blockTime: number;
  readonly err: LedgerError | null;
  readonly logs: readonly string[];
  readonly accountKeys: readonly string[];
  readonly fee: bigint;
}

export interface RpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export class LedgerRpcError extends Error {
  readonly rpcError: RpcError;

  constructor(rpcError: RpcError) {
    super(rpcError.message);
    this.rpcError = rpcError;
  }
}

class ProgramFailure extends Error {
  constructor(
    readonly err: LedgerError,
    readonly logs: readonly string[],
  ) {
    super('program failure');
  }
}

export interface FixtureLedgerOptions {
  readonly programId: string;
  readonly genesisHash: string;
  readonly initialSlot?: number;
  /** Unix seconds; defaults to the wall clock. */
  readonly now?: () => number;
}

interface RegisteredBlockhash {
  readonly lastValidBlockHeight: number;
}

function customError(code: number): LedgerError {
  return { InstructionError: [0, { Custom: code }] };
}

function hexCode(code: number): string {
  return `0x${code.toString(16)}`;
}

export class FixtureLedger {
  readonly programId: string;
  readonly genesisHash: string;
  private readonly now: () => number;
  private slot: number;
  private blockHeight: number;
  private readonly accounts = new Map<string, LedgerAccount>();
  private readonly transactions = new Map<string, LedgerTransaction>();
  private readonly blockhashes = new Map<string, RegisteredBlockhash>();
  /** Test controls. */
  outage = false;
  dropNext = false;
  landNextWithError: number | null = null;
  /** The next `sendTransaction` executes, but its response is lost in transit (`fetchForLedger` throws). */
  loseNextResponse = false;

  constructor(options: FixtureLedgerOptions) {
    this.programId = options.programId;
    this.genesisHash = options.genesisHash;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.slot = options.initialSlot ?? 4242;
    this.blockHeight = this.slot;
    pubkeyBytes(this.programId);
    this.accounts.set(this.programId, {
      owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
      lamports: 1n,
      data: new Uint8Array(0),
      executable: true,
    });
  }

  get currentSlot(): number {
    return this.slot;
  }

  get currentBlockHeight(): number {
    return this.blockHeight;
  }

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

  account(address: string): LedgerAccount | null {
    return this.accounts.get(address) ?? null;
  }

  /** Every account the program owns, as `getProgramAccounts` would list them. */
  programAccounts(): readonly { readonly pubkey: string; readonly account: LedgerAccount }[] {
    return [...this.accounts.entries()]
      .filter(([, account]) => account.owner === this.programId)
      .map(([pubkey, account]) => ({ pubkey, account }));
  }

  transaction(signature: string): LedgerTransaction | null {
    return this.transactions.get(signature) ?? null;
  }

  /** Advance the chain; confirmation levels follow from the distance to each landing slot. */
  advance(slots = 1): void {
    this.slot += slots;
    this.blockHeight += slots;
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

  confirmationStatus(landed: LedgerTransaction): 'processed' | 'confirmed' | 'finalized' {
    const depth = this.slot - landed.slot;
    if (depth >= FINALITY_DEPTH) {
      return 'finalized';
    }
    return depth >= 1 ? 'confirmed' : 'processed';
  }

  signatureStatus(signature: string): {
    readonly slot: number;
    readonly confirmations: number | null;
    readonly err: LedgerError | null;
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

  /**
   * Submit a wire transaction (base64) with preflight: signatures, blockhash
   * and fee-payer balance are checked, then the instruction is executed on a
   * copy of the state; a failing program leaves nothing behind and the call
   * answers the simulation error, as a node would.
   */
  send(transactionBase64: string, options: { readonly skipPreflight?: boolean } = {}): string {
    this.requireOnline();
    let parsed: Transaction;
    try {
      parsed = parseTransaction(base64ToBytes(transactionBase64));
    } catch (error) {
      throw new LedgerRpcError({
        code: -32602,
        message: `invalid transaction: ${error instanceof Error ? error.message : 'unparseable'}`,
      });
    }
    if (!verifyTransactionSignatures(parsed).allValid) {
      throw new LedgerRpcError({
        code: -32003,
        message: 'Transaction signature verification failure',
      });
    }
    const signature = transactionSignature(parsed);
    if (this.transactions.has(signature)) {
      return signature; // an identical resend is idempotent
    }
    if (!this.isBlockhashValid(parsed.message.recentBlockhash)) {
      throw new LedgerRpcError({
        code: -32002,
        message: 'Transaction simulation failed: Blockhash not found',
        data: { err: 'BlockhashNotFound', logs: [] },
      });
    }
    const feePayer = parsed.message.accountKeys[0] as string;
    const fee = LAMPORTS_PER_SIGNATURE * BigInt(parsed.signatures.length);
    const payerAccount = this.accounts.get(feePayer);
    if (!payerAccount || payerAccount.lamports < fee) {
      throw new LedgerRpcError({
        code: -32002,
        message:
          'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.',
        data: { err: 'AccountNotFound', logs: [] },
      });
    }
    let outcome: { readonly writes: Map<string, LedgerAccount>; readonly logs: string[] };
    try {
      outcome = this.execute(parsed);
    } catch (error) {
      if (error instanceof ProgramFailure && !options.skipPreflight) {
        const detail =
          typeof error.err === 'object' && 'InstructionError' in error.err
            ? typeof error.err.InstructionError[1] === 'object'
              ? `custom program error: ${hexCode(error.err.InstructionError[1].Custom)}`
              : error.err.InstructionError[1]
            : error.err;
        throw new LedgerRpcError({
          code: -32002,
          message: `Transaction simulation failed: Error processing Instruction 0: ${detail}`,
          data: { err: error.err, logs: error.logs, unitsConsumed: 0 },
        });
      }
      if (error instanceof ProgramFailure) {
        outcome = { writes: new Map(), logs: [...error.logs] };
        this.land(parsed, signature, fee, error.err, outcome.logs);
        return signature;
      }
      throw error;
    }
    if (this.dropNext) {
      this.dropNext = false;
      return signature; // accepted by the node, never lands
    }
    if (this.landNextWithError !== null) {
      const code = this.landNextWithError;
      this.landNextWithError = null;
      this.land(parsed, signature, fee, customError(code), [
        `Program ${this.programId} failed: custom program error: ${hexCode(code)}`,
      ]);
      return signature;
    }
    for (const [address, account] of outcome.writes) {
      this.accounts.set(address, account);
    }
    this.land(parsed, signature, fee, null, outcome.logs);
    return signature;
  }

  private land(
    parsed: Transaction,
    signature: string,
    fee: bigint,
    err: LedgerError | null,
    logs: readonly string[],
  ): void {
    const feePayer = parsed.message.accountKeys[0] as string;
    const payer = this.accounts.get(feePayer) as LedgerAccount;
    this.accounts.set(feePayer, { ...payer, lamports: payer.lamports - fee });
    this.transactions.set(signature, {
      signature,
      slot: this.slot,
      blockHeight: this.blockHeight,
      blockTime: this.now(),
      err,
      logs,
      accountKeys: parsed.message.accountKeys,
      fee,
    });
  }

  private requireOnline(): void {
    if (this.outage) {
      throw new LedgerRpcError({ code: -32005, message: 'Node is unhealthy' });
    }
  }

  private execute(parsed: Transaction): {
    readonly writes: Map<string, LedgerAccount>;
    readonly logs: string[];
  } {
    const { message } = parsed;
    if (message.instructions.length !== 1) {
      throw new ProgramFailure('TooManyInstructions', [
        'fixture ledger: exactly one registry instruction per transaction',
      ]);
    }
    const instruction = message.instructions[0] as (typeof message.instructions)[number];
    const programId = message.accountKeys[instruction.programIdIndex];
    if (programId !== this.programId) {
      throw new ProgramFailure({ InstructionError: [0, 'IncorrectProgramId'] }, [
        `fixture ledger: unknown program ${programId}`,
      ]);
    }
    const keys = instruction.accountIndexes.map((index) => message.accountKeys[index] as string);
    const isSigner = (address: string) => {
      const index = message.accountKeys.indexOf(address);
      return index >= 0 && index < message.header.numRequiredSignatures;
    };
    const logs = [`Program ${this.programId} invoke [1]`];
    const fail = (code: number, reason: string): never => {
      logs.push(`Program log: AnchorError occurred. Error Code: ${reason}. Error Number: ${code}.`);
      logs.push(`Program ${this.programId} failed: custom program error: ${hexCode(code)}`);
      throw new ProgramFailure(customError(code), logs);
    };
    const discriminator = instruction.data.subarray(0, DISCRIMINATOR_LENGTH);
    const writes = new Map<string, LedgerAccount>();

    if (bytesEqual(discriminator, REGISTER_VERSION_DISCRIMINATOR)) {
      logs.push('Program log: Instruction: RegisterVersion');
      let args: ReturnType<typeof decodeRegisterVersionData>;
      try {
        args = decodeRegisterVersionData(instruction.data);
      } catch {
        throw new ProgramFailure({ InstructionError: [0, 'InvalidInstructionData'] }, logs);
      }
      const [publisher, record, parent, systemProgram] = keys;
      if (!publisher || !record || !parent || !systemProgram) {
        throw new ProgramFailure({ InstructionError: [0, 'NotEnoughAccountKeys'] }, logs);
      }
      if (!isSigner(publisher)) {
        fail(ANCHOR_ERRORS.AccountNotSigner, 'AccountNotSigner');
      }
      const expected = recordAddress(this.programId, args.manifestHash);
      if (record !== expected.address) {
        fail(ANCHOR_ERRORS.ConstraintSeeds, 'ConstraintSeeds');
      }
      if (systemProgram !== SYSTEM_PROGRAM_ID) {
        fail(ANCHOR_ERRORS.InvalidProgramId, 'InvalidProgramId');
      }
      let parentRecord: ReturnType<typeof decodeVersionRecord> | null = null;
      if (parent !== this.programId) {
        const account = this.accounts.get(parent);
        if (!account || account.data.length === 0) {
          fail(ANCHOR_ERRORS.AccountNotInitialized, 'AccountNotInitialized');
        }
        if ((account as LedgerAccount).owner !== this.programId) {
          fail(ANCHOR_ERRORS.AccountOwnedByWrongProgram, 'AccountOwnedByWrongProgram');
        }
        try {
          parentRecord = decodeVersionRecord((account as LedgerAccount).data);
        } catch {
          fail(ANCHOR_ERRORS.AccountDiscriminatorMismatch, 'AccountDiscriminatorMismatch');
        }
      }
      const existing = this.accounts.get(record);
      if (existing && (existing.lamports > 0n || existing.data.length > 0)) {
        logs.push(
          `Program log: Allocate: account Address { address: ${record}, base: None } already in use`,
        );
        logs.push(`Program ${this.programId} failed: custom program error: 0x0`);
        throw new ProgramFailure(customError(0), logs);
      }
      const rules = checkRegisterArgs(args);
      if (!rules.ok) {
        fail(rules.code, rules.error);
      }
      if (args.relation === RELATIONS.none) {
        if (parentRecord !== null) {
          fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
      } else {
        if (parentRecord === null) {
          fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
        if (
          !bytesEqual(
            (parentRecord as ReturnType<typeof decodeVersionRecord>).manifestHash,
            args.parentManifestHash,
          ) ||
          parent === record
        ) {
          fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
      }
      const rent = rentExemptMinimum(RECORD_SPACE);
      const payer = this.accounts.get(publisher) as LedgerAccount;
      if (payer.lamports < rent + LAMPORTS_PER_SIGNATURE) {
        logs.push(`Program log: Transfer: insufficient lamports ${payer.lamports}, need ${rent}`);
        throw new ProgramFailure(customError(1), logs);
      }
      writes.set(publisher, { ...payer, lamports: payer.lamports - rent });
      writes.set(record, {
        owner: this.programId,
        lamports: rent,
        executable: false,
        data: encodeVersionRecord({
          layoutVersion: RECORD_LAYOUT_VERSION,
          schemaVersion: args.schemaVersion,
          status: 0,
          bump: expected.bump,
          publisher,
          manifestHash: args.manifestHash,
          contentDigest: args.contentDigest,
          relation: args.relation,
          parentManifestHash: args.parentManifestHash,
          cashWeightBps: args.cashWeightBps,
          legs: args.legs,
          registeredSlot: BigInt(this.slot),
          registeredUnixTime: BigInt(this.now()),
          statusUpdatedSlot: BigInt(this.slot),
        }),
      });
      logs.push(`Program ${this.programId} success`);
      return { writes, logs };
    }

    if (bytesEqual(discriminator, SET_STATUS_DISCRIMINATOR)) {
      logs.push('Program log: Instruction: SetStatus');
      let status: number;
      try {
        status = decodeSetStatusData(instruction.data);
      } catch {
        throw new ProgramFailure({ InstructionError: [0, 'InvalidInstructionData'] }, logs);
      }
      const [publisher, record] = keys;
      if (!publisher || !record) {
        throw new ProgramFailure({ InstructionError: [0, 'NotEnoughAccountKeys'] }, logs);
      }
      if (!isSigner(publisher)) {
        fail(ANCHOR_ERRORS.AccountNotSigner, 'AccountNotSigner');
      }
      const account = this.accounts.get(record);
      if (!account || account.data.length === 0) {
        fail(ANCHOR_ERRORS.AccountNotInitialized, 'AccountNotInitialized');
      }
      if ((account as LedgerAccount).owner !== this.programId) {
        fail(ANCHOR_ERRORS.AccountOwnedByWrongProgram, 'AccountOwnedByWrongProgram');
      }
      let decoded: ReturnType<typeof decodeVersionRecord>;
      try {
        decoded = decodeVersionRecord((account as LedgerAccount).data);
      } catch {
        return fail(ANCHOR_ERRORS.AccountDiscriminatorMismatch, 'AccountDiscriminatorMismatch');
      }
      if (decoded.publisher !== publisher) {
        // `has_one = publisher @ RegistryError::NotPublisher`
        fail(registryErrorCode('NotPublisher'), 'NotPublisher');
      }
      if (recordAddress(this.programId, decoded.manifestHash).address !== record) {
        fail(ANCHOR_ERRORS.ConstraintSeeds, 'ConstraintSeeds');
      }
      if (status !== 0 && status !== 1) {
        fail(registryErrorCode('UnknownStatus'), 'UnknownStatus');
      }
      writes.set(record, {
        ...(account as LedgerAccount),
        data: encodeVersionRecord({ ...decoded, status, statusUpdatedSlot: BigInt(this.slot) }),
      });
      logs.push(`Program ${this.programId} success`);
      return { writes, logs };
    }

    return fail(ANCHOR_ERRORS.InstructionFallbackNotFound, 'InstructionFallbackNotFound');
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
      if (error instanceof LedgerRpcError) {
        return { rpcError: error.rpcError };
      }
      throw error;
    }
  }

  private accountValue(account: LedgerAccount) {
    return {
      data: [bytesToBase64(account.data), 'base64'],
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.owner,
      rentEpoch: 0,
      space: account.data.length,
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
        return { 'solana-core': 'fixture-ledger' };
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
          throw new LedgerRpcError({
            code: -32602,
            message: 'fixture ledger accepts base64-encoded transactions only',
          });
        }
        return this.send(String(params[0]), { skipPreflight: config.skipPreflight === true });
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
          },
          transaction: {
            signatures: [landed.signature],
            message: { accountKeys: landed.accountKeys },
          },
          version: 'legacy',
        };
      }
      case 'getAccountInfo': {
        this.requireOnline();
        const account = this.accounts.get(String(params[0]));
        return { context, value: account ? this.accountValue(account) : null };
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
        throw new LedgerRpcError({ code: -32601, message: `method not found: ${method}` });
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
      throw new LedgerRpcError({ code: -32602, message: 'memcmp bytes are not base58' });
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
 * A `fetch` stand-in that answers JSON-RPC requests from a ledger, delegating
 * methods the ledger does not know (catalog mint reads, funding) to
 * `fallback` when one is given. For tests and the local fixture RPC only.
 */
export function fetchForLedger(
  ledger: FixtureLedger,
  fallback?: (method: string, params: unknown) => unknown,
): typeof fetch {
  const answer = (method: string, params: unknown): unknown => {
    const own = ledger.handle(method, params);
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
    if (method === 'getAccountInfo' && ledger.account(first) === null) {
      // Registry records first, then whatever the fallback knows (fixture mints).
      return fallback(method, params);
    }
    if (method === 'getBalance' && ledger.account(first) === null) {
      return fallback(method, params);
    }
    return own;
  };
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown };
    const result = answer(body.method, body.params);
    if (body.method === 'sendTransaction' && ledger.loseNextResponse) {
      ledger.loseNextResponse = false;
      throw new TypeError('fetch failed: connection reset after the request was sent');
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

/** The bytes of the account discriminator as a base58 memcmp filter value. */
export function versionRecordFilter(): { readonly offset: number; readonly bytes: string } {
  return { offset: 0, bytes: encodeBase58(VERSION_RECORD_DISCRIMINATOR) };
}

/** Deterministic blockhash-like value for tests that need one without a ledger. */
export function fakeBlockhash(label: string): string {
  return encodeBase58(new Uint8Array(createHash('sha256').update(label).digest()));
}
