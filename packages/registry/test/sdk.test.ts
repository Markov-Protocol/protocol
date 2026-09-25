import { generateKeyPairSync } from 'node:crypto';
import { ByteReader } from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  checkRegisterArgs,
  compileLegacyMessage,
  createProgramAddress,
  decodeVersionRecord,
  encodeCompactU16,
  encodeVersionRecord,
  explorerUrl,
  findProgramAddress,
  hexToBytes,
  isOnCurve,
  parseMessage,
  parseTransaction,
  pubkeyBase58,
  pubkeyBytes,
  RECORD_SPACE,
  type RegistryLeg,
  readCompactU16,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  registryErrorCode,
  SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  serializeMessage,
  serializeTransaction,
  signerFromPrivateKey,
  signTransaction,
  sortLegs,
  transactionSignature,
  unsignedTransaction,
  verifyTransactionSignatures,
} from '../src/index.js';

const PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const MINT_B = '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL';
const HASH = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);

function signer() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return signerFromPrivateKey(privateKey);
}

function baseArgs() {
  return registrationArgs({
    manifestHash: HASH,
    contentDigest: DIGEST,
    legs: [
      { mint: MINT_B, tokenProgram: 'token-2022', weightBps: 3000 },
      { mint: MINT_A, tokenProgram: 'spl-token', weightBps: 6000 },
    ],
    cashWeightBps: 1000,
    relation: 'none',
  });
}

describe('public keys and program addresses', () => {
  it('recognises curve points and refuses program-derived addresses', () => {
    expect(isOnCurve(pubkeyBytes(signer().publicKey))).toBe(true);
    expect(isOnCurve(pubkeyBytes(SYSTEM_PROGRAM_ID))).toBe(true);
    expect(isOnCurve(pubkeyBytes(SPL_TOKEN_PROGRAM_ID))).toBe(true);
    const derived = findProgramAddress([new TextEncoder().encode('x')], pubkeyBytes(PROGRAM_ID));
    expect(isOnCurve(derived.address)).toBe(false);
    expect(
      createProgramAddress(
        [new TextEncoder().encode('x'), Uint8Array.of(derived.bump)],
        pubkeyBytes(PROGRAM_ID),
      ),
    ).toEqual(derived.address);
    expect(isOnCurve(new Uint8Array(31))).toBe(false);
  });

  it('bounds seeds and validates key lengths', () => {
    expect(() => findProgramAddress([new Uint8Array(33)], pubkeyBytes(PROGRAM_ID))).toThrow(
      /longer than 32/,
    );
    expect(() => pubkeyBytes('abc')).toThrow(/32-byte/);
    expect(() => pubkeyBase58(new Uint8Array(31))).toThrow(/32-byte/);
    expect(() => recordAddress(PROGRAM_ID, new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('rules mirror', () => {
  it('accepts the sorted, exact recipe and refuses each rule in program order', () => {
    const ok = baseArgs();
    const [first, second] = ok.legs as [RegistryLeg, RegistryLeg];
    expect(ok.legs.map((leg) => leg.mint)).toEqual(
      sortLegs([{ mint: MINT_B }, { mint: MINT_A }]).map((l) => l.mint),
    );
    expect(checkRegisterArgs(ok)).toEqual({ ok: true });
    const refuse = (patch: Partial<typeof ok>, error: string) =>
      expect(checkRegisterArgs({ ...ok, ...patch })).toEqual({
        ok: false,
        error,
        code: registryErrorCode(error as never),
      });
    refuse({ schemaVersion: 2 }, 'UnsupportedSchema');
    refuse({ manifestHash: new Uint8Array(32) }, 'EmptyHash');
    refuse({ legs: [] }, 'NoLegs');
    refuse(
      {
        legs: Array.from({ length: 11 }, (_, i) => ({
          mint: pubkeyBase58(Uint8Array.from({ length: 32 }, (__, j) => (j === 0 ? i + 1 : 0))),
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
          weightBps: 900,
        })),
        cashWeightBps: 100,
      },
      'TooManyLegs',
    );
    refuse({ legs: [{ ...first, weightBps: 0 }, second] }, 'ZeroWeight');
    refuse({ legs: [{ ...first, mint: SYSTEM_PROGRAM_ID }, second] }, 'InvalidMint');
    refuse({ legs: [{ ...first, tokenProgram: PROGRAM_ID }, second] }, 'UnsupportedTokenProgram');
    refuse({ legs: [second, first] }, 'LegsNotSorted');
    refuse({ legs: [first, first] }, 'LegsNotSorted');
    refuse({ cashWeightBps: 999 }, 'WeightTotal');
    refuse({ cashWeightBps: 1001 }, 'WeightTotal');
    refuse({ relation: 3, parentManifestHash: hexToBytes(DIGEST) }, 'UnknownRelation');
    refuse({ relation: 0, parentManifestHash: hexToBytes(DIGEST) }, 'InvalidParent');
    refuse({ relation: 1 }, 'InvalidParent');
    refuse({ relation: 2, parentManifestHash: hexToBytes(HASH) }, 'InvalidParent');
    expect(
      checkRegisterArgs({ ...ok, relation: 1, parentManifestHash: hexToBytes(DIGEST) }),
    ).toEqual({ ok: true });
  });
});

describe('record encoding', () => {
  it('round-trips a record and refuses wrong sizes, discriminators and non-zero padding', () => {
    const record = {
      layoutVersion: 1,
      schemaVersion: 1,
      status: 0,
      bump: 254,
      publisher: signer().publicKey,
      manifestHash: hexToBytes(HASH),
      contentDigest: hexToBytes(DIGEST),
      relation: 0,
      parentManifestHash: new Uint8Array(32),
      cashWeightBps: 1000,
      legs: baseArgs().legs,
      registeredSlot: 4242n,
      registeredUnixTime: 1_758_800_123n,
      statusUpdatedSlot: 4242n,
    };
    const bytes = encodeVersionRecord(record);
    expect(bytes.length).toBe(RECORD_SPACE);
    expect(decodeVersionRecord(bytes)).toEqual(record);
    expect(() => decodeVersionRecord(bytes.subarray(1))).toThrow(/832 bytes/);
    const wrongDiscriminator = Uint8Array.from(bytes);
    wrongDiscriminator[0] = (wrongDiscriminator[0] as number) ^ 1;
    expect(() => decodeVersionRecord(wrongDiscriminator)).toThrow(/discriminator/);
    const dirty = Uint8Array.from(bytes);
    dirty[RECORD_SPACE - 1] = 7;
    expect(() => decodeVersionRecord(dirty)).toThrow(/non-zero bytes/);
    const wrongLayout = Uint8Array.from(bytes);
    wrongLayout[8] = 2;
    expect(() => decodeVersionRecord(wrongLayout)).toThrow(/layout version/);
  });
});

describe('legacy transactions', () => {
  it('encodes and decodes compact-u16', () => {
    for (const value of [0, 1, 127, 128, 255, 256, 16_383, 16_384, 65_535]) {
      const bytes = encodeCompactU16(value);
      expect(readCompactU16(new ByteReader(bytes))).toBe(value);
    }
    expect(() => encodeCompactU16(65_536)).toThrow();
  });

  it('compiles, serialises, parses, signs and verifies a registration transaction', () => {
    const publisher = signer();
    const instruction = registerVersionInstruction({
      programId: PROGRAM_ID,
      publisher: publisher.publicKey,
      args: baseArgs(),
    });
    const blockhash = pubkeyBase58(new Uint8Array(32).fill(9));
    const message = compileLegacyMessage({
      feePayer: publisher.publicKey,
      instructions: [instruction],
      recentBlockhash: blockhash,
    });
    expect(message.header).toEqual({
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 2,
    });
    expect(message.accountKeys[0]).toBe(publisher.publicKey);
    // publisher, record, the program id (also standing in for the absent parent), system program
    expect(message.accountKeys).toHaveLength(4);
    const bytes = serializeMessage(message);
    expect(parseMessage(bytes)).toEqual(message);

    const unsigned = unsignedTransaction(message);
    const parsedUnsigned = parseTransaction(unsigned);
    expect(parsedUnsigned.signatures[0]).toEqual(new Uint8Array(64));
    expect(verifyTransactionSignatures(parsedUnsigned).allValid).toBe(false);

    const signed = signTransaction(unsigned, publisher);
    const parsed = parseTransaction(signed.bytes);
    expect(verifyTransactionSignatures(parsed)).toEqual({
      allValid: true,
      signers: [{ signer: publisher.publicKey, valid: true }],
    });
    expect(transactionSignature(parsed)).toBe(signed.signature);
    expect(parsed.messageBytes).toEqual(bytes);
    expect(base64ToBytes(bytesToBase64(signed.bytes))).toEqual(signed.bytes);

    // A tampered message no longer verifies; a stranger cannot sign for the fee payer.
    const tampered = Uint8Array.from(signed.bytes);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
    expect(verifyTransactionSignatures(parseTransaction(tampered)).allValid).toBe(false);
    expect(() => signTransaction(unsigned, signer())).toThrow(/not a required signer/);
  });

  it('refuses versioned messages, inconsistent headers, dangling indexes and trailing bytes', () => {
    const publisher = signer();
    const message = compileLegacyMessage({
      feePayer: publisher.publicKey,
      instructions: [
        registerVersionInstruction({
          programId: PROGRAM_ID,
          publisher: publisher.publicKey,
          args: baseArgs(),
        }),
      ],
      recentBlockhash: pubkeyBase58(new Uint8Array(32).fill(1)),
    });
    const bytes = serializeMessage(message);
    const versioned = Uint8Array.from(bytes);
    versioned[0] = (versioned[0] as number) | 0x80;
    expect(() => parseMessage(versioned)).toThrow(/versioned/);
    const inconsistent = Uint8Array.from(bytes);
    inconsistent[0] = 9;
    expect(() => parseMessage(inconsistent)).toThrow(/header/);
    expect(() => parseMessage(new Uint8Array([...bytes, 0]))).toThrow(/trailing/);
    const dangling = Uint8Array.from(bytes);
    dangling[3 + 1 + message.accountKeys.length * 32 + 32 + 1] = 42; // program id index of the only instruction
    expect(() => parseMessage(dangling)).toThrow(/outside the message/);
    expect(() => parseTransaction(serializeTransaction([], bytes))).toThrow(/signatures/);
    expect(() => parseTransaction(new Uint8Array(1300))).toThrow(/exceeds 1232/);
  });
});

describe('explorer links', () => {
  it('links public clusters only', () => {
    expect(explorerUrl('devnet', 'tx', 'sig')).toBe(
      'https://explorer.solana.com/tx/sig?cluster=devnet',
    );
    expect(explorerUrl('mainnet-beta', 'address', 'addr')).toBe(
      'https://explorer.solana.com/address/addr',
    );
    expect(explorerUrl('localnet', 'tx', 'sig')).toBeNull();
  });
});
