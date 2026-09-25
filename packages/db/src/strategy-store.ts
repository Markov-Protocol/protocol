import type {
  Disclosures,
  FrozenLeg,
  Maintenance,
  StrategyDraftContent,
  StrategyKind,
  StrategyStatus,
} from '@markov/contracts';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Database } from './client.js';
import { portfolioInstances, strategies, strategyDrafts, strategyVersions } from './schema.js';

/**
 * Strategy persistence (B07). Reads and writes are owner-scoped; drafts
 * carry a revision that moves on every save (`ifRevision` detects an edit
 * made elsewhere); freezing locks the strategy row, numbers the version
 * inside the transaction and never touches an existing version; instances
 * pin a version and only change pins through an explicit acceptance.
 */
export type StrategyRow = typeof strategies.$inferSelect;
export type StrategyDraftRow = typeof strategyDrafts.$inferSelect;
export type StrategyVersionRow = typeof strategyVersions.$inferSelect;
export type PortfolioInstanceRow = typeof portfolioInstances.$inferSelect;

export interface ForkProvenance {
  readonly strategyId: string;
  readonly versionId: string;
}

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what} did not return a row`);
  }
  return row;
}

export async function createStrategy(
  db: Database,
  input: {
    ownerUserId: string;
    content: StrategyDraftContent;
    forkOf: ForkProvenance | null;
    now: Date;
  },
): Promise<{ strategy: StrategyRow; draft: StrategyDraftRow }> {
  return db.transaction(async (tx) => {
    const strategy = one(
      await tx
        .insert(strategies)
        .values({
          ownerUserId: input.ownerUserId,
          status: 'active',
          forkOfStrategyId: input.forkOf?.strategyId ?? null,
          forkOfVersionId: input.forkOf?.versionId ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(),
      'strategy insert',
    );
    const draft = one(
      await tx
        .insert(strategyDrafts)
        .values({
          strategyId: strategy.id,
          revision: 1,
          content: input.content,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning(),
      'draft insert',
    );
    return { strategy, draft };
  });
}

export async function findStrategy(
  db: Database,
  ownerUserId: string,
  strategyId: string,
): Promise<StrategyRow | null> {
  const rows = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, strategyId), eq(strategies.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/** A strategy by id regardless of owner: for rules that only need its status or lineage. */
export async function findStrategyById(
  db: Database,
  strategyId: string,
): Promise<StrategyRow | null> {
  const rows = await db.select().from(strategies).where(eq(strategies.id, strategyId)).limit(1);
  return rows[0] ?? null;
}

export async function listStrategies(
  db: Database,
  ownerUserId: string,
  limit = 100,
): Promise<
  { strategy: StrategyRow; draft: StrategyDraftRow; current: StrategyVersionRow | null }[]
> {
  return db
    .select({ strategy: strategies, draft: strategyDrafts, current: strategyVersions })
    .from(strategies)
    .innerJoin(strategyDrafts, eq(strategyDrafts.strategyId, strategies.id))
    .leftJoin(strategyVersions, eq(strategyVersions.id, strategies.currentVersionId))
    .where(eq(strategies.ownerUserId, ownerUserId))
    .orderBy(desc(strategies.updatedAt))
    .limit(limit);
}

export async function readDraft(db: Database, strategyId: string): Promise<StrategyDraftRow> {
  return one(
    await db
      .select()
      .from(strategyDrafts)
      .where(eq(strategyDrafts.strategyId, strategyId))
      .limit(1),
    'draft read',
  );
}

export type DraftSaveResult =
  | { readonly outcome: 'applied'; readonly draft: StrategyDraftRow }
  | { readonly outcome: 'conflict'; readonly draft: StrategyDraftRow }
  | { readonly outcome: 'not_found' };

/** Replaces the working copy under a row lock; `ifRevision` must match the stored revision when given. */
export async function saveDraft(
  db: Database,
  input: {
    ownerUserId: string;
    strategyId: string;
    content: StrategyDraftContent;
    ifRevision: number | null;
    now: Date;
  },
): Promise<DraftSaveResult> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(strategies)
      .where(
        and(eq(strategies.id, input.strategyId), eq(strategies.ownerUserId, input.ownerUserId)),
      )
      .for('update');
    if (!locked[0]) {
      return { outcome: 'not_found' };
    }
    const current = one(
      await tx.select().from(strategyDrafts).where(eq(strategyDrafts.strategyId, input.strategyId)),
      'draft read',
    );
    if (input.ifRevision !== null && input.ifRevision !== current.revision) {
      return { outcome: 'conflict', draft: current };
    }
    const draft = one(
      await tx
        .update(strategyDrafts)
        .set({ content: input.content, revision: current.revision + 1, updatedAt: input.now })
        .where(eq(strategyDrafts.strategyId, input.strategyId))
        .returning(),
      'draft update',
    );
    await tx
      .update(strategies)
      .set({ updatedAt: input.now })
      .where(eq(strategies.id, input.strategyId));
    return { outcome: 'applied', draft };
  });
}

export interface VersionContent {
  readonly schemaVersion: string;
  readonly kind: StrategyKind;
  readonly authorPrincipal: string;
  readonly title: string;
  readonly thesis: string;
  readonly thesisId: string | null;
  readonly legs: FrozenLeg[];
  readonly cashWeightBps: number;
  readonly maintenance: Maintenance;
  readonly disclosures: Disclosures;
  readonly references: string[];
  readonly canonicalManifest: string;
  readonly manifestHash: string;
  readonly contentDigest: string;
}

export type FreezeResult =
  | {
      readonly outcome: 'frozen';
      readonly version: StrategyVersionRow;
      readonly strategy: StrategyRow;
    }
  | {
      readonly outcome: 'unchanged';
      readonly version: StrategyVersionRow;
      readonly strategy: StrategyRow;
    }
  | { readonly outcome: 'conflict'; readonly draft: StrategyDraftRow }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'archived' };

/**
 * Freezes the working copy as the next version. The strategy row is locked
 * so version numbers are dense and unique; `build` runs inside the
 * transaction with the locked draft and may throw to roll everything back
 * (validation lives in the service). A build whose content digest equals the
 * current version's is reported as `unchanged` and creates nothing. Other
 * people's active instances of this strategy get the new version proposed;
 * their pins do not move.
 */
export async function freezeVersion(
  db: Database,
  input: {
    ownerUserId: string;
    strategyId: string;
    ifRevision: number | null;
    now: Date;
    build: (
      draft: StrategyDraftRow,
      strategy: StrategyRow,
      versionNumber: number,
    ) => Promise<VersionContent>;
  },
): Promise<FreezeResult> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(strategies)
      .where(
        and(eq(strategies.id, input.strategyId), eq(strategies.ownerUserId, input.ownerUserId)),
      )
      .for('update');
    const strategy = locked[0];
    if (!strategy) {
      return { outcome: 'not_found' };
    }
    if (strategy.status === 'archived') {
      return { outcome: 'archived' };
    }
    const draft = one(
      await tx.select().from(strategyDrafts).where(eq(strategyDrafts.strategyId, strategy.id)),
      'draft read',
    );
    if (input.ifRevision !== null && input.ifRevision !== draft.revision) {
      return { outcome: 'conflict', draft };
    }
    const latest = await tx
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategy.id))
      .orderBy(desc(strategyVersions.versionNumber))
      .limit(1);
    const previous = latest[0] ?? null;
    const versionNumber = (previous?.versionNumber ?? 0) + 1;
    const content = await input.build(draft, strategy, versionNumber);
    if (previous && previous.contentDigest === content.contentDigest) {
      return { outcome: 'unchanged', version: previous, strategy };
    }
    const version = one(
      await tx
        .insert(strategyVersions)
        .values({
          strategyId: strategy.id,
          versionNumber,
          schemaVersion: content.schemaVersion,
          kind: content.kind,
          authorPrincipal: content.authorPrincipal,
          publisherWallet: null,
          parentVersionId: previous?.id ?? null,
          forkOfStrategyId: strategy.forkOfStrategyId,
          forkOfVersionId: strategy.forkOfVersionId,
          title: content.title,
          thesis: content.thesis,
          thesisId: content.thesisId,
          legs: content.legs,
          cashWeightBps: content.cashWeightBps,
          maintenance: content.maintenance,
          disclosures: content.disclosures,
          references: content.references,
          canonicalManifest: content.canonicalManifest,
          manifestHash: content.manifestHash,
          contentDigest: content.contentDigest,
          publication: 'unpublished',
          moderation: 'none',
          deprecatedBy: null,
          frozenAt: input.now,
        })
        .returning(),
      'version insert',
    );
    const updated = one(
      await tx
        .update(strategies)
        .set({ currentVersionId: version.id, updatedAt: input.now })
        .where(eq(strategies.id, strategy.id))
        .returning(),
      'strategy update',
    );
    // The owner's own instances learn about the new version at once; other
    // people's instances are offered it only once it is registered (B14),
    // because they can read and pin nothing else. Nothing moves a pin.
    await tx
      .update(portfolioInstances)
      .set({ proposedVersionId: version.id, updatedAt: input.now })
      .where(
        and(
          eq(portfolioInstances.strategyId, strategy.id),
          eq(portfolioInstances.ownerUserId, strategy.ownerUserId),
          eq(portfolioInstances.status, 'active'),
          ne(portfolioInstances.pinnedVersionId, version.id),
        ),
      );
    return { outcome: 'frozen', version, strategy: updated };
  });
}

export async function listVersions(
  db: Database,
  strategyId: string,
): Promise<StrategyVersionRow[]> {
  return db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId))
    .orderBy(desc(strategyVersions.versionNumber));
}

export async function findVersion(
  db: Database,
  strategyId: string,
  versionId: string,
): Promise<StrategyVersionRow | null> {
  const rows = await db
    .select()
    .from(strategyVersions)
    .where(and(eq(strategyVersions.id, versionId), eq(strategyVersions.strategyId, strategyId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findVersionById(
  db: Database,
  versionId: string,
): Promise<StrategyVersionRow | null> {
  const rows = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, versionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateStrategyStatus(
  db: Database,
  input: { ownerUserId: string; strategyId: string; status: StrategyStatus; now: Date },
): Promise<StrategyRow | null> {
  const rows = await db
    .update(strategies)
    .set({ status: input.status, updatedAt: input.now })
    .where(and(eq(strategies.id, input.strategyId), eq(strategies.ownerUserId, input.ownerUserId)))
    .returning();
  return rows[0] ?? null;
}

/* -------------------------------------------------------------- instances */

export async function createInstance(
  db: Database,
  input: {
    ownerUserId: string;
    strategyId: string;
    versionId: string;
    walletId: string;
    label: string | null;
    now: Date;
  },
): Promise<PortfolioInstanceRow> {
  return one(
    await db
      .insert(portfolioInstances)
      .values({
        ownerUserId: input.ownerUserId,
        strategyId: input.strategyId,
        pinnedVersionId: input.versionId,
        proposedVersionId: null,
        walletId: input.walletId,
        label: input.label,
        status: 'active',
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning(),
    'instance insert',
  );
}

export async function listInstances(
  db: Database,
  ownerUserId: string,
  limit = 100,
): Promise<PortfolioInstanceRow[]> {
  return db
    .select()
    .from(portfolioInstances)
    .where(eq(portfolioInstances.ownerUserId, ownerUserId))
    .orderBy(desc(portfolioInstances.updatedAt))
    .limit(limit);
}

export async function findInstance(
  db: Database,
  ownerUserId: string,
  instanceId: string,
): Promise<PortfolioInstanceRow | null> {
  const rows = await db
    .select()
    .from(portfolioInstances)
    .where(
      and(eq(portfolioInstances.id, instanceId), eq(portfolioInstances.ownerUserId, ownerUserId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The owner's explicit acceptance of a version; the only way a pin moves. */
export async function pinInstance(
  db: Database,
  input: { ownerUserId: string; instanceId: string; versionId: string; now: Date },
): Promise<PortfolioInstanceRow | null> {
  const rows = await db
    .update(portfolioInstances)
    .set({ pinnedVersionId: input.versionId, proposedVersionId: null, updatedAt: input.now })
    .where(
      and(
        eq(portfolioInstances.id, input.instanceId),
        eq(portfolioInstances.ownerUserId, input.ownerUserId),
        eq(portfolioInstances.status, 'active'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
