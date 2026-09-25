import { createHash } from 'node:crypto';
import { BorshReader, BorshWriter } from './borsh.js';
import { bytesEqual, concatBytes, isZeroBytes } from './bytes.js';
import {
  findProgramAddress,
  PUBLIC_KEY_LENGTH,
  pubkeyBase58,
  pubkeyBytes,
  SYSTEM_PROGRAM_ID,
} from './pubkey.js';

/**
 * The exact binary encodings of `programs/strategy-registry`: Anchor
 * discriminators, Borsh-encoded instruction arguments and the version
 * record account. `docs/markov/strategy-registry.md` documents the layout;
 * `programs/strategy-registry/vectors/registry-vectors.json`, written by the
 * Rust tests, is the shared proof that both sides agree.
 */
export const RECORD_SEED = new TextEncoder().encode('version');
export const MAX_LEGS = 10;
export const TOTAL_BPS = 10_000;
export const SCHEMA_VERSION = 1;
export const RECORD_LAYOUT_VERSION = 1;
export const DISCRIMINATOR_LENGTH = 8;
export const HASH_LENGTH = 32;
/** 8-byte discriminator + 824 bytes of fields with the leg vector at its maximum. */
export const RECORD_SPACE = 832;
const LEG_LENGTH = PUBLIC_KEY_LENGTH * 2 + 2;

export const RELATIONS = { none: 0, revision: 1, fork: 2 } as const;
export type RelationName = keyof typeof RELATIONS;
export const RECORD_STATUSES = { active: 0, deprecated: 1 } as const;
export type RecordStatusName = keyof typeof RECORD_STATUSES;

/** `sha256("<namespace>:<name>")[0..8]`, Anchor's default discriminator. */
export function anchorDiscriminator(namespace: 'global' | 'account', name: string): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8),
  );
}

export const REGISTER_VERSION_DISCRIMINATOR = anchorDiscriminator('global', 'register_version');
export const SET_STATUS_DISCRIMINATOR = anchorDiscriminator('global', 'set_status');
export const VERSION_RECORD_DISCRIMINATOR = anchorDiscriminator('account', 'VersionRecord');

export interface RegistryLeg {
  readonly mint: string;
  readonly tokenProgram: string;
  readonly weightBps: number;
}

export interface RegisterVersionArgs {
  readonly schemaVersion: number;
  readonly manifestHash: Uint8Array;
  readonly contentDigest: Uint8Array;
  readonly relation: number;
  readonly parentManifestHash: Uint8Array;
  readonly cashWeightBps: number;
  readonly legs: readonly RegistryLeg[];
}

export interface VersionRecord {
  readonly layoutVersion: number;
  readonly schemaVersion: number;
  readonly status: number;
  readonly bump: number;
  readonly publisher: string;
  readonly manifestHash: Uint8Array;
  readonly contentDigest: Uint8Array;
  readonly relation: number;
  readonly parentManifestHash: Uint8Array;
  readonly cashWeightBps: number;
  readonly legs: readonly RegistryLeg[];
  readonly registeredSlot: bigint;
  readonly registeredUnixTime: bigint;
  readonly statusUpdatedSlot: bigint;
}

function writeLeg(writer: BorshWriter, leg: RegistryLeg): void {
  writer.fixedBytes(pubkeyBytes(leg.mint), PUBLIC_KEY_LENGTH);
  writer.fixedBytes(pubkeyBytes(leg.tokenProgram), PUBLIC_KEY_LENGTH);
  writer.u16(leg.weightBps);
}

function readLeg(reader: BorshReader): RegistryLeg {
  return {
    mint: pubkeyBase58(reader.fixedBytes(PUBLIC_KEY_LENGTH)),
    tokenProgram: pubkeyBase58(reader.fixedBytes(PUBLIC_KEY_LENGTH)),
    weightBps: reader.u16(),
  };
}

/** Instruction data of `register_version`. */
export function encodeRegisterVersionData(args: RegisterVersionArgs): Uint8Array {
  const writer = new BorshWriter();
  writer.bytes(REGISTER_VERSION_DISCRIMINATOR);
  writer.u16(args.schemaVersion);
  writer.fixedBytes(args.manifestHash, HASH_LENGTH);
  writer.fixedBytes(args.contentDigest, HASH_LENGTH);
  writer.u8(args.relation);
  writer.fixedBytes(args.parentManifestHash, HASH_LENGTH);
  writer.u16(args.cashWeightBps);
  writer.vec(args.legs, writeLeg);
  return writer.finish();
}

export function decodeRegisterVersionData(data: Uint8Array): RegisterVersionArgs {
  const reader = new BorshReader(data);
  if (!bytesEqual(reader.fixedBytes(DISCRIMINATOR_LENGTH), REGISTER_VERSION_DISCRIMINATOR)) {
    throw new Error('not a register_version instruction');
  }
  const args: RegisterVersionArgs = {
    schemaVersion: reader.u16(),
    manifestHash: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    contentDigest: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    relation: reader.u8(),
    parentManifestHash: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    cashWeightBps: reader.u16(),
    legs: reader.vec(readLeg, MAX_LEGS * 2),
  };
  if (reader.remaining !== 0) {
    throw new Error('trailing bytes after the register_version arguments');
  }
  return args;
}

/** Instruction data of `set_status`. */
export function encodeSetStatusData(status: number): Uint8Array {
  return new BorshWriter().bytes(SET_STATUS_DISCRIMINATOR).u8(status).finish();
}

export function decodeSetStatusData(data: Uint8Array): number {
  const reader = new BorshReader(data);
  if (!bytesEqual(reader.fixedBytes(DISCRIMINATOR_LENGTH), SET_STATUS_DISCRIMINATOR)) {
    throw new Error('not a set_status instruction');
  }
  const status = reader.u8();
  if (reader.remaining !== 0) {
    throw new Error('trailing bytes after the set_status argument');
  }
  return status;
}

/** The record account bytes exactly as the program writes them (padding to `RECORD_SPACE` is zero). */
export function encodeVersionRecord(record: VersionRecord): Uint8Array {
  const writer = new BorshWriter();
  writer.bytes(VERSION_RECORD_DISCRIMINATOR);
  writer.u8(record.layoutVersion);
  writer.u16(record.schemaVersion);
  writer.u8(record.status);
  writer.u8(record.bump);
  writer.fixedBytes(pubkeyBytes(record.publisher), PUBLIC_KEY_LENGTH);
  writer.fixedBytes(record.manifestHash, HASH_LENGTH);
  writer.fixedBytes(record.contentDigest, HASH_LENGTH);
  writer.u8(record.relation);
  writer.fixedBytes(record.parentManifestHash, HASH_LENGTH);
  writer.u16(record.cashWeightBps);
  writer.vec(record.legs, writeLeg);
  writer.u64(record.registeredSlot);
  writer.i64(record.registeredUnixTime);
  writer.u64(record.statusUpdatedSlot);
  const body = writer.finish();
  if (body.length > RECORD_SPACE) {
    throw new Error(`record of ${body.length} bytes exceeds ${RECORD_SPACE}`);
  }
  return concatBytes(body, new Uint8Array(RECORD_SPACE - body.length));
}

/**
 * Decode a record account. The discriminator and layout version must match,
 * the leg vector is bounded, and everything after the fields must be zero
 * padding (Anchor allocates the maximum space up front).
 */
export function decodeVersionRecord(data: Uint8Array): VersionRecord {
  if (data.length !== RECORD_SPACE) {
    throw new Error(`a version record is ${RECORD_SPACE} bytes, got ${data.length}`);
  }
  const reader = new BorshReader(data);
  if (!bytesEqual(reader.fixedBytes(DISCRIMINATOR_LENGTH), VERSION_RECORD_DISCRIMINATOR)) {
    throw new Error('not a version record (discriminator mismatch)');
  }
  const layoutVersion = reader.u8();
  if (layoutVersion !== RECORD_LAYOUT_VERSION) {
    throw new Error(`unsupported record layout version ${layoutVersion}`);
  }
  const record: VersionRecord = {
    layoutVersion,
    schemaVersion: reader.u16(),
    status: reader.u8(),
    bump: reader.u8(),
    publisher: pubkeyBase58(reader.fixedBytes(PUBLIC_KEY_LENGTH)),
    manifestHash: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    contentDigest: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    relation: reader.u8(),
    parentManifestHash: new Uint8Array(reader.fixedBytes(HASH_LENGTH)),
    cashWeightBps: reader.u16(),
    legs: reader.vec(readLeg, MAX_LEGS),
    registeredSlot: reader.u64(),
    registeredUnixTime: reader.i64(),
    statusUpdatedSlot: reader.u64(),
  };
  if (!isZeroBytes(reader.take(reader.remaining))) {
    throw new Error('non-zero bytes after the record fields');
  }
  return record;
}

/** Number of bytes a record with `legs` legs occupies before the zero padding. */
export function recordBodyLength(legs: number): number {
  return (
    DISCRIMINATOR_LENGTH +
    1 +
    2 +
    1 +
    1 +
    32 +
    32 +
    32 +
    1 +
    32 +
    2 +
    4 +
    legs * LEG_LENGTH +
    8 +
    8 +
    8
  );
}

export interface RecordAddress {
  readonly address: string;
  readonly bump: number;
}

/** `["version", manifest_hash]` under the program: where a manifest's record lives if it exists. */
export function recordAddress(programId: string, manifestHash: Uint8Array): RecordAddress {
  if (manifestHash.length !== HASH_LENGTH) {
    throw new Error('a manifest hash is 32 bytes');
  }
  const derived = findProgramAddress([RECORD_SEED, manifestHash], pubkeyBytes(programId));
  return { address: pubkeyBase58(derived.address), bump: derived.bump };
}

export interface AccountMeta {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface RegistryInstruction {
  readonly programId: string;
  readonly accounts: readonly AccountMeta[];
  readonly data: Uint8Array;
}

/**
 * The `register_version` instruction: publisher (signer, pays), the record
 * address derived from the manifest hash, the parent record or, in its
 * absence, the program id itself (Anchor's encoding of an absent optional
 * account), and the system program.
 */
export function registerVersionInstruction(input: {
  readonly programId: string;
  readonly publisher: string;
  readonly args: RegisterVersionArgs;
  readonly parentRecord?: string | null;
}): RegistryInstruction {
  const record = recordAddress(input.programId, input.args.manifestHash);
  return {
    programId: input.programId,
    accounts: [
      { pubkey: input.publisher, isSigner: true, isWritable: true },
      { pubkey: record.address, isSigner: false, isWritable: true },
      { pubkey: input.parentRecord ?? input.programId, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeRegisterVersionData(input.args),
  };
}

export function setStatusInstruction(input: {
  readonly programId: string;
  readonly publisher: string;
  readonly record: string;
  readonly status: number;
}): RegistryInstruction {
  return {
    programId: input.programId,
    accounts: [
      { pubkey: input.publisher, isSigner: true, isWritable: false },
      { pubkey: input.record, isSigner: false, isWritable: true },
    ],
    data: encodeSetStatusData(input.status),
  };
}
