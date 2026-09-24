import type {
  InstrumentReference,
  ResearchSubject,
  RunStatus,
  SourceRole,
  ThesisStatement,
} from '@markov/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { researchRuns, sourceRecords, theses, thesisRevisions } from './schema.js';

/**
 * Research persistence (B06). Every read and write is scoped by the owner;
 * a thesis another person owns answers null so the API can say not found.
 * Revisions are immutable and numbered inside a transaction; runs move
 * through queued → running → succeeded | failed | cancelled once.
 */
export type ThesisRow = typeof theses.$inferSelect;
export type ThesisRevisionRow = typeof thesisRevisions.$inferSelect;
export type SourceRecordRow = typeof sourceRecords.$inferSelect;
export type ResearchRunRow = typeof researchRuns.$inferSelect;

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

export interface RevisionWrite {
  readonly title: string;
  readonly claim: string;
  readonly statements: ThesisStatement[];
  readonly counterarguments: string[];
  readonly instruments: InstrumentReference[];
  readonly subjects: ResearchSubject[];
  readonly privateNotes: string | null;
  readonly authorPrincipal: string;
  readonly contentHash: string;
}

export async function createThesis(
  db: Database,
  input: {
    ownerUserId: string;
    visibility: 'private' | 'public';
    revision: RevisionWrite;
    now: Date;
  },
): Promise<{ thesis: ThesisRow; revision: ThesisRevisionRow }> {
  return db.transaction(async (tx) => {
    const thesis = one(
      await tx
        .insert(theses)
        .values({
          ownerUserId: input.ownerUserId,
          visibility: input.visibility,
          status: 'draft',
          currentRevisionNumber: 1,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(),
      'thesis insert',
    );
    const revision = one(
      await tx
        .insert(thesisRevisions)
        .values({ thesisId: thesis.id, revisionNumber: 1, ...input.revision, createdAt: input.now })
        .returning(),
      'revision insert',
    );
    return { thesis, revision };
  });
}

export async function findThesis(
  db: Database,
  ownerUserId: string,
  thesisId: string,
): Promise<ThesisRow | null> {
  const rows = await db
    .select()
    .from(theses)
    .where(and(eq(theses.id, thesisId), eq(theses.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Any owner: for the public projection, which the service filters by visibility. */
export async function findThesisAnyOwner(
  db: Database,
  thesisId: string,
): Promise<ThesisRow | null> {
  const rows = await db.select().from(theses).where(eq(theses.id, thesisId)).limit(1);
  return rows[0] ?? null;
}

export async function listTheses(
  db: Database,
  ownerUserId: string,
  limit = 100,
): Promise<{ thesis: ThesisRow; revision: ThesisRevisionRow }[]> {
  const rows = await db
    .select({ thesis: theses, revision: thesisRevisions })
    .from(theses)
    .innerJoin(
      thesisRevisions,
      and(
        eq(thesisRevisions.thesisId, theses.id),
        eq(thesisRevisions.revisionNumber, theses.currentRevisionNumber),
      ),
    )
    .where(eq(theses.ownerUserId, ownerUserId))
    .orderBy(desc(theses.updatedAt))
    .limit(limit);
  return rows;
}

export async function currentRevision(db: Database, thesis: ThesisRow): Promise<ThesisRevisionRow> {
  const rows = await db
    .select()
    .from(thesisRevisions)
    .where(
      and(
        eq(thesisRevisions.thesisId, thesis.id),
        eq(thesisRevisions.revisionNumber, thesis.currentRevisionNumber),
      ),
    )
    .limit(1);
  return one(rows, 'current revision');
}

export async function listRevisions(db: Database, thesisId: string): Promise<ThesisRevisionRow[]> {
  return db
    .select()
    .from(thesisRevisions)
    .where(eq(thesisRevisions.thesisId, thesisId))
    .orderBy(desc(thesisRevisions.revisionNumber));
}

/** Appends a revision with the next number under a row lock so two writers never share a number. */
export async function appendRevision(
  db: Database,
  input: { ownerUserId: string; thesisId: string; revision: RevisionWrite; now: Date },
): Promise<{ thesis: ThesisRow; revision: ThesisRevisionRow } | null> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(theses)
      .where(and(eq(theses.id, input.thesisId), eq(theses.ownerUserId, input.ownerUserId)))
      .for('update');
    const thesis = locked[0];
    if (!thesis) {
      return null;
    }
    const revisionNumber = thesis.currentRevisionNumber + 1;
    const revision = one(
      await tx
        .insert(thesisRevisions)
        .values({ thesisId: thesis.id, revisionNumber, ...input.revision, createdAt: input.now })
        .returning(),
      'revision insert',
    );
    const updated = one(
      await tx
        .update(theses)
        .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
        .where(eq(theses.id, thesis.id))
        .returning(),
      'thesis update',
    );
    return { thesis: updated, revision };
  });
}

export async function updateThesis(
  db: Database,
  input: {
    ownerUserId: string;
    thesisId: string;
    visibility?: 'private' | 'public';
    status?: 'draft' | 'archived';
    now: Date;
  },
): Promise<ThesisRow | null> {
  const rows = await db
    .update(theses)
    .set({
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.status ? { status: input.status } : {}),
      updatedAt: input.now,
    })
    .where(and(eq(theses.id, input.thesisId), eq(theses.ownerUserId, input.ownerUserId)))
    .returning();
  return rows[0] ?? null;
}

export interface SourceWrite {
  readonly thesisId: string;
  readonly role: SourceRole;
  readonly url: string;
  readonly finalUrl: string | null;
  readonly title: string | null;
  readonly status: 'fetched' | 'blocked' | 'failed';
  readonly blockedReason: string | null;
  readonly contentType: string | null;
  readonly byteLength: number | null;
  readonly contentHash: string | null;
  readonly excerpt: string | null;
  readonly publishedAt: Date | null;
  readonly observedAt: Date | null;
  readonly retrievedAt: Date;
  readonly redirects: string[];
}

export async function recordSource(db: Database, input: SourceWrite): Promise<SourceRecordRow> {
  return one(await db.insert(sourceRecords).values(input).returning(), 'source insert');
}

export async function listSources(db: Database, thesisId: string): Promise<SourceRecordRow[]> {
  return db
    .select()
    .from(sourceRecords)
    .where(eq(sourceRecords.thesisId, thesisId))
    .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id));
}

export async function createRun(
  db: Database,
  input: {
    thesisId: string;
    ownerUserId: string;
    question: string;
    sourceIds: string[];
    budget: { maxOutputChars: number; maxStatements: number };
    now: Date;
  },
): Promise<ResearchRunRow> {
  return one(
    await db
      .insert(researchRuns)
      .values({
        thesisId: input.thesisId,
        ownerUserId: input.ownerUserId,
        status: 'queued',
        question: input.question,
        sourceIds: input.sourceIds,
        budget: input.budget,
        createdAt: input.now,
      })
      .returning(),
    'run insert',
  );
}

export async function findRun(
  db: Database,
  ownerUserId: string,
  runId: string,
): Promise<ResearchRunRow | null> {
  const rows = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRuns(
  db: Database,
  ownerUserId: string,
  thesisId: string | null,
  limit = 50,
): Promise<ResearchRunRow[]> {
  const where =
    thesisId === null
      ? eq(researchRuns.ownerUserId, ownerUserId)
      : and(eq(researchRuns.ownerUserId, ownerUserId), eq(researchRuns.thesisId, thesisId));
  return db
    .select()
    .from(researchRuns)
    .where(where)
    .orderBy(desc(researchRuns.createdAt), desc(researchRuns.id))
    .limit(limit);
}

/** queued → running; null when the run is no longer queued (cancelled, already running). */
export async function startRun(
  db: Database,
  runId: string,
  now: Date,
): Promise<ResearchRunRow | null> {
  const rows = await db
    .update(researchRuns)
    .set({ status: 'running', startedAt: now })
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, 'queued')))
    .returning();
  return rows[0] ?? null;
}

/** running → succeeded | failed; a run cancelled meanwhile keeps its cancelled state and the result is dropped. */
export async function finishRun(
  db: Database,
  input: {
    runId: string;
    status: 'succeeded' | 'failed';
    provenance: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    error: string | null;
    now: Date;
  },
): Promise<ResearchRunRow | null> {
  const rows = await db
    .update(researchRuns)
    .set({
      status: input.status,
      provenance: input.provenance,
      output: input.output,
      error: input.error,
      finishedAt: input.now,
    })
    .where(and(eq(researchRuns.id, input.runId), eq(researchRuns.status, 'running')))
    .returning();
  return rows[0] ?? null;
}

/** queued | running → cancelled; null when the run already finished. */
export async function cancelRun(
  db: Database,
  ownerUserId: string,
  runId: string,
  now: Date,
): Promise<ResearchRunRow | null> {
  const current = await findRun(db, ownerUserId, runId);
  if (!current || (current.status !== 'queued' && current.status !== 'running')) {
    return null;
  }
  const rows = await db
    .update(researchRuns)
    .set({ status: 'cancelled', finishedAt: now })
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, current.status as RunStatus)))
    .returning();
  return rows[0] ?? null;
}
