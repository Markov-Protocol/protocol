import { createHash } from 'node:crypto';
import { encodeBase58 } from '@markov/contracts';
import {
  ANCHOR_ERRORS,
  bytesEqual,
  type ChainAccount,
  type ChainError,
  ChainRpcError,
  type ChainTransaction,
  FixtureChain,
  type FixtureChainOptions,
  fetchForChain,
  LAMPORTS_PER_SIGNATURE,
  type ProgramContext,
  type ProgramExecutor,
  rentExemptMinimum,
  SYSTEM_PROGRAM_ID,
} from '@markov/solana-codec';
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
import { checkRegisterArgs, registryErrorCode } from './rules.js';

/**
 * The registry program's semantics (the same rules, the same Anchor error
 * codes, the same account bytes) as an executor of the fixture chain of
 * `@markov/solana-codec`, so the API, the indexer and the browser tests can
 * be exercised without a validator.
 *
 * It is a fixture: FIXTURE_VERIFIED evidence only. The program's behaviour
 * under the real runtime is proven by `programs/strategy-registry/tests`,
 * and nothing here is reachable from a production configuration.
 */
export {
  ANCHOR_ERRORS,
  BLOCKHASH_VALIDITY,
  FINALITY_DEPTH,
  LAMPORTS_PER_SIGNATURE,
  rentExemptMinimum,
} from '@markov/solana-codec';
export type LedgerAccount = ChainAccount;
export type LedgerError = ChainError;
export type LedgerTransaction = ChainTransaction;
export const LedgerRpcError = ChainRpcError;
export type LedgerRpcError = ChainRpcError;

export interface FixtureLedgerOptions extends FixtureChainOptions {
  readonly programId: string;
}

/** The registry program as a fixture-chain executor for `programId`. */
export function registryProgramExecutor(programId: string): ProgramExecutor {
  return (ctx: ProgramContext) => {
    const keys = ctx.accounts.map((account) => account.pubkey);
    const discriminator = ctx.data.subarray(0, DISCRIMINATOR_LENGTH);

    if (bytesEqual(discriminator, REGISTER_VERSION_DISCRIMINATOR)) {
      ctx.log('Program log: Instruction: RegisterVersion');
      let args: ReturnType<typeof decodeRegisterVersionData>;
      try {
        args = decodeRegisterVersionData(ctx.data);
      } catch {
        ctx.fail('InvalidInstructionData');
      }
      const [publisher, record, parent, systemProgram] = keys;
      if (!publisher || !record || !parent || !systemProgram) {
        ctx.fail('NotEnoughAccountKeys');
      }
      if (!ctx.isSigner(publisher)) {
        ctx.fail(ANCHOR_ERRORS.AccountNotSigner, 'AccountNotSigner');
      }
      const expected = recordAddress(programId, args.manifestHash);
      if (record !== expected.address) {
        ctx.fail(ANCHOR_ERRORS.ConstraintSeeds, 'ConstraintSeeds');
      }
      if (systemProgram !== SYSTEM_PROGRAM_ID) {
        ctx.fail(ANCHOR_ERRORS.InvalidProgramId, 'InvalidProgramId');
      }
      let parentRecord: ReturnType<typeof decodeVersionRecord> | null = null;
      if (parent !== programId) {
        const account = ctx.read(parent);
        if (!account || account.data.length === 0) {
          ctx.fail(ANCHOR_ERRORS.AccountNotInitialized, 'AccountNotInitialized');
        }
        if ((account as ChainAccount).owner !== programId) {
          ctx.fail(ANCHOR_ERRORS.AccountOwnedByWrongProgram, 'AccountOwnedByWrongProgram');
        }
        try {
          parentRecord = decodeVersionRecord((account as ChainAccount).data);
        } catch {
          ctx.fail(ANCHOR_ERRORS.AccountDiscriminatorMismatch, 'AccountDiscriminatorMismatch');
        }
      }
      const existing = ctx.read(record);
      if (existing && (existing.lamports > 0n || existing.data.length > 0)) {
        ctx.log(
          `Program log: Allocate: account Address { address: ${record}, base: None } already in use`,
        );
        ctx.fail(0, 'already in use');
      }
      const rules = checkRegisterArgs(args);
      if (!rules.ok) {
        ctx.fail(rules.code, rules.error);
      }
      if (args.relation === RELATIONS.none) {
        if (parentRecord !== null) {
          ctx.fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
      } else {
        if (parentRecord === null) {
          ctx.fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
        if (
          !bytesEqual(
            (parentRecord as ReturnType<typeof decodeVersionRecord>).manifestHash,
            args.parentManifestHash,
          ) ||
          parent === record
        ) {
          ctx.fail(registryErrorCode('InvalidParent'), 'InvalidParent');
        }
      }
      const rent = rentExemptMinimum(RECORD_SPACE);
      const payer = ctx.read(publisher) as ChainAccount;
      if (payer.lamports < rent + LAMPORTS_PER_SIGNATURE) {
        ctx.log(`Program log: Transfer: insufficient lamports ${payer.lamports}, need ${rent}`);
        ctx.fail(1, 'InsufficientFunds');
      }
      ctx.write(publisher, { ...payer, lamports: payer.lamports - rent });
      ctx.write(record, {
        owner: programId,
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
          registeredSlot: BigInt(ctx.slot),
          registeredUnixTime: BigInt(ctx.unixTime),
          statusUpdatedSlot: BigInt(ctx.slot),
        }),
      });
      return;
    }

    if (bytesEqual(discriminator, SET_STATUS_DISCRIMINATOR)) {
      ctx.log('Program log: Instruction: SetStatus');
      let status: number;
      try {
        status = decodeSetStatusData(ctx.data);
      } catch {
        ctx.fail('InvalidInstructionData');
      }
      const [publisher, record] = keys;
      if (!publisher || !record) {
        ctx.fail('NotEnoughAccountKeys');
      }
      if (!ctx.isSigner(publisher)) {
        ctx.fail(ANCHOR_ERRORS.AccountNotSigner, 'AccountNotSigner');
      }
      const account = ctx.read(record);
      if (!account || account.data.length === 0) {
        ctx.fail(ANCHOR_ERRORS.AccountNotInitialized, 'AccountNotInitialized');
      }
      if ((account as ChainAccount).owner !== programId) {
        ctx.fail(ANCHOR_ERRORS.AccountOwnedByWrongProgram, 'AccountOwnedByWrongProgram');
      }
      let decoded: ReturnType<typeof decodeVersionRecord>;
      try {
        decoded = decodeVersionRecord((account as ChainAccount).data);
      } catch {
        ctx.fail(ANCHOR_ERRORS.AccountDiscriminatorMismatch, 'AccountDiscriminatorMismatch');
      }
      if (decoded.publisher !== publisher) {
        // `has_one = publisher @ RegistryError::NotPublisher`
        ctx.fail(registryErrorCode('NotPublisher'), 'NotPublisher');
      }
      if (recordAddress(programId, decoded.manifestHash).address !== record) {
        ctx.fail(ANCHOR_ERRORS.ConstraintSeeds, 'ConstraintSeeds');
      }
      if (status !== 0 && status !== 1) {
        ctx.fail(registryErrorCode('UnknownStatus'), 'UnknownStatus');
      }
      ctx.write(record, {
        ...(account as ChainAccount),
        data: encodeVersionRecord({ ...decoded, status, statusUpdatedSlot: BigInt(ctx.slot) }),
      });
      return;
    }

    ctx.fail(ANCHOR_ERRORS.InstructionFallbackNotFound, 'InstructionFallbackNotFound');
  };
}

/** The fixture chain with the registry program registered under `programId`. */
export class FixtureLedger extends FixtureChain {
  readonly programId: string;

  constructor(options: FixtureLedgerOptions) {
    super(options);
    this.programId = options.programId;
    this.registerProgram(
      options.programId,
      registryProgramExecutor(options.programId),
      'strategy-registry',
    );
  }

  /** Every account the registry program owns (or of another program when asked). */
  override programAccounts(
    programId: string = this.programId,
  ): readonly { readonly pubkey: string; readonly account: ChainAccount }[] {
    return super.programAccounts(programId);
  }
}

/** A `fetch` stand-in answering JSON-RPC from a ledger; `fetchForChain` under its old name. */
export const fetchForLedger: typeof fetchForChain = fetchForChain;

/** The bytes of the account discriminator as a base58 memcmp filter value. */
export function versionRecordFilter(): { readonly offset: number; readonly bytes: string } {
  return { offset: 0, bytes: encodeBase58(VERSION_RECORD_DISCRIMINATOR) };
}

/** Deterministic blockhash-like value for tests that need one without a ledger. */
export function fakeBlockhash(label: string): string {
  return encodeBase58(new Uint8Array(createHash('sha256').update(label).digest()));
}
