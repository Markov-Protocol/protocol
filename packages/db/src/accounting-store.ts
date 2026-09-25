import type {
  ExternalFlowAcknowledgementRequest,
  JournalEntry,
  Lot,
  LotConsumption,
  ReceiptBody,
  ReconciliationCheckpoint,
} from '@markov/contracts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  executionFills,
  executionPlans,
  intents,
  journalEntries,
  journalLines,
  lotConsumptions,
  lots,
  portfolioInstances,
  receiptSigningKeys,
  receipts,
  reconciliationCheckpoints,
  strategyVersions,
} from './schema.js';

/**
 * Accounting persistence (B12). Journal entries are inserted with their
 * lines in one transaction and are unique per owner and source reference,
 * so a repeated observation leaves nothing behind; lots and consumptions
 * are written with the entries that open or consume them; checkpoints and
 * receipts are append-only.
 */
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type JournalLineRow = typeof journalLines.$inferSelect;
export type LotRow = typeof lots.$inferSelect;
export type LotConsumptionRow = typeof lotConsumptions.$inferSelect;
export type ReconciliationCheckpointRow = typeof reconciliationCheckpoints.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type ReceiptSigningKeyRow = typeof receiptSigningKeys.$inferSelect;

function toEntry(row: JournalEntryRow, lines: readonly JournalLineRow[]): JournalEntry {
  return {
    entryId: row.id,
    ownerUserId: row.ownerUserId,
    walletId: row.walletId,
    instanceId: row.instanceId,
    kind: row.kind as JournalEntry['kind'],
    source: { kind: row.sourceKind as JournalEntry['source']['kind'], ref: row.sourceRef },
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    reversesEntryId: row.reversesEntryId,
    attribution: row.attribution as JournalEntry['attribution'],
    acknowledgement:
      row.acknowledgementKind && row.acknowledgedAt
        ? {
            kind: row.acknowledgementKind as NonNullable<JournalEntry['acknowledgement']>['kind'],
            note: row.acknowledgementNote,
            acknowledgedAt: row.acknowledgedAt.toISOString(),
          }
        : null,
    memo: row.memo,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        account: line.account as JournalEntry['lines'][number]['account'],
        asset: line.asset,
        symbol: line.symbol,
        decimals: line.decimals,
        deltaRaw: line.deltaRaw,
        lotId: line.lotId,
      })),
  };
}

export function toLot(row: LotRow): Lot {
  return {
    lotId: row.id,
    ownerUserId: row.ownerUserId,
    walletId: row.walletId,
    instanceId: row.instanceId,
    intentId: row.intentId,
    asset: row.asset,
    symbol: row.symbol,
    decimals: row.decimals,
    openedAt: row.openedAt.toISOString(),
    quantityRaw: row.quantityRaw,
    remainingRaw: row.remainingRaw,
    costAsset: row.costAsset,
    costRaw: row.costRaw,
    feeLamports: row.feeLamports,
    sourceEntryId: row.sourceEntryId,
    status: row.status as Lot['status'],
  };
}

async function linesFor(db: Database, entryIds: readonly string[]): Promise<JournalLineRow[]> {
  if (entryIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(journalLines)
    .where(inArray(journalLines.entryId, [...entryIds]))
    .orderBy(asc(journalLines.position));
}

function attachLines(rows: readonly JournalEntryRow[], lines: readonly JournalLineRow[]) {
  const byEntry = new Map<string, JournalLineRow[]>();
  for (const line of lines) {
    const bucket = byEntry.get(line.entryId) ?? [];
    bucket.push(line);
    byEntry.set(line.entryId, bucket);
  }
  return rows.map((row) => toEntry(row, byEntry.get(row.id) ?? []));
}

/** Every entry of a wallet, oldest first (bounded; the journal of one wallet is small in V1). */
export async function listJournalEntries(
  db: Database,
  ownerUserId: string,
  walletId: string,
  limit = 5000,
): Promise<JournalEntry[]> {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.ownerUserId, ownerUserId), eq(journalEntries.walletId, walletId)))
    .orderBy(asc(journalEntries.occurredAt), asc(journalEntries.recordedAt), asc(journalEntries.id))
    .limit(limit);
  return attachLines(
    rows,
    await linesFor(
      db,
      rows.map((row) => row.id),
    ),
  );
}

export async function findJournalEntry(
  db: Database,
  ownerUserId: string,
  entryId: string,
): Promise<JournalEntry | null> {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.ownerUserId, ownerUserId), eq(journalEntries.id, entryId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return toEntry(row, await linesFor(db, [row.id]));
}

/**
 * Appends entries with their lines; an entry whose owner and source
 * reference already exist is skipped (its lines are not written twice).
 * Answers the ids that were appended.
 */
export async function appendJournalEntries(
  db: Database,
  entries: readonly JournalEntry[],
): Promise<string[]> {
  if (entries.length === 0) {
    return [];
  }
  return db.transaction(async (tx) => {
    const appended: string[] = [];
    for (const entry of entries) {
      const inserted = await tx
        .insert(journalEntries)
        .values({
          id: entry.entryId,
          ownerUserId: entry.ownerUserId,
          walletId: entry.walletId,
          instanceId: entry.instanceId,
          kind: entry.kind,
          sourceKind: entry.source.kind,
          sourceRef: entry.source.ref,
          occurredAt: new Date(entry.occurredAt),
          recordedAt: new Date(entry.recordedAt),
          reversesEntryId: entry.reversesEntryId,
          attribution: entry.attribution,
          acknowledgementKind: entry.acknowledgement?.kind ?? null,
          acknowledgementNote: entry.acknowledgement?.note ?? null,
          acknowledgedAt: entry.acknowledgement
            ? new Date(entry.acknowledgement.acknowledgedAt)
            : null,
          memo: entry.memo,
        })
        .onConflictDoNothing({ target: [journalEntries.ownerUserId, journalEntries.sourceRef] })
        .returning({ id: journalEntries.id });
      if (inserted.length === 0) {
        continue;
      }
      appended.push(entry.entryId);
      await tx.insert(journalLines).values(
        entry.lines.map((line, position) => ({
          entryId: entry.entryId,
          position,
          account: line.account,
          asset: line.asset,
          symbol: line.symbol,
          decimals: line.decimals,
          deltaRaw: line.deltaRaw,
          lotId: line.lotId,
        })),
      );
    }
    return appended;
  });
}

/** The owner's explanation of an external flow; the attribution becomes wallet-level (`unassigned`). */
export async function acknowledgeJournalEntry(
  db: Database,
  input: {
    readonly ownerUserId: string;
    readonly entryId: string;
    readonly acknowledgement: ExternalFlowAcknowledgementRequest;
    readonly now: Date;
  },
): Promise<JournalEntry | null> {
  const rows = await db
    .update(journalEntries)
    .set({
      attribution: 'unassigned',
      acknowledgementKind: input.acknowledgement.kind,
      acknowledgementNote: input.acknowledgement.note,
      acknowledgedAt: input.now,
    })
    .where(
      and(
        eq(journalEntries.ownerUserId, input.ownerUserId),
        eq(journalEntries.id, input.entryId),
        eq(journalEntries.attribution, 'needs_reconciliation'),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) {
    return null;
  }
  return toEntry(row, await linesFor(db, [row.id]));
}

/** Assets of a wallet with an external flow the owner has not explained yet. */
export async function listPendingFlowAssets(
  db: Database,
  ownerUserId: string,
  walletId: string,
): Promise<{ readonly entryId: string; readonly asset: string }[]> {
  const rows = await db
    .select({ entryId: journalEntries.id, asset: journalLines.asset })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.ownerUserId, ownerUserId),
        eq(journalEntries.walletId, walletId),
        eq(journalEntries.attribution, 'needs_reconciliation'),
        eq(journalLines.account, 'wallet'),
      ),
    );
  return rows;
}

/* --------------------------------------------------------------- projection */

export interface ProjectableFill {
  readonly fill: {
    readonly fillId: string;
    readonly intentId: string;
    readonly planId: string;
    readonly attemptId: string;
    readonly ownerUserId: string;
    readonly legIndex: number;
    readonly signature: string;
    readonly slot: number;
    readonly blockTime: Date | null;
    readonly side: string;
    readonly inputMint: string;
    readonly outputMint: string;
    readonly inputSpentRaw: string;
    readonly outputReceivedRaw: string;
    readonly feeLamports: string;
    readonly lamportsSpent: string;
    readonly observedAt: Date;
  };
  readonly intent: {
    readonly kind: string;
    readonly walletId: string;
    readonly strategyId: string | null;
    readonly versionId: string | null;
  };
  readonly leg: {
    readonly inputSymbol: string;
    readonly inputDecimals: number;
    readonly outputSymbol: string;
    readonly outputDecimals: number;
  } | null;
}

/** Fills whose journal entry does not exist yet (by the fill's source reference), oldest first. */
export async function listUnjournaledFills(
  db: Database,
  input: { readonly ownerUserId: string | null; readonly limit: number },
): Promise<ProjectableFill[]> {
  const conditions = [
    sql`NOT EXISTS (SELECT 1 FROM ${journalEntries} WHERE ${journalEntries.ownerUserId} = ${executionFills.ownerUserId} AND ${journalEntries.sourceRef} = 'fill:' || ${executionFills.signature} || ':' || ${executionFills.legIndex}::text)`,
  ];
  if (input.ownerUserId !== null) {
    conditions.push(eq(executionFills.ownerUserId, input.ownerUserId));
  }
  const rows = await db
    .select({
      fill: executionFills,
      intent: {
        kind: intents.kind,
        walletId: intents.walletId,
        strategyId: intents.strategyId,
        versionId: intents.versionId,
      },
      plan: executionPlans.plan,
    })
    .from(executionFills)
    .innerJoin(intents, eq(intents.id, executionFills.intentId))
    .innerJoin(executionPlans, eq(executionPlans.id, executionFills.planId))
    .where(and(...conditions))
    .orderBy(asc(executionFills.slot), asc(executionFills.createdAt), asc(executionFills.legIndex))
    .limit(input.limit);
  return rows.map((row) => {
    const leg = row.plan.legs.find((entry) => entry.legIndex === row.fill.legIndex) ?? null;
    return {
      fill: {
        fillId: row.fill.id,
        intentId: row.fill.intentId,
        planId: row.fill.planId,
        attemptId: row.fill.attemptId,
        ownerUserId: row.fill.ownerUserId,
        legIndex: row.fill.legIndex,
        signature: row.fill.signature,
        slot: row.fill.slot,
        blockTime: row.fill.blockTime,
        side: row.fill.side,
        inputMint: row.fill.inputMint,
        outputMint: row.fill.outputMint,
        inputSpentRaw: row.fill.inputSpentRaw,
        outputReceivedRaw: row.fill.outputReceivedRaw,
        feeLamports: row.fill.feeLamports,
        lamportsSpent: row.fill.lamportsSpent,
        observedAt: row.fill.observedAt,
      },
      intent: row.intent,
      leg:
        leg === null
          ? null
          : {
              inputSymbol: leg.inputSymbol,
              inputDecimals: leg.inputDecimals,
              outputSymbol: leg.outputSymbol,
              outputDecimals: leg.outputDecimals,
            },
    };
  });
}

export interface AttributionInstanceRow {
  readonly instanceId: string;
  readonly walletId: string;
  readonly strategyId: string;
  readonly pinnedVersionId: string;
  readonly status: string;
}

export async function listAttributionInstances(
  db: Database,
  ownerUserId: string,
): Promise<AttributionInstanceRow[]> {
  const rows = await db
    .select({
      instanceId: portfolioInstances.id,
      walletId: portfolioInstances.walletId,
      strategyId: portfolioInstances.strategyId,
      pinnedVersionId: portfolioInstances.pinnedVersionId,
      status: portfolioInstances.status,
    })
    .from(portfolioInstances)
    .where(eq(portfolioInstances.ownerUserId, ownerUserId));
  return rows;
}

/** The strategy a frozen version belongs to (for attributing a basket whose intent stores only the version). */
export async function strategyIdOfVersion(db: Database, versionId: string): Promise<string | null> {
  const rows = await db
    .select({ strategyId: strategyVersions.strategyId })
    .from(strategyVersions)
    .where(eq(strategyVersions.id, versionId))
    .limit(1);
  return rows[0]?.strategyId ?? null;
}

/* --------------------------------------------------------------------- lots */

export async function listOpenLots(
  db: Database,
  input: { readonly ownerUserId: string; readonly walletId: string; readonly asset: string },
): Promise<Lot[]> {
  const rows = await db
    .select()
    .from(lots)
    .where(
      and(
        eq(lots.ownerUserId, input.ownerUserId),
        eq(lots.walletId, input.walletId),
        eq(lots.asset, input.asset),
        eq(lots.status, 'open'),
      ),
    )
    .orderBy(asc(lots.openedAt), asc(lots.id));
  return rows.map(toLot);
}

export async function listLotsForInstance(
  db: Database,
  ownerUserId: string,
  instanceId: string,
): Promise<Lot[]> {
  const rows = await db
    .select()
    .from(lots)
    .where(and(eq(lots.ownerUserId, ownerUserId), eq(lots.instanceId, instanceId)))
    .orderBy(asc(lots.openedAt), asc(lots.id));
  return rows.map(toLot);
}

export async function listLotsForWallet(
  db: Database,
  ownerUserId: string,
  walletId: string,
): Promise<Lot[]> {
  const rows = await db
    .select()
    .from(lots)
    .where(and(eq(lots.ownerUserId, ownerUserId), eq(lots.walletId, walletId)))
    .orderBy(asc(lots.openedAt), asc(lots.id));
  return rows.map(toLot);
}

/**
 * Writes the outcome of one fill's projection atomically: its entries (skipped
 * when already present), the lot a buy opens, and the consumptions and lot
 * updates a sell produces. Answers whether the fill entry was appended.
 */
export async function appendFillProjection(
  db: Database,
  input: {
    readonly entries: readonly JournalEntry[];
    readonly lot: Lot | null;
    readonly consumptions: readonly LotConsumption[];
    readonly lotUpdates: readonly Lot[];
  },
): Promise<{ readonly appended: string[] }> {
  return db.transaction(async (tx) => {
    const appended = await appendJournalEntries(tx as unknown as Database, input.entries);
    if (appended.length === 0) {
      return { appended };
    }
    if (input.lot) {
      await tx.insert(lots).values({
        id: input.lot.lotId,
        ownerUserId: input.lot.ownerUserId,
        walletId: input.lot.walletId,
        instanceId: input.lot.instanceId,
        intentId: input.lot.intentId,
        asset: input.lot.asset,
        symbol: input.lot.symbol,
        decimals: input.lot.decimals,
        openedAt: new Date(input.lot.openedAt),
        quantityRaw: input.lot.quantityRaw,
        remainingRaw: input.lot.remainingRaw,
        costAsset: input.lot.costAsset,
        costRaw: input.lot.costRaw,
        feeLamports: input.lot.feeLamports,
        sourceEntryId: input.lot.sourceEntryId,
        status: input.lot.status,
      });
    }
    for (const lot of input.lotUpdates) {
      await tx
        .update(lots)
        .set({ remainingRaw: lot.remainingRaw, status: lot.status, updatedAt: new Date() })
        .where(eq(lots.id, lot.lotId));
    }
    if (input.consumptions.length > 0) {
      await tx.insert(lotConsumptions).values(
        input.consumptions.map((consumption) => ({
          id: consumption.consumptionId,
          lotId: consumption.lotId,
          entryId: consumption.entryId,
          quantityRaw: consumption.quantityRaw,
          costRaw: consumption.costRaw,
          proceedsRaw: consumption.proceedsRaw,
          consumedAt: new Date(consumption.consumedAt),
        })),
      );
    }
    return { appended };
  });
}

/* -------------------------------------------------------------- checkpoints */

export async function insertCheckpoint(
  db: Database,
  input: Omit<ReconciliationCheckpoint, 'createdAt'> & { readonly now: Date },
): Promise<ReconciliationCheckpoint> {
  const rows = await db
    .insert(reconciliationCheckpoints)
    .values({
      id: input.checkpointId,
      ownerUserId: input.ownerUserId,
      walletId: input.walletId,
      slot: input.slot,
      observedAt: new Date(input.observedAt),
      commitment: input.commitment,
      status: input.status,
      assets: input.assets,
      createdAt: input.now,
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('checkpoint insert returned no row');
  }
  return toCheckpoint(row);
}

export function toCheckpoint(row: ReconciliationCheckpointRow): ReconciliationCheckpoint {
  return {
    checkpointId: row.id,
    walletId: row.walletId,
    ownerUserId: row.ownerUserId,
    slot: row.slot,
    observedAt: row.observedAt.toISOString(),
    commitment: row.commitment as ReconciliationCheckpoint['commitment'],
    status: row.status as ReconciliationCheckpoint['status'],
    assets: row.assets,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function latestCheckpoint(
  db: Database,
  ownerUserId: string,
  walletId: string,
): Promise<ReconciliationCheckpoint | null> {
  const rows = await db
    .select()
    .from(reconciliationCheckpoints)
    .where(
      and(
        eq(reconciliationCheckpoints.ownerUserId, ownerUserId),
        eq(reconciliationCheckpoints.walletId, walletId),
      ),
    )
    .orderBy(desc(reconciliationCheckpoints.sequence))
    .limit(1);
  const row = rows[0];
  return row ? toCheckpoint(row) : null;
}

/** Wallets with journal activity, for periodic reconciliation (owner and wallet pairs). */
export async function listJournaledWallets(
  db: Database,
  limit = 100,
): Promise<{ readonly ownerUserId: string; readonly walletId: string }[]> {
  const rows = await db
    .selectDistinct({ ownerUserId: journalEntries.ownerUserId, walletId: journalEntries.walletId })
    .from(journalEntries)
    .limit(limit);
  return rows;
}

/* ----------------------------------------------------------------- receipts */

export async function upsertSigningKey(
  db: Database,
  input: {
    readonly keyId: string;
    readonly publicKey: string;
    readonly now: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(receiptSigningKeys)
      .values({
        keyId: input.keyId,
        algorithm: 'ed25519',
        publicKey: input.publicKey,
        status: 'active',
        validFrom: input.now,
        validTo: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: receiptSigningKeys.keyId,
        set: { publicKey: input.publicKey, status: 'active', validTo: null, updatedAt: input.now },
      });
    // Every other key is retired: it still verifies what it signed while active.
    await tx
      .update(receiptSigningKeys)
      .set({ status: 'retired', validTo: input.now, updatedAt: input.now })
      .where(
        and(
          sql`${receiptSigningKeys.keyId} <> ${input.keyId}`,
          eq(receiptSigningKeys.status, 'active'),
          isNull(receiptSigningKeys.validTo),
        ),
      );
  });
}

export async function listSigningKeys(db: Database): Promise<ReceiptSigningKeyRow[]> {
  return db.select().from(receiptSigningKeys).orderBy(asc(receiptSigningKeys.validFrom));
}

export async function insertReceipt(
  db: Database,
  input: {
    readonly receiptId: string;
    readonly ownerUserId: string;
    readonly kind: string;
    readonly intentId: string;
    readonly planId: string;
    readonly intentState: string;
    readonly body: ReceiptBody;
    readonly canonicalHash: string;
    readonly keyId: string;
    readonly signerPublicKey: string;
    readonly signature: string;
    readonly public: boolean;
    readonly issuedAt: Date;
  },
): Promise<{ readonly row: ReceiptRow; readonly created: boolean }> {
  const inserted = await db
    .insert(receipts)
    .values({
      id: input.receiptId,
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      intentId: input.intentId,
      planId: input.planId,
      intentState: input.intentState,
      body: input.body,
      canonicalHash: input.canonicalHash,
      keyId: input.keyId,
      signerPublicKey: input.signerPublicKey,
      signature: input.signature,
      public: input.public,
      issuedAt: input.issuedAt,
      createdAt: input.issuedAt,
    })
    .onConflictDoNothing({ target: [receipts.intentId, receipts.kind, receipts.intentState] })
    .returning();
  const row = inserted[0];
  if (row) {
    return { row, created: true };
  }
  const existing = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.intentId, input.intentId),
        eq(receipts.kind, input.kind),
        eq(receipts.intentState, input.intentState),
      ),
    )
    .limit(1);
  const found = existing[0];
  if (!found) {
    throw new Error('receipt insert conflicted but no row exists');
  }
  return { row: found, created: false };
}

export async function findReceipt(db: Database, receiptId: string): Promise<ReceiptRow | null> {
  const rows = await db.select().from(receipts).where(eq(receipts.id, receiptId)).limit(1);
  return rows[0] ?? null;
}

export async function listReceipts(
  db: Database,
  ownerUserId: string,
  limit = 100,
): Promise<ReceiptRow[]> {
  return db
    .select()
    .from(receipts)
    .where(eq(receipts.ownerUserId, ownerUserId))
    .orderBy(desc(receipts.sequence))
    .limit(limit);
}

export async function listReceiptsForIntent(
  db: Database,
  ownerUserId: string,
  intentId: string,
): Promise<ReceiptRow[]> {
  return db
    .select()
    .from(receipts)
    .where(and(eq(receipts.ownerUserId, ownerUserId), eq(receipts.intentId, intentId)))
    .orderBy(asc(receipts.sequence));
}

export async function setReceiptPublic(
  db: Database,
  ownerUserId: string,
  receiptId: string,
  isPublic: boolean,
): Promise<ReceiptRow | null> {
  const rows = await db
    .update(receipts)
    .set({ public: isPublic })
    .where(and(eq(receipts.ownerUserId, ownerUserId), eq(receipts.id, receiptId)))
    .returning();
  return rows[0] ?? null;
}

/**
 * The store port the accounting projector drives (`projectFills` in
 * `@markov/accounting`), so the API and the worker append the same entries.
 */
export function createProjectionStorePort(db: Database) {
  return {
    async listUnjournaledFills(input: {
      readonly ownerUserId: string | null;
      readonly limit: number;
    }) {
      const rows = await listUnjournaledFills(db, input);
      return rows.map((row) => ({
        fill: {
          fillId: row.fill.fillId,
          ownerUserId: row.fill.ownerUserId,
          intentId: row.fill.intentId,
          planId: row.fill.planId,
          legIndex: row.fill.legIndex,
          signature: row.fill.signature,
          slot: row.fill.slot,
          blockTime: row.fill.blockTime?.toISOString() ?? null,
          side: row.fill.side as 'buy' | 'sell',
          inputMint: row.fill.inputMint,
          outputMint: row.fill.outputMint,
          inputSpentRaw: row.fill.inputSpentRaw,
          outputReceivedRaw: row.fill.outputReceivedRaw,
          feeLamports: row.fill.feeLamports,
          lamportsSpent: row.fill.lamportsSpent,
          observedAt: row.fill.observedAt.toISOString(),
        },
        intent: row.intent,
        leg: row.leg,
      }));
    },
    listAttributionInstances: (ownerUserId: string) => listAttributionInstances(db, ownerUserId),
    strategyIdOfVersion: (versionId: string) => strategyIdOfVersion(db, versionId),
    listOpenLots: (input: {
      readonly ownerUserId: string;
      readonly walletId: string;
      readonly asset: string;
    }) => listOpenLots(db, input),
    appendFillProjection: (input: {
      readonly entries: readonly JournalEntry[];
      readonly lot: Lot | null;
      readonly consumptions: readonly LotConsumption[];
      readonly lotUpdates: readonly Lot[];
    }) => appendFillProjection(db, input),
  };
}
