import type {
  EligibilityCapability,
  EligibilityOutcome,
  Issuer,
  JurisdictionEvidenceKind,
  JurisdictionRule,
  OwnerLimits,
  PolicyDenial,
  PolicySide,
  PolicyStage,
} from '@markov/contracts';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  betaParticipants,
  eligibilityDecisions,
  instruments,
  jurisdictionRuleSets,
  ownerLimits,
  policyDecisions,
  spendReservations,
  termsAcknowledgements,
  termsDocuments,
} from './schema.js';

/**
 * Policy persistence (B05): published rule sets and terms, recorded
 * eligibility decisions and acknowledgements, owner limits, pending-spend
 * reservations and every policy decision. Reservations are serialised per
 * user with a transaction-scoped advisory lock so concurrent intents can
 * never overspend a shared budget; the store never decides policy itself,
 * it runs the caller's deterministic decision inside the lock.
 */

export type JurisdictionRuleSetRow = typeof jurisdictionRuleSets.$inferSelect;
export type TermsDocumentRow = typeof termsDocuments.$inferSelect;
export type TermsAcknowledgementRow = typeof termsAcknowledgements.$inferSelect;
export type EligibilityDecisionRow = typeof eligibilityDecisions.$inferSelect;
export type OwnerLimitsRow = typeof ownerLimits.$inferSelect;
export type SpendReservationRow = typeof spendReservations.$inferSelect;
export type PolicyDecisionRow = typeof policyDecisions.$inferSelect;
export type BetaParticipantRow = typeof betaParticipants.$inferSelect;

export class PolicyVersionConflictError extends Error {
  override readonly name = 'PolicyVersionConflictError';
  constructor(kind: 'rule set' | 'terms document', version: string) {
    super(`${kind} ${version} is already published; versions are immutable`);
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

/* ------------------------------------------------------------------ rules */

export async function publishJurisdictionRuleSet(
  db: Database,
  input: {
    policyVersion: string;
    validityDays: number;
    rules: JurisdictionRule[];
    evidence: Record<string, string>;
    publishedBy: string;
    now: Date;
  },
): Promise<JurisdictionRuleSetRow> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ policyVersion: jurisdictionRuleSets.policyVersion })
      .from(jurisdictionRuleSets)
      .where(eq(jurisdictionRuleSets.policyVersion, input.policyVersion))
      .limit(1);
    if (existing.length > 0) {
      throw new PolicyVersionConflictError('rule set', input.policyVersion);
    }
    await tx
      .update(jurisdictionRuleSets)
      .set({ active: 0 })
      .where(eq(jurisdictionRuleSets.active, 1));
    const rows = await tx
      .insert(jurisdictionRuleSets)
      .values({
        policyVersion: input.policyVersion,
        validityDays: input.validityDays,
        rules: input.rules,
        evidence: input.evidence,
        publishedAt: input.now,
        publishedBy: input.publishedBy,
        active: 1,
      })
      .returning();
    return one(rows, 'rule set insert');
  });
}

export async function activeJurisdictionRuleSet(
  db: Database,
): Promise<JurisdictionRuleSetRow | null> {
  const rows = await db
    .select()
    .from(jurisdictionRuleSets)
    .where(eq(jurisdictionRuleSets.active, 1))
    .orderBy(desc(jurisdictionRuleSets.publishedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listJurisdictionRuleSets(
  db: Database,
  limit = 50,
): Promise<JurisdictionRuleSetRow[]> {
  return db
    .select()
    .from(jurisdictionRuleSets)
    .orderBy(desc(jurisdictionRuleSets.publishedAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ terms */

export async function publishTermsDocument(
  db: Database,
  input: {
    termsVersion: string;
    title: string;
    contentHash: string;
    url: string;
    requiredFor: EligibilityCapability[];
    publishedBy: string;
    now: Date;
  },
): Promise<TermsDocumentRow> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ termsVersion: termsDocuments.termsVersion })
      .from(termsDocuments)
      .where(eq(termsDocuments.termsVersion, input.termsVersion))
      .limit(1);
    if (existing.length > 0) {
      throw new PolicyVersionConflictError('terms document', input.termsVersion);
    }
    // One active document per capability: the newcomer retires every active document sharing a capability.
    const active = await tx.select().from(termsDocuments).where(eq(termsDocuments.active, 1));
    const retire = active
      .filter((doc) =>
        doc.requiredFor.some((capability) =>
          input.requiredFor.includes(capability as EligibilityCapability),
        ),
      )
      .map((doc) => doc.termsVersion);
    if (retire.length > 0) {
      await tx
        .update(termsDocuments)
        .set({ active: 0 })
        .where(inArray(termsDocuments.termsVersion, retire));
    }
    const rows = await tx
      .insert(termsDocuments)
      .values({ ...input, publishedAt: input.now, active: 1 })
      .returning();
    return one(rows, 'terms insert');
  });
}

export async function listActiveTermsDocuments(db: Database): Promise<TermsDocumentRow[]> {
  return db
    .select()
    .from(termsDocuments)
    .where(eq(termsDocuments.active, 1))
    .orderBy(desc(termsDocuments.publishedAt));
}

export async function findTermsDocument(
  db: Database,
  termsVersion: string,
): Promise<TermsDocumentRow | null> {
  const rows = await db
    .select()
    .from(termsDocuments)
    .where(eq(termsDocuments.termsVersion, termsVersion))
    .limit(1);
  return rows[0] ?? null;
}

/** Idempotent per user and version: a repeated acknowledgement returns the first one. */
export async function recordTermsAcknowledgement(
  db: Database,
  input: {
    userId: string;
    termsVersion: string;
    contentHash: string;
    channel: 'app' | 'cli';
    now: Date;
  },
): Promise<TermsAcknowledgementRow> {
  await db
    .insert(termsAcknowledgements)
    .values({ ...input, acknowledgedAt: input.now })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(termsAcknowledgements)
    .where(
      and(
        eq(termsAcknowledgements.userId, input.userId),
        eq(termsAcknowledgements.termsVersion, input.termsVersion),
      ),
    )
    .limit(1);
  return one(rows, 'terms acknowledgement');
}

export async function listTermsAcknowledgements(
  db: Database,
  userId: string,
): Promise<TermsAcknowledgementRow[]> {
  return db
    .select()
    .from(termsAcknowledgements)
    .where(eq(termsAcknowledgements.userId, userId))
    .orderBy(desc(termsAcknowledgements.acknowledgedAt));
}

/* ------------------------------------------------------------ eligibility */

export async function recordEligibilityDecision(
  db: Database,
  input: {
    userId: string;
    capability: EligibilityCapability;
    policyVersion: string | null;
    jurisdiction: string;
    evidenceKind: JurisdictionEvidenceKind;
    outcome: EligibilityOutcome;
    reasons: string[];
    issuers: Issuer[];
    decidedAt: Date;
    expiresAt: Date;
    decidedBy: string;
  },
): Promise<EligibilityDecisionRow> {
  const rows = await db.insert(eligibilityDecisions).values(input).returning();
  return one(rows, 'eligibility decision insert');
}

export async function latestEligibilityDecision(
  db: Database,
  userId: string,
  capability: EligibilityCapability,
): Promise<EligibilityDecisionRow | null> {
  const rows = await db
    .select()
    .from(eligibilityDecisions)
    .where(
      and(eq(eligibilityDecisions.userId, userId), eq(eligibilityDecisions.capability, capability)),
    )
    .orderBy(desc(eligibilityDecisions.seq))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEligibilityDecisions(
  db: Database,
  userId: string,
  limit = 50,
): Promise<EligibilityDecisionRow[]> {
  return db
    .select()
    .from(eligibilityDecisions)
    .where(eq(eligibilityDecisions.userId, userId))
    .orderBy(desc(eligibilityDecisions.seq))
    .limit(limit);
}

export async function findEligibilityDecision(
  db: Database,
  decisionId: string,
): Promise<EligibilityDecisionRow | null> {
  const rows = await db
    .select()
    .from(eligibilityDecisions)
    .where(eq(eligibilityDecisions.id, decisionId))
    .limit(1);
  return rows[0] ?? null;
}

/** Revokes once; a second revocation returns null so the caller can answer honestly. */
export async function revokeEligibilityDecision(
  db: Database,
  input: { decisionId: string; reason: string; now: Date },
): Promise<EligibilityDecisionRow | null> {
  const rows = await db
    .update(eligibilityDecisions)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(
      and(
        eq(eligibilityDecisions.id, input.decisionId),
        sql`${eligibilityDecisions.revokedAt} IS NULL`,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/* ----------------------------------------------------------------- limits */

export async function upsertOwnerLimits(
  db: Database,
  input: { userId: string; limits: Partial<OwnerLimits>; now: Date },
): Promise<OwnerLimitsRow> {
  const rows = await db
    .insert(ownerLimits)
    .values({ userId: input.userId, limits: input.limits, updatedAt: input.now })
    .onConflictDoUpdate({
      target: ownerLimits.userId,
      set: { limits: input.limits, updatedAt: input.now },
    })
    .returning();
  return one(rows, 'owner limits upsert');
}

export async function findOwnerLimits(
  db: Database,
  userId: string,
): Promise<OwnerLimitsRow | null> {
  const rows = await db.select().from(ownerLimits).where(eq(ownerLimits.userId, userId)).limit(1);
  return rows[0] ?? null;
}

/* ----------------------------------------------------------- participants */

export async function addBetaParticipant(
  db: Database,
  input: { userId: string; note: string; addedBy: string; now: Date },
): Promise<BetaParticipantRow> {
  const rows = await db
    .insert(betaParticipants)
    .values({ userId: input.userId, note: input.note, addedBy: input.addedBy, addedAt: input.now })
    .onConflictDoUpdate({
      target: betaParticipants.userId,
      set: { note: input.note, addedBy: input.addedBy, addedAt: input.now },
    })
    .returning();
  return one(rows, 'beta participant upsert');
}

export async function removeBetaParticipant(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .delete(betaParticipants)
    .where(eq(betaParticipants.userId, userId))
    .returning();
  return rows.length > 0;
}

export async function listBetaParticipants(
  db: Database,
  limit = 200,
): Promise<BetaParticipantRow[]> {
  return db.select().from(betaParticipants).orderBy(desc(betaParticipants.addedAt)).limit(limit);
}

export async function isBetaParticipant(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: betaParticipants.userId })
    .from(betaParticipants)
    .where(eq(betaParticipants.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/* ----------------------------------------------------------- reservations */

export interface BudgetUsage {
  /** Raw USDC held or consumed since the start of the UTC day. */
  readonly dailyUsedUsdcRaw: string;
  /** Raw USDC of buy-side holds still in force. */
  readonly reservedUsdcRaw: string;
}

/** Start of the UTC day containing `now`; the daily turnover window. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function sweepExpired(db: Database | Tx, userId: string, now: Date): Promise<void> {
  await db
    .update(spendReservations)
    .set({ status: 'expired', releasedAt: now })
    .where(
      and(
        eq(spendReservations.userId, userId),
        eq(spendReservations.status, 'held'),
        lte(spendReservations.expiresAt, now),
      ),
    );
}

async function readUsage(db: Database | Tx, userId: string, now: Date): Promise<BudgetUsage> {
  const dayStart = utcDayStart(now);
  const rows = await db.execute<{ daily: string; reserved: string }>(sql`
    SELECT
      coalesce(sum(${spendReservations.notionalUsdcRaw}::numeric) FILTER (
        WHERE ${spendReservations.status} IN ('held', 'consumed') AND ${spendReservations.createdAt} >= ${dayStart}
      ), 0)::text AS daily,
      coalesce(sum(${spendReservations.notionalUsdcRaw}::numeric) FILTER (
        WHERE ${spendReservations.status} = 'held' AND ${spendReservations.side} = 'buy' AND ${spendReservations.expiresAt} > ${now}
      ), 0)::text AS reserved
    FROM ${spendReservations}
    WHERE ${spendReservations.userId} = ${userId}
  `);
  const row = rows.rows[0];
  return { dailyUsedUsdcRaw: row?.daily ?? '0', reservedUsdcRaw: row?.reserved ?? '0' };
}

/** Current usage without holding anything; the read-only counterpart of `reserveSpend`. */
export async function budgetUsage(db: Database, userId: string, now: Date): Promise<BudgetUsage> {
  await sweepExpired(db, userId, now);
  return readUsage(db, userId, now);
}

export type ReserveOutcome<T extends { readonly allow: boolean }> =
  | { readonly kind: 'existing'; readonly row: SpendReservationRow; readonly usage: BudgetUsage }
  | {
      readonly kind: 'created';
      readonly row: SpendReservationRow;
      readonly decision: T;
      readonly usage: BudgetUsage;
    }
  | { readonly kind: 'denied'; readonly decision: T; readonly usage: BudgetUsage };

/**
 * Evaluate and hold in one serialised step. The per-user advisory lock makes
 * concurrent intents queue: each sees the holds created before it, so the
 * sum of holds can never exceed what `decide` allows. A repeated intent id
 * returns the existing hold without deciding again.
 */
export async function reserveSpend<T extends { readonly allow: boolean }>(
  db: Database,
  input: {
    userId: string;
    intentId: string;
    instrumentId: string;
    side: PolicySide;
    notionalUsdcRaw: string;
    now: Date;
    expiresAt: Date;
    decide: (usage: BudgetUsage) => T;
  },
): Promise<ReserveOutcome<T>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
    await sweepExpired(tx, input.userId, input.now);
    const existing = await tx
      .select()
      .from(spendReservations)
      .where(
        and(
          eq(spendReservations.userId, input.userId),
          eq(spendReservations.intentId, input.intentId),
        ),
      )
      .limit(1);
    const usage = await readUsage(tx, input.userId, input.now);
    const found = existing[0];
    if (found) {
      return { kind: 'existing', row: found, usage };
    }
    const decision = input.decide(usage);
    if (!decision.allow) {
      return { kind: 'denied', decision, usage };
    }
    const rows = await tx
      .insert(spendReservations)
      .values({
        userId: input.userId,
        intentId: input.intentId,
        instrumentId: input.instrumentId,
        side: input.side,
        notionalUsdcRaw: input.notionalUsdcRaw,
        status: 'held',
        createdAt: input.now,
        expiresAt: input.expiresAt,
      })
      .returning();
    return { kind: 'created', row: one(rows, 'reservation insert'), decision, usage };
  });
}

export async function findReservation(
  db: Database,
  userId: string,
  intentId: string,
): Promise<SpendReservationRow | null> {
  const rows = await db
    .select()
    .from(spendReservations)
    .where(and(eq(spendReservations.userId, userId), eq(spendReservations.intentId, intentId)))
    .limit(1);
  return rows[0] ?? null;
}

async function settleReservation(
  db: Database,
  input: { userId: string; intentId: string; now: Date },
  status: 'released' | 'consumed',
): Promise<SpendReservationRow | null> {
  const rows = await db
    .update(spendReservations)
    .set({ status, releasedAt: input.now })
    .where(
      and(
        eq(spendReservations.userId, input.userId),
        eq(spendReservations.intentId, input.intentId),
        eq(spendReservations.status, 'held'),
        gt(spendReservations.expiresAt, input.now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Held → released; null when nothing was held (unknown, already settled or expired). */
export async function releaseReservation(
  db: Database,
  input: { userId: string; intentId: string; now: Date },
): Promise<SpendReservationRow | null> {
  return settleReservation(db, input, 'released');
}

/** Held → consumed once the intent was actually submitted (B10). Consumed holds keep counting towards the day. */
export async function consumeReservation(
  db: Database,
  input: { userId: string; intentId: string; now: Date },
): Promise<SpendReservationRow | null> {
  return settleReservation(db, input, 'consumed');
}

export async function listReservations(
  db: Database,
  userId: string,
  now: Date,
  limit = 100,
): Promise<SpendReservationRow[]> {
  await sweepExpired(db, userId, now);
  return db
    .select()
    .from(spendReservations)
    .where(eq(spendReservations.userId, userId))
    .orderBy(desc(spendReservations.createdAt), desc(spendReservations.id))
    .limit(limit);
}

/* -------------------------------------------------------------- decisions */

export async function recordPolicyDecision(
  db: Database,
  input: {
    userId: string;
    instrumentId: string;
    side: PolicySide;
    stage: PolicyStage;
    notionalUsdcRaw: string;
    outcome: 'allow' | 'deny';
    denials: PolicyDenial[];
    evidence: Record<string, unknown>;
    limits: OwnerLimits;
    budget: Record<string, string>;
    reservationId: string | null;
    evaluatedAt: Date;
    expiresAt: Date;
  },
): Promise<PolicyDecisionRow> {
  const rows = await db.insert(policyDecisions).values(input).returning();
  return one(rows, 'policy decision insert');
}

export async function listPolicyDecisions(
  db: Database,
  userId: string,
  limit = 50,
): Promise<PolicyDecisionRow[]> {
  return db
    .select()
    .from(policyDecisions)
    .where(eq(policyDecisions.userId, userId))
    .orderBy(desc(policyDecisions.seq))
    .limit(limit);
}

/** Instrument rows for exposure positions, in one query. */
export async function findInstrumentsByIds(
  db: Database,
  ids: readonly string[],
): Promise<(typeof instruments.$inferSelect)[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(instruments)
    .where(inArray(instruments.id, [...ids]));
}
