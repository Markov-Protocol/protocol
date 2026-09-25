import type {
  PublicationFailure,
  PublicationLifecycle,
  PublicationOperation,
  RegistrationEvidence,
  RegistryRecord,
} from '@markov/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  registryIndexerState,
  registryRecords,
  strategies,
  strategyPublications,
  strategyVersions,
  walletLinks,
} from './schema.js';
import type { StrategyVersionRow } from './strategy-store.js';

/**
 * Registry persistence (B08). Publications record the owner's attempts to
 * register a version with a verified wallet; registry records mirror what
 * the indexer has read from finalized chain state. Every state written here
 * is derived from what the chain reported; the store never marks anything
 * registered on its own.
 */
export type StrategyPublicationRow = typeof strategyPublications.$inferSelect;
export type RegistryRecordRow = typeof registryRecords.$inferSelect;
export type RegistryIndexerStateRow = typeof registryIndexerState.$inferSelect;

const IN_FLIGHT: readonly PublicationLifecycle[] = ['validated', 'awaiting_signature', 'submitted'];

export interface NewPublication {
  readonly versionId: string;
  readonly strategyId: string;
  readonly ownerUserId: string;
  readonly operation: PublicationOperation;
  readonly programId: string;
  readonly genesisHash: string;
  readonly recordAddress: string;
  readonly publisherWalletId: string;
  readonly publisherAddress: string;
  readonly manifestHash: string;
  readonly contentDigest: string;
  readonly unsignedTransaction: string;
  readonly message: string;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly estimatedCostLamports: number;
  readonly now: Date;
}

export type CreatePublicationResult =
  | { readonly outcome: 'created'; readonly publication: StrategyPublicationRow }
  | { readonly outcome: 'in_flight'; readonly publication: StrategyPublicationRow };

/**
 * Create a publication unless one of the same operation is already in
 * flight for the version, in which case that one is answered. The version
 * row is locked so two concurrent prepares cannot both succeed.
 */
export async function createPublication(
  db: Database,
  input: NewPublication,
): Promise<CreatePublicationResult> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: strategyVersions.id })
      .from(strategyVersions)
      .where(eq(strategyVersions.id, input.versionId))
      .for('update');
    const existing = await tx
      .select()
      .from(strategyPublications)
      .where(
        and(
          eq(strategyPublications.versionId, input.versionId),
          eq(strategyPublications.operation, input.operation),
          inArray(strategyPublications.state, [...IN_FLIGHT]),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { outcome: 'in_flight', publication: existing[0] };
    }
    const rows = await tx
      .insert(strategyPublications)
      .values({
        versionId: input.versionId,
        strategyId: input.strategyId,
        ownerUserId: input.ownerUserId,
        operation: input.operation,
        state: 'awaiting_signature',
        programId: input.programId,
        genesisHash: input.genesisHash,
        recordAddress: input.recordAddress,
        publisherWalletId: input.publisherWalletId,
        publisherAddress: input.publisherAddress,
        manifestHash: input.manifestHash,
        contentDigest: input.contentDigest,
        unsignedTransaction: input.unsignedTransaction,
        message: input.message,
        recentBlockhash: input.recentBlockhash,
        lastValidBlockHeight: input.lastValidBlockHeight,
        estimatedCostLamports: input.estimatedCostLamports,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    const publication = rows[0];
    if (!publication) {
      throw new Error('publication insert returned no row');
    }
    if (input.operation === 'register') {
      await tx
        .update(strategyVersions)
        .set({ publication: 'awaiting_signature' })
        .where(
          and(
            eq(strategyVersions.id, input.versionId),
            inArray(strategyVersions.publication, [
              'unpublished',
              'validated',
              'failed',
              'expired',
              'unknown',
            ]),
          ),
        );
    }
    return { outcome: 'created', publication };
  });
}

export async function findPublication(
  db: Database,
  ownerUserId: string,
  publicationId: string,
): Promise<StrategyPublicationRow | null> {
  const rows = await db
    .select()
    .from(strategyPublications)
    .where(
      and(
        eq(strategyPublications.id, publicationId),
        eq(strategyPublications.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Any publication by id, unscoped: for the indexer and internal refreshes only. */
export async function findPublicationById(
  db: Database,
  publicationId: string,
): Promise<StrategyPublicationRow | null> {
  const rows = await db
    .select()
    .from(strategyPublications)
    .where(eq(strategyPublications.id, publicationId))
    .limit(1);
  return rows[0] ?? null;
}

/** The newest publication of a version for an operation, whatever its state. */
export async function latestPublication(
  db: Database,
  ownerUserId: string,
  versionId: string,
  operation: PublicationOperation,
): Promise<StrategyPublicationRow | null> {
  const rows = await db
    .select()
    .from(strategyPublications)
    .where(
      and(
        eq(strategyPublications.versionId, versionId),
        eq(strategyPublications.ownerUserId, ownerUserId),
        eq(strategyPublications.operation, operation),
      ),
    )
    .orderBy(desc(strategyPublications.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Publications the indexer must follow up (submitted, or awaiting a signature that may have expired). */
export async function listPublicationsInStates(
  db: Database,
  states: readonly PublicationLifecycle[],
  limit: number,
): Promise<StrategyPublicationRow[]> {
  return db
    .select()
    .from(strategyPublications)
    .where(inArray(strategyPublications.state, [...states]))
    .orderBy(strategyPublications.updatedAt)
    .limit(limit);
}

export interface PublicationPatch {
  readonly state?: PublicationLifecycle;
  readonly confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
  readonly signature?: string | null;
  readonly submittedAt?: Date | null;
  readonly evidence?: RegistrationEvidence | null;
  readonly failure?: PublicationFailure | null;
  readonly lastCheckedAt?: Date | null;
}

/**
 * Apply a state change and keep the version's `publication` column and
 * `publisherWallet` in step for registrations. A registration that has
 * reached `registered` is terminal: later patches cannot move it back.
 */
export async function updatePublication(
  db: Database,
  publicationId: string,
  patch: PublicationPatch,
  now: Date,
): Promise<StrategyPublicationRow | null> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(strategyPublications)
      .where(eq(strategyPublications.id, publicationId))
      .for('update');
    const current = locked[0];
    if (!current) {
      return null;
    }
    if (
      current.state === 'registered' &&
      patch.state !== undefined &&
      patch.state !== 'registered'
    ) {
      return current;
    }
    const rows = await tx
      .update(strategyPublications)
      .set({
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.confirmationStatus !== undefined
          ? { confirmationStatus: patch.confirmationStatus }
          : {}),
        ...(patch.signature !== undefined ? { signature: patch.signature } : {}),
        ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
        ...(patch.evidence !== undefined ? { evidence: patch.evidence } : {}),
        ...(patch.failure !== undefined ? { failure: patch.failure } : {}),
        ...(patch.lastCheckedAt !== undefined ? { lastCheckedAt: patch.lastCheckedAt } : {}),
        updatedAt: now,
      })
      .where(eq(strategyPublications.id, publicationId))
      .returning();
    const updated = rows[0];
    if (!updated) {
      throw new Error('publication update returned no row');
    }
    if (updated.operation === 'register' && patch.state !== undefined) {
      await tx
        .update(strategyVersions)
        .set(
          patch.state === 'registered'
            ? { publication: 'registered', publisherWallet: updated.publisherAddress }
            : { publication: patch.state },
        )
        .where(
          and(
            eq(strategyVersions.id, updated.versionId),
            sql`${strategyVersions.publication} <> 'registered'`,
          ),
        );
    }
    return updated;
  });
}

/* ------------------------------------------------------- registry records */

export interface ObservedRecord {
  readonly address: string;
  readonly programId: string;
  readonly genesisHash: string;
  readonly publisher: string;
  readonly status: 'active' | 'deprecated';
  readonly layoutVersion: number;
  readonly schemaVersion: number;
  readonly relation: 'none' | 'revision' | 'fork';
  readonly parentManifestHash: string | null;
  readonly manifestHash: string;
  readonly contentDigest: string;
  readonly cashWeightBps: number;
  readonly legs: RegistryRecord['legs'];
  readonly registeredSlot: number;
  readonly registeredUnixTime: number;
  readonly statusUpdatedSlot: number;
  readonly data: string;
  readonly signature: string | null;
  readonly observedSlot: number;
  readonly now: Date;
}

/** Insert or refresh a record read from the chain; links it to the version carrying its manifest hash. */
export async function upsertRegistryRecord(
  db: Database,
  input: ObservedRecord,
): Promise<RegistryRecordRow> {
  const matching = await db
    .select({ id: strategyVersions.id })
    .from(strategyVersions)
    .where(eq(strategyVersions.manifestHash, input.manifestHash))
    .limit(1);
  const versionId = matching[0]?.id ?? null;
  const rows = await db
    .insert(registryRecords)
    .values({
      address: input.address,
      programId: input.programId,
      genesisHash: input.genesisHash,
      publisher: input.publisher,
      status: input.status,
      layoutVersion: input.layoutVersion,
      schemaVersion: input.schemaVersion,
      relation: input.relation,
      parentManifestHash: input.parentManifestHash,
      manifestHash: input.manifestHash,
      contentDigest: input.contentDigest,
      cashWeightBps: input.cashWeightBps,
      legs: input.legs,
      registeredSlot: input.registeredSlot,
      registeredUnixTime: input.registeredUnixTime,
      statusUpdatedSlot: input.statusUpdatedSlot,
      data: input.data,
      versionId,
      signature: input.signature,
      observedSlot: input.observedSlot,
      firstSeenAt: input.now,
      observedAt: input.now,
    })
    .onConflictDoUpdate({
      target: registryRecords.address,
      set: {
        status: input.status,
        statusUpdatedSlot: input.statusUpdatedSlot,
        data: input.data,
        versionId,
        signature: sql`coalesce(${registryRecords.signature}, ${input.signature})`,
        observedSlot: input.observedSlot,
        observedAt: input.now,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('registry record upsert returned no row');
  }
  return row;
}

export async function findRegistryRecord(
  db: Database,
  address: string,
): Promise<RegistryRecordRow | null> {
  const rows = await db
    .select()
    .from(registryRecords)
    .where(eq(registryRecords.address, address))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRegistryRecordByManifestHash(
  db: Database,
  programId: string,
  manifestHash: string,
): Promise<RegistryRecordRow | null> {
  const rows = await db
    .select()
    .from(registryRecords)
    .where(
      and(eq(registryRecords.programId, programId), eq(registryRecords.manifestHash, manifestHash)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function countRegistryRecords(db: Database, programId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registryRecords)
    .where(eq(registryRecords.programId, programId));
  return rows[0]?.count ?? 0;
}

/* --------------------------------------------------------- public reads */

export interface PublicVersionRead {
  readonly version: StrategyVersionRow;
  readonly record: RegistryRecordRow;
  readonly publication: StrategyPublicationRow | null;
}

/** A registered, unmoderated version with its indexed record; null unless it is public. */
export async function findPublicVersion(
  db: Database,
  strategyId: string,
  versionId: string,
): Promise<PublicVersionRead | null> {
  const rows = await db
    .select({ version: strategyVersions, record: registryRecords })
    .from(strategyVersions)
    .innerJoin(registryRecords, eq(registryRecords.versionId, strategyVersions.id))
    .where(
      and(
        eq(strategyVersions.id, versionId),
        eq(strategyVersions.strategyId, strategyId),
        eq(strategyVersions.publication, 'registered'),
        eq(strategyVersions.moderation, 'none'),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const publications = await db
    .select()
    .from(strategyPublications)
    .where(
      and(
        eq(strategyPublications.versionId, versionId),
        eq(strategyPublications.operation, 'register'),
        eq(strategyPublications.state, 'registered'),
      ),
    )
    .orderBy(desc(strategyPublications.updatedAt))
    .limit(1);
  return { version: row.version, record: row.record, publication: publications[0] ?? null };
}

export interface PublicStrategyRead {
  readonly strategy: typeof strategies.$inferSelect;
  readonly versions: readonly {
    readonly version: StrategyVersionRow;
    readonly record: RegistryRecordRow;
  }[];
}

/** A strategy's registered, unmoderated versions, newest first; null when none is public. */
export async function findPublicStrategy(
  db: Database,
  strategyId: string,
): Promise<PublicStrategyRead | null> {
  const strategyRows = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);
  const strategy = strategyRows[0];
  if (!strategy) {
    return null;
  }
  const versions = await db
    .select({ version: strategyVersions, record: registryRecords })
    .from(strategyVersions)
    .innerJoin(registryRecords, eq(registryRecords.versionId, strategyVersions.id))
    .where(
      and(
        eq(strategyVersions.strategyId, strategyId),
        eq(strategyVersions.publication, 'registered'),
        eq(strategyVersions.moderation, 'none'),
      ),
    )
    .orderBy(desc(strategyVersions.versionNumber));
  if (versions.length === 0) {
    return null;
  }
  return { strategy, versions };
}

/** The wallet a publication signs with must be one of the owner's verified wallets on this network. */
export async function findOwnedWallet(
  db: Database,
  ownerUserId: string,
  walletId: string,
): Promise<typeof walletLinks.$inferSelect | null> {
  const rows = await db
    .select()
    .from(walletLinks)
    .where(
      and(
        eq(walletLinks.id, walletId),
        eq(walletLinks.userId, ownerUserId),
        sql`${walletLinks.unlinkedAt} IS NULL`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/* --------------------------------------------------------- indexer state */

export async function readIndexerState(
  db: Database,
  programId: string,
): Promise<RegistryIndexerStateRow | null> {
  const rows = await db
    .select()
    .from(registryIndexerState)
    .where(eq(registryIndexerState.programId, programId))
    .limit(1);
  return rows[0] ?? null;
}

export async function writeIndexerState(
  db: Database,
  input: {
    readonly programId: string;
    readonly genesisHash: string;
    readonly lastRunAt: Date;
    readonly lastObservedSlot: number | null;
    readonly recordsIndexed: number;
    readonly lastError: string | null;
  },
): Promise<void> {
  await db
    .insert(registryIndexerState)
    .values({
      programId: input.programId,
      genesisHash: input.genesisHash,
      lastRunAt: input.lastRunAt,
      lastObservedSlot: input.lastObservedSlot,
      recordsIndexed: input.recordsIndexed,
      lastError: input.lastError,
      updatedAt: input.lastRunAt,
    })
    .onConflictDoUpdate({
      target: registryIndexerState.programId,
      set: {
        lastRunAt: input.lastRunAt,
        lastObservedSlot: input.lastObservedSlot,
        recordsIndexed: input.recordsIndexed,
        lastError: input.lastError,
        updatedAt: input.lastRunAt,
      },
    });
}
