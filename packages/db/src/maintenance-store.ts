import type {
  Cadence,
  DriftTarget,
  InvestmentTarget,
  MissedRunPolicy,
  OccurrenceReason,
  ScheduleKind,
  ScheduleStatus,
} from '@markov/contracts';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { agentProposals, scheduleOccurrences, schedules } from './schema.js';

/**
 * Maintenance persistence (B16). Schedules and occurrences are scoped by
 * the verified owner on every read. A maintenance pass claims one due
 * schedule at a time with `FOR UPDATE SKIP LOCKED` inside a transaction, so
 * two workers never decide the same occurrence, and an occurrence row is
 * unique per schedule and sequence, so a restarted pass cannot repeat one.
 */
export type ScheduleRow = typeof schedules.$inferSelect;
export type OccurrenceRow = typeof scheduleOccurrences.$inferSelect;
export type StoredOccurrenceStatus = 'proposed' | 'skipped' | 'failed' | 'expired';

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

/* ------------------------------------------------------------ schedules */

export async function createSchedule(
  db: Database,
  input: {
    ownerUserId: string;
    kind: ScheduleKind;
    label: string;
    cadence: Cadence;
    target: InvestmentTarget | DriftTarget;
    walletId: string | null;
    instanceId: string | null;
    strategyVersionId: string | null;
    instrumentId: string | null;
    startAt: Date;
    endAt: Date | null;
    reviewWindowHours: number;
    missedRunPolicy: MissedRunPolicy;
    nextDueAt: Date | null;
    now: Date;
  },
): Promise<ScheduleRow> {
  return one(
    await db
      .insert(schedules)
      .values({
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        status: 'active',
        mode: 'prepare_for_approval',
        label: input.label,
        cadence: input.cadence,
        target: input.target,
        walletId: input.walletId,
        instanceId: input.instanceId,
        strategyVersionId: input.strategyVersionId,
        instrumentId: input.instrumentId,
        startAt: input.startAt,
        endAt: input.endAt,
        reviewWindowHours: input.reviewWindowHours,
        missedRunPolicy: input.missedRunPolicy,
        nextDueAt: input.nextDueAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning(),
    'schedule insert',
  );
}

export async function findSchedule(
  db: Database,
  ownerUserId: string,
  scheduleId: string,
): Promise<ScheduleRow | null> {
  const rows = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, scheduleId), eq(schedules.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSchedules(
  db: Database,
  ownerUserId: string,
  query: { status: ScheduleStatus | null; limit: number },
): Promise<ScheduleRow[]> {
  const conditions = [eq(schedules.ownerUserId, ownerUserId)];
  if (query.status !== null) {
    conditions.push(eq(schedules.status, query.status));
  }
  return db
    .select()
    .from(schedules)
    .where(and(...conditions))
    .orderBy(desc(schedules.createdAt), desc(schedules.id))
    .limit(query.limit);
}

/** Owner edits; the kind and the target's resources never change here. */
export async function updateSchedule(
  db: Database,
  ownerUserId: string,
  scheduleId: string,
  patch: Partial<
    Pick<
      ScheduleRow,
      | 'label'
      | 'cadence'
      | 'target'
      | 'endAt'
      | 'reviewWindowHours'
      | 'missedRunPolicy'
      | 'nextDueAt'
    >
  >,
  now: Date,
): Promise<ScheduleRow | null> {
  const rows = await db
    .update(schedules)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(schedules.id, scheduleId), eq(schedules.ownerUserId, ownerUserId)))
    .returning();
  return rows[0] ?? null;
}

/** Guarded status change: only from the statuses named, so a cancel and a resume cannot both win. */
export async function transitionSchedule(
  db: Database,
  input: {
    ownerUserId: string | null;
    scheduleId: string;
    from: readonly ScheduleStatus[];
    to: ScheduleStatus;
    reason: string | null;
    nextDueAt?: Date | null;
    now: Date;
  },
): Promise<ScheduleRow | null> {
  const conditions = [
    eq(schedules.id, input.scheduleId),
    inArray(schedules.status, [...input.from]),
  ];
  if (input.ownerUserId !== null) {
    conditions.push(eq(schedules.ownerUserId, input.ownerUserId));
  }
  const rows = await db
    .update(schedules)
    .set({
      status: input.to,
      statusReason: input.reason,
      pausedAt: input.to === 'paused' ? input.now : null,
      endedAt: input.to === 'cancelled' || input.to === 'revoked' ? input.now : null,
      ...(input.nextDueAt !== undefined ? { nextDueAt: input.nextDueAt } : {}),
      updatedAt: input.now,
    })
    .where(and(...conditions))
    .returning();
  return rows[0] ?? null;
}

/**
 * Claims up to `limit` active schedules whose next occurrence is due, for
 * the calling transaction only. Rows locked by another pass are skipped.
 */
export async function claimDueSchedules(
  tx: Database,
  now: Date,
  limit: number,
): Promise<ScheduleRow[]> {
  return tx
    .select()
    .from(schedules)
    .where(and(eq(schedules.status, 'active'), lte(schedules.nextDueAt, now)))
    .orderBy(asc(schedules.nextDueAt))
    .limit(limit)
    .for('update', { skipLocked: true });
}

/** Locks one schedule for the calling transaction; null when another pass holds it or it is gone. */
export async function lockSchedule(tx: Database, scheduleId: string): Promise<ScheduleRow | null> {
  const rows = await tx
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1)
    .for('update', { skipLocked: true });
  return rows[0] ?? null;
}

/** Advances the schedule after a pass decided its occurrences. */
export async function advanceSchedule(
  db: Database,
  input: {
    scheduleId: string;
    lastSequence: number;
    nextDueAt: Date | null;
    proposed: number;
    skipped: number;
    failed: number;
    lastProposalAt?: Date | null;
    now: Date;
  },
): Promise<void> {
  await db
    .update(schedules)
    .set({
      lastSequence: input.lastSequence,
      nextDueAt: input.nextDueAt,
      proposedCount: sql`${schedules.proposedCount} + ${input.proposed}`,
      skippedCount: sql`${schedules.skippedCount} + ${input.skipped}`,
      failedCount: sql`${schedules.failedCount} + ${input.failed}`,
      ...(input.lastProposalAt !== undefined ? { lastProposalAt: input.lastProposalAt } : {}),
      updatedAt: input.now,
    })
    .where(eq(schedules.id, input.scheduleId));
}

/** Revokes every active or paused schedule bound to a wallet or an instance the owner no longer has. */
export async function revokeSchedulesFor(
  db: Database,
  input: { walletId?: string; instanceId?: string; reason: string; now: Date },
): Promise<ScheduleRow[]> {
  const conditions = [inArray(schedules.status, ['active', 'paused'])];
  if (input.walletId !== undefined) {
    conditions.push(eq(schedules.walletId, input.walletId));
  }
  if (input.instanceId !== undefined) {
    conditions.push(eq(schedules.instanceId, input.instanceId));
  }
  if (conditions.length === 1) {
    return [];
  }
  return db
    .update(schedules)
    .set({
      status: 'revoked',
      statusReason: input.reason,
      nextDueAt: null,
      endedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(...conditions))
    .returning();
}

/* ------------------------------------------------------------ occurrences */

export async function recordOccurrence(
  db: Database,
  input: {
    id: string;
    scheduleId: string;
    ownerUserId: string;
    sequence: number;
    dueAt: Date;
    windowEndsAt: Date;
    status: StoredOccurrenceStatus;
    reason: OccurrenceReason | null;
    detail: string | null;
    proposalId: string | null;
    dedupKey: string;
    now: Date;
  },
): Promise<OccurrenceRow> {
  const inserted = await db
    .insert(scheduleOccurrences)
    .values({
      id: input.id,
      scheduleId: input.scheduleId,
      ownerUserId: input.ownerUserId,
      sequence: input.sequence,
      dueAt: input.dueAt,
      windowEndsAt: input.windowEndsAt,
      status: input.status,
      reason: input.reason,
      detail: input.detail === null ? null : input.detail.slice(0, 500),
      proposalId: input.proposalId,
      dedupKey: input.dedupKey,
      decidedAt: input.now,
    })
    .onConflictDoNothing({ target: [scheduleOccurrences.scheduleId, scheduleOccurrences.sequence] })
    .returning();
  const row = inserted[0];
  if (row) {
    return row;
  }
  // A restarted pass already wrote this occurrence: answer the existing row.
  const existing = await findOccurrenceBySequence(db, input.scheduleId, input.sequence);
  if (existing === null) {
    throw new Error('occurrence insert did not return a row');
  }
  return existing;
}

export async function findOccurrenceBySequence(
  db: Database,
  scheduleId: string,
  sequence: number,
): Promise<OccurrenceRow | null> {
  const rows = await db
    .select()
    .from(scheduleOccurrences)
    .where(
      and(
        eq(scheduleOccurrences.scheduleId, scheduleId),
        eq(scheduleOccurrences.sequence, sequence),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listOccurrences(
  db: Database,
  ownerUserId: string,
  scheduleId: string,
  limit: number,
): Promise<OccurrenceRow[]> {
  return db
    .select()
    .from(scheduleOccurrences)
    .where(
      and(
        eq(scheduleOccurrences.scheduleId, scheduleId),
        eq(scheduleOccurrences.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(desc(scheduleOccurrences.sequence))
    .limit(limit);
}

export async function latestOccurrence(
  db: Database,
  scheduleId: string,
): Promise<OccurrenceRow | null> {
  const rows = await db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.scheduleId, scheduleId))
    .orderBy(desc(scheduleOccurrences.sequence))
    .limit(1);
  return rows[0] ?? null;
}

/** Occurrences whose proposal is still `proposed` past its expiry: they expired unopened. */
export async function listExpiredOccurrences(
  db: Database,
  now: Date,
  limit: number,
): Promise<Array<{ occurrence: OccurrenceRow; scheduleLabel: string }>> {
  const rows = await db
    .select({ occurrence: scheduleOccurrences, scheduleLabel: schedules.label })
    .from(scheduleOccurrences)
    .innerJoin(agentProposals, eq(agentProposals.id, scheduleOccurrences.proposalId))
    .innerJoin(schedules, eq(schedules.id, scheduleOccurrences.scheduleId))
    .where(
      and(
        eq(scheduleOccurrences.status, 'proposed'),
        isNull(scheduleOccurrences.expiryNotifiedAt),
        eq(agentProposals.status, 'proposed'),
        lte(agentProposals.expiresAt, now),
      ),
    )
    .orderBy(asc(scheduleOccurrences.windowEndsAt))
    .limit(limit);
  return rows;
}

export async function markOccurrenceExpired(
  db: Database,
  occurrenceId: string,
  now: Date,
): Promise<OccurrenceRow | null> {
  const rows = await db
    .update(scheduleOccurrences)
    .set({ status: 'expired', expiryNotifiedAt: now })
    .where(
      and(eq(scheduleOccurrences.id, occurrenceId), eq(scheduleOccurrences.status, 'proposed')),
    )
    .returning();
  return rows[0] ?? null;
}
