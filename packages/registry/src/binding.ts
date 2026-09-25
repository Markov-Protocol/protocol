import {
  compareBytes,
  hexToBytes,
  pubkeyBytes,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@markov/solana-codec';
import {
  HASH_LENGTH,
  RELATIONS,
  type RegisterVersionArgs,
  type RegistryLeg,
  SCHEMA_VERSION,
  type VersionRecord,
} from './layout.js';

/**
 * Binding between a frozen strategy version (B07) and its on-chain record:
 * the arguments a registration must carry and the comparison that decides
 * whether a record found on chain is the record of a given version.
 */
export type TokenProgramName = 'spl-token' | 'token-2022';

export function tokenProgramId(name: TokenProgramName): string {
  return name === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
}

export function tokenProgramName(programId: string): TokenProgramName | null {
  if (programId === SPL_TOKEN_PROGRAM_ID) {
    return 'spl-token';
  }
  if (programId === TOKEN_2022_PROGRAM_ID) {
    return 'token-2022';
  }
  return null;
}

export interface VersionBinding {
  /** Hex SHA-256 of the canonical manifest. */
  readonly manifestHash: string;
  /** Hex SHA-256 of the canonical content. */
  readonly contentDigest: string;
  readonly legs: readonly {
    readonly mint: string;
    readonly tokenProgram: TokenProgramName;
    readonly weightBps: number;
  }[];
  readonly cashWeightBps: number;
  /** `none` for a first version, `revision` for a later version of the same strategy, `fork` for a fork. */
  readonly relation: keyof typeof RELATIONS;
  /** Hex manifest hash of the registered parent record, when the relation names one. */
  readonly parentManifestHash?: string | null;
}

/** Legs sorted ascending by mint bytes, exactly as the program requires. */
export function sortLegs<T extends { readonly mint: string }>(legs: readonly T[]): T[] {
  return [...legs].sort((a, b) => compareBytes(pubkeyBytes(a.mint), pubkeyBytes(b.mint)));
}

/** The `register_version` arguments of a version. */
export function registrationArgs(binding: VersionBinding): RegisterVersionArgs {
  const legs: RegistryLeg[] = sortLegs(binding.legs).map((leg) => ({
    mint: leg.mint,
    tokenProgram: tokenProgramId(leg.tokenProgram),
    weightBps: leg.weightBps,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    manifestHash: hexToBytes(binding.manifestHash, HASH_LENGTH),
    contentDigest: hexToBytes(binding.contentDigest, HASH_LENGTH),
    relation: RELATIONS[binding.relation],
    parentManifestHash: binding.parentManifestHash
      ? hexToBytes(binding.parentManifestHash, HASH_LENGTH)
      : new Uint8Array(HASH_LENGTH),
    cashWeightBps: binding.cashWeightBps,
    legs,
  };
}

export interface RecordComparison {
  readonly matches: boolean;
  /** Human-readable names of the fields that differ; empty when the record is the version's. */
  readonly mismatches: readonly string[];
}

/** Whether an on-chain record carries exactly the economic content and hashes of a version. */
export function compareRecordToVersion(
  record: VersionRecord,
  binding: VersionBinding,
): RecordComparison {
  const expected = registrationArgs(binding);
  const mismatches: string[] = [];
  if (record.schemaVersion !== expected.schemaVersion) {
    mismatches.push('schemaVersion');
  }
  if (compareBytes(record.manifestHash, expected.manifestHash) !== 0) {
    mismatches.push('manifestHash');
  }
  if (compareBytes(record.contentDigest, expected.contentDigest) !== 0) {
    mismatches.push('contentDigest');
  }
  if (record.cashWeightBps !== expected.cashWeightBps) {
    mismatches.push('cashWeightBps');
  }
  if (record.legs.length !== expected.legs.length) {
    mismatches.push('legs');
  } else {
    for (let i = 0; i < record.legs.length; i += 1) {
      const actual = record.legs[i] as RegistryLeg;
      const wanted = expected.legs[i] as RegistryLeg;
      if (
        actual.mint !== wanted.mint ||
        actual.tokenProgram !== wanted.tokenProgram ||
        actual.weightBps !== wanted.weightBps
      ) {
        mismatches.push(`legs/${i}`);
      }
    }
  }
  if (record.relation !== expected.relation) {
    mismatches.push('relation');
  }
  if (compareBytes(record.parentManifestHash, expected.parentManifestHash) !== 0) {
    mismatches.push('parentManifestHash');
  }
  return { matches: mismatches.length === 0, mismatches };
}
