import type {
  AttemptState,
  DecodedInstruction,
  IntentState,
  SimulationEvidence,
  TransactionEffects,
} from '@markov/contracts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  executionAttempts,
  executionFills,
  intents,
  outboxEvents,
  preparedTransactions,
  spendReservations,
} from './schema.js';

/**
 * Execution persistence (B10). A prepared transaction is stored exactly as
 * validated; an attempt is persisted with its signature, its signed bytes
 * and an outbox event in one database transaction before any broadcast; a
 * partial unique index keeps at most one live attempt per intent; fills are
 * idempotent on signature and leg. Guarded intent transitions live in the
 * planning store and are reused here.
 */
export type PreparedTransactionRow = typeof preparedTransactions.$inferSelect;
export type ExecutionAttemptRow = typeof executionAttempts.$inferSelect;
export type ExecutionFillRow = typeof executionFills.$inferSelect;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;

export const LIVE_ATTEMPT_STATES: readonly AttemptState[] = [
  'submitting',
  'submitted',
  'confirmed',
  'unknown',
];

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

export interface NewPreparedTransaction {
  readonly intentId: string;
  readonly planId: string;
  readonly ownerUserId: string;
  readonly transactionIndex: number;
  readonly batch: number;
  readonly legIndexes: readonly number[];
  readonly version: 'legacy' | 'v0';
  readonly messageHash: string;
  readonly unsignedTransaction: string;
  readonly feePayer: string;
  readonly expectedSigner: string;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly buildSource: string;
  readonly instructions: readonly DecodedInstruction[];
  readonly effects: TransactionEffects;
  readonly simulation: SimulationEvidence;
  readonly now: Date;
}

/** Stores a prepared transaction and supersedes earlier unsigned (prepared or expired) ones of the same plan and index. */
export async function insertPreparedTransaction(
  db: Database,
  input: NewPreparedTransaction,
): Promise<PreparedTransactionRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(preparedTransactions)
      .set({ state: 'superseded', updatedAt: input.now })
      .where(
        and(
          eq(preparedTransactions.planId, input.planId),
          eq(preparedTransactions.transactionIndex, input.transactionIndex),
          inArray(preparedTransactions.state, ['prepared', 'expired']),
        ),
      );
    return one(
      await tx
        .insert(preparedTransactions)
        .values({
          intentId: input.intentId,
          planId: input.planId,
          ownerUserId: input.ownerUserId,
          transactionIndex: input.transactionIndex,
          batch: input.batch,
          legIndexes: [...input.legIndexes],
          version: input.version,
          messageHash: input.messageHash,
          unsignedTransaction: input.unsignedTransaction,
          feePayer: input.feePayer,
          expectedSigner: input.expectedSigner,
          recentBlockhash: input.recentBlockhash,
          lastValidBlockHeight: input.lastValidBlockHeight,
          buildSource: input.buildSource,
          instructions: [...input.instructions],
          effects: input.effects,
          simulation: input.simulation,
          state: 'prepared',
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(),
      'prepared transaction insert',
    );
  });
}

export async function findPreparedTransaction(
  db: Database,
  ownerUserId: string,
  transactionId: string,
): Promise<PreparedTransactionRow | null> {
  const rows = await db
    .select()
    .from(preparedTransactions)
    .where(
      and(
        eq(preparedTransactions.id, transactionId),
        eq(preparedTransactions.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The newest prepared transaction per index for a plan (superseded ones excluded). */
export async function listCurrentPreparedTransactions(
  db: Database,
  planId: string,
): Promise<PreparedTransactionRow[]> {
  const rows = await db
    .select()
    .from(preparedTransactions)
    .where(
      and(
        eq(preparedTransactions.planId, planId),
        sql`${preparedTransactions.state} <> 'superseded'`,
      ),
    )
    .orderBy(
      asc(preparedTransactions.transactionIndex),
      desc(preparedTransactions.createdAt),
      desc(preparedTransactions.id),
    );
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.transactionIndex)) {
      return false;
    }
    seen.add(row.transactionIndex);
    return true;
  });
}

export async function updatePreparedTransactionState(
  db: Database,
  transactionId: string,
  state: AttemptState,
  now: Date,
): Promise<void> {
  await db
    .update(preparedTransactions)
    .set({ state, updatedAt: now })
    .where(eq(preparedTransactions.id, transactionId));
}

export interface NewAttempt {
  readonly transactionId: string;
  readonly intentId: string;
  readonly planId: string;
  readonly ownerUserId: string;
  readonly transactionIndex: number;
  readonly signature: string;
  readonly signedTransaction: string;
  readonly messageHash: string;
  readonly reservationId: string | null;
  readonly lastValidBlockHeight: number;
  readonly now: Date;
}

export interface NewOutboxEvent {
  readonly kind: (typeof outboxEvents.$inferInsert)['kind'];
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly ownerUserId: string | null;
  readonly payload: Record<string, unknown>;
  readonly now: Date;
}

export type BeginSubmissionResult =
  | { readonly kind: 'begun'; readonly attempt: ExecutionAttemptRow }
  | { readonly kind: 'intent_not_ready' }
  | { readonly kind: 'attempt_in_flight'; readonly attempt: ExecutionAttemptRow };

/**
 * Persists the attempt (signature, signed bytes), the outbox event and the
 * intent transition to SUBMITTING in one transaction, before any broadcast.
 * A live attempt already in flight, or an intent that is not awaiting the
 * signature, leaves nothing behind.
 */
export async function beginSubmission(
  db: Database,
  input: NewAttempt & { readonly intentFrom: readonly IntentState[] },
): Promise<BeginSubmissionResult> {
  return db.transaction(async (tx) => {
    const live = await tx
      .select()
      .from(executionAttempts)
      .where(
        and(
          eq(executionAttempts.intentId, input.intentId),
          inArray(executionAttempts.state, [...LIVE_ATTEMPT_STATES]),
        ),
      )
      .limit(1);
    if (live[0]) {
      return { kind: 'attempt_in_flight', attempt: live[0] };
    }
    const moved = await tx
      .update(intents)
      .set({ state: 'SUBMITTING', stateReason: null, updatedAt: input.now })
      .where(and(eq(intents.id, input.intentId), inArray(intents.state, [...input.intentFrom])))
      .returning({ id: intents.id });
    if (!moved[0]) {
      return { kind: 'intent_not_ready' };
    }
    const attempt = one(
      await tx
        .insert(executionAttempts)
        .values({
          transactionId: input.transactionId,
          intentId: input.intentId,
          planId: input.planId,
          ownerUserId: input.ownerUserId,
          transactionIndex: input.transactionIndex,
          signature: input.signature,
          signedTransaction: input.signedTransaction,
          messageHash: input.messageHash,
          state: 'submitting',
          reason: null,
          reservationId: input.reservationId,
          lastValidBlockHeight: input.lastValidBlockHeight,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(),
      'attempt insert',
    );
    await tx
      .update(preparedTransactions)
      .set({ state: 'submitting', updatedAt: input.now })
      .where(eq(preparedTransactions.id, input.transactionId));
    await tx.insert(outboxEvents).values({
      kind: 'execution.pending',
      aggregateType: 'intent',
      aggregateId: input.intentId,
      ownerUserId: input.ownerUserId,
      payload: {
        attemptId: attempt.id,
        transactionId: input.transactionId,
        signature: input.signature,
        messageHash: input.messageHash,
      },
      createdAt: input.now,
    });
    return { kind: 'begun', attempt };
  });
}

export interface AttemptPatch {
  readonly state?: AttemptState;
  readonly reason?: string | null;
  readonly confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
  readonly slot?: number | null;
  readonly chainError?: string | null;
  readonly submittedAt?: Date;
  readonly lastSentAt?: Date;
  readonly lastCheckedAt?: Date;
  readonly resendCount?: number;
}

export async function updateAttempt(
  db: Database,
  attemptId: string,
  patch: AttemptPatch,
  now: Date,
): Promise<ExecutionAttemptRow | null> {
  const rows = await db
    .update(executionAttempts)
    .set({
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      ...(patch.confirmationStatus !== undefined
        ? { confirmationStatus: patch.confirmationStatus }
        : {}),
      ...(patch.slot !== undefined ? { slot: patch.slot } : {}),
      ...(patch.chainError !== undefined ? { chainError: patch.chainError } : {}),
      ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}),
      ...(patch.lastSentAt !== undefined ? { lastSentAt: patch.lastSentAt } : {}),
      ...(patch.lastCheckedAt !== undefined ? { lastCheckedAt: patch.lastCheckedAt } : {}),
      ...(patch.resendCount !== undefined ? { resendCount: patch.resendCount } : {}),
      updatedAt: now,
    })
    .where(eq(executionAttempts.id, attemptId))
    .returning();
  const row = rows[0] ?? null;
  if (row && patch.state !== undefined) {
    await db
      .update(preparedTransactions)
      .set({ state: patch.state, updatedAt: now })
      .where(eq(preparedTransactions.id, row.transactionId));
  }
  return row;
}

export async function findAttempt(
  db: Database,
  ownerUserId: string,
  attemptId: string,
): Promise<ExecutionAttemptRow | null> {
  const rows = await db
    .select()
    .from(executionAttempts)
    .where(and(eq(executionAttempts.id, attemptId), eq(executionAttempts.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findLiveAttempt(
  db: Database,
  intentId: string,
): Promise<ExecutionAttemptRow | null> {
  const rows = await db
    .select()
    .from(executionAttempts)
    .where(
      and(
        eq(executionAttempts.intentId, intentId),
        inArray(executionAttempts.state, [...LIVE_ATTEMPT_STATES]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listAttempts(db: Database, intentId: string): Promise<ExecutionAttemptRow[]> {
  return db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.intentId, intentId))
    .orderBy(asc(executionAttempts.createdAt));
}

/** Every live attempt across owners, oldest first; the worker reconciles them in rounds. */
export async function listLiveAttempts(db: Database, limit = 100): Promise<ExecutionAttemptRow[]> {
  return db
    .select()
    .from(executionAttempts)
    .where(inArray(executionAttempts.state, [...LIVE_ATTEMPT_STATES]))
    .orderBy(asc(executionAttempts.updatedAt))
    .limit(limit);
}

export interface NewFill {
  readonly attemptId: string;
  readonly intentId: string;
  readonly planId: string;
  readonly ownerUserId: string;
  readonly legIndex: number;
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: Date | null;
  readonly side: 'buy' | 'sell';
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inputSpentRaw: string;
  readonly outputReceivedRaw: string;
  readonly feeLamports: string;
  readonly lamportsSpent: string;
  readonly withinBounds: boolean;
  readonly observedAt: Date;
}

/** Records a fill once per signature and leg; answers whether the row was new. */
export async function insertFill(db: Database, input: NewFill): Promise<boolean> {
  const rows = await db
    .insert(executionFills)
    .values({
      attemptId: input.attemptId,
      intentId: input.intentId,
      planId: input.planId,
      ownerUserId: input.ownerUserId,
      legIndex: input.legIndex,
      signature: input.signature,
      slot: input.slot,
      blockTime: input.blockTime,
      side: input.side,
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      inputSpentRaw: input.inputSpentRaw,
      outputReceivedRaw: input.outputReceivedRaw,
      feeLamports: input.feeLamports,
      lamportsSpent: input.lamportsSpent,
      withinBounds: input.withinBounds,
      source: 'transaction_meta',
      observedAt: input.observedAt,
      createdAt: input.observedAt,
    })
    .onConflictDoNothing({ target: [executionFills.signature, executionFills.legIndex] })
    .returning({ id: executionFills.id });
  return rows.length > 0;
}

export async function listFills(db: Database, intentId: string): Promise<ExecutionFillRow[]> {
  return db
    .select()
    .from(executionFills)
    .where(eq(executionFills.intentId, intentId))
    .orderBy(asc(executionFills.legIndex), asc(executionFills.createdAt));
}

export async function insertOutboxEvent(
  db: Database,
  input: NewOutboxEvent,
): Promise<OutboxEventRow> {
  return one(
    await db
      .insert(outboxEvents)
      .values({
        kind: input.kind,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        ownerUserId: input.ownerUserId,
        payload: input.payload,
        createdAt: input.now,
      })
      .returning(),
    'outbox insert',
  );
}

export async function listOutboxEvents(
  db: Database,
  aggregateId: string,
): Promise<OutboxEventRow[]> {
  return db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.aggregateId, aggregateId))
    .orderBy(asc(outboxEvents.createdAt));
}

export async function listUnpublishedOutboxEvents(
  db: Database,
  limit = 100,
): Promise<OutboxEventRow[]> {
  return db
    .select()
    .from(outboxEvents)
    .where(isNull(outboxEvents.publishedAt))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(limit);
}

export async function markOutboxPublished(
  db: Database,
  ids: readonly string[],
  now: Date,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await db
    .update(outboxEvents)
    .set({ publishedAt: now })
    .where(inArray(outboxEvents.id, [...ids]));
}

/** Settles the policy reservation an attempt holds, when it holds one. */
export async function settleAttemptReservation(
  db: Database,
  attemptId: string,
  outcome: 'consumed' | 'released',
  now: Date,
): Promise<void> {
  const rows = await db
    .select({ reservationId: executionAttempts.reservationId })
    .from(executionAttempts)
    .where(eq(executionAttempts.id, attemptId))
    .limit(1);
  const reservationId = rows[0]?.reservationId ?? null;
  if (reservationId === null) {
    return;
  }
  await db
    .update(spendReservations)
    .set({ status: outcome, releasedAt: now })
    .where(and(eq(spendReservations.id, reservationId), eq(spendReservations.status, 'held')));
}

/** An attempt with the prepared transaction it signed and the intent it belongs to. */
export interface AttemptContext {
  readonly attempt: ExecutionAttemptRow;
  readonly transaction: PreparedTransactionRow;
  readonly intent: typeof intents.$inferSelect;
}

async function contextsFor(db: Database, rows: ExecutionAttemptRow[]): Promise<AttemptContext[]> {
  const out: AttemptContext[] = [];
  for (const attempt of rows) {
    const [transaction] = await db
      .select()
      .from(preparedTransactions)
      .where(eq(preparedTransactions.id, attempt.transactionId))
      .limit(1);
    const [intent] = await db
      .select()
      .from(intents)
      .where(eq(intents.id, attempt.intentId))
      .limit(1);
    if (transaction && intent) {
      out.push({ attempt, transaction, intent });
    }
  }
  return out;
}

/** Every live attempt with its transaction and intent, oldest first (the reconciliation loop's input). */
export async function listLiveAttemptContexts(
  db: Database,
  limit = 100,
): Promise<AttemptContext[]> {
  return contextsFor(db, await listLiveAttempts(db, limit));
}

export async function findAttemptContext(
  db: Database,
  attemptId: string,
): Promise<AttemptContext | null> {
  const rows = await db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.id, attemptId))
    .limit(1);
  const contexts = await contextsFor(db, rows);
  return contexts[0] ?? null;
}

/** Marks unsigned prepared transactions whose blockhash can no longer land as expired; answers how many. */
export async function expirePreparedTransactions(
  db: Database,
  planId: string,
  finalizedBlockHeight: number,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(preparedTransactions)
    .set({ state: 'expired', updatedAt: now })
    .where(
      and(
        eq(preparedTransactions.planId, planId),
        eq(preparedTransactions.state, 'prepared'),
        sql`${preparedTransactions.lastValidBlockHeight} < ${finalizedBlockHeight}`,
      ),
    )
    .returning({ id: preparedTransactions.id });
  return rows.length;
}

/**
 * The persistence port the execution lifecycle (`@markov/execution`) drives:
 * guarded intent transitions, attempt patches, idempotent fills, reservation
 * settlement and outbox events, all over this database. Structurally typed so
 * the domain package never depends on the database.
 */
export function createExecutionStorePort(db: Database) {
  return {
    async updateAttempt(attemptId: string, patch: AttemptPatch, now: Date): Promise<void> {
      await updateAttempt(db, attemptId, patch, now);
    },
    async transitionIntent(input: {
      readonly intentId: string;
      readonly from: readonly string[];
      readonly to: string;
      readonly reason: string | null;
      readonly now: Date;
    }): Promise<boolean> {
      const rows = await db
        .update(intents)
        .set({ state: input.to, stateReason: input.reason, updatedAt: input.now })
        .where(and(eq(intents.id, input.intentId), inArray(intents.state, [...input.from])))
        .returning({ id: intents.id });
      return rows.length > 0;
    },
    recordFill(fill: NewFill): Promise<boolean> {
      return insertFill(db, fill);
    },
    settleReservation(attemptId: string, outcome: 'consumed' | 'released', now: Date) {
      return settleAttemptReservation(db, attemptId, outcome, now);
    },
    async writeOutbox(event: {
      readonly kind: string;
      readonly intentId: string;
      readonly ownerUserId: string;
      readonly payload: Record<string, unknown>;
      readonly now: Date;
    }): Promise<void> {
      await insertOutboxEvent(db, {
        kind: event.kind as NewOutboxEvent['kind'],
        aggregateType: 'intent',
        aggregateId: event.intentId,
        ownerUserId: event.ownerUserId,
        payload: event.payload,
        now: event.now,
      });
    },
  };
}
export type ExecutionStorePort = ReturnType<typeof createExecutionStorePort>;
