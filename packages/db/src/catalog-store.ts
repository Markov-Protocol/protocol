import type {
  CatalogPrice,
  IngestionSource,
  InstrumentDecisionKind,
  InstrumentKind,
  InstrumentStatus,
  Issuer,
  MintVerificationResult,
  OnChainMint,
  TokenProgram,
} from '@markov/contracts';
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  instrumentDecisions,
  instrumentMintVerifications,
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
  const rows = await db.insert(issuerSnapshots).values(input).returning();
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
