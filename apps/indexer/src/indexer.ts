import type { MarkovConfig } from '@markov/config';
import {
  countRegistryRecords,
  type Database,
  findVersionById,
  listPublicationsInStates,
  type StrategyPublicationRow,
  updatePublication,
  upsertRegistryRecord,
  writeIndexerState,
} from '@markov/db';
import type { Logger } from '@markov/observability';
import {
  bytesToBase64,
  bytesToHex,
  decodeVersionRecord,
  derivePublicationOutcome,
  observeSubmission,
  RECORD_SPACE,
  RECORD_STATUSES,
  RELATIONS,
  type TokenProgramName,
  tokenProgramName,
  type VersionRecord,
  versionRecordFilter,
} from '@markov/registry';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';

export interface IndexerDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly genesisHash: string;
  readonly rpc: SolanaRpcClient;
  readonly logger: Logger;
  readonly now?: () => Date;
  /** Upper bound on program accounts read per pass; more than this is logged and left for the next pass. */
  readonly maxAccountsPerPass?: number;
}

export interface IndexerPassReport {
  readonly programId: string;
  readonly publicationsChecked: number;
  readonly publicationsChanged: number;
  readonly accountsObserved: number;
  readonly recordsIndexed: number;
  readonly observedSlot: number | null;
  readonly errors: readonly string[];
  readonly ranAt: string;
}

const PENDING: readonly ('submitted' | 'unknown' | 'awaiting_signature')[] = [
  'submitted',
  'unknown',
  'awaiting_signature',
];

function statusName(status: number): 'active' | 'deprecated' {
  return status === RECORD_STATUSES.deprecated ? 'deprecated' : 'active';
}

function relationName(relation: number): 'none' | 'revision' | 'fork' {
  return (['none', 'revision', 'fork'] as const)[relation] ?? 'none';
}

async function mirrorRecord(
  deps: IndexerDeps,
  input: {
    readonly address: string;
    readonly programId: string;
    readonly record: VersionRecord;
    readonly data: Uint8Array;
    readonly observedSlot: number;
    readonly signature: string | null;
  },
): Promise<void> {
  await upsertRegistryRecord(deps.db, {
    address: input.address,
    programId: input.programId,
    genesisHash: deps.genesisHash,
    publisher: input.record.publisher,
    status: statusName(input.record.status),
    layoutVersion: input.record.layoutVersion,
    schemaVersion: input.record.schemaVersion,
    relation: relationName(input.record.relation),
    parentManifestHash:
      input.record.relation === RELATIONS.none ? null : bytesToHex(input.record.parentManifestHash),
    manifestHash: bytesToHex(input.record.manifestHash),
    contentDigest: bytesToHex(input.record.contentDigest),
    cashWeightBps: input.record.cashWeightBps,
    legs: input.record.legs.map((leg) => ({
      mint: leg.mint,
      tokenProgram: (tokenProgramName(leg.tokenProgram) ?? 'spl-token') as TokenProgramName,
      weightBps: leg.weightBps,
    })),
    registeredSlot: Number(input.record.registeredSlot),
    registeredUnixTime: Number(input.record.registeredUnixTime),
    statusUpdatedSlot: Number(input.record.statusUpdatedSlot),
    data: bytesToBase64(input.data),
    signature: input.signature,
    observedSlot: input.observedSlot,
    now: (deps.now ?? (() => new Date()))(),
  });
}

/** Follow one in-flight publication to whatever the chain says now. */
async function followPublication(deps: IndexerDeps, row: StrategyPublicationRow): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const at = now();
  if (row.state === 'awaiting_signature') {
    try {
      const height = await deps.rpc.getBlockHeight('finalized');
      if (height > row.lastValidBlockHeight) {
        await updatePublication(
          deps.db,
          row.id,
          {
            state: 'expired',
            lastCheckedAt: at,
            failure: {
              code: 'blockhash_expired',
              programErrorCode: null,
              programError: null,
              message:
                'the transaction was not signed before its blockhash expired; prepare the publication again',
            },
          },
          at,
        );
        return true;
      }
    } catch (error) {
      if (!(error instanceof SolanaRpcError)) {
        throw error;
      }
    }
    return false;
  }
  if (!row.signature) {
    return false;
  }
  const version = await findVersionById(deps.db, row.versionId);
  if (!version) {
    return false;
  }
  const legs = version.legs.flatMap((leg) => {
    const tokenProgram: TokenProgramName | 'unknown' = leg.admission.tokenProgram;
    return tokenProgram === 'unknown'
      ? []
      : [{ mint: leg.admission.mint, tokenProgram, weightBps: leg.weightBps }];
  });
  const observation = await observeSubmission(
    deps.rpc,
    { signature: row.signature, recordAddress: row.recordAddress },
    now,
  );
  // The relation and parent the record carries are whatever the publisher registered;
  // the indexer compares economic content and leaves lineage to the record itself.
  const relation =
    observation.account !== 'unavailable' && observation.account
      ? (() => {
          try {
            const decoded = decodeVersionRecord(observation.account.data);
            return {
              relation: relationName(decoded.relation),
              parentManifestHash:
                decoded.relation === RELATIONS.none ? null : bytesToHex(decoded.parentManifestHash),
            };
          } catch {
            return { relation: 'none' as const, parentManifestHash: null };
          }
        })()
      : { relation: 'none' as const, parentManifestHash: null };
  const outcome = derivePublicationOutcome(
    {
      operation: row.operation as 'register' | 'deprecate' | 'reactivate',
      programId: row.programId,
      cluster: deps.config.solana.cluster,
      signature: row.signature,
      lastValidBlockHeight: row.lastValidBlockHeight,
      recordAddress: row.recordAddress,
      publisherAddress: row.publisherAddress,
      binding: {
        manifestHash: version.manifestHash,
        contentDigest: version.contentDigest,
        legs,
        cashWeightBps: version.cashWeightBps,
        ...relation,
      },
    },
    observation,
  );
  if (outcome.state === 'registered') {
    await mirrorRecord(deps, {
      address: row.recordAddress,
      programId: row.programId,
      record: outcome.record,
      data: outcome.recordData,
      observedSlot: outcome.evidence.slot,
      signature: row.operation === 'register' ? row.signature : null,
    });
  }
  const changed = outcome.state !== row.state;
  await updatePublication(
    deps.db,
    row.id,
    {
      state: outcome.state,
      lastCheckedAt: at,
      ...('confirmationStatus' in outcome
        ? { confirmationStatus: outcome.confirmationStatus ?? null }
        : {}),
      ...(outcome.state === 'registered'
        ? { evidence: outcome.evidence, failure: null }
        : outcome.state === 'failed' || outcome.state === 'expired'
          ? { failure: outcome.failure }
          : {}),
    },
    at,
  );
  return changed;
}

/**
 * One indexing pass: follow pending publications, then mirror every record
 * account the program owns (permissionless registrations included). The
 * pass never throws on a network failure; it records the error and moves on.
 */
export async function runIndexerPass(deps: IndexerDeps): Promise<IndexerPassReport | null> {
  const programId = deps.config.registry.programId;
  if (programId === null) {
    deps.logger.info('no registry program configured; indexer idle');
    return null;
  }
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];
  let publicationsChecked = 0;
  let publicationsChanged = 0;
  const pending = await listPublicationsInStates(deps.db, PENDING, 200);
  for (const row of pending) {
    publicationsChecked += 1;
    try {
      if (await followPublication(deps, row)) {
        publicationsChanged += 1;
      }
    } catch (error) {
      errors.push(
        `publication ${row.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  let accountsObserved = 0;
  let observedSlot: number | null = null;
  try {
    observedSlot = await deps.rpc.getSlot('finalized');
    const accounts = await deps.rpc.getProgramAccounts(programId, 'finalized', [
      { dataSize: RECORD_SPACE },
      { memcmp: versionRecordFilter() },
    ]);
    const limit = deps.maxAccountsPerPass ?? 5_000;
    if (accounts.length > limit) {
      errors.push(`program has ${accounts.length} records; only ${limit} mirrored this pass`);
    }
    for (const account of accounts.slice(0, limit)) {
      try {
        const record = decodeVersionRecord(account.data);
        await mirrorRecord(deps, {
          address: account.pubkey,
          programId,
          record,
          data: account.data,
          observedSlot,
          signature: null,
        });
        accountsObserved += 1;
      } catch (error) {
        errors.push(
          `record ${account.pubkey}: ${error instanceof Error ? error.message : 'undecodable'}`,
        );
      }
    }
  } catch (error) {
    errors.push(
      `program accounts: ${error instanceof SolanaRpcError ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const recordsIndexed = await countRegistryRecords(deps.db, programId);
  const ranAt = now();
  await writeIndexerState(deps.db, {
    programId,
    genesisHash: deps.genesisHash,
    lastRunAt: ranAt,
    lastObservedSlot: observedSlot,
    recordsIndexed,
    lastError: errors[0] ?? null,
  });
  const report: IndexerPassReport = {
    programId,
    publicationsChecked,
    publicationsChanged,
    accountsObserved,
    recordsIndexed,
    observedSlot,
    errors,
    ranAt: ranAt.toISOString(),
  };
  deps.logger.info(report, 'registry indexer pass');
  return report;
}
