import { createHash, createPublicKey, sign as signRaw, verify as verifyRaw } from 'node:crypto';
import { decodeBase58, encodeBase58 } from '@markov/contracts';
import { ByteReader, ByteWriter, bytesEqual, bytesToHex, concatBytes } from './bytes.js';
import { PUBLIC_KEY_LENGTH, pubkeyBase58, pubkeyBytes } from './pubkey.js';

/**
 * Solana transaction messages in both wire layouts: the legacy layout every
 * wallet signs and the versioned (v0) layout that adds address lookup
 * tables. Both are implemented from the `solana-message` definitions rather
 * than a provider SDK. Signatures are Ed25519 over the exact message bytes;
 * verification uses the platform's crypto.
 *
 * A message is parsed, never trusted: every count is bounds-checked, every
 * index must point inside the (resolved) account list, and a versioned
 * message only resolves once the lookup tables it names have been read from
 * the chain (`resolveMessageAccounts`).
 */
export const SIGNATURE_LENGTH = 64;
export const BLOCKHASH_LENGTH = 32;
/** Maximum serialized transaction size a node accepts (one IPv6 MTU packet). */
export const MAX_TRANSACTION_BYTES = 1232;
/** Prefix bit that marks a versioned message; the low bits carry the version. */
const VERSION_PREFIX_MASK = 0x80;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface AccountMeta {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

/** An instruction before compilation: program, accounts with their roles, data. */
export interface Instruction {
  readonly programId: string;
  readonly accounts: readonly AccountMeta[];
  readonly data: Uint8Array;
}

export interface MessageHeader {
  readonly numRequiredSignatures: number;
  readonly numReadonlySignedAccounts: number;
  readonly numReadonlyUnsignedAccounts: number;
}

export interface CompiledInstruction {
  readonly programIdIndex: number;
  readonly accountIndexes: readonly number[];
  readonly data: Uint8Array;
}

export interface AddressTableLookup {
  readonly accountKey: string;
  readonly writableIndexes: readonly number[];
  readonly readonlyIndexes: readonly number[];
}

export interface LegacyMessage {
  readonly version: 'legacy';
  readonly header: MessageHeader;
  /** Static keys: fee payer first, then the remaining signers, then the rest. */
  readonly accountKeys: readonly string[];
  readonly recentBlockhash: string;
  readonly instructions: readonly CompiledInstruction[];
}

export interface V0Message {
  readonly version: 0;
  readonly header: MessageHeader;
  readonly accountKeys: readonly string[];
  readonly recentBlockhash: string;
  readonly instructions: readonly CompiledInstruction[];
  readonly addressTableLookups: readonly AddressTableLookup[];
}

export type Message = LegacyMessage | V0Message;

export interface Transaction {
  readonly signatures: readonly Uint8Array[];
  readonly message: Message;
  /** The exact bytes the signatures cover. */
  readonly messageBytes: Uint8Array;
}

export function encodeCompactU16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`compact-u16 out of range: ${value}`);
  }
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest & 0x7f;
    rest >>= 7;
    if (rest === 0) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return Uint8Array.from(out);
}

export function readCompactU16(reader: ByteReader): number {
  let value = 0;
  for (let i = 0; i < 3; i += 1) {
    const byte = reader.u8();
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) {
      if (value > 0xffff) {
        throw new Error('compact-u16 out of range');
      }
      return value;
    }
  }
  throw new Error('compact-u16 longer than three bytes');
}

interface KeyEntry {
  readonly pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * Compile instructions into a legacy message: fee payer first, then the
 * remaining signers (writable before read-only), then the non-signers
 * (writable before read-only), in order of first appearance. Program ids are
 * read-only non-signers.
 */
export function compileLegacyMessage(input: {
  readonly feePayer: string;
  readonly instructions: readonly Instruction[];
  readonly recentBlockhash: string;
}): LegacyMessage {
  pubkeyBytes(input.feePayer);
  if (decodeBase58(input.recentBlockhash).length !== BLOCKHASH_LENGTH) {
    throw new Error('a blockhash is 32 bytes');
  }
  const entries = new Map<string, KeyEntry>();
  const touch = (meta: AccountMeta) => {
    const existing = entries.get(meta.pubkey);
    if (existing) {
      existing.isSigner ||= meta.isSigner;
      existing.isWritable ||= meta.isWritable;
      return;
    }
    pubkeyBytes(meta.pubkey);
    entries.set(meta.pubkey, {
      pubkey: meta.pubkey,
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    });
  };
  touch({ pubkey: input.feePayer, isSigner: true, isWritable: true });
  for (const instruction of input.instructions) {
    for (const meta of instruction.accounts) {
      touch(meta);
    }
    touch({ pubkey: instruction.programId, isSigner: false, isWritable: false });
  }
  const all = [...entries.values()];
  const ordered = [
    ...all.filter((entry) => entry.isSigner && entry.isWritable),
    ...all.filter((entry) => entry.isSigner && !entry.isWritable),
    ...all.filter((entry) => !entry.isSigner && entry.isWritable),
    ...all.filter((entry) => !entry.isSigner && !entry.isWritable),
  ];
  const accountKeys = ordered.map((entry) => entry.pubkey);
  const indexOf = (pubkey: string) => {
    const index = accountKeys.indexOf(pubkey);
    if (index < 0) {
      throw new Error(`account ${pubkey} is not part of the message`);
    }
    return index;
  };
  return {
    version: 'legacy',
    header: {
      numRequiredSignatures: ordered.filter((entry) => entry.isSigner).length,
      numReadonlySignedAccounts: ordered.filter((entry) => entry.isSigner && !entry.isWritable)
        .length,
      numReadonlyUnsignedAccounts: ordered.filter((entry) => !entry.isSigner && !entry.isWritable)
        .length,
    },
    accountKeys,
    recentBlockhash: input.recentBlockhash,
    instructions: input.instructions.map((instruction) => ({
      programIdIndex: indexOf(instruction.programId),
      accountIndexes: instruction.accounts.map((meta) => indexOf(meta.pubkey)),
      data: instruction.data,
    })),
  };
}

function writeInstructions(writer: ByteWriter, instructions: readonly CompiledInstruction[]) {
  writer.bytes(encodeCompactU16(instructions.length));
  for (const instruction of instructions) {
    writer.u8(instruction.programIdIndex);
    writer.bytes(encodeCompactU16(instruction.accountIndexes.length));
    for (const index of instruction.accountIndexes) {
      writer.u8(index);
    }
    writer.bytes(encodeCompactU16(instruction.data.length));
    writer.bytes(instruction.data);
  }
}

export function serializeMessage(message: Message): Uint8Array {
  const writer = new ByteWriter();
  if (message.version === 0) {
    writer.u8(VERSION_PREFIX_MASK | 0);
  }
  writer.u8(message.header.numRequiredSignatures);
  writer.u8(message.header.numReadonlySignedAccounts);
  writer.u8(message.header.numReadonlyUnsignedAccounts);
  writer.bytes(encodeCompactU16(message.accountKeys.length));
  for (const key of message.accountKeys) {
    writer.bytes(pubkeyBytes(key));
  }
  writer.bytes(decodeBase58(message.recentBlockhash));
  writeInstructions(writer, message.instructions);
  if (message.version === 0) {
    writer.bytes(encodeCompactU16(message.addressTableLookups.length));
    for (const lookup of message.addressTableLookups) {
      writer.bytes(pubkeyBytes(lookup.accountKey));
      writer.bytes(encodeCompactU16(lookup.writableIndexes.length));
      for (const index of lookup.writableIndexes) {
        writer.u8(index);
      }
      writer.bytes(encodeCompactU16(lookup.readonlyIndexes.length));
      for (const index of lookup.readonlyIndexes) {
        writer.u8(index);
      }
    }
  }
  return writer.finish();
}

function readHeaderAndKeys(reader: ByteReader): {
  readonly header: MessageHeader;
  readonly accountKeys: string[];
  readonly recentBlockhash: string;
} {
  const header: MessageHeader = {
    numRequiredSignatures: reader.u8(),
    numReadonlySignedAccounts: reader.u8(),
    numReadonlyUnsignedAccounts: reader.u8(),
  };
  const keyCount = readCompactU16(reader);
  if (
    keyCount === 0 ||
    keyCount < header.numRequiredSignatures ||
    header.numRequiredSignatures === 0
  ) {
    throw new Error('message header does not fit its account keys');
  }
  if (
    header.numReadonlySignedAccounts > header.numRequiredSignatures ||
    header.numReadonlyUnsignedAccounts > keyCount - header.numRequiredSignatures
  ) {
    throw new Error('message header counts are inconsistent');
  }
  const accountKeys: string[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    accountKeys.push(pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH)));
  }
  const recentBlockhash = encodeBase58(reader.take(BLOCKHASH_LENGTH));
  return { header, accountKeys, recentBlockhash };
}

function readInstructions(reader: ByteReader, addressSpace: number): CompiledInstruction[] {
  const instructionCount = readCompactU16(reader);
  const instructions: CompiledInstruction[] = [];
  for (let i = 0; i < instructionCount; i += 1) {
    const programIdIndex = reader.u8();
    const accountCount = readCompactU16(reader);
    const accountIndexes: number[] = [];
    for (let j = 0; j < accountCount; j += 1) {
      accountIndexes.push(reader.u8());
    }
    const dataLength = readCompactU16(reader);
    const data = new Uint8Array(reader.take(dataLength));
    if (programIdIndex >= addressSpace || accountIndexes.some((index) => index >= addressSpace)) {
      throw new Error('instruction references an account outside the message');
    }
    instructions.push({ programIdIndex, accountIndexes, data });
  }
  return instructions;
}

function readMessage(reader: ByteReader): Message {
  const first = reader.u8();
  if ((first & VERSION_PREFIX_MASK) === 0) {
    // Legacy: the byte just read is numRequiredSignatures.
    const numReadonlySignedAccounts = reader.u8();
    const numReadonlyUnsignedAccounts = reader.u8();
    const header: MessageHeader = {
      numRequiredSignatures: first,
      numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts,
    };
    const keyCount = readCompactU16(reader);
    if (keyCount === 0 || keyCount < header.numRequiredSignatures || first === 0) {
      throw new Error('message header does not fit its account keys');
    }
    if (
      header.numReadonlySignedAccounts > header.numRequiredSignatures ||
      header.numReadonlyUnsignedAccounts > keyCount - header.numRequiredSignatures
    ) {
      throw new Error('message header counts are inconsistent');
    }
    const accountKeys: string[] = [];
    for (let i = 0; i < keyCount; i += 1) {
      accountKeys.push(pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH)));
    }
    const recentBlockhash = encodeBase58(reader.take(BLOCKHASH_LENGTH));
    const instructions = readInstructions(reader, keyCount);
    return { version: 'legacy', header, accountKeys, recentBlockhash, instructions };
  }
  const version = first & ~VERSION_PREFIX_MASK;
  if (version !== 0) {
    throw new Error(`versioned message of unsupported version ${version}`);
  }
  const { header, accountKeys, recentBlockhash } = readHeaderAndKeys(reader);
  // Instructions may index into lookup-table addresses; the upper bound is
  // checked again once the tables are resolved.
  const instructions = readInstructions(reader, 256);
  const lookupCount = readCompactU16(reader);
  const addressTableLookups: AddressTableLookup[] = [];
  let loaded = 0;
  for (let i = 0; i < lookupCount; i += 1) {
    const accountKey = pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH));
    const writableCount = readCompactU16(reader);
    const writableIndexes: number[] = [];
    for (let j = 0; j < writableCount; j += 1) {
      writableIndexes.push(reader.u8());
    }
    const readonlyCount = readCompactU16(reader);
    const readonlyIndexes: number[] = [];
    for (let j = 0; j < readonlyCount; j += 1) {
      readonlyIndexes.push(reader.u8());
    }
    loaded += writableCount + readonlyCount;
    addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
  }
  if (accountKeys.length + loaded > 256) {
    throw new Error('a message addresses at most 256 accounts');
  }
  const addressSpace = accountKeys.length + loaded;
  for (const instruction of instructions) {
    if (
      instruction.programIdIndex >= addressSpace ||
      instruction.accountIndexes.some((index) => index >= addressSpace)
    ) {
      throw new Error('instruction references an account outside the message');
    }
  }
  return { version: 0, header, accountKeys, recentBlockhash, instructions, addressTableLookups };
}

export function parseMessage(bytes: Uint8Array): Message {
  const reader = new ByteReader(bytes);
  const message = readMessage(reader);
  if (reader.remaining !== 0) {
    throw new Error('trailing bytes after the message');
  }
  return message;
}

/** Wire transaction: compact-u16 signature count, the signatures, the message. */
export function serializeTransaction(
  signatures: readonly Uint8Array[],
  messageBytes: Uint8Array,
): Uint8Array {
  for (const signature of signatures) {
    if (signature.length !== SIGNATURE_LENGTH) {
      throw new Error('a signature is 64 bytes');
    }
  }
  return concatBytes(encodeCompactU16(signatures.length), ...signatures, messageBytes);
}

/** The bytes a wallet receives to sign: zeroed signature slots in front of the message. */
export function unsignedTransaction(message: Message): Uint8Array {
  const slots = Array.from(
    { length: message.header.numRequiredSignatures },
    () => new Uint8Array(SIGNATURE_LENGTH),
  );
  return serializeTransaction(slots, serializeMessage(message));
}

export function parseTransaction(bytes: Uint8Array): Transaction {
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    throw new Error(`transaction of ${bytes.length} bytes exceeds ${MAX_TRANSACTION_BYTES}`);
  }
  const reader = new ByteReader(bytes);
  const count = readCompactU16(reader);
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    signatures.push(new Uint8Array(reader.take(SIGNATURE_LENGTH)));
  }
  const messageStart = reader.position;
  const message = readMessage(reader);
  if (reader.remaining !== 0) {
    throw new Error('trailing bytes after the message');
  }
  if (signatures.length !== message.header.numRequiredSignatures) {
    throw new Error(
      `${signatures.length} signatures for a message requiring ${message.header.numRequiredSignatures}`,
    );
  }
  return { signatures, message, messageBytes: new Uint8Array(bytes.subarray(messageStart)) };
}

/* ----------------------------------------------------- account resolution */

export interface ResolvedAccount {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
  /** Static keys are signed over; lookup-table keys were loaded from the chain. */
  readonly source: 'static' | 'lookup';
}

/** Whether the static key at `index` is writable per the message header. */
export function staticKeyIsWritable(message: Message, index: number): boolean {
  const { header, accountKeys } = message;
  if (index < header.numRequiredSignatures) {
    return index < header.numRequiredSignatures - header.numReadonlySignedAccounts;
  }
  return index < accountKeys.length - header.numReadonlyUnsignedAccounts;
}

/**
 * The complete account list of a message in index order: static keys, then
 * every writable lookup address, then every read-only lookup address. A
 * versioned message needs the addresses of each table it names, as read
 * from the chain; a missing table or an index past its end is an error.
 */
export function resolveMessageAccounts(
  message: Message,
  tables: ReadonlyMap<string, readonly string[]> = new Map(),
): readonly ResolvedAccount[] {
  const resolved: ResolvedAccount[] = message.accountKeys.map((pubkey, index) => ({
    pubkey,
    isSigner: index < message.header.numRequiredSignatures,
    isWritable: staticKeyIsWritable(message, index),
    source: 'static',
  }));
  if (message.version === 'legacy') {
    return resolved;
  }
  const load = (lookup: AddressTableLookup, indexes: readonly number[], isWritable: boolean) => {
    const addresses = tables.get(lookup.accountKey);
    if (!addresses) {
      throw new Error(`address lookup table ${lookup.accountKey} was not resolved`);
    }
    return indexes.map((index) => {
      const pubkey = addresses[index];
      if (pubkey === undefined) {
        throw new Error(`lookup index ${index} is past the end of table ${lookup.accountKey}`);
      }
      return { pubkey, isSigner: false, isWritable, source: 'lookup' as const };
    });
  };
  const writable = message.addressTableLookups.flatMap((lookup) =>
    load(lookup, lookup.writableIndexes, true),
  );
  const readonly = message.addressTableLookups.flatMap((lookup) =>
    load(lookup, lookup.readonlyIndexes, false),
  );
  return [...resolved, ...writable, ...readonly];
}

export interface ResolvedInstruction {
  readonly index: number;
  readonly programId: string;
  readonly accounts: readonly ResolvedAccount[];
  readonly data: Uint8Array;
}

/** Every instruction with its program id and accounts looked up in the resolved list. */
export function resolveInstructions(
  message: Message,
  accounts: readonly ResolvedAccount[],
): readonly ResolvedInstruction[] {
  const at = (index: number): ResolvedAccount => {
    const account = accounts[index];
    if (!account) {
      throw new Error(`instruction references account index ${index} outside the message`);
    }
    return account;
  };
  return message.instructions.map((instruction, index) => ({
    index,
    programId: at(instruction.programIdIndex).pubkey,
    accounts: instruction.accountIndexes.map(at),
    data: instruction.data,
  }));
}

/* ------------------------------------------------- address lookup tables */

export const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const LOOKUP_TABLE_META_LENGTH = 56;

export interface AddressLookupTable {
  readonly deactivationSlot: bigint;
  readonly lastExtendedSlot: bigint;
  readonly authority: string | null;
  readonly addresses: readonly string[];
}

/** Decode an address lookup table account (`solana-address-lookup-table-interface` state layout). */
export function decodeAddressLookupTable(data: Uint8Array): AddressLookupTable {
  const reader = new ByteReader(data);
  const typeIndex = reader.u32();
  if (typeIndex !== 1) {
    throw new Error('not an initialized address lookup table');
  }
  const deactivationSlot = reader.u64();
  const lastExtendedSlot = reader.u64();
  reader.u8(); // last extended slot start index
  const hasAuthority = reader.u8();
  const authorityBytes = reader.take(PUBLIC_KEY_LENGTH);
  reader.u16(); // padding
  if (reader.position !== LOOKUP_TABLE_META_LENGTH) {
    throw new Error('lookup table header length mismatch');
  }
  if (reader.remaining % PUBLIC_KEY_LENGTH !== 0) {
    throw new Error('lookup table addresses are not 32-byte aligned');
  }
  const addresses: string[] = [];
  while (reader.remaining > 0) {
    addresses.push(pubkeyBase58(reader.take(PUBLIC_KEY_LENGTH)));
  }
  return {
    deactivationSlot,
    lastExtendedSlot,
    authority: hasAuthority === 1 ? pubkeyBase58(authorityBytes) : null,
    addresses,
  };
}

/** Encode a lookup table account (tests and the fixture chain). */
export function encodeAddressLookupTable(input: {
  readonly addresses: readonly string[];
  readonly authority?: string | null;
  readonly deactivationSlot?: bigint;
  readonly lastExtendedSlot?: bigint;
}): Uint8Array {
  const writer = new ByteWriter();
  writer.u32(1);
  writer.u64(input.deactivationSlot ?? 0xffffffffffffffffn);
  writer.u64(input.lastExtendedSlot ?? 0n);
  writer.u8(0);
  writer.u8(input.authority ? 1 : 0);
  writer.bytes(input.authority ? pubkeyBytes(input.authority) : new Uint8Array(PUBLIC_KEY_LENGTH));
  writer.u16(0);
  for (const address of input.addresses) {
    writer.bytes(pubkeyBytes(address));
  }
  return writer.finish();
}

/* ---------------------------------------------------------- signatures */

function spki(pubkey: string) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkeyBytes(pubkey))]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyEd25519(pubkey: string, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== SIGNATURE_LENGTH) {
    return false;
  }
  try {
    return verifyRaw(null, Buffer.from(message), spki(pubkey), Buffer.from(signature));
  } catch {
    return false;
  }
}

export interface SignatureVerification {
  readonly signer: string;
  readonly valid: boolean;
}

/** Every required signature checked against its signer over the exact message bytes. */
export function verifyTransactionSignatures(transaction: Transaction): {
  readonly allValid: boolean;
  readonly signers: readonly SignatureVerification[];
} {
  const signers = transaction.signatures.map((signature, index) => {
    const signer = transaction.message.accountKeys[index] as string;
    return { signer, valid: verifyEd25519(signer, transaction.messageBytes, signature) };
  });
  return { allValid: signers.length > 0 && signers.every((entry) => entry.valid), signers };
}

/** The transaction id: the base58 fee-payer signature. */
export function transactionSignature(transaction: Transaction): string {
  const first = transaction.signatures[0];
  if (!first) {
    throw new Error('a transaction without signatures has no id');
  }
  return encodeBase58(first);
}

/** Whether two messages are byte-identical (what the submit step requires of a wallet-signed transaction). */
export function sameMessage(a: Uint8Array, b: Uint8Array): boolean {
  return bytesEqual(a, b);
}

/** Hex SHA-256 of the exact message bytes: the identity a prepared transaction is stored and approved under. */
export function messageHashHex(messageBytes: Uint8Array): string {
  return bytesToHex(new Uint8Array(createHash('sha256').update(messageBytes).digest()));
}

export interface Ed25519Signer {
  readonly publicKey: string;
  sign(message: Uint8Array): Uint8Array;
}

/**
 * Sign with a Node `KeyObject` (tests, the nonproduction CLI demo). Never a
 * production wallet: the product signs through the Wallet Standard adapter.
 */
export function signerFromPrivateKey(privateKey: import('node:crypto').KeyObject): Ed25519Signer {
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(ED25519_SPKI_PREFIX.length);
  return {
    publicKey: pubkeyBase58(Uint8Array.from(raw)),
    sign: (message) => Uint8Array.from(signRaw(null, Buffer.from(message), privateKey)),
  };
}

/** Sign an unsigned transaction with one of its required signers; other signature slots stay as they are. */
export function signTransaction(
  unsigned: Uint8Array,
  signer: Ed25519Signer,
): { readonly bytes: Uint8Array; readonly signature: string } {
  const parsed = parseTransaction(unsigned);
  const index = parsed.message.accountKeys.indexOf(signer.publicKey);
  if (index < 0 || index >= parsed.message.header.numRequiredSignatures) {
    throw new Error('the signer is not a required signer of this transaction');
  }
  const signatures = parsed.signatures.map((existing, i) =>
    i === index ? signer.sign(parsed.messageBytes) : existing,
  );
  return {
    bytes: serializeTransaction(signatures, parsed.messageBytes),
    signature: encodeBase58(signatures[0] as Uint8Array),
  };
}
