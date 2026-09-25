import { randomBytes, randomInt } from 'node:crypto';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type CategoryPreferences,
  DEFAULT_CATEGORY_PREFERENCES,
  DELIVERY_MAX_ATTEMPTS,
  type DeadLetterListResponse,
  type DeliveryRetryResponse,
  type EmailSetResponse,
  type FixtureOutboxResponse,
  type Notification,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationListResponse,
  type NotificationPreferences,
  type NotificationPreferencesUpdateRequest,
  type NotificationQuery,
  type OccurrenceReason,
  type OccurrenceStatus,
} from '@markov/contracts';
import {
  advanceProjectionCursor,
  clearEmail as clearEmailRow,
  confirmEmail as confirmEmailRow,
  countVerificationAttempt,
  createNotification,
  type Database,
  deliveriesOf,
  findNotification,
  findPreferences,
  listDeadDeliveries,
  listDueDeliveries,
  listMarkEventsAfter,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDeliveryRow,
  type NotificationPreferencesRow,
  type NotificationRow,
  notificationCounts,
  readProjectionCursor,
  recordAuditEvent,
  requeueDelivery,
  setPendingEmail,
  settleDelivery,
  upsertPreferences,
} from '@markov/db';
import {
  channelsFor,
  type EmailAdapter,
  type FixtureEmailAdapter,
  hashVerificationCode,
  nextAttemptDelayMs,
  renderNotificationEmail,
  renderVerificationEmail,
  routeMarkEvent,
  routeScheduleOutcome,
  verificationCodeFrom,
  verificationCodesMatch,
} from '@markov/notifications';
import { ApiError } from '../errors.js';

export const NOTIFICATIONS_NOTE =
  'Notifications are facts about your own resources, delivered in-app always and by email only to an address you verified, for categories you turned on. A notification links to something you open in the app after signing in; it never carries a credential and nothing happens because it was read.';
export const PREFERENCES_NOTE =
  'Email goes only to the verified address; security notices stay on by email until you turn them off. Removing the address stops every email at once.';
const VERIFICATION_TTL_MS = 15 * 60_000;
const VERIFICATION_MAX_ATTEMPTS = 5;

export interface NotificationServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  /** Null when no email provider is configured; in-app notifications still work. */
  readonly email: EmailAdapter | null;
  readonly now?: () => Date;
}

export interface ScheduleOutcomeInput {
  readonly ownerUserId: string;
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly label: string;
  readonly status: OccurrenceStatus;
  readonly reason: OccurrenceReason | null;
  readonly detail: string | null;
}

export interface NotificationService {
  list(principal: Principal, query: NotificationQuery): Promise<NotificationListResponse>;
  markRead(principal: Principal, notificationId: string, requestId: string): Promise<Notification>;
  markAllRead(principal: Principal, requestId: string): Promise<{ updated: number }>;
  getPreferences(principal: Principal): Promise<NotificationPreferences>;
  updatePreferences(
    principal: Principal,
    request: NotificationPreferencesUpdateRequest,
    requestId: string,
  ): Promise<NotificationPreferences>;
  setEmail(principal: Principal, address: string, requestId: string): Promise<EmailSetResponse>;
  verifyEmail(
    principal: Principal,
    code: string,
    requestId: string,
  ): Promise<NotificationPreferences>;
  clearEmail(principal: Principal, requestId: string): Promise<NotificationPreferences>;
  /** Projects the owners' events written since the cursor into notifications (idempotent). */
  project(batchSize: number): Promise<{ projected: number; lastSeq: number }>;
  /** Attempts every queued delivery that is due; bounded retries, then dead-lettered. */
  deliver(batchSize: number): Promise<{ delivered: number; retried: number; dead: number }>;
  /** A schedule outcome the owner is told about (skipped, failed, expired). */
  notifyScheduleOutcome(input: ScheduleOutcomeInput): Promise<Notification | null>;
  deadLetters(limit: number): Promise<DeadLetterListResponse>;
  retry(
    principal: Principal,
    notificationId: string,
    channel: NotificationChannel,
    requestId: string,
  ): Promise<DeliveryRetryResponse>;
  /** What the fixture provider would have sent (local and test only); NOT_FOUND with any other provider. */
  fixtureOutbox(): FixtureOutboxResponse;
}

function isFixtureAdapter(adapter: EmailAdapter): adapter is FixtureEmailAdapter {
  return adapter.provider === 'fixture' && Array.isArray((adapter as { sent?: unknown }).sent);
}

function readerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'device') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'notifications are read by the owner’s session or a paired device',
    );
  }
  return principal.userId;
}

function ownerOf(principal: Principal): string {
  if (principal.class !== 'user' || principal.userId === null) {
    throw new ApiError('FORBIDDEN', 'only the owner’s own session changes notification settings');
  }
  return principal.userId;
}

export function createNotificationService(deps: NotificationServiceDeps): NotificationService {
  const { config, db, email } = deps;
  const now = deps.now ?? (() => new Date());
  const provider = email?.provider ?? 'disabled';
  const appOrigin = config.notifications.appOrigin ?? '';

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType,
      targetId,
      requestId,
      details,
    });

  const categoriesOf = (row: NotificationPreferencesRow | null): CategoryPreferences =>
    row === null
      ? DEFAULT_CATEGORY_PREFERENCES
      : { ...DEFAULT_CATEGORY_PREFERENCES, ...row.categories };

  const preferencesOf = (
    row: NotificationPreferencesRow | null,
    at: Date,
  ): NotificationPreferences => ({
    email: {
      address: row?.emailAddress ?? null,
      verifiedAt: row?.emailVerifiedAt?.toISOString() ?? null,
      pendingVerification:
        row !== null &&
        row.emailPendingHash !== null &&
        row.emailPendingExpiresAt !== null &&
        row.emailPendingExpiresAt.getTime() > at.getTime(),
      pendingExpiresAt: row?.emailPendingExpiresAt?.toISOString() ?? null,
      provider,
    },
    categories: categoriesOf(row),
    updatedAt: (row?.updatedAt ?? at).toISOString(),
    note: PREFERENCES_NOTE,
  });

  const deliveryOf = (row: NotificationDeliveryRow): Notification['deliveries'][number] => ({
    channel: row.channel as NotificationChannel,
    status: row.status as Notification['deliveries'][number]['status'],
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    detail: row.detail,
  });

  const notificationsOf = async (rows: NotificationRow[]): Promise<Notification[]> => {
    const deliveries = await deliveriesOf(
      db,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      notificationId: row.id,
      seq: row.seq,
      category: row.category as NotificationCategory,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link:
        row.linkType !== null && row.linkId !== null
          ? { type: row.linkType as NonNullable<Notification['link']>['type'], id: row.linkId }
          : null,
      sourceEventSeq: row.sourceEventSeq,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      deliveries: deliveries.filter((entry) => entry.notificationId === row.id).map(deliveryOf),
    }));
  };

  const requireNotification = async (ownerUserId: string, notificationId: string) => {
    const row = await findNotification(db, ownerUserId, notificationId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no notification with that id');
    }
    return row;
  };

  const emailVerified = (row: NotificationPreferencesRow | null): boolean =>
    row !== null && row.emailAddress !== null && row.emailVerifiedAt !== null;

  return {
    async list(principal, query) {
      const ownerUserId = readerOf(principal);
      const rows = await listNotifications(db, ownerUserId, {
        after: query.after,
        limit: query.limit,
        unread: query.unread,
        category: query.category,
      });
      const [items, counts] = await Promise.all([
        notificationsOf(rows),
        notificationCounts(db, ownerUserId),
      ]);
      const last = items[items.length - 1];
      return {
        notifications: items,
        unread: counts.unread,
        nextAfter:
          last !== undefined && items.length === query.limit && last.seq < counts.latestSeq
            ? last.seq
            : null,
        latestSeq: counts.latestSeq,
        note: NOTIFICATIONS_NOTE,
      };
    },

    async markRead(principal, notificationId, requestId) {
      const ownerUserId = readerOf(principal);
      await requireNotification(ownerUserId, notificationId);
      const row = await markNotificationRead(db, ownerUserId, notificationId, now());
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no notification with that id');
      }
      await audit(principal, 'notification.read', 'notification', notificationId, requestId);
      return (await notificationsOf([row]))[0] as Notification;
    },

    async markAllRead(principal, requestId) {
      const ownerUserId = readerOf(principal);
      const updated = await markAllNotificationsRead(db, ownerUserId, now());
      await audit(principal, 'notification.read_all', 'user', ownerUserId, requestId, { updated });
      return { updated };
    },

    async getPreferences(principal) {
      const ownerUserId = ownerOf(principal);
      return preferencesOf(await findPreferences(db, ownerUserId), now());
    },

    async updatePreferences(principal, request, requestId) {
      const ownerUserId = ownerOf(principal);
      const at = now();
      const current = await findPreferences(db, ownerUserId);
      const categories: CategoryPreferences = { ...categoriesOf(current) };
      for (const [category, preference] of Object.entries(request.categories)) {
        if (preference !== undefined) {
          categories[category as NotificationCategory] = preference;
        }
      }
      const row = await upsertPreferences(db, { userId: ownerUserId, categories, now: at });
      await audit(principal, 'notification.preferences.update', 'user', ownerUserId, requestId, {
        categories,
      });
      return preferencesOf(row, at);
    },

    async setEmail(principal, address, requestId) {
      const ownerUserId = ownerOf(principal);
      const at = now();
      const code = verificationCodeFrom((max) => randomInt(max));
      const salt = randomBytes(8).toString('hex');
      const expiresAt = new Date(at.getTime() + VERIFICATION_TTL_MS);
      const current = await findPreferences(db, ownerUserId);
      const row = await setPendingEmail(db, {
        userId: ownerUserId,
        address,
        pendingHash: hashVerificationCode(code, config.auth.credentialPepper, salt),
        pendingSalt: salt,
        pendingExpiresAt: expiresAt,
        defaults: categoriesOf(current),
        now: at,
      });
      let verification: EmailSetResponse['verification'];
      if (email === null) {
        verification = {
          status: 'unavailable',
          provider,
          expiresAt: null,
          detail: 'no email provider is configured; the address stays pending until one is',
        };
      } else {
        const result = await email.send(
          renderVerificationEmail(address, code, expiresAt, `${ownerUserId}:${salt}`),
        );
        verification = result.accepted
          ? { status: 'sent', provider, expiresAt: expiresAt.toISOString(), detail: null }
          : { status: 'failed', provider, expiresAt: null, detail: result.detail.slice(0, 300) };
      }
      await audit(principal, 'notification.email.set', 'user', ownerUserId, requestId, {
        provider,
        verification: verification.status,
      });
      return { preferences: preferencesOf(row, at), verification };
    },

    async verifyEmail(principal, code, requestId) {
      const ownerUserId = ownerOf(principal);
      const at = now();
      const current = await findPreferences(db, ownerUserId);
      if (
        current === null ||
        current.emailPendingHash === null ||
        current.emailPendingSalt === null ||
        current.emailPendingExpiresAt === null
      ) {
        throw new ApiError('VALIDATION_FAILED', 'no email address is waiting for verification');
      }
      if (current.emailPendingExpiresAt.getTime() <= at.getTime()) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'the verification code expired; set the address again',
        );
      }
      if (current.emailPendingAttempts >= VERIFICATION_MAX_ATTEMPTS) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'too many wrong codes; set the address again to receive a new one',
        );
      }
      const expected = current.emailPendingHash;
      const offered = hashVerificationCode(
        code,
        config.auth.credentialPepper,
        current.emailPendingSalt,
      );
      if (!verificationCodesMatch(expected, offered)) {
        await countVerificationAttempt(db, ownerUserId, at);
        await audit(principal, 'notification.email.verify', 'user', ownerUserId, requestId, {
          ok: false,
        });
        throw new ApiError('VALIDATION_FAILED', 'the code does not match');
      }
      const row = await confirmEmailRow(db, ownerUserId, at);
      await audit(principal, 'notification.email.verify', 'user', ownerUserId, requestId, {
        ok: true,
      });
      return preferencesOf(row, at);
    },

    async clearEmail(principal, requestId) {
      const ownerUserId = ownerOf(principal);
      const at = now();
      const row = await clearEmailRow(db, ownerUserId, at);
      await audit(principal, 'notification.email.clear', 'user', ownerUserId, requestId);
      return preferencesOf(row, at);
    },

    async project(batchSize) {
      const at = now();
      const cursor = await readProjectionCursor(db);
      const events = await listMarkEventsAfter(db, cursor, batchSize);
      let projected = 0;
      let lastSeq = cursor;
      const preferenceCache = new Map<string, NotificationPreferencesRow | null>();
      for (const event of events) {
        lastSeq = event.seq;
        const routed = routeMarkEvent({
          kind: event.kind as Parameters<typeof routeMarkEvent>[0]['kind'],
          subject: {
            type: event.subjectType as Parameters<typeof routeMarkEvent>[0]['subject']['type'],
            id: event.subjectId,
          },
          payload: event.payload,
        });
        if (routed === null) {
          continue;
        }
        let preferences = preferenceCache.get(event.ownerUserId);
        if (preferences === undefined) {
          preferences = await findPreferences(db, event.ownerUserId);
          preferenceCache.set(event.ownerUserId, preferences);
        }
        const channels = channelsFor(
          routed.category,
          categoriesOf(preferences),
          emailVerified(preferences),
        );
        if (channels.length === 0) {
          continue;
        }
        const created = await createNotification(db, {
          ownerUserId: event.ownerUserId,
          category: routed.category,
          kind: routed.kind,
          title: routed.title,
          body: routed.body,
          link: routed.link,
          sourceEventSeq: event.seq,
          sourceKey: null,
          channels,
          now: at,
        });
        if (created !== null) {
          projected += 1;
        }
      }
      if (lastSeq > cursor) {
        await advanceProjectionCursor(db, lastSeq, at);
      }
      return { projected, lastSeq };
    },

    async deliver(batchSize) {
      const at = now();
      let delivered = 0;
      let retried = 0;
      let dead = 0;
      const due = await listDueDeliveries(db, at, batchSize);
      for (const { delivery, notification } of due) {
        if (delivery.channel !== 'email') {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'delivered',
            detail: null,
            nextAttemptAt: null,
            now: at,
          });
          delivered += 1;
          continue;
        }
        const preferences = await findPreferences(db, notification.ownerUserId);
        if (!emailVerified(preferences) || preferences?.emailAddress === null) {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'skipped',
            detail: 'no verified email address at delivery time',
            nextAttemptAt: null,
            now: at,
          });
          continue;
        }
        if (email === null) {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'skipped',
            detail: 'no email provider is configured',
            nextAttemptAt: null,
            now: at,
          });
          continue;
        }
        const message = renderNotificationEmail(
          {
            notificationId: notification.id,
            category: notification.category as NotificationCategory,
            kind: notification.kind,
            title: notification.title,
            body: notification.body,
            link:
              notification.linkType !== null && notification.linkId !== null
                ? ({ type: notification.linkType, id: notification.linkId } as NonNullable<
                    ReturnType<typeof routeMarkEvent>
                  >['link'])
                : null,
          },
          preferences?.emailAddress as string,
          { appOrigin },
        );
        const result = await email.send(message);
        if (result.accepted) {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'delivered',
            detail: `provider message ${result.providerMessageId}`,
            nextAttemptAt: null,
            now: at,
          });
          delivered += 1;
          continue;
        }
        const attempts = delivery.attempts + 1;
        if (!result.retryable) {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'failed',
            detail: result.detail,
            nextAttemptAt: null,
            now: at,
          });
          dead += 1;
          continue;
        }
        if (attempts >= DELIVERY_MAX_ATTEMPTS) {
          await settleDelivery(db, {
            deliveryId: delivery.id,
            status: 'dead',
            detail: `gave up after ${attempts} attempts: ${result.detail}`,
            nextAttemptAt: null,
            now: at,
          });
          dead += 1;
          continue;
        }
        await settleDelivery(db, {
          deliveryId: delivery.id,
          status: 'queued',
          detail: result.detail,
          nextAttemptAt: new Date(at.getTime() + nextAttemptDelayMs(attempts)),
          now: at,
        });
        retried += 1;
      }
      return { delivered, retried, dead };
    },

    async notifyScheduleOutcome(input) {
      const routed = routeScheduleOutcome(input);
      if (routed === null) {
        return null;
      }
      const at = now();
      const preferences = await findPreferences(db, input.ownerUserId);
      const channels = channelsFor(
        routed.category,
        categoriesOf(preferences),
        emailVerified(preferences),
      );
      if (channels.length === 0) {
        return null;
      }
      const row = await createNotification(db, {
        ownerUserId: input.ownerUserId,
        category: routed.category,
        kind: routed.kind,
        title: routed.title,
        body: routed.body,
        link: routed.link,
        sourceEventSeq: null,
        sourceKey: `occurrence:${input.occurrenceId}:${input.status}`,
        channels,
        now: at,
      });
      return row === null ? null : ((await notificationsOf([row]))[0] ?? null);
    },

    async deadLetters(limit) {
      const rows = await listDeadDeliveries(db, limit);
      return {
        deliveries: rows.map(({ delivery, notification }) => ({
          notificationId: notification.id,
          ownerUserId: notification.ownerUserId,
          channel: delivery.channel as NotificationChannel,
          category: notification.category as NotificationCategory,
          kind: notification.kind,
          attempts: delivery.attempts,
          lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
          detail: delivery.detail,
          createdAt: notification.createdAt.toISOString(),
        })),
        note: 'Deliveries that exhausted their retries. Requeue one after the cause is fixed; nothing is resent on its own.',
      };
    },

    fixtureOutbox() {
      if (email === null || !isFixtureAdapter(email)) {
        throw new ApiError(
          'NOT_FOUND',
          'the email provider is not the fixture; a configured provider keeps its own delivery records',
        );
      }
      return {
        provider: 'fixture',
        messages: email.sent.map((message) => ({ ...message })),
        refused: email.refused.map((entry) => ({
          message: { ...entry.message },
          retryable: entry.retryable,
        })),
        note: 'The fixture provider records what a configured provider would have been asked to send. It exists for local runs and the startup check; production never uses it.',
      };
    },

    async retry(principal, notificationId, channel, requestId) {
      const row = await requeueDelivery(db, notificationId, channel, now());
      if (!row) {
        throw new ApiError(
          'NOT_FOUND',
          'no dead or failed delivery for that notification and channel',
        );
      }
      await audit(
        principal,
        'notification.delivery.retry',
        'notification',
        notificationId,
        requestId,
        {
          channel,
        },
      );
      return {
        notificationId,
        channel,
        status: row.status as DeliveryRetryResponse['status'],
        attempts: row.attempts,
        detail: row.detail,
      };
    },
  };
}
