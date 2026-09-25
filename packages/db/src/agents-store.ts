import type {
  CompanionBudget,
  CompanionContext,
  CompanionOutput,
  CompanionProvenance,
  CompanionUsage,
  MarkEventKind,
  MarkEventSubjectType,
  ProposalKind,
  RunStatus,
} from '@markov/contracts';
import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { agentProposals, companionRuns, markEvents } from './schema.js';

/**
 * Agents and companion persistence (B15). Runs, proposals and events are
 * scoped by the verified owner on every read; another account's rows are
 * indistinguishable from missing ones. Run and proposal state changes are
 * guarded (`UPDATE … WHERE status = …`) so a cancel and a finish cannot
 * both win.
 */
export type CompanionRunRow = typeof companionRuns.$inferSelect;
export type AgentProposalRow = typeof agentProposals.$inferSelect;
export type MarkEventRow = typeof markEvents.$inferSelect;

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

/* ------------------------------------------------------------ runs */

export async function createCompanionRun(
  db: Database,
  input: {
    ownerUserId: string;
    principal: string;
    question: string;
    context: CompanionContext;
    budget: CompanionBudget;
    now: Date;
  },
): Promise<CompanionRunRow> {
  return one(
    await db
      .insert(companionRuns)
      .values({
        ownerUserId: input.ownerUserId,
        principal: input.principal,
        status: 'queued',
        question: input.question,
        context: input.context,
        budget: input.budget,
        createdAt: input.now,
      })
      .returning(),
    'companion run insert',
  );
}

export async function findCompanionRun(
  db: Database,
  ownerUserId: string,
  runId: string,
): Promise<CompanionRunRow | null> {
  const rows = await db
    .select()
    .from(companionRuns)
    .where(and(eq(companionRuns.id, runId), eq(companionRuns.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCompanionRuns(
  db: Database,
  ownerUserId: string,
  limit = 50,
): Promise<CompanionRunRow[]> {
  return db
    .select()
    .from(companionRuns)
    .where(eq(companionRuns.ownerUserId, ownerUserId))
    .orderBy(desc(companionRuns.createdAt), desc(companionRuns.id))
    .limit(limit);
}

/** queued → running; null when the run is no longer queued (cancelled meanwhile). */
export async function startCompanionRun(
  db: Database,
  runId: string,
  now: Date,
): Promise<CompanionRunRow | null> {
  const rows = await db
    .update(companionRuns)
    .set({ status: 'running', startedAt: now })
    .where(and(eq(companionRuns.id, runId), eq(companionRuns.status, 'queued')))
    .returning();
  return rows[0] ?? null;
}

/** running → succeeded | failed; a run cancelled meanwhile keeps its state and the result is dropped. */
export async function finishCompanionRun(
  db: Database,
  input: {
    runId: string;
    status: 'succeeded' | 'failed';
    usage: CompanionUsage;
    provenance: CompanionProvenance;
    output: CompanionOutput | null;
    error: string | null;
    now: Date;
  },
): Promise<CompanionRunRow | null> {
  const rows = await db
    .update(companionRuns)
    .set({
      status: input.status,
      usage: input.usage,
      provenance: input.provenance,
      output: input.output,
      error: input.error,
      finishedAt: input.now,
    })
    .where(and(eq(companionRuns.id, input.runId), eq(companionRuns.status, 'running')))
    .returning();
  return rows[0] ?? null;
}

export async function cancelCompanionRun(
  db: Database,
  ownerUserId: string,
  runId: string,
  now: Date,
): Promise<CompanionRunRow | null> {
  const current = await findCompanionRun(db, ownerUserId, runId);
  if (!current || (current.status !== 'queued' && current.status !== 'running')) {
    return null;
  }
  const rows = await db
    .update(companionRuns)
    .set({ status: 'cancelled', finishedAt: now })
    .where(and(eq(companionRuns.id, runId), eq(companionRuns.status, current.status as RunStatus)))
    .returning();
  return rows[0] ?? null;
}

/** Cost (micros) of the owner's runs created at or after `since`, finished or not; the daily cap reads it. */
export async function companionCostSince(
  db: Database,
  ownerUserId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`coalesce(sum((${companionRuns.usage} ->> 'costMicros')::bigint), 0)`,
    })
    .from(companionRuns)
    .where(and(eq(companionRuns.ownerUserId, ownerUserId), gte(companionRuns.createdAt, since)));
  return Number.parseInt(rows[0]?.total ?? '0', 10) || 0;
}

/* ------------------------------------------------------- proposals */

export async function createProposal(
  db: Database,
  input: {
    ownerUserId: string;
    runId: string | null;
    createdBy: string;
    kind: ProposalKind;
    summary: string;
    payload: Record<string, unknown>;
    reviewNote: string;
    expiresAt: Date;
    now: Date;
  },
): Promise<AgentProposalRow> {
  return one(
    await db
      .insert(agentProposals)
      .values({
        ownerUserId: input.ownerUserId,
        runId: input.runId,
        createdBy: input.createdBy,
        kind: input.kind,
        status: 'proposed',
        summary: input.summary,
        payload: input.payload,
        reviewNote: input.reviewNote,
        expiresAt: input.expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning(),
    'proposal insert',
  );
}

export async function findProposal(
  db: Database,
  ownerUserId: string,
  proposalId: string,
): Promise<AgentProposalRow | null> {
  const rows = await db
    .select()
    .from(agentProposals)
    .where(and(eq(agentProposals.id, proposalId), eq(agentProposals.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listProposals(
  db: Database,
  ownerUserId: string,
  limit = 50,
): Promise<AgentProposalRow[]> {
  return db
    .select()
    .from(agentProposals)
    .where(eq(agentProposals.ownerUserId, ownerUserId))
    .orderBy(desc(agentProposals.createdAt), desc(agentProposals.id))
    .limit(limit);
}

/** proposed → opened, recording the intent the open created when there is one; null when not proposed any more. */
export async function openProposal(
  db: Database,
  input: { ownerUserId: string; proposalId: string; intentId: string | null; now: Date },
): Promise<AgentProposalRow | null> {
  const rows = await db
    .update(agentProposals)
    .set({ status: 'opened', intentId: input.intentId, openedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(agentProposals.id, input.proposalId),
        eq(agentProposals.ownerUserId, input.ownerUserId),
        eq(agentProposals.status, 'proposed'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function dismissProposal(
  db: Database,
  ownerUserId: string,
  proposalId: string,
  now: Date,
): Promise<AgentProposalRow | null> {
  const rows = await db
    .update(agentProposals)
    .set({ status: 'dismissed', dismissedAt: now, updatedAt: now })
    .where(
      and(
        eq(agentProposals.id, proposalId),
        eq(agentProposals.ownerUserId, ownerUserId),
        eq(agentProposals.status, 'proposed'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/* ---------------------------------------------------------- events */

export interface NewMarkEvent {
  readonly ownerUserId: string;
  readonly kind: MarkEventKind;
  readonly subject: { readonly type: MarkEventSubjectType; readonly id: string };
  readonly payload: Record<string, unknown>;
  readonly now: Date;
}

/** Appends one event for the owner; callers inside a transaction pass the transaction as `db`. */
export async function recordMarkEvent(db: Database, input: NewMarkEvent): Promise<MarkEventRow> {
  return one(
    await db
      .insert(markEvents)
      .values({
        ownerUserId: input.ownerUserId,
        kind: input.kind,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        payload: input.payload,
        occurredAt: input.now,
      })
      .returning(),
    'mark event insert',
  );
}

export async function listMarkEvents(
  db: Database,
  ownerUserId: string,
  query: { after: number; limit: number; kind: MarkEventKind | null },
): Promise<MarkEventRow[]> {
  const conditions = [eq(markEvents.ownerUserId, ownerUserId), gt(markEvents.seq, query.after)];
  if (query.kind !== null) {
    conditions.push(eq(markEvents.kind, query.kind));
  }
  return db
    .select()
    .from(markEvents)
    .where(and(...conditions))
    .orderBy(asc(markEvents.seq))
    .limit(query.limit);
}

export async function latestMarkEventSeq(db: Database, ownerUserId: string): Promise<number> {
  const rows = await db
    .select({ seq: sql<string>`coalesce(max(${markEvents.seq}), 0)` })
    .from(markEvents)
    .where(eq(markEvents.ownerUserId, ownerUserId));
  return Number.parseInt(rows[0]?.seq ?? '0', 10) || 0;
}
