import type {
  BudgetMode,
  ExecutionPlan,
  IntentKind,
  IntentState,
  PlanMode,
  PlanStatus,
  VenueQuote,
} from '@markov/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { executionPlans, intents, venueQuotes } from './schema.js';

/**
 * Execution planning persistence (B09). Intents are idempotent per owner
 * and key; state changes are guarded transitions (`UPDATE … WHERE state IN
 * …`) so concurrent requests cannot both win; a new plan supersedes the
 * intent's earlier valid plans inside one transaction; plan documents are
 * stored exactly as hashed and never edited. Nothing here moves funds.
 */
export type IntentRow = typeof intents.$inferSelect;
export type ExecutionPlanRow = typeof executionPlans.$inferSelect;
export type VenueQuoteRow = typeof venueQuotes.$inferSelect;

export interface NewIntent {
  readonly ownerUserId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly schemaVersion: string;
  readonly kind: IntentKind;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly strategyId: string | null;
  readonly versionId: string | null;
  readonly instrumentId: string | null;
  readonly budget: {
    readonly mint: string;
    readonly symbol: string;
    readonly decimals: number;
    readonly raw: string;
  };
  readonly budgetMode: BudgetMode;
  readonly executionPreference: string;
  readonly approvalMode: string;
  readonly slippageBps: number;
  /** A reviewed completion of a partially completed intent (B11), or null. */
  readonly continuation: {
    readonly ofIntentId: string;
    readonly ofPlanId: string;
    readonly legIndexes: readonly number[];
  } | null;
  readonly now: Date;
  readonly expiresAt: Date;
}

export type CreateIntentResult =
  | { readonly kind: 'created'; readonly row: IntentRow }
  | { readonly kind: 'existing'; readonly row: IntentRow };

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

export async function createIntent(db: Database, input: NewIntent): Promise<CreateIntentResult> {
  const inserted = await db
    .insert(intents)
    .values({
      ownerUserId: input.ownerUserId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      schemaVersion: input.schemaVersion,
      kind: input.kind,
      state: 'DRAFT',
      stateReason: null,
      walletId: input.walletId,
      walletAddress: input.walletAddress,
      strategyId: input.strategyId,
      versionId: input.versionId,
      instrumentId: input.instrumentId,
      budgetMint: input.budget.mint,
      budgetSymbol: input.budget.symbol,
      budgetDecimals: input.budget.decimals,
      budgetRaw: input.budget.raw,
      budgetMode: input.budgetMode,
      executionPreference: input.executionPreference,
      approvalMode: input.approvalMode,
      slippageBps: input.slippageBps,
      continuationOfIntentId: input.continuation?.ofIntentId ?? null,
      continuationOfPlanId: input.continuation?.ofPlanId ?? null,
      continuationLegIndexes: input.continuation ? [...input.continuation.legIndexes] : null,
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({ target: [intents.ownerUserId, intents.idempotencyKey] })
    .returning();
  if (inserted[0]) {
    return { kind: 'created', row: inserted[0] };
  }
  const existing = await db
    .select()
    .from(intents)
    .where(
      and(
        eq(intents.ownerUserId, input.ownerUserId),
        eq(intents.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  return { kind: 'existing', row: one(existing, 'intent lookup after conflict') };
}

/** Links a partially completed intent to the intent that continues it (once). */
export async function markIntentContinued(
  db: Database,
  intentId: string,
  continuedByIntentId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(intents)
    .set({ continuedByIntentId, updatedAt: now })
    .where(and(eq(intents.id, intentId), isNull(intents.continuedByIntentId)))
    .returning({ id: intents.id });
  return rows.length > 0;
}

export async function findIntent(
  db: Database,
  ownerUserId: string,
  intentId: string,
): Promise<IntentRow | null> {
  const rows = await db
    .select()
    .from(intents)
    .where(and(eq(intents.id, intentId), eq(intents.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listIntents(
  db: Database,
  ownerUserId: string,
  limit = 50,
): Promise<IntentRow[]> {
  return db
    .select()
    .from(intents)
    .where(eq(intents.ownerUserId, ownerUserId))
    .orderBy(desc(intents.createdAt), desc(intents.id))
    .limit(limit);
}

export interface IntentTransition {
  readonly intentId: string;
  /** The states the change is valid from; any other current state leaves the row untouched. */
  readonly from: readonly IntentState[];
  readonly to: IntentState;
  readonly reason: string | null;
  /** Set to bind the intent to its newest plan; omit to leave the binding alone. */
  readonly latestPlan?: { readonly id: string; readonly hash: string } | null;
  readonly now: Date;
}

/** Guarded state change: answers the updated row, or null when the intent was not in one of `from`. */
export async function transitionIntent(
  db: Database,
  input: IntentTransition,
): Promise<IntentRow | null> {
  const rows = await db
    .update(intents)
    .set({
      state: input.to,
      stateReason: input.reason,
      updatedAt: input.now,
      ...(input.latestPlan === undefined
        ? {}
        : {
            latestPlanId: input.latestPlan?.id ?? null,
            latestPlanHash: input.latestPlan?.hash ?? null,
          }),
    })
    .where(and(eq(intents.id, input.intentId), inArray(intents.state, [...input.from])))
    .returning();
  return rows[0] ?? null;
}

export interface NewPlan {
  readonly intentId: string;
  readonly ownerUserId: string;
  readonly planHash: string;
  readonly mode: PlanMode;
  readonly plan: ExecutionPlan;
  readonly expiresAt: Date;
  readonly now: Date;
}

/** Stores a plan and supersedes the intent's earlier valid plans in the same transaction. */
export async function insertPlan(db: Database, input: NewPlan): Promise<ExecutionPlanRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(executionPlans)
      .set({ status: 'superseded' })
      .where(and(eq(executionPlans.intentId, input.intentId), eq(executionPlans.status, 'valid')));
    return one(
      await tx
        .insert(executionPlans)
        .values({
          id: input.plan.planId,
          intentId: input.intentId,
          ownerUserId: input.ownerUserId,
          planHash: input.planHash,
          mode: input.mode,
          status: 'valid',
          plan: input.plan,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        })
        .returning(),
      'plan insert',
    );
  });
}

export async function findPlan(
  db: Database,
  ownerUserId: string,
  planId: string,
): Promise<ExecutionPlanRow | null> {
  const rows = await db
    .select()
    .from(executionPlans)
    .where(and(eq(executionPlans.id, planId), eq(executionPlans.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPlans(db: Database, intentId: string): Promise<ExecutionPlanRow[]> {
  return db
    .select()
    .from(executionPlans)
    .where(eq(executionPlans.intentId, intentId))
    .orderBy(desc(executionPlans.createdAt));
}

export async function markPlanStatus(
  db: Database,
  planId: string,
  status: PlanStatus,
): Promise<void> {
  await db.update(executionPlans).set({ status }).where(eq(executionPlans.id, planId));
}

/** Records the owner's review of a valid plan; null when the plan is no longer valid. */
export async function acknowledgePlan(
  db: Database,
  input: { planId: string; hash: string; stagedAcknowledged: boolean; now: Date },
): Promise<ExecutionPlanRow | null> {
  const rows = await db
    .update(executionPlans)
    .set({
      acknowledgedAt: input.now,
      acknowledgedHash: input.hash,
      stagedAcknowledged: input.stagedAcknowledged,
    })
    .where(and(eq(executionPlans.id, input.planId), eq(executionPlans.status, 'valid')))
    .returning();
  return rows[0] ?? null;
}

export interface NewVenueQuote {
  readonly intentId: string;
  readonly planId: string | null;
  readonly legIndex: number;
  readonly quote: VenueQuote;
  readonly accepted: boolean;
  readonly issues: readonly { code: string; message: string }[];
  readonly now: Date;
}

export async function insertVenueQuotes(
  db: Database,
  rows: readonly NewVenueQuote[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db.insert(venueQuotes).values(
    rows.map((row) => ({
      intentId: row.intentId,
      planId: row.planId,
      legIndex: row.legIndex,
      venue: row.quote.venue,
      mode: row.quote.mode,
      quoteRef: row.quote.quoteRef,
      inputMint: row.quote.inputMint,
      outputMint: row.quote.outputMint,
      inAmountRaw: row.quote.inAmountRaw,
      outAmountRaw: row.quote.outAmountRaw,
      otherAmountThresholdRaw: row.quote.otherAmountThresholdRaw,
      slippageBps: row.quote.slippageBps,
      priceImpactBps: row.quote.priceImpactBps,
      quote: row.quote,
      accepted: row.accepted,
      issues: [...row.issues],
      observedAt: new Date(row.quote.observedAt),
      createdAt: row.now,
    })),
  );
}

export async function listVenueQuotes(db: Database, intentId: string): Promise<VenueQuoteRow[]> {
  return db
    .select()
    .from(venueQuotes)
    .where(eq(venueQuotes.intentId, intentId))
    .orderBy(desc(venueQuotes.createdAt), venueQuotes.legIndex);
}
