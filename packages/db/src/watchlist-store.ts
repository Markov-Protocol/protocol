import { and, desc, eq } from 'drizzle-orm';
import type { InstrumentRow } from './catalog-store.js';
import type { Database } from './client.js';
import { instruments, watchlistItems, watchlists } from './schema.js';

/**
 * Watchlist persistence (F05). One list per person with a version that
 * moves on every change, so a client can send `ifVersion` and learn that
 * another device edited the list first. Items keep their catalog row
 * whatever its status; a delisted instrument stays visible as delisted.
 */
export interface WatchlistRead {
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly items: readonly {
    readonly instrumentId: string;
    readonly note: string | null;
    readonly addedAt: Date;
    readonly instrument: InstrumentRow | null;
  }[];
}

export type WatchlistWriteResult =
  | { readonly outcome: 'applied'; readonly watchlist: WatchlistRead }
  | { readonly outcome: 'unchanged'; readonly watchlist: WatchlistRead }
  | { readonly outcome: 'conflict'; readonly watchlist: WatchlistRead };

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

async function readWith(db: Executor, userId: string): Promise<WatchlistRead> {
  const [head] = await db.select().from(watchlists).where(eq(watchlists.userId, userId)).limit(1);
  const rows = await db
    .select({ item: watchlistItems, instrument: instruments })
    .from(watchlistItems)
    .leftJoin(instruments, eq(instruments.id, watchlistItems.instrumentId))
    .where(eq(watchlistItems.userId, userId))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.instrumentId));
  return {
    version: head?.version ?? 0,
    updatedAt: head?.updatedAt ?? null,
    items: rows.map((row) => ({
      instrumentId: row.item.instrumentId,
      note: row.item.note,
      addedAt: row.item.addedAt,
      instrument: row.instrument,
    })),
  };
}

export async function readWatchlist(db: Database, userId: string): Promise<WatchlistRead> {
  return readWith(db, userId);
}

export async function countWatchlistItems(db: Database, userId: string): Promise<number> {
  const rows = await db
    .select({ instrumentId: watchlistItems.instrumentId })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId));
  return rows.length;
}

/** Locks the person's list head (creating it on first use) and answers its current version. */
async function lockHead(tx: Database, userId: string): Promise<number> {
  await tx.insert(watchlists).values({ userId }).onConflictDoNothing({ target: watchlists.userId });
  const locked = await tx
    .select()
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .for('update');
  return locked[0]?.version ?? 0;
}

export async function addWatchlistItem(
  db: Database,
  input: {
    userId: string;
    instrumentId: string;
    note: string | null;
    ifVersion: number | null;
    now: Date;
  },
): Promise<WatchlistWriteResult> {
  return db.transaction(async (tx) => {
    const version = await lockHead(tx, input.userId);
    if (input.ifVersion !== null && input.ifVersion !== version) {
      return { outcome: 'conflict', watchlist: await readWith(tx, input.userId) };
    }
    const existing = await tx
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, input.userId),
          eq(watchlistItems.instrumentId, input.instrumentId),
        ),
      )
      .limit(1);
    const current = existing[0];
    if (current && current.note === input.note) {
      return { outcome: 'unchanged', watchlist: await readWith(tx, input.userId) };
    }
    if (current) {
      await tx
        .update(watchlistItems)
        .set({ note: input.note })
        .where(
          and(
            eq(watchlistItems.userId, input.userId),
            eq(watchlistItems.instrumentId, input.instrumentId),
          ),
        );
    } else {
      await tx.insert(watchlistItems).values({
        userId: input.userId,
        instrumentId: input.instrumentId,
        note: input.note,
        addedAt: input.now,
      });
    }
    await tx
      .update(watchlists)
      .set({ version: version + 1, updatedAt: input.now })
      .where(eq(watchlists.userId, input.userId));
    return { outcome: 'applied', watchlist: await readWith(tx, input.userId) };
  });
}

export async function removeWatchlistItem(
  db: Database,
  input: { userId: string; instrumentId: string; ifVersion: number | null; now: Date },
): Promise<WatchlistWriteResult> {
  return db.transaction(async (tx) => {
    const version = await lockHead(tx, input.userId);
    if (input.ifVersion !== null && input.ifVersion !== version) {
      return { outcome: 'conflict', watchlist: await readWith(tx, input.userId) };
    }
    const removed = await tx
      .delete(watchlistItems)
      .where(
        and(
          eq(watchlistItems.userId, input.userId),
          eq(watchlistItems.instrumentId, input.instrumentId),
        ),
      )
      .returning({ instrumentId: watchlistItems.instrumentId });
    if (removed.length === 0) {
      return { outcome: 'unchanged', watchlist: await readWith(tx, input.userId) };
    }
    await tx
      .update(watchlists)
      .set({ version: version + 1, updatedAt: input.now })
      .where(eq(watchlists.userId, input.userId));
    return { outcome: 'applied', watchlist: await readWith(tx, input.userId) };
  });
}
