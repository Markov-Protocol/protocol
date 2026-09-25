import {
  deadLetterListResponseSchema,
  deliveryRetryResponseSchema,
  emailSetRequestSchema,
  emailSetResponseSchema,
  emailVerifyRequestSchema,
  errorResponseSchema,
  fixtureOutboxResponseSchema,
  idSchema,
  notificationChannelSchema,
  notificationListResponseSchema,
  notificationPreferencesSchema,
  notificationPreferencesUpdateRequestSchema,
  notificationQuerySchema,
  notificationSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { NotificationService } from '../notifications/service.js';

export interface NotificationRoutesOptions {
  readonly notifications: NotificationService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
};
const notificationParams = z.object({ notificationId: idSchema });
const reader = [requireClass('user', 'device'), requireScope('notifications:receive')];
const owner = requireClass('user');
const emailRateLimit = { rateLimit: { max: 5, timeWindow: '1 hour' } };
const operatorRead = [requireClass('operator'), requireScope('ops:read')];
const operatorWrite = [requireClass('operator'), requireScope('ops:maintenance:run')];

/**
 * Notifications (B16): the owner's in-app outbox, read state, channel
 * preferences and the verified email address; operator recovery of dead
 * deliveries. A notification links to something the app opens after its
 * own authentication; nothing here carries a credential.
 */
export const notificationRoutes: FastifyPluginAsyncZod<NotificationRoutesOptions> = async (
  app,
  { notifications },
) => {
  app.get(
    '/v1/me/notifications',
    {
      preHandler: reader,
      schema: {
        tags: ['notifications'],
        summary: 'Your notifications in sequence, with unread count',
        description:
          'Read by your session or a paired device holding notifications:receive. Pass the last sequence you saw as after; unread=true keeps only unread ones.',
        querystring: notificationQuerySchema,
        response: { 200: notificationListResponseSchema, ...errorResponses },
      },
    },
    async (request) => notifications.list(principalOf(request), request.query),
  );

  app.post(
    '/v1/me/notifications/read-all',
    {
      preHandler: reader,
      schema: {
        tags: ['notifications'],
        summary: 'Mark every notification read',
        response: { 200: z.object({ updated: z.number().int().nonnegative() }), ...errorResponses },
      },
    },
    async (request) => notifications.markAllRead(principalOf(request), request.id),
  );

  app.post(
    '/v1/me/notifications/:notificationId/read',
    {
      preHandler: reader,
      schema: {
        tags: ['notifications'],
        summary: 'Mark one notification read',
        params: notificationParams,
        response: { 200: notificationSchema, ...errorResponses },
      },
    },
    async (request) =>
      notifications.markRead(principalOf(request), request.params.notificationId, request.id),
  );

  app.get(
    '/v1/me/notification-preferences',
    {
      preHandler: owner,
      schema: {
        tags: ['notifications'],
        summary: 'Your channel preferences and email address state',
        response: { 200: notificationPreferencesSchema, ...errorResponses },
      },
    },
    async (request) => notifications.getPreferences(principalOf(request)),
  );

  app.put(
    '/v1/me/notification-preferences',
    {
      preHandler: owner,
      schema: {
        tags: ['notifications'],
        summary: 'Turn categories on or off per channel',
        description:
          'Email for a category takes effect only once an address is verified; in-app stays available whatever the provider.',
        body: notificationPreferencesUpdateRequestSchema,
        response: { 200: notificationPreferencesSchema, ...errorResponses },
      },
    },
    async (request) =>
      notifications.updatePreferences(principalOf(request), request.body, request.id),
  );

  app.post(
    '/v1/me/notification-preferences/email',
    {
      preHandler: owner,
      config: emailRateLimit,
      schema: {
        tags: ['notifications'],
        summary: 'Set the email address; a verification code is sent to it',
        description:
          'The address stays pending until the code is entered; nothing else is ever sent to an unverified address. Without an email provider the address stays pending and the response says so.',
        body: emailSetRequestSchema,
        response: { 200: emailSetResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      notifications.setEmail(principalOf(request), request.body.address, request.id),
  );

  app.post(
    '/v1/me/notification-preferences/email/verify',
    {
      preHandler: owner,
      config: emailRateLimit,
      schema: {
        tags: ['notifications'],
        summary: 'Confirm the pending email address with the code it received',
        body: emailVerifyRequestSchema,
        response: { 200: notificationPreferencesSchema, ...errorResponses },
      },
    },
    async (request) =>
      notifications.verifyEmail(principalOf(request), request.body.code, request.id),
  );

  app.delete(
    '/v1/me/notification-preferences/email',
    {
      preHandler: owner,
      schema: {
        tags: ['notifications'],
        summary: 'Remove the email address; every email stops at once',
        response: { 200: notificationPreferencesSchema, ...errorResponses },
      },
    },
    async (request) => notifications.clearEmail(principalOf(request), request.id),
  );

  app.get(
    '/v1/ops/notifications/dead-letter',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['notifications'],
        summary: 'Deliveries that exhausted their retries (operator)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: { 200: deadLetterListResponseSchema, ...errorResponses },
      },
    },
    async (request) => notifications.deadLetters(request.query.limit),
  );

  app.get(
    '/v1/ops/notifications/fixture-outbox',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['notifications'],
        summary: 'What the fixture email provider would have sent (operator; local and test only)',
        response: { 200: fixtureOutboxResponseSchema, ...errorResponses },
      },
    },
    async () => notifications.fixtureOutbox(),
  );

  app.post(
    '/v1/ops/notifications/:notificationId/retry',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['notifications'],
        summary: 'Requeue a dead or failed delivery for one more attempt (operator)',
        params: notificationParams,
        body: z.object({ channel: notificationChannelSchema }),
        response: { 200: deliveryRetryResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      notifications.retry(
        principalOf(request),
        request.params.notificationId,
        request.body.channel,
        request.id,
      ),
  );
};
