import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from './client.js';
import type { RegistryRecordRow } from './registry-store.js';
import {
  moderationDecisions,
  portfolioInstances,
  registryRecords,
  strategies,
  strategyFollows,
  strategyVersions,
} from './schema.js';
import type { StrategyRow, StrategyVersionRow } from './strategy-store.js';

/**
 * Discovery (B14): the public population is every active strategy with at
 * least one registered, unmoderated version. Archived strategies, drafts,
 * unpublished versions and hidden versions are not in it by construction;
 * nothing here selects an owner, a wallet or an instance.
 */

export type ModerationDecisionRow = typeof moderationDecisions.$inferSelect;

export interface PublicStrategyCandidate {
  readonly strategy: StrategyRow;
  /** Registered, unmoderated versions with their indexed records, newest first. */
  readonly versions: readonly { version: StrategyVersionRow; record: RegistryRecordRow }[];
  readonly followerCount: number;
}

export async function listPublicStrategies(
  db: Database,
  limit = 500,
): Promise<PublicStrategyCandidate[]> {
  const rows = await db
    .select({ strategy: strategies, version: strategyVersions, record: registryRecords })
    .from(strategyVersions)
    .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
    .innerJoin(registryRecords, eq(registryRecords.versionId, strategyVersions.id))
    .where(
      and(
        eq(strategies.status, 'active'),
        eq(strategyVersions.publication, 'registered'),
        eq(strategyVersions.moderation, 'none'),
      ),
    )
    .orderBy(desc(strategies.updatedAt), desc(strategies.id), desc(strategyVersions.versionNumber))
    .limit(limit);
  const grouped = new Map<
    string,
    { strategy: StrategyRow; versions: PublicStrategyCandidate['versions'][number][] }
  >();
  for (const row of rows) {
    const entry = grouped.get(row.strategy.id);
    if (entry) {
      entry.versions.push({ version: row.version, record: row.record });
    } else {
      grouped.set(row.strategy.id, {
        strategy: row.strategy,
        versions: [{ version: row.version, record: row.record }],
      });
    }
  }
  const strategyIds = [...grouped.keys()];
  const followers = new Map<string, number>();
  if (strategyIds.length > 0) {
    const counts = await db
      .select({ strategyId: strategyFollows.strategyId, value: count() })
      .from(strategyFollows)
      .where(inArray(strategyFollows.strategyId, strategyIds))
      .groupBy(strategyFollows.strategyId);
    for (const row of counts) {
      followers.set(row.strategyId, row.value);
    }
  }
  return [...grouped.values()].map((entry) => ({
    strategy: entry.strategy,
    versions: entry.versions,
    followerCount: followers.get(entry.strategy.id) ?? 0,
  }));
}

/**
 * Offer a registered version to the active instances of people other than
 * the strategy owner that are not pinned to it. Nothing moves a pin: the
 * proposal waits for the owner of each instance to accept it explicitly.
 */
export async function proposeVersionToFollowers(
  db: Database,
  input: { strategyId: string; versionId: string; strategyOwnerUserId: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(portfolioInstances)
    .set({ proposedVersionId: input.versionId, updatedAt: input.now })
    .where(
      and(
        eq(portfolioInstances.strategyId, input.strategyId),
        eq(portfolioInstances.status, 'active'),
        ne(portfolioInstances.ownerUserId, input.strategyOwnerUserId),
        ne(portfolioInstances.pinnedVersionId, input.versionId),
      ),
    )
    .returning({ id: portfolioInstances.id });
  return rows.length;
}

export type ModerationOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'unchanged'; version: StrategyVersionRow; latest: ModerationDecisionRow | null }
  | { outcome: 'decided'; version: StrategyVersionRow; decision: ModerationDecisionRow };

/**
 * Apply a moderation decision to a version and record it. Hiding a version
 * withdraws proposals to it from other people's instances (they could no
 * longer read what they were offered); making it visible again re-offers it
 * when it is the strategy's newest public version. Pins never move.
 */
export async function recordModerationDecision(
  db: Database,
  input: {
    strategyId: string;
    versionId: string;
    status: 'none' | 'hidden';
    reason: string;
    reference: string | null;
    decidedBy: string;
    now: Date;
  },
): Promise<ModerationOutcome> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ version: strategyVersions, strategy: strategies })
      .from(strategyVersions)
      .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
      .where(
        and(
          eq(strategyVersions.id, input.versionId),
          eq(strategyVersions.strategyId, input.strategyId),
        ),
      )
      .for('update', { of: strategyVersions });
    const row = locked[0];
    if (!row) {
      return { outcome: 'not_found' };
    }
    if (row.version.moderation === input.status) {
      const latest = await tx
        .select()
        .from(moderationDecisions)
        .where(eq(moderationDecisions.versionId, input.versionId))
        .orderBy(desc(moderationDecisions.decidedAt), desc(moderationDecisions.id))
        .limit(1);
      return { outcome: 'unchanged', version: row.version, latest: latest[0] ?? null };
    }
    const updated = await tx
      .update(strategyVersions)
      .set({ moderation: input.status })
      .where(eq(strategyVersions.id, input.versionId))
      .returning();
    const version = updated[0];
    if (!version) {
      throw new Error('moderation update returned no row');
    }
    const inserted = await tx
      .insert(moderationDecisions)
      .values({
        strategyId: input.strategyId,
        versionId: input.versionId,
        status: input.status,
        previousStatus: row.version.moderation,
        reason: input.reason,
        reference: input.reference,
        decidedBy: input.decidedBy,
        decidedAt: input.now,
      })
      .returning();
    const decision = inserted[0];
    if (!decision) {
      throw new Error('moderation decision insert returned no row');
    }
    if (input.status === 'hidden') {
      await tx
        .update(portfolioInstances)
        .set({ proposedVersionId: null, updatedAt: input.now })
        .where(
          and(
            eq(portfolioInstances.strategyId, input.strategyId),
            eq(portfolioInstances.proposedVersionId, input.versionId),
            ne(portfolioInstances.ownerUserId, row.strategy.ownerUserId),
          ),
        );
    } else if (version.publication === 'registered') {
      const newest = await tx
        .select({ id: strategyVersions.id })
        .from(strategyVersions)
        .where(
          and(
            eq(strategyVersions.strategyId, input.strategyId),
            eq(strategyVersions.publication, 'registered'),
            eq(strategyVersions.moderation, 'none'),
          ),
        )
        .orderBy(desc(strategyVersions.versionNumber))
        .limit(1);
      if (newest[0]?.id === version.id) {
        await proposeVersionToFollowers(tx, {
          strategyId: input.strategyId,
          versionId: version.id,
          strategyOwnerUserId: row.strategy.ownerUserId,
          now: input.now,
        });
      }
    }
    return { outcome: 'decided', version, decision };
  });
}

export async function listModerationDecisions(
  db: Database,
  strategyId: string,
  limit = 200,
): Promise<ModerationDecisionRow[]> {
  return db
    .select()
    .from(moderationDecisions)
    .where(eq(moderationDecisions.strategyId, strategyId))
    .orderBy(desc(moderationDecisions.decidedAt), desc(moderationDecisions.id))
    .limit(limit);
}
