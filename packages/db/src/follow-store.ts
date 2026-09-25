import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import { registryRecords, strategyFollows, strategyVersions } from './schema.js';

/**
 * Follow persistence (F08). One row per person and strategy; the newest
 * registered, unmoderated version is looked up at read time so a follow
 * never leaks a draft and never outlives a withheld version.
 */
export interface FollowRead {
  readonly strategyId: string;
  readonly followedAt: Date;
  readonly latestVersion: {
    readonly versionId: string;
    readonly versionNumber: number;
    readonly title: string;
    readonly status: 'active' | 'deprecated';
    readonly registeredAt: Date;
  } | null;
}

export async function listFollows(db: Database, userId: string): Promise<readonly FollowRead[]> {
  const rows = await db
    .select()
    .from(strategyFollows)
    .where(eq(strategyFollows.userId, userId))
    .orderBy(desc(strategyFollows.createdAt), desc(strategyFollows.strategyId));
  if (rows.length === 0) {
    return [];
  }
  const versions = await db
    .select({ version: strategyVersions, record: registryRecords })
    .from(strategyVersions)
    .innerJoin(registryRecords, eq(registryRecords.versionId, strategyVersions.id))
    .where(
      and(
        inArray(
          strategyVersions.strategyId,
          rows.map((row) => row.strategyId),
        ),
        eq(strategyVersions.publication, 'registered'),
        eq(strategyVersions.moderation, 'none'),
      ),
    )
    .orderBy(desc(strategyVersions.versionNumber));
  const newest = new Map<string, FollowRead['latestVersion']>();
  for (const { version, record } of versions) {
    if (!newest.has(version.strategyId)) {
      newest.set(version.strategyId, {
        versionId: version.id,
        versionNumber: version.versionNumber,
        title: version.title,
        status: record.status as 'active' | 'deprecated',
        registeredAt: new Date(record.registeredUnixTime * 1000),
      });
    }
  }
  return rows.map((row) => ({
    strategyId: row.strategyId,
    followedAt: row.createdAt,
    latestVersion: newest.get(row.strategyId) ?? null,
  }));
}

export async function followStrategy(
  db: Database,
  input: { userId: string; strategyId: string; now: Date },
): Promise<{ created: boolean }> {
  const inserted = await db
    .insert(strategyFollows)
    .values({ userId: input.userId, strategyId: input.strategyId, createdAt: input.now })
    .onConflictDoNothing()
    .returning({ strategyId: strategyFollows.strategyId });
  return { created: inserted.length > 0 };
}

export async function unfollowStrategy(
  db: Database,
  input: { userId: string; strategyId: string },
): Promise<boolean> {
  const removed = await db
    .delete(strategyFollows)
    .where(
      and(
        eq(strategyFollows.userId, input.userId),
        eq(strategyFollows.strategyId, input.strategyId),
      ),
    )
    .returning({ strategyId: strategyFollows.strategyId });
  return removed.length > 0;
}

export async function countFollows(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(strategyFollows)
    .where(eq(strategyFollows.userId, userId));
  return row?.value ?? 0;
}

export async function countFollowers(db: Database, strategyId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(strategyFollows)
    .where(eq(strategyFollows.strategyId, strategyId));
  return row?.value ?? 0;
}
