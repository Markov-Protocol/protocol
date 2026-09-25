import { createPublicKey, sign as signRaw, verify as verifyRaw } from 'node:crypto';
import { decodeBase58, encodeBase58 } from '@markov/contracts';
import { ByteReader, ByteWriter, bytesEqual, concatBytes } from './bytes.js';
import type { AccountMeta, RegistryInstruction } from './layout.js';
import { PUBLIC_KEY_LENGTH, pubkeyBase58, pubkeyBytes } from './pubkey.js';

/**
 * Legacy Solana transaction messages: the wire format every wallet signs and
 * every RPC node accepts (`solana-message` legacy layout). A registry
 * publication is one instruction with at most five accounts, so address
 * lookup tables and versioned messages are unnecessary; refusing them keeps
 * the parser small enough to review. Signatures are Ed25519 over the exact
 * message bytes; verification uses the platform's crypto, never a provider
 * SDK.
 */
export const SIGNATURE_LENGTH = 64;
export const BLOCKHASH_LENGTH = 32;
/** Maximum serialized transaction size a node accepts (one IPv6 MTU packet). */
export const MAX_TRANSACTION_BYTES = 1232;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

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

export interface LegacyMessage {
  readonly header: MessageHeader;
  readonly accountKeys: readonly string[];
  readonly recentBlockhash: string;
  readonly instructions: readonly CompiledInstruction[];
}

export interface Transaction {
  readonly signatures: readonly Uint8Array[];
  readonly message: LegacyMessage;
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
  readonly instructions: readonly RegistryInstruction[];
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

export function serializeMessage(message: LegacyMessage): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(message.header.numRequiredSignatures);
  writer.u8(message.header.numReadonlySignedAccounts);
  writer.u8(message.header.numReadonlyUnsignedAccounts);
  writer.bytes(encodeCompactU16(message.accountKeys.length));
  for (const key of message.accountKeys) {
    writer.bytes(pubkeyBytes(key));
  }
  writer.bytes(decodeBase58(message.recentBlockhash));
  writer.bytes(encodeCompactU16(message.instructions.length));
  for (const instruction of message.instructions) {
    writer.u8(instruction.programIdIndex);
    writer.bytes(encodeCompactU16(instruction.accountIndexes.length));
    for (const index of instruction.accountIndexes) {
      writer.u8(index);
    }
    writer.bytes(encodeCompactU16(instruction.data.length));
    writer.bytes(instruction.data);
  }
  return writer.finish();
}

function readMessage(reader: ByteReader): LegacyMessage {
  const numRequiredSignatures = reader.u8();
  if (numRequiredSignatures & 0x80) {
    throw new Error('versioned messages are not supported');
  }
  const header: MessageHeader = {
    numRequiredSignatures,
    numReadonlySignedAccounts: reader.u8(),
    numReadonlyUnsignedAccounts: reader.u8(),
  };
  const keyCount = readCompactU16(reader);
  if (keyCount === 0 || keyCount < header.numRequiredSignatures) {
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
    if (programIdIndex >= keyCount || accountIndexes.some((index) => index >= keyCount)) {
      throw new Error('instruction references an account outside the message');
    }
    instructions.push({ programIdIndex, accountIndexes, data });
  }
  return { header, accountKeys, recentBlockhash, instructions };
}

export function parseMessage(bytes: Uint8Array): LegacyMessage {
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
export function unsignedTransaction(message: LegacyMessage): Uint8Array {
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

/** Sign an unsigned transaction with the fee payer's signer; other signature slots stay as they are. */
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
