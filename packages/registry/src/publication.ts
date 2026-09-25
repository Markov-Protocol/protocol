import type { SolanaCluster } from '@markov/contracts';
import { bytesToHex } from '@markov/solana-codec';
import { compareRecordToVersion, type VersionBinding } from './binding.js';
import { explorerUrl } from './explorer.js';
import { decodeVersionRecord, RECORD_STATUSES, type VersionRecord } from './layout.js';
import { registryErrorName } from './rules.js';

/**
 * The state machine of a publication, decided from chain observations
 * alone. Every input is what an RPC node answered (or that it did not
 * answer); the output is the next state with its evidence or failure.
 * Nothing here trusts a database row, a built transaction or an accepted
 * submission: only a finalized transaction and a decoded record that match
 * the expectation count as registration.
 */
export type Unavailable = 'unavailable';

export interface SignatureObservation {
  readonly slot: number;
  readonly err: unknown | null;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
}

export interface TransactionObservation {
  readonly slot: number;
  readonly blockTime: number | null;
  readonly err: unknown | null;
  readonly logs: readonly string[];
}

export interface AccountObservation {
  readonly owner: string;
  readonly data: Uint8Array;
}

export interface ChainObservation {
  /** null: the node has no record of the signature; unavailable: the node could not be asked. */
  readonly signature: SignatureObservation | null | Unavailable;
  readonly blockHeight: number | Unavailable;
  readonly transaction: TransactionObservation | null | Unavailable;
  readonly account: AccountObservation | null | Unavailable;
  readonly observedAt: string;
}

export type PublicationOperation = 'register' | 'deprecate' | 'reactivate';

export interface PublicationExpectation {
  readonly operation: PublicationOperation;
  readonly programId: string;
  readonly cluster: SolanaCluster;
  readonly signature: string;
  readonly lastValidBlockHeight: number;
  readonly recordAddress: string;
  readonly publisherAddress: string;
  readonly binding: VersionBinding;
}

export interface PublicationFailureOutcome {
  readonly code:
    | 'program_error'
    | 'transaction_error'
    | 'rejected_by_node'
    | 'blockhash_expired'
    | 'record_mismatch';
  readonly programErrorCode: number | null;
  readonly programError: string | null;
  readonly message: string;
}

export interface RegistrationEvidenceOutcome {
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: string | null;
  readonly recordAddress: string;
  readonly publisher: string;
  readonly status: 'active' | 'deprecated';
  readonly transactionUrl: string | null;
  readonly recordUrl: string | null;
}

export type PublicationOutcome =
  | {
      readonly state: 'submitted';
      readonly confirmationStatus: SignatureObservation['confirmationStatus'];
    }
  | {
      readonly state: 'unknown';
      readonly reason: string;
      readonly confirmationStatus: SignatureObservation['confirmationStatus'];
    }
  | { readonly state: 'expired'; readonly failure: PublicationFailureOutcome }
  | {
      readonly state: 'failed';
      readonly failure: PublicationFailureOutcome;
      readonly confirmationStatus: SignatureObservation['confirmationStatus'];
    }
  | {
      readonly state: 'registered';
      readonly evidence: RegistrationEvidenceOutcome;
      readonly record: VersionRecord;
      readonly recordData: Uint8Array;
      readonly confirmationStatus: 'finalized';
    };

/** Extract a program's custom error code from a node-reported transaction error, if there is one. */
export function customErrorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('InstructionError' in err)) {
    return null;
  }
  const inner = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(inner) || inner.length !== 2) {
    return null;
  }
  const detail = inner[1] as unknown;
  if (typeof detail === 'object' && detail !== null && 'Custom' in detail) {
    const code = (detail as { Custom: unknown }).Custom;
    return typeof code === 'number' ? code : null;
  }
  return null;
}

export function describeTransactionError(err: unknown): PublicationFailureOutcome {
  const code = customErrorCode(err);
  if (code !== null) {
    const name = registryErrorName(code);
    return {
      code: 'program_error',
      programErrorCode: code,
      programError: name,
      message: name
        ? `the registry program refused the transaction: ${name} (${code})`
        : `the transaction failed with custom program error ${code}`,
    };
  }
  return {
    code: 'transaction_error',
    programErrorCode: null,
    programError: null,
    message: `the transaction failed: ${typeof err === 'string' ? err : JSON.stringify(err)}`,
  };
}

/** Failure of a node's preflight (`sendTransaction` error message), classified for the record. */
export function describeNodeRejection(message: string): PublicationFailureOutcome {
  if (/blockhash not found/i.test(message)) {
    return {
      code: 'blockhash_expired',
      programErrorCode: null,
      programError: null,
      message: 'the transaction expired before the node accepted it; prepare the publication again',
    };
  }
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(message);
  if (custom?.[1]) {
    const code = Number.parseInt(custom[1], 16);
    const name = registryErrorName(code);
    return {
      code: 'program_error',
      programErrorCode: code,
      programError: name,
      message: name
        ? `the registry program refused the transaction: ${name} (${code})`
        : `the node's simulation failed with custom program error ${code}`,
    };
  }
  return {
    code: 'rejected_by_node',
    programErrorCode: null,
    programError: null,
    message: `the node rejected the transaction: ${message.slice(0, 300)}`,
  };
}

function statusName(status: number): 'active' | 'deprecated' {
  return status === RECORD_STATUSES.deprecated ? 'deprecated' : 'active';
}

/** Decide the next state of a submitted publication from what the chain says. */
export function derivePublicationOutcome(
  expectation: PublicationExpectation,
  observation: ChainObservation,
): PublicationOutcome {
  if (observation.signature === 'unavailable' || observation.blockHeight === 'unavailable') {
    return {
      state: 'unknown',
      reason: 'the network could not be asked about the transaction',
      confirmationStatus: null,
    };
  }
  if (observation.signature === null) {
    if (observation.blockHeight > expectation.lastValidBlockHeight) {
      return {
        state: 'expired',
        failure: {
          code: 'blockhash_expired',
          programErrorCode: null,
          programError: null,
          message:
            'the network never recorded the transaction and its blockhash has expired; prepare the publication again',
        },
      };
    }
    return { state: 'submitted', confirmationStatus: null };
  }
  const status = observation.signature;
  if (status.err !== null) {
    return {
      state: 'failed',
      failure: describeTransactionError(status.err),
      confirmationStatus: status.confirmationStatus,
    };
  }
  if (status.confirmationStatus !== 'finalized') {
    return { state: 'submitted', confirmationStatus: status.confirmationStatus };
  }
  if (observation.account === 'unavailable' || observation.transaction === 'unavailable') {
    return {
      state: 'unknown',
      reason: 'the transaction is finalized but the record could not be read yet',
      confirmationStatus: 'finalized',
    };
  }
  if (observation.account === null) {
    return {
      state: 'unknown',
      reason: 'the transaction is finalized but the node does not serve the record yet',
      confirmationStatus: 'finalized',
    };
  }
  if (observation.account.owner !== expectation.programId) {
    return {
      state: 'failed',
      failure: {
        code: 'record_mismatch',
        programErrorCode: null,
        programError: null,
        message: `the record address is owned by ${observation.account.owner}, not the registry program`,
      },
      confirmationStatus: 'finalized',
    };
  }
  let record: VersionRecord;
  try {
    record = decodeVersionRecord(observation.account.data);
  } catch (error) {
    return {
      state: 'failed',
      failure: {
        code: 'record_mismatch',
        programErrorCode: null,
        programError: null,
        message: `the record does not decode: ${error instanceof Error ? error.message : 'unknown'}`,
      },
      confirmationStatus: 'finalized',
    };
  }
  const comparison = compareRecordToVersion(record, expectation.binding);
  const mismatches = [...comparison.mismatches];
  if (record.publisher !== expectation.publisherAddress) {
    mismatches.push('publisher');
  }
  if (expectation.operation === 'deprecate' && record.status !== RECORD_STATUSES.deprecated) {
    mismatches.push('status');
  }
  if (expectation.operation === 'reactivate' && record.status !== RECORD_STATUSES.active) {
    mismatches.push('status');
  }
  if (mismatches.length > 0) {
    return {
      state: 'failed',
      failure: {
        code: 'record_mismatch',
        programErrorCode: null,
        programError: null,
        message: `the record on chain differs from the version in ${mismatches.join(', ')}`,
      },
      confirmationStatus: 'finalized',
    };
  }
  const slot = observation.transaction?.slot ?? status.slot;
  const blockTime = observation.transaction?.blockTime ?? null;
  return {
    state: 'registered',
    confirmationStatus: 'finalized',
    record,
    recordData: observation.account.data,
    evidence: {
      signature: expectation.signature,
      slot,
      blockTime: blockTime === null ? null : new Date(blockTime * 1000).toISOString(),
      recordAddress: expectation.recordAddress,
      publisher: record.publisher,
      status: statusName(record.status),
      transactionUrl: explorerUrl(expectation.cluster, 'tx', expectation.signature),
      recordUrl: explorerUrl(expectation.cluster, 'address', expectation.recordAddress),
    },
  };
}

/** Human-readable hash of a decoded record for logs and diagnostics. */
export function recordSummary(record: VersionRecord): string {
  return `${bytesToHex(record.manifestHash).slice(0, 12)}… by ${record.publisher} (${statusName(record.status)}, ${record.legs.length} legs)`;
}
