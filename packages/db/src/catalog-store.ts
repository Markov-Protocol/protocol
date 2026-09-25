import type {
  CatalogPrice,
  CorporateActionDetails,
  CorporateActionStatus,
  CorporateActionType,
  ExtensionAssessment,
  IngestionSource,
  InstrumentDecisionKind,
  InstrumentKind,
  InstrumentStatus,
  Issuer,
  MintVerificationResult,
  MultiplierSource,
  OnChainMint,
  SnapshotKindSchemaType,
  TokenProgram,
} from '@markov/contracts';
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  corporateActions,
  instrumentDecisions,
  instrumentMintVerifications,
  instrumentMultipliers,
  instruments,
  issuerSnapshots,
} from './schema.js';

/**
 * Catalog persistence. The store records what ingestion planned and what
 * operators decided; it never decides admission itself. Status changes go
 * through `recordInstrumentDecision`, which checks the expected previous
 * status inside the transaction so two operators cannot race.
 */

export type IssuerSnapshotRow = typeof issuerSnapshots.$inferSelect;
export type InstrumentRow = typeof instruments.$inferSelect;
export type MintVerificationRow = typeof instrumentMintVerifications.$inferSelect;
export type InstrumentDecisionRow = typeof instrumentDecisions.$inferSelect;
export type CorporateActionRow = typeof corporateActions.$inferSelect;
export type InstrumentMultiplierRow = typeof instrumentMultipliers.$inferSelect;

export class InstrumentStatusConflictError extends Error {
  override readonly name = 'InstrumentStatusConflictError';
  readonly currentStatus: InstrumentStatus | null;

  constructor(currentStatus: InstrumentStatus | null) {
    super(
      currentStatus === null
        ? 'instrument does not exist'
        : `instrument status changed to ${currentStatus} before the decision was recorded`,
    );
    this.currentStatus = currentStatus;
  }
}

export async function recordIssuerSnapshot(
  db: Database,
  input: {
    issuer: Issuer;
    kind?: SnapshotKindSchemaType;
    source: IngestionSource;
    sourceRef: string;
    fetchedAt: Date;
    contentHash: string;
    schemaVersion: string | null;
    itemCount: number;
    status: 'accepted' | 'rejected';
    rejectionReason: string | null;
    createdBy: string;
  },
): Promise<IssuerSnapshotRow> {
  const rows = await db
    .insert(issuerSnapshots)
    .values({ ...input, kind: input.kind ?? 'products' })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('snapshot insert did not return a row');
  }
  return row;
}

export async function listIssuerSnapshots(
  db: Database,
  issuer: Issuer | null,
  limit = 50,
): Promise<IssuerSnapshotRow[]> {
  const query = db.select().from(issuerSnapshots);
  const filtered = issuer ? query.where(eq(issuerSnapshots.issuer, issuer)) : query;
  return filtered.orderBy(desc(issuerSnapshots.fetchedAt), desc(issuerSnapshots.id)).limit(limit);
}

/** Every instrument of an issuer, whatever its status, for ingestion planning. */
export async function listInstrumentsForPlanning(
  db: Database,
  issuer: Issuer,
): Promise<InstrumentRow[]> {
  return db.select().from(instruments).where(eq(instruments.issuer, issuer));
}

/** Upstream fields the catalog stores for a product (structurally identical to the domain's normalized product). */
export interface InstrumentUpstreamFields {
  readonly productId: string;
  readonly symbol: string;
  readonly name: string;
  readonly companyName: string;
  readonly kind: InstrumentKind;
  readonly mint: string;
  readonly decimals: number;
  readonly tokenProgram: TokenProgram;
  readonly website: string | null;
  readonly description: string | null;
  readonly referencePrice: CatalogPrice | null;
  readonly underlying: { readonly ticker: string; readonly exchange: string | null } | null;
}

export type IngestionWrite =
  | {
      readonly kind: 'insert';
      readonly product: InstrumentUpstreamFields;
      readonly fingerprint: string;
      readonly status: 'quarantined' | 'rejected';
      readonly reasons: readonly string[];
    }
  | {
      readonly kind: 'update';
      readonly instrumentId: string;
      readonly product: InstrumentUpstreamFields;
      readonly fingerprint: string;
      readonly newStatus: InstrumentStatus | null;
      readonly reasons: readonly string[];
    }
  | {
      /** The upstream record for an existing instrument became invalid: admitted/paused pause, others reject. */
      readonly kind: 'invalid';
      readonly instrumentId: string;
      readonly currentStatus: InstrumentStatus;
      readonly reasons: readonly string[];
    };

function reasonText(reasons: readonly string[]): string | null {
  const text = reasons.join('; ');
  return text.length === 0 ? null : text.slice(0, 500);
}

/** Apply planned writes in one transaction so a feed is either fully applied or not at all. */
export async function applyIngestion(
  db: Database,
  input: {
    issuer: Issuer;
    genesisHash: string;
    snapshotId: string;
    writes: readonly IngestionWrite[];
    now: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const write of input.writes) {
      if (write.kind === 'insert') {
        const product = write.product;
        await tx.insert(instruments).values({
          issuer: input.issuer,
          issuerProductId: product.productId,
          symbol: product.symbol,
          name: product.name,
          companyName: product.companyName,
          kind: product.kind,
          chain: 'solana',
          genesisHash: input.genesisHash,
          mint: product.mint,
          decimals: product.decimals,
          tokenProgram: product.tokenProgram,
          status: write.status,
          statusReason: reasonText(write.reasons),
          website: product.website,
          description: product.description,
          referencePrice: product.referencePrice,
          underlyingTicker: product.underlying?.ticker ?? null,
          underlyingExchange: product.underlying?.exchange ?? null,
          fingerprint: write.fingerprint,
          sourceSnapshotId: input.snapshotId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        continue;
      }
      if (write.kind === 'update') {
        const product = write.product;
        await tx
          .update(instruments)
          .set({
            symbol: product.symbol,
            name: product.name,
            companyName: product.companyName,
            kind: product.kind,
            mint: product.mint,
            decimals: product.decimals,
            tokenProgram: product.tokenProgram,
            website: product.website,
            description: product.description,
            referencePrice: product.referencePrice,
            underlyingTicker: product.underlying?.ticker ?? null,
            underlyingExchange: product.underlying?.exchange ?? null,
            fingerprint: write.fingerprint,
            sourceSnapshotId: input.snapshotId,
            updatedAt: input.now,
            ...(write.newStatus
              ? { status: write.newStatus, statusReason: reasonText(write.reasons) }
              : {}),
          })
          .where(eq(instruments.id, write.instrumentId));
        continue;
      }
      const pauses = write.currentStatus === 'admitted' || write.currentStatus === 'paused';
      await tx
        .update(instruments)
        .set({
          status: pauses ? 'paused' : 'rejected',
          statusReason: reasonText(['upstream record invalid', ...write.reasons]),
          sourceSnapshotId: input.snapshotId,
          updatedAt: input.now,
        })
        .where(eq(instruments.id, write.instrumentId));
    }
  });
}

/** The admitted or known instrument minted at `mint`, or null; mints are unique per verified instrument. */
export async function findInstrumentByMint(
  db: Database,
  mint: string,
): Promise<InstrumentRow | null> {
  const rows = await db.select().from(instruments).where(eq(instruments.mint, mint)).limit(1);
  return rows[0] ?? null;
}

export async function findInstrument(
  db: Database,
  instrumentId: string,
): Promise<InstrumentRow | null> {
  const rows = await db.select().from(instruments).where(eq(instruments.id, instrumentId)).limit(1);
  return rows[0] ?? null;
}

export interface InstrumentListFilter {
  readonly issuer?: Issuer | undefined;
  readonly kind?: InstrumentKind | undefined;
  readonly statuses: readonly InstrumentStatus[];
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

function encodeCursor(row: InstrumentRow): string {
  return Buffer.from(`${row.symbol}\u0000${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { symbol: string; id: string } | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('\u0000');
  if (separator <= 0) {
    return null;
  }
  const id = decoded.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return null;
  }
  return { symbol: decoded.slice(0, separator), id };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Keyset-paginated listing ordered by symbol then id; search matches symbol prefix, name or company. */
export async function listInstruments(
  db: Database,
  filter: InstrumentListFilter,
): Promise<{ rows: InstrumentRow[]; nextCursor: string | null }> {
  if (filter.statuses.length === 0) {
    return { rows: [], nextCursor: null };
  }
  const conditions = [inArray(instruments.status, [...filter.statuses])];
  if (filter.issuer) {
    conditions.push(eq(instruments.issuer, filter.issuer));
  }
  if (filter.kind) {
    conditions.push(eq(instruments.kind, filter.kind));
  }
  if (filter.q && filter.q.trim().length > 0) {
    const term = escapeLike(filter.q.trim());
    const match = or(
      ilike(instruments.symbol, `${term}%`),
      ilike(instruments.name, `%${term}%`),
      ilike(instruments.companyName, `%${term}%`),
    );
    if (match) {
      conditions.push(match);
    }
  }
  if (filter.cursor) {
    const decoded = decodeCursor(filter.cursor);
    if (decoded === null) {
      return { rows: [], nextCursor: null };
    }
    const after = or(
      gt(instruments.symbol, decoded.symbol),
      and(eq(instruments.symbol, decoded.symbol), sql`${instruments.id} > ${decoded.id}::uuid`),
    );
    if (after) {
      conditions.push(after);
    }
  }
  const rows = await db
    .select()
    .from(instruments)
    .where(and(...conditions))
    .orderBy(asc(instruments.symbol), asc(instruments.id))
    .limit(filter.limit + 1);
  const page = rows.slice(0, filter.limit);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > filter.limit && last ? encodeCursor(last) : null };
}

export async function recordMintVerification(
  db: Database,
  input: {
    instrumentId: string;
    rpcHost: string;
    slot: number | null;
    result: MintVerificationResult;
    onChain: OnChainMint | null;
    mismatches: readonly string[];
    verifiedAt: Date;
    compatibility?: ExtensionAssessment | null;
  },
): Promise<MintVerificationRow> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(instrumentMintVerifications)
      .values({
        instrumentId: input.instrumentId,
        rpcHost: input.rpcHost,
        slot: input.slot,
        result: input.result,
        onChain: input.onChain,
        mismatches: [...input.mismatches],
        verifiedAt: input.verifiedAt,
        compatibility: input.compatibility ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('verification insert did not return a row');
    }
    // A verified mint settles the token program the feed left unknown.
    if (input.result === 'verified' && input.onChain) {
      await tx
        .update(instruments)
        .set({ tokenProgram: input.onChain.tokenProgram, updatedAt: input.verifiedAt })
        .where(
          and(eq(instruments.id, input.instrumentId), eq(instruments.tokenProgram, 'unknown')),
        );
    }
    return row;
  });
}

export async function latestMintVerification(
  db: Database,
  instrumentId: string,
): Promise<MintVerificationRow | null> {
  const rows = await db
    .select()
    .from(instrumentMintVerifications)
    .where(eq(instrumentMintVerifications.instrumentId, instrumentId))
    .orderBy(desc(instrumentMintVerifications.verifiedAt), desc(instrumentMintVerifications.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Record an operator decision and move the status atomically; fails if the status changed meanwhile. */
export async function recordInstrumentDecision(
  db: Database,
  input: {
    instrumentId: string;
    decision: InstrumentDecisionKind;
    reason: string;
    evidence: Record<string, string>;
    decidedBy: string;
    expectedPreviousStatus: InstrumentStatus;
    newStatus: InstrumentStatus;
    decidedAt: Date;
  },
): Promise<InstrumentDecisionRow> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ status: instruments.status })
      .from(instruments)
      .where(eq(instruments.id, input.instrumentId))
      .for('update')
      .limit(1);
    const current = locked[0]?.status as InstrumentStatus | undefined;
    if (current === undefined || current !== input.expectedPreviousStatus) {
      throw new InstrumentStatusConflictError(current ?? null);
    }
    await tx
      .update(instruments)
      .set({
        status: input.newStatus,
        statusReason: input.reason.slice(0, 500),
        updatedAt: input.decidedAt,
        ...(input.decision === 'admit' ? { admittedAt: input.decidedAt } : {}),
      })
      .where(eq(instruments.id, input.instrumentId));
    const rows = await tx
      .insert(instrumentDecisions)
      .values({
        instrumentId: input.instrumentId,
        decision: input.decision,
        reason: input.reason,
        evidence: input.evidence,
        previousStatus: current,
        newStatus: input.newStatus,
        decidedBy: input.decidedBy,
        decidedAt: input.decidedAt,
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('decision insert did not return a row');
    }
    return row;
  });
}

export async function listInstrumentDecisions(
  db: Database,
  instrumentId: string,
  limit = 50,
): Promise<InstrumentDecisionRow[]> {
  return db
    .select()
    .from(instrumentDecisions)
    .where(eq(instrumentDecisions.instrumentId, instrumentId))
    .orderBy(desc(instrumentDecisions.decidedAt), desc(instrumentDecisions.id))
    .limit(limit);
}

/* ---------------------------------------------------------------------------
 * Corporate actions and multiplier evidence (B04)
 * ------------------------------------------------------------------------- */

export interface CorporateActionEventInput {
  readonly externalId: string;
  readonly productId: string;
  readonly type: CorporateActionType;
  readonly announcedAt: string;
  readonly effectiveAt: string;
  readonly summary: string;
  readonly details: CorporateActionDetails;
  readonly fingerprint: string;
}

export type CorporateActionWriteInput =
  | {
      readonly kind: 'insert';
      readonly instrumentId: string;
      readonly event: CorporateActionEventInput;
    }
  | {
      readonly kind: 'update';
      readonly actionId: string;
      readonly event: CorporateActionEventInput;
    };

export async function listCorporateActionsForPlanning(
  db: Database,
  issuer: Issuer,
): Promise<CorporateActionRow[]> {
  return db.select().from(corporateActions).where(eq(corporateActions.issuer, issuer));
}

/** Insert new pending events and update changed pending ones in one transaction; applied or rejected rows never change. */
export async function applyCorporateActionWrites(
  db: Database,
  input: {
    issuer: Issuer;
    snapshotId: string;
    writes: readonly CorporateActionWriteInput[];
    now: Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const write of input.writes) {
      const event = write.event;
      if (write.kind === 'insert') {
        await tx.insert(corporateActions).values({
          instrumentId: write.instrumentId,
          issuer: input.issuer,
          externalId: event.externalId,
          type: event.type,
          status: 'pending',
          announcedAt: new Date(event.announcedAt),
          effectiveAt: new Date(event.effectiveAt),
          summary: event.summary,
          details: event.details,
          fingerprint: event.fingerprint,
          sourceSnapshotId: input.snapshotId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        continue;
      }
      await tx
        .update(corporateActions)
        .set({
          type: event.type,
          announcedAt: new Date(event.announcedAt),
          effectiveAt: new Date(event.effectiveAt),
          summary: event.summary,
          details: event.details,
          fingerprint: event.fingerprint,
          sourceSnapshotId: input.snapshotId,
          updatedAt: input.now,
        })
        .where(
          and(eq(corporateActions.id, write.actionId), eq(corporateActions.status, 'pending')),
        );
    }
  });
}

export async function listCorporateActions(
  db: Database,
  filter: {
    instrumentId?: string | undefined;
    instrumentIds?: readonly string[] | undefined;
    issuer?: Issuer | undefined;
    status?: CorporateActionStatus | undefined;
    limit?: number;
  },
): Promise<CorporateActionRow[]> {
  const conditions = [];
  if (filter.instrumentId) {
    conditions.push(eq(corporateActions.instrumentId, filter.instrumentId));
  }
  if (filter.instrumentIds) {
    if (filter.instrumentIds.length === 0) {
      return [];
    }
    conditions.push(inArray(corporateActions.instrumentId, [...filter.instrumentIds]));
  }
  if (filter.issuer) {
    conditions.push(eq(corporateActions.issuer, filter.issuer));
  }
  if (filter.status) {
    conditions.push(eq(corporateActions.status, filter.status));
  }
  const query = db.select().from(corporateActions);
  const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
  return filtered
    .orderBy(desc(corporateActions.effectiveAt), desc(corporateActions.createdAt))
    .limit(filter.limit ?? 200);
}

export async function findCorporateAction(
  db: Database,
  actionId: string,
): Promise<CorporateActionRow | null> {
  const rows = await db
    .select()
    .from(corporateActions)
    .where(eq(corporateActions.id, actionId))
    .limit(1);
  return rows[0] ?? null;
}

export class CorporateActionStatusConflictError extends Error {
  override readonly name = 'CorporateActionStatusConflictError';
  readonly currentStatus: CorporateActionStatus | null;

  constructor(currentStatus: CorporateActionStatus | null) {
    super(
      currentStatus === null
        ? 'corporate action does not exist'
        : `corporate action is already ${currentStatus}`,
    );
    this.currentStatus = currentStatus;
  }
}

export interface LifecycleUpdate {
  readonly haltedAt?: Date | null;
  readonly haltedReason?: string | null;
  readonly migrationTargetProductId?: string | null;
  readonly migrationDeadlineAt?: Date | null;
  readonly sunsetAt?: Date | null;
}

export interface MultiplierInput {
  readonly effectiveAt: Date;
  readonly multiplier: string;
  readonly multiplierExact: string;
  readonly source: MultiplierSource;
  readonly evidence: Record<string, string>;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function upsertMultiplier(
  tx: Transaction,
  instrumentId: string,
  input: MultiplierInput,
  recordedAt: Date,
): Promise<InstrumentMultiplierRow> {
  const rows = await tx
    .insert(instrumentMultipliers)
    .values({
      instrumentId,
      effectiveAt: input.effectiveAt,
      multiplier: input.multiplier,
      multiplierExact: input.multiplierExact,
      source: input.source,
      evidence: input.evidence,
      recordedAt,
    })
    .onConflictDoUpdate({
      target: [
        instrumentMultipliers.instrumentId,
        instrumentMultipliers.effectiveAt,
        instrumentMultipliers.source,
      ],
      set: {
        multiplier: input.multiplier,
        multiplierExact: input.multiplierExact,
        evidence: input.evidence,
        recordedAt,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('multiplier upsert did not return a row');
  }
  return row;
}

/** Apply a pending action: its status, the instrument's lifecycle columns and any multiplier evidence move together. */
export async function applyCorporateAction(
  db: Database,
  input: {
    actionId: string;
    appliedBy: string;
    appliedAt: Date;
    reason: string;
    lifecycle: LifecycleUpdate;
    multiplier: MultiplierInput | null;
  },
): Promise<{ action: CorporateActionRow; multiplier: InstrumentMultiplierRow | null }> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ status: corporateActions.status, instrumentId: corporateActions.instrumentId })
      .from(corporateActions)
      .where(eq(corporateActions.id, input.actionId))
      .for('update')
      .limit(1);
    const current = locked[0];
    if (!current || current.status !== 'pending') {
      throw new CorporateActionStatusConflictError(
        (current?.status as CorporateActionStatus | undefined) ?? null,
      );
    }
    const rows = await tx
      .update(corporateActions)
      .set({
        status: 'applied',
        statusReason: input.reason.slice(0, 500),
        appliedAt: input.appliedAt,
        appliedBy: input.appliedBy,
        updatedAt: input.appliedAt,
      })
      .where(eq(corporateActions.id, input.actionId))
      .returning();
    const action = rows[0];
    if (!action) {
      throw new Error('corporate action update did not return a row');
    }
    const lifecycle = input.lifecycle;
    const patch: Partial<typeof instruments.$inferInsert> = { updatedAt: input.appliedAt };
    if ('haltedAt' in lifecycle) {
      patch.haltedAt = lifecycle.haltedAt ?? null;
      patch.haltedReason = lifecycle.haltedReason ?? null;
    }
    if ('migrationTargetProductId' in lifecycle) {
      patch.migrationTargetProductId = lifecycle.migrationTargetProductId ?? null;
      patch.migrationDeadlineAt = lifecycle.migrationDeadlineAt ?? null;
    }
    if ('sunsetAt' in lifecycle) {
      patch.sunsetAt = lifecycle.sunsetAt ?? null;
    }
    await tx.update(instruments).set(patch).where(eq(instruments.id, current.instrumentId));
    let multiplier: InstrumentMultiplierRow | null = null;
    if (input.multiplier) {
      multiplier = await upsertMultiplier(
        tx,
        current.instrumentId,
        input.multiplier,
        input.appliedAt,
      );
    }
    return { action, multiplier };
  });
}

export async function rejectCorporateAction(
  db: Database,
  input: { actionId: string; reason: string; decidedBy: string; at: Date },
): Promise<CorporateActionRow> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ status: corporateActions.status })
      .from(corporateActions)
      .where(eq(corporateActions.id, input.actionId))
      .for('update')
      .limit(1);
    const current = locked[0];
    if (!current || current.status !== 'pending') {
      throw new CorporateActionStatusConflictError(
        (current?.status as CorporateActionStatus | undefined) ?? null,
      );
    }
    const rows = await tx
      .update(corporateActions)
      .set({
        status: 'rejected',
        statusReason: input.reason.slice(0, 500),
        appliedBy: input.decidedBy,
        updatedAt: input.at,
      })
      .where(eq(corporateActions.id, input.actionId))
      .returning();
    const action = rows[0];
    if (!action) {
      throw new Error('corporate action update did not return a row');
    }
    return action;
  });
}

export async function recordInstrumentMultiplier(
  db: Database,
  instrumentId: string,
  input: MultiplierInput,
  recordedAt: Date,
): Promise<InstrumentMultiplierRow> {
  return db.transaction((tx) => upsertMultiplier(tx, instrumentId, input, recordedAt));
}

export async function listInstrumentMultipliers(
  db: Database,
  instrumentId: string,
): Promise<InstrumentMultiplierRow[]> {
  return db
    .select()
    .from(instrumentMultipliers)
    .where(eq(instrumentMultipliers.instrumentId, instrumentId))
    .orderBy(desc(instrumentMultipliers.effectiveAt), desc(instrumentMultipliers.id));
}

/** Batch reads for list pages: multipliers and latest verifications for many instruments at once. */
export async function listMultipliersFor(
  db: Database,
  instrumentIds: readonly string[],
): Promise<InstrumentMultiplierRow[]> {
  if (instrumentIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(instrumentMultipliers)
    .where(inArray(instrumentMultipliers.instrumentId, [...instrumentIds]))
    .orderBy(desc(instrumentMultipliers.effectiveAt), desc(instrumentMultipliers.id));
}

export async function latestVerificationsFor(
  db: Database,
  instrumentIds: readonly string[],
): Promise<Map<string, MintVerificationRow>> {
  const latest = new Map<string, MintVerificationRow>();
  if (instrumentIds.length === 0) {
    return latest;
  }
  const rows = await db
    .select()
    .from(instrumentMintVerifications)
    .where(inArray(instrumentMintVerifications.instrumentId, [...instrumentIds]))
    .orderBy(desc(instrumentMintVerifications.verifiedAt), desc(instrumentMintVerifications.id));
  for (const row of rows) {
    if (!latest.has(row.instrumentId)) {
      latest.set(row.instrumentId, row);
    }
  }
  return latest;
}

export async function findInstrumentByProduct(
  db: Database,
  issuer: Issuer,
  issuerProductId: string,
): Promise<InstrumentRow | null> {
  const rows = await db
    .select()
    .from(instruments)
    .where(and(eq(instruments.issuer, issuer), eq(instruments.issuerProductId, issuerProductId)))
    .limit(1);
  return rows[0] ?? null;
}
