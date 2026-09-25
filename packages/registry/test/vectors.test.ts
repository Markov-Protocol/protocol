import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  anchorDiscriminator,
  bytesToHex,
  compareRecordToVersion,
  decodeRegisterVersionData,
  decodeSetStatusData,
  decodeVersionRecord,
  encodeRegisterVersionData,
  encodeSetStatusData,
  encodeVersionRecord,
  findProgramAddress,
  hexToBytes,
  MAX_LEGS,
  pubkeyBase58,
  pubkeyBytes,
  RECORD_SPACE,
  REGISTRY_ERRORS,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  registryErrorCode,
  SPL_TOKEN_PROGRAM_ID,
  setStatusInstruction,
  TOKEN_2022_PROGRAM_ID,
} from '../src/index.js';

/**
 * The vectors are written by the Rust program's own tests under the real
 * runtime (`programs/strategy-registry/tests/vectors.rs`). Every assertion
 * here proves the TypeScript side reproduces them byte for byte.
 */
interface Vectors {
  programId: string;
  recordSeed: string;
  recordSpace: number;
  maxLegs: number;
  tokenPrograms: Record<string, string>;
  discriminators: Record<string, string>;
  errors: { name: string; code: number; message: string }[];
  manifest: {
    b07: {
      canonicalManifest: string;
      manifestHash: string;
      canonicalContent: string;
      contentDigest: string;
    };
  };
  registration: {
    genesisHash: string;
    manifest: {
      strategyId: string;
      versionNumber: number;
      parentVersionId: null;
      forkOf: null;
      title: string;
      thesis: string;
      thesisId: null;
      legs: {
        instrumentId: string;
        mint: string;
        tokenProgram: 'spl-token' | 'token-2022';
        weightBps: number;
      }[];
      cashWeightBps: number;
      maintenance: { suggestion: 'hold'; driftThresholdBps: null; reviewEveryDays: null };
      references: string[];
    };
    canonicalManifest: string;
    manifestHash: string;
    canonicalContent: string;
    contentDigest: string;
    args: {
      schemaVersion: number;
      manifestHash: string;
      contentDigest: string;
      relation: number;
      parentManifestHash: string;
      cashWeightBps: number;
      legs: { mint: string; tokenProgram: string; weightBps: number }[];
    };
    instructionData: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    publisher: string;
    recordAddress: string;
    bump: number;
    clock: { slot: number; unixTimestamp: number };
    recordData: string;
    record: Record<string, unknown>;
  };
  deprecation: {
    instructionData: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    clock: { slot: number; unixTimestamp: number };
    recordData: string;
    record: Record<string, unknown>;
  };
  programAddresses: { seeds: string[]; address: string; bump: number }[];
}

const vectors = JSON.parse(
  readFileSync(
    new URL('../../../programs/strategy-registry/vectors/registry-vectors.json', import.meta.url),
    'utf8',
  ),
) as Vectors;

describe('shared registry vectors', () => {
  it('agrees on the constants, discriminators and error codes', () => {
    expect(vectors.recordSpace).toBe(RECORD_SPACE);
    expect(vectors.maxLegs).toBe(MAX_LEGS);
    expect(vectors.recordSeed).toBe('version');
    expect(vectors.tokenPrograms).toEqual({
      'spl-token': SPL_TOKEN_PROGRAM_ID,
      'token-2022': TOKEN_2022_PROGRAM_ID,
    });
    expect(bytesToHex(anchorDiscriminator('global', 'register_version'))).toBe(
      vectors.discriminators['register_version'],
    );
    expect(bytesToHex(anchorDiscriminator('global', 'set_status'))).toBe(
      vectors.discriminators['set_status'],
    );
    expect(bytesToHex(anchorDiscriminator('account', 'VersionRecord'))).toBe(
      vectors.discriminators['VersionRecord'],
    );
    expect(vectors.errors).toEqual(
      REGISTRY_ERRORS.map(([name, message]) => ({ name, code: registryErrorCode(name), message })),
    );
  });

  it('carries the B07 manifest vector (proven by packages/strategy/test/registry-vectors.test.ts)', () => {
    expect(vectors.manifest.b07.manifestHash).toBe(
      'd324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a',
    );
    expect(vectors.registration.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives the same program addresses as Pubkey::find_program_address', () => {
    const programId = pubkeyBytes(vectors.programId);
    for (const derivation of vectors.programAddresses) {
      const derived = findProgramAddress(
        derivation.seeds.map((seed) => hexToBytes(seed)),
        programId,
      );
      expect(pubkeyBase58(derived.address)).toBe(derivation.address);
      expect(derived.bump).toBe(derivation.bump);
    }
    const record = recordAddress(vectors.programId, hexToBytes(vectors.registration.manifestHash));
    expect(record).toEqual({
      address: vectors.registration.recordAddress,
      bump: vectors.registration.bump,
    });
  });

  it('encodes register_version exactly as anchor_lang does, from the manifest binding', () => {
    const { registration } = vectors;
    const args = registrationArgs({
      manifestHash: registration.manifestHash,
      contentDigest: registration.contentDigest,
      legs: registration.manifest.legs.map((leg) => ({
        mint: leg.mint,
        tokenProgram: leg.tokenProgram,
        weightBps: leg.weightBps,
      })),
      cashWeightBps: registration.manifest.cashWeightBps,
      relation: 'none',
    });
    expect(args.legs.map((leg) => leg.mint)).toEqual(registration.args.legs.map((leg) => leg.mint));
    expect(bytesToHex(encodeRegisterVersionData(args))).toBe(registration.instructionData);
    const decoded = decodeRegisterVersionData(hexToBytes(registration.instructionData));
    expect(bytesToHex(decoded.manifestHash)).toBe(registration.args.manifestHash);
    expect(decoded.legs).toEqual(registration.args.legs);
    expect(decoded.cashWeightBps).toBe(registration.args.cashWeightBps);

    const instruction = registerVersionInstruction({
      programId: vectors.programId,
      publisher: registration.publisher,
      args,
    });
    expect(instruction.accounts).toEqual(registration.accounts);
    expect(bytesToHex(instruction.data)).toBe(registration.instructionData);
  });

  it('decodes and re-encodes the account bytes the runtime wrote', () => {
    const { registration, deprecation } = vectors;
    const record = decodeVersionRecord(hexToBytes(registration.recordData));
    expect(record.publisher).toBe(registration.publisher);
    expect(record.bump).toBe(registration.bump);
    expect(record.status).toBe(0);
    expect(bytesToHex(record.manifestHash)).toBe(registration.manifestHash);
    expect(bytesToHex(record.contentDigest)).toBe(registration.contentDigest);
    expect(record.legs).toEqual(registration.args.legs);
    expect(record.cashWeightBps).toBe(registration.args.cashWeightBps);
    expect(Number(record.registeredSlot)).toBe(registration.clock.slot);
    expect(Number(record.registeredUnixTime)).toBe(registration.clock.unixTimestamp);
    expect(Number(record.statusUpdatedSlot)).toBe(registration.clock.slot);
    expect(bytesToHex(encodeVersionRecord(record))).toBe(registration.recordData);
    expect(
      compareRecordToVersion(record, {
        manifestHash: registration.manifestHash,
        contentDigest: registration.contentDigest,
        legs: registration.manifest.legs,
        cashWeightBps: registration.manifest.cashWeightBps,
        relation: 'none',
      }),
    ).toEqual({ matches: true, mismatches: [] });

    const deprecated = decodeVersionRecord(hexToBytes(deprecation.recordData));
    expect(deprecated.status).toBe(1);
    expect(Number(deprecated.statusUpdatedSlot)).toBe(deprecation.clock.slot);
    expect(Number(deprecated.registeredSlot)).toBe(registration.clock.slot);
    expect(deprecated.legs).toEqual(record.legs);
    expect(bytesToHex(encodeSetStatusData(1))).toBe(deprecation.instructionData);
    expect(decodeSetStatusData(hexToBytes(deprecation.instructionData))).toBe(1);
    expect(
      setStatusInstruction({
        programId: vectors.programId,
        publisher: registration.publisher,
        record: registration.recordAddress,
        status: 1,
      }).accounts,
    ).toEqual(deprecation.accounts);
  });
});
