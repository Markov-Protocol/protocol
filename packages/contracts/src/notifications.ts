import { z } from 'zod';
import { idSchema } from './identity.js';

/**
 * Notifications (B16): a durable in-app outbox projected from the owner's
 * Mark I events and from schedule outcomes, delivered in-app always and by
 * email only to an address the owner entered and verified. A notification
 * links to a resource the owner opens in the app; it never carries a
 * credential and nothing happens because it was read.
 */

export const NOTIFICATION_CATEGORIES = [
  'proposals',
  'execution',
  'schedules',
  'data',
  'security',
] as const;
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/** `queued` waits for its next attempt; `dead` gave up after the retry budget and waits for an operator. */
export const DELIVERY_STATUSES = ['delivered', 'queued', 'failed', 'dead', 'skipped'] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const NOTIFICATION_LINK_TYPES = [
  'proposal',
  'intent',
  'plan',
  'schedule',
  'occurrence',
  'instance',
  'device',
  'run',
] as const;
export const notificationLinkTypeSchema = z.enum(NOTIFICATION_LINK_TYPES);

/** Retry budget per delivery before it is dead-lettered. */
export const DELIVERY_MAX_ATTEMPTS = 5;
export const NOTIFICATION_PAGE_MAX = 100;

export const notificationDeliverySchema = z.object({
  channel: notificationChannelSchema,
  status: deliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastAttemptAt: z.iso.datetime().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  /** Provider receipt id or the last error, never a secret and never the message body. */
  detail: z.string().max(300).nullable(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const notificationSchema = z.object({
  notificationId: idSchema,
  /** Strictly increasing per deployment; a reader resumes with `after=<seq>`. */
  seq: z.number().int().nonnegative(),
  category: notificationCategorySchema,
  /** The event kind or schedule outcome that produced it, for example `proposal.created` or `schedule.skipped`. */
  kind: z.string().max(60),
  title: z.string().max(140),
  body: z.string().max(600),
  /** What to open in the app; an app path is derived from it, never a bearer link. */
  link: z.object({ type: notificationLinkTypeSchema, id: z.string().max(100) }).nullable(),
  sourceEventSeq: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  deliveries: z.array(notificationDeliverySchema),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_MAX).default(50),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  category: notificationCategorySchema.optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
  nextAfter: z.number().int().nonnegative().nullable(),
  latestSeq: z.number().int().nonnegative(),
  note: z.string().max(600),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const categoryPreferenceSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
});
export type CategoryPreference = z.infer<typeof categoryPreferenceSchema>;

export const categoryPreferencesSchema = z.object({
  proposals: categoryPreferenceSchema,
  execution: categoryPreferenceSchema,
  schedules: categoryPreferenceSchema,
  data: categoryPreferenceSchema,
  security: categoryPreferenceSchema,
});
export type CategoryPreferences = z.infer<typeof categoryPreferencesSchema>;

/** In-app on for everything; email off until the owner verifies an address and turns a category on. */
export const DEFAULT_CATEGORY_PREFERENCES: CategoryPreferences = {
  proposals: { inApp: true, email: false },
  execution: { inApp: true, email: false },
  schedules: { inApp: true, email: false },
  data: { inApp: true, email: false },
  security: { inApp: true, email: true },
};

export const EMAIL_PROVIDERS = ['disabled', 'fixture', 'configured'] as const;
export const emailProviderSchema = z.enum(EMAIL_PROVIDERS);
export type EmailProvider = z.infer<typeof emailProviderSchema>;

export const notificationPreferencesSchema = z.object({
  email: z.object({
    /** The address the owner entered; shown to its owner only. */
    address: z.string().max(254).nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    pendingVerification: z.boolean(),
    pendingExpiresAt: z.iso.datetime().nullable(),
    /** The platform's email provider as configured; `disabled` means no message can be sent. */
    provider: emailProviderSchema,
  }),
  categories: categoryPreferencesSchema,
  updatedAt: z.iso.datetime(),
  note: z.string().max(600),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const notificationPreferencesUpdateRequestSchema = z.object({
  categories: categoryPreferencesSchema.partial(),
});
export type NotificationPreferencesUpdateRequest = z.infer<
  typeof notificationPreferencesUpdateRequestSchema
>;

export const emailSetRequestSchema = z.object({
  address: z.email().max(254),
});
export const emailSetResponseSchema = z.object({
  preferences: notificationPreferencesSchema,
  verification: z.object({
    /** `sent` when the provider accepted the verification message; `unavailable` when no provider is configured (the address stays pending). */
    status: z.enum(['sent', 'unavailable', 'failed']),
    provider: emailProviderSchema,
    expiresAt: z.iso.datetime().nullable(),
    detail: z.string().max(300).nullable(),
  }),
});
export type EmailSetResponse = z.infer<typeof emailSetResponseSchema>;

export const emailVerifyRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'six digits'),
});

/** Operator view of deliveries that exhausted their retries. */
export const deadLetterDeliverySchema = z.object({
  notificationId: idSchema,
  ownerUserId: idSchema,
  channel: notificationChannelSchema,
  category: notificationCategorySchema,
  kind: z.string().max(60),
  attempts: z.number().int().nonnegative(),
  lastAttemptAt: z.iso.datetime().nullable(),
  detail: z.string().max(300).nullable(),
  createdAt: z.iso.datetime(),
});
export const deadLetterListResponseSchema = z.object({
  deliveries: z.array(deadLetterDeliverySchema),
  note: z.string().max(600),
});
export type DeadLetterListResponse = z.infer<typeof deadLetterListResponseSchema>;
export const deliveryRetryResponseSchema = z.object({
  notificationId: idSchema,
  channel: notificationChannelSchema,
  status: deliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  detail: z.string().max(300).nullable(),
});
export type DeliveryRetryResponse = z.infer<typeof deliveryRetryResponseSchema>;

/** What the email adapter is handed: rendered text, never a credential, never a bearer link. */
export const emailMessageSchema = z.object({
  to: z.email().max(254),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(4000),
  /** Stable per notification and channel so a provider can drop a duplicate. */
  idempotencyKey: z.string().min(1).max(120),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;

/** Operator view of the fixture email provider's outbox (local and test only): what would have been sent. */
export const fixtureOutboxResponseSchema = z.object({
  provider: z.literal('fixture'),
  messages: z.array(emailMessageSchema),
  refused: z.array(z.object({ message: emailMessageSchema, retryable: z.boolean() })),
  note: z.string().max(600),
});
export type FixtureOutboxResponse = z.infer<typeof fixtureOutboxResponseSchema>;
