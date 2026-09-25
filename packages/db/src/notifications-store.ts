import type {
  CategoryPreferences,
  DeliveryStatus,
  NotificationCategory,
  NotificationChannel,
} from '@markov/contracts';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  notificationDeliveries,
  notificationPreferences,
  notificationProjectionCursor,
  notifications,
} from './schema.js';

/**
 * Notification persistence (B16): the in-app outbox, its per-channel
 * deliveries, the owner's preferences and the projection cursor. Reads are
 * owner-scoped; a notification is written once per source event or source
 * key, so a rerun of the projection creates nothing twice.
 */
export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NotificationPreferencesRow = typeof notificationPreferences.$inferSelect;

const CURSOR_ID = 'default';

/* ------------------------------------------------------------ notifications */

export interface NewNotification {
  readonly ownerUserId: string;
  readonly category: NotificationCategory;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link: { readonly type: string; readonly id: string } | null;
  readonly sourceEventSeq: number | null;
  readonly sourceKey: string | null;
  readonly channels: readonly NotificationChannel[];
  readonly now: Date;
}

/**
 * Writes a notification and one queued delivery per channel. Answers null
 * when the source event or key was already projected.
 */
export async function createNotification(
  db: Database,
  input: NewNotification,
): Promise<NotificationRow | null> {
  const inserted = await db
    .insert(notifications)
    .values({
      ownerUserId: input.ownerUserId,
      category: input.category,
      kind: input.kind.slice(0, 60),
      title: input.title.slice(0, 140),
      body: input.body.slice(0, 600),
      linkType: input.link?.type ?? null,
      linkId: input.link?.id ?? null,
      sourceEventSeq: input.sourceEventSeq,
      sourceKey: input.sourceKey,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning();
  const row = inserted[0];
  if (!row) {
    return null;
  }
  if (input.channels.length > 0) {
    await db
      .insert(notificationDeliveries)
      .values(
        input.channels.map((channel) => ({
          notificationId: row.id,
          ownerUserId: input.ownerUserId,
          channel,
          // In-app delivery is the row itself; other channels wait for the dispatcher.
          status: channel === 'in_app' ? 'delivered' : 'queued',
          attempts: channel === 'in_app' ? 1 : 0,
          lastAttemptAt: channel === 'in_app' ? input.now : null,
          nextAttemptAt: channel === 'in_app' ? null : input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      )
      .onConflictDoNothing();
  }
  return row;
}

export async function listNotifications(
  db: Database,
  ownerUserId: string,
  query: {
    after: number;
    limit: number;
    unread: boolean | undefined;
    category: NotificationCategory | undefined;
  },
): Promise<NotificationRow[]> {
  const conditions = [
    eq(notifications.ownerUserId, ownerUserId),
    gt(notifications.seq, query.after),
  ];
  if (query.unread === true) {
    conditions.push(isNull(notifications.readAt));
  }
  if (query.category !== undefined) {
    conditions.push(eq(notifications.category, query.category));
  }
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(asc(notifications.seq))
    .limit(query.limit);
}

export async function findNotification(
  db: Database,
  ownerUserId: string,
  notificationId: string,
): Promise<NotificationRow | null> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deliveriesOf(
  db: Database,
  notificationIds: readonly string[],
): Promise<NotificationDeliveryRow[]> {
  if (notificationIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.notificationId, [...notificationIds]))
    .orderBy(asc(notificationDeliveries.channel));
}

export async function notificationCounts(
  db: Database,
  ownerUserId: string,
): Promise<{ unread: number; latestSeq: number }> {
  const rows = await db
    .select({
      unread: sql<string>`count(*) filter (where ${notifications.readAt} is null)`,
      latestSeq: sql<string>`coalesce(max(${notifications.seq}), 0)`,
    })
    .from(notifications)
    .where(eq(notifications.ownerUserId, ownerUserId));
  return {
    unread: Number.parseInt(rows[0]?.unread ?? '0', 10) || 0,
    latestSeq: Number.parseInt(rows[0]?.latestSeq ?? '0', 10) || 0,
  };
}

export async function markNotificationRead(
  db: Database,
  ownerUserId: string,
  notificationId: string,
  now: Date,
): Promise<NotificationRow | null> {
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.ownerUserId, ownerUserId),
        isNull(notifications.readAt),
      ),
    )
    .returning();
  return rows[0] ?? (await findNotification(db, ownerUserId, notificationId));
}

export async function markAllNotificationsRead(
  db: Database,
  ownerUserId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.ownerUserId, ownerUserId), isNull(notifications.readAt)))
    .returning({ seq: notifications.seq });
  return rows.length;
}

/* ------------------------------------------------------------ deliveries */

/** Queued deliveries whose next attempt is due, oldest first, with their notification. */
export async function listDueDeliveries(
  db: Database,
  now: Date,
  limit: number,
): Promise<Array<{ delivery: NotificationDeliveryRow; notification: NotificationRow }>> {
  return db
    .select({ delivery: notificationDeliveries, notification: notifications })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(
      and(
        eq(notificationDeliveries.status, 'queued'),
        lte(notificationDeliveries.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(notificationDeliveries.nextAttemptAt))
    .limit(limit);
}

export async function settleDelivery(
  db: Database,
  input: {
    deliveryId: string;
    status: DeliveryStatus;
    detail: string | null;
    nextAttemptAt: Date | null;
    now: Date;
  },
): Promise<NotificationDeliveryRow | null> {
  const rows = await db
    .update(notificationDeliveries)
    .set({
      status: input.status,
      attempts: sql`${notificationDeliveries.attempts} + 1`,
      lastAttemptAt: input.now,
      nextAttemptAt: input.nextAttemptAt,
      detail: input.detail === null ? null : input.detail.slice(0, 300),
      updatedAt: input.now,
    })
    .where(eq(notificationDeliveries.id, input.deliveryId))
    .returning();
  return rows[0] ?? null;
}

/** Deliveries that exhausted their retries, newest first. */
export async function listDeadDeliveries(
  db: Database,
  limit: number,
): Promise<Array<{ delivery: NotificationDeliveryRow; notification: NotificationRow }>> {
  return db
    .select({ delivery: notificationDeliveries, notification: notifications })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(eq(notificationDeliveries.status, 'dead'))
    .orderBy(desc(notificationDeliveries.updatedAt))
    .limit(limit);
}

/** Operator recovery: a dead delivery goes back to the queue for one more attempt now. */
export async function requeueDelivery(
  db: Database,
  notificationId: string,
  channel: NotificationChannel,
  now: Date,
): Promise<NotificationDeliveryRow | null> {
  const rows = await db
    .update(notificationDeliveries)
    .set({
      status: 'queued',
      nextAttemptAt: now,
      detail: 'requeued by an operator',
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.notificationId, notificationId),
        eq(notificationDeliveries.channel, channel),
        inArray(notificationDeliveries.status, ['dead', 'failed']),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/* ------------------------------------------------------------ preferences */

export async function findPreferences(
  db: Database,
  userId: string,
): Promise<NotificationPreferencesRow | null> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertPreferences(
  db: Database,
  input: {
    userId: string;
    categories: CategoryPreferences;
    now: Date;
  },
): Promise<NotificationPreferencesRow> {
  const rows = await db
    .insert(notificationPreferences)
    .values({ userId: input.userId, categories: input.categories, updatedAt: input.now })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { categories: input.categories, updatedAt: input.now },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('preferences upsert did not return a row');
  }
  return row;
}

export async function setPendingEmail(
  db: Database,
  input: {
    userId: string;
    address: string;
    pendingHash: string;
    pendingSalt: string;
    pendingExpiresAt: Date;
    defaults: CategoryPreferences;
    now: Date;
  },
): Promise<NotificationPreferencesRow> {
  const rows = await db
    .insert(notificationPreferences)
    .values({
      userId: input.userId,
      emailAddress: input.address,
      emailVerifiedAt: null,
      emailPendingHash: input.pendingHash,
      emailPendingSalt: input.pendingSalt,
      emailPendingExpiresAt: input.pendingExpiresAt,
      emailPendingAttempts: 0,
      categories: input.defaults,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        emailAddress: input.address,
        emailVerifiedAt: null,
        emailPendingHash: input.pendingHash,
        emailPendingSalt: input.pendingSalt,
        emailPendingExpiresAt: input.pendingExpiresAt,
        emailPendingAttempts: 0,
        updatedAt: input.now,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('pending email upsert did not return a row');
  }
  return row;
}

export async function countVerificationAttempt(
  db: Database,
  userId: string,
  now: Date,
): Promise<NotificationPreferencesRow | null> {
  const rows = await db
    .update(notificationPreferences)
    .set({
      emailPendingAttempts: sql`${notificationPreferences.emailPendingAttempts} + 1`,
      updatedAt: now,
    })
    .where(eq(notificationPreferences.userId, userId))
    .returning();
  return rows[0] ?? null;
}

export async function confirmEmail(
  db: Database,
  userId: string,
  now: Date,
): Promise<NotificationPreferencesRow | null> {
  const rows = await db
    .update(notificationPreferences)
    .set({
      emailVerifiedAt: now,
      emailPendingHash: null,
      emailPendingSalt: null,
      emailPendingExpiresAt: null,
      emailPendingAttempts: 0,
      updatedAt: now,
    })
    .where(eq(notificationPreferences.userId, userId))
    .returning();
  return rows[0] ?? null;
}

export async function clearEmail(
  db: Database,
  userId: string,
  now: Date,
): Promise<NotificationPreferencesRow | null> {
  const rows = await db
    .update(notificationPreferences)
    .set({
      emailAddress: null,
      emailVerifiedAt: null,
      emailPendingHash: null,
      emailPendingSalt: null,
      emailPendingExpiresAt: null,
      emailPendingAttempts: 0,
      updatedAt: now,
    })
    .where(eq(notificationPreferences.userId, userId))
    .returning();
  return rows[0] ?? null;
}

/* ------------------------------------------------------------ projection cursor */

export async function readProjectionCursor(db: Database): Promise<number> {
  const rows = await db
    .select({ lastEventSeq: notificationProjectionCursor.lastEventSeq })
    .from(notificationProjectionCursor)
    .where(eq(notificationProjectionCursor.id, CURSOR_ID))
    .limit(1);
  return rows[0]?.lastEventSeq ?? 0;
}

export async function advanceProjectionCursor(
  db: Database,
  lastEventSeq: number,
  now: Date,
): Promise<void> {
  await db
    .insert(notificationProjectionCursor)
    .values({ id: CURSOR_ID, lastEventSeq, updatedAt: now })
    .onConflictDoUpdate({
      target: notificationProjectionCursor.id,
      set: {
        lastEventSeq: sql`greatest(${notificationProjectionCursor.lastEventSeq}, ${lastEventSeq})`,
        updatedAt: now,
      },
    });
}
