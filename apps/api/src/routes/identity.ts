import {
  apiCredentialCreatedResponseSchema,
  apiCredentialCreateRequestSchema,
  apiCredentialListResponseSchema,
  auditEventSchema,
  deviceListResponseSchema,
  devicePairedResponseSchema,
  devicePairingCreateRequestSchema,
  devicePairingResponseSchema,
  devicePairRequestSchema,
  errorResponseSchema,
  idSchema,
  meResponseSchema,
  operatorUserSummarySchema,
  sessionExchangeRequestSchema,
  sessionResponseSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletLinkRequestSchema,
  walletLinkSchema,
  walletListResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { IdentityService } from '../auth/service.js';

export interface IdentityRoutesOptions {
  readonly identity: IdentityService;
  /** Present only with the nonproduction test issuer; mints identity tokens for local journeys. */
  readonly mintTestToken:
    | ((input: { subject: string; authTime?: string }) => Promise<string>)
    | null;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
};
const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const identityRoutes: FastifyPluginAsyncZod<IdentityRoutesOptions> = async (
  app,
  { identity, mintTestToken },
) => {
  app.post(
    '/v1/auth/sessions',
    {
      config: strictRateLimit,
      schema: {
        tags: ['identity'],
        summary: 'Exchange a verified identity token for an opaque Markov session',
        body: sessionExchangeRequestSchema,
        response: { 201: sessionResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const session = await identity.exchangeIdentityToken(request.body.identityToken, request.id);
      return reply.code(201).send(session);
    },
  );

  if (mintTestToken) {
    app.post(
      '/v1/auth/test-tokens',
      {
        config: strictRateLimit,
        schema: {
          hide: true,
          body: z.object({
            subject: z.string().min(1).max(200),
            authTime: z.iso.datetime().optional(),
          }),
          response: { 201: z.object({ identityToken: z.string() }) },
        },
      },
      async (request, reply) => {
        const identityToken = await mintTestToken(
          request.body.authTime
            ? { subject: request.body.subject, authTime: request.body.authTime }
            : { subject: request.body.subject },
        );
        return reply.code(201).send({ identityToken });
      },
    );
  }

  app.delete(
    '/v1/auth/sessions/current',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Sign out the current session',
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await identity.logout(principalOf(request), request.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/v1/me',
    {
      preHandler: requireClass('user', 'agent'),
      schema: {
        tags: ['identity'],
        summary: 'Describe the calling principal',
        response: { 200: meResponseSchema, ...errorResponses },
      },
    },
    async (request) => identity.me(principalOf(request)),
  );

  app.post(
    '/v1/me/wallets/challenges',
    {
      config: strictRateLimit,
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Start wallet ownership verification (requires recent sign-in)',
        body: walletChallengeRequestSchema,
        response: { 201: walletChallengeResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await identity.createWalletChallenge(
            principalOf(request),
            request.body.address,
            request.id,
          ),
        ),
  );

  app.post(
    '/v1/me/wallets',
    {
      config: strictRateLimit,
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Link a wallet by presenting the signed challenge',
        body: walletLinkRequestSchema,
        response: { 201: walletLinkSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await identity.linkWallet(principalOf(request), request.body, request.id)),
  );

  app.get(
    '/v1/me/wallets',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('portfolio:read')],
      schema: {
        tags: ['identity'],
        summary: 'List verified wallets',
        response: { 200: walletListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ wallets: await identity.listWallets(principalOf(request)) }),
  );

  app.delete(
    '/v1/me/wallets/:walletId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Unlink a wallet (requires recent sign-in)',
        params: z.object({ walletId: idSchema }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await identity.unlinkWallet(principalOf(request), request.params.walletId, request.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/v1/me/api-credentials',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Create a scoped, expiring API agent credential (requires recent sign-in)',
        body: apiCredentialCreateRequestSchema,
        response: { 201: apiCredentialCreatedResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await identity.createApiCredential(principalOf(request), request.body, request.id)),
  );

  app.get(
    '/v1/me/api-credentials',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'List API credentials (never secrets)',
        response: { 200: apiCredentialListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ credentials: await identity.listApiCredentials(principalOf(request)) }),
  );

  app.delete(
    '/v1/me/api-credentials/:credentialId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Revoke an API credential (requires recent sign-in)',
        params: z.object({ credentialId: idSchema }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await identity.revokeApiCredential(
        principalOf(request),
        request.params.credentialId,
        request.id,
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/v1/me/devices/pairings',
    {
      config: strictRateLimit,
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Create a single-use device pairing code (requires recent sign-in)',
        body: devicePairingCreateRequestSchema,
        response: { 201: devicePairingResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await identity.createDevicePairing(
            principalOf(request),
            request.body.capabilities,
            request.id,
          ),
        ),
  );

  app.post(
    '/v1/devices/pair',
    {
      config: strictRateLimit,
      schema: {
        tags: ['identity'],
        summary: 'Pair a device with a code; returns the device credential once',
        body: devicePairRequestSchema,
        response: { 201: devicePairedResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await identity.pairDevice(request.body, request.id)),
  );

  app.get(
    '/v1/me/devices',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'List paired devices',
        response: { 200: deviceListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ devices: await identity.listDevices(principalOf(request)) }),
  );

  app.delete(
    '/v1/me/devices/:deviceId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['identity'],
        summary: 'Revoke a device (requires recent sign-in)',
        params: z.object({ deviceId: idSchema }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await identity.revokeDevice(principalOf(request), request.params.deviceId, request.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/v1/ops/users/:userId',
    {
      preHandler: [requireClass('operator'), requireScope('ops:read')],
      schema: {
        tags: ['operations'],
        summary: 'Operator view of an account (no secrets)',
        params: z.object({ userId: idSchema }),
        response: { 200: operatorUserSummarySchema, ...errorResponses },
      },
    },
    async (request) => identity.operatorUserSummary(request.params.userId),
  );

  app.delete(
    '/v1/ops/api-credentials/:credentialId',
    {
      preHandler: [requireClass('operator'), requireScope('ops:credentials:revoke')],
      schema: {
        tags: ['operations'],
        summary: 'Operator revocation of an agent credential',
        params: z.object({ credentialId: idSchema }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await identity.operatorRevokeCredential(
        principalOf(request),
        request.params.credentialId,
        request.id,
      );
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/v1/ops/audit',
    {
      preHandler: [requireClass('operator'), requireScope('ops:read')],
      schema: {
        tags: ['operations'],
        summary: 'Recent audit events',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
        response: { 200: z.object({ events: z.array(auditEventSchema) }), ...errorResponses },
      },
    },
    async (request) => ({ events: await identity.operatorAuditEvents(request.query.limit) }),
  );
};
