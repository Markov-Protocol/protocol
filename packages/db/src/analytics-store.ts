import type {
  JournalEntry,
  ObservablePriceKind,
  PriceObservationSourceKind,
} from '@markov/contracts';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { LotConsumptionRow } from './accounting-store.js';
import { attachLines, linesFor } from './accounting-store.js';
import type { Database } from './client.js';
import type { RegistryRecordRow } from './registry-store.js';
import {
  journalEntries,
  lotConsumptions,
  priceObservations,
  reconciliationCheckpoints,
  registryRecords,
  strategyVersions,
} from './schema.js';
import type { StrategyVersionRow } from './strategy-store.js';

/**
 * Analytics reads and the price observation record (B13). Observations are
 * append-only and unique per asset, kind, source and time, so a feed
 * ingested twice or an operator repeating an entry changes nothing.
 */

export type PriceObservationRow = typeof priceObservations.$inferSelect;

export interface NewPriceObservation {
  readonly asset: string;
  readonly instrumentId: string | null;
  readonly kind: ObservablePriceKind;
  readonly value: string;
  readonly unit: string;
  readonly observedAt: Date;
  readonly source: string;
  readonly sourceKind: PriceObservationSourceKind;
  readonly evidence?: Record<string, string>;
  readonly recordedBy?: string | null;
}

/** Inserts what is new; an existing (asset, kind, source, observedAt) point is left untouched. */
export async function recordPriceObservations(
  db: Database,
  rows: readonly NewPriceObservation[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) {
    return { inserted: 0 };
  }
  const inserted = await db
    .insert(priceObservations)
    .values(
      rows.map((row) => ({
        asset: row.asset,
        instrumentId: row.instrumentId,
        kind: row.kind,
        value: row.value,
        unit: row.unit,
        observedAt: row.observedAt,
        source: row.source,
        sourceKind: row.sourceKind,
        evidence: row.evidence ?? {},
        recordedBy: row.recordedBy ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: priceObservations.id });
  return { inserted: inserted.length };
}

export interface PriceObservationFilter {
  readonly assets: readonly string[];
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly limit?: number | undefined;
}

/** Observations of the assets, oldest first (ties by insertion), bounded. */
export async function listPriceObservations(
  db: Database,
  filter: PriceObservationFilter,
): Promise<PriceObservationRow[]> {
  if (filter.assets.length === 0) {
    return [];
  }
  const conditions = [inArray(priceObservations.asset, [...filter.assets])];
  if (filter.from) {
    conditions.push(gte(priceObservations.observedAt, filter.from));
  }
  if (filter.to) {
    conditions.push(lte(priceObservations.observedAt, filter.to));
  }
  return db
    .select()
    .from(priceObservations)
    .where(and(...conditions))
    .orderBy(asc(priceObservations.observedAt), asc(priceObservations.id))
    .limit(filter.limit ?? 20_000);
}

export async function listConsumptionsForLots(
  db: Database,
  lotIds: readonly string[],
): Promise<LotConsumptionRow[]> {
  if (lotIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(lotConsumptions)
    .where(inArray(lotConsumptions.lotId, [...lotIds]))
    .orderBy(asc(lotConsumptions.consumedAt), asc(lotConsumptions.id));
}

/** The journal entries attributed to one instance, oldest first (fees and fills the instance paid for). */
export async function listJournalEntriesForInstance(
  db: Database,
  ownerUserId: string,
  instanceId: string,
  limit = 5000,
): Promise<JournalEntry[]> {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(
      and(eq(journalEntries.ownerUserId, ownerUserId), eq(journalEntries.instanceId, instanceId)),
    )
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

export interface RankableVersion {
  readonly version: StrategyVersionRow;
  readonly record: RegistryRecordRow;
}

/** Every registered, unmoderated version with its indexed record: the public model-series population. */
export async function listRankableVersions(db: Database, limit = 500): Promise<RankableVersion[]> {
  return db
    .select({ version: strategyVersions, record: registryRecords })
    .from(strategyVersions)
    .innerJoin(registryRecords, eq(registryRecords.versionId, strategyVersions.id))
    .where(
      and(eq(strategyVersions.publication, 'registered'), eq(strategyVersions.moderation, 'none')),
    )
    .orderBy(desc(strategyVersions.frozenAt), desc(strategyVersions.id))
    .limit(limit);
}

/** When the platform first observed the wallet on chain: the actual series of a wallet starts there. */
export async function earliestCheckpointAt(
  db: Database,
  ownerUserId: string,
  walletId: string,
): Promise<Date | null> {
  const rows = await db
    .select({ observedAt: reconciliationCheckpoints.observedAt })
    .from(reconciliationCheckpoints)
    .where(
      and(
        eq(reconciliationCheckpoints.ownerUserId, ownerUserId),
        eq(reconciliationCheckpoints.walletId, walletId),
      ),
    )
    .orderBy(asc(reconciliationCheckpoints.sequence))
    .limit(1);
  return rows[0]?.observedAt ?? null;
}
