import {
  base58AddressSchema,
  errorResponseSchema,
  idSchema,
  publicationPrepareRequestSchema,
  publicationSchema,
  publicationSubmitRequestSchema,
  publicStrategySchema,
  publicVersionSchema,
  registryRecordSchema,
  registryStatusSchema,
  statusChangeRequestSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { RegistryService } from '../registry/service.js';

export interface RegistryRoutesOptions {
  readonly registry: RegistryService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};
const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const versionParams = z.object({ strategyId: idSchema, versionId: idSchema });
const strategyParams = z.object({ strategyId: idSchema });
const publicationParams = z.object({ publicationId: idSchema });
const recordParams = z.object({ address: base58AddressSchema });
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const interactive = requireClass('user');

/**
 * On-chain registration (B08). Publishing is the owner's own typed
 * operation: the API validates, builds and verifies; the owner's wallet
 * signs; the chain decides. Every state answered here is what the network
 * reported at the last check. Nothing here quotes, spends or moves a pin.
 */
export const registryRoutes: FastifyPluginAsyncZod<RegistryRoutesOptions> = async (
  app,
  { registry },
) => {
  app.get(
    '/v1/registry',
    {
      schema: {
        tags: ['registry'],
        summary: 'Registry program, network and indexer status of this deployment',
        response: { 200: registryStatusSchema, 503: errorResponseSchema },
      },
    },
    async () => registry.status(),
  );

  app.post(
    '/v1/me/strategies/:strategyId/versions/:versionId/publication',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['registry'],
        summary: 'Prepare the registration of a frozen version with one of your verified wallets',
        description:
          'Validates the version against the program rules, shows exactly what becomes public, and answers an unsigned transaction for the wallet to sign. 201 for a new publication; 200 with the current one when a registration is already in flight or done. Nothing reaches the chain until the signed transaction is submitted.',
        params: versionParams,
        body: publicationPrepareRequestSchema,
        response: { 200: publicationSchema, 201: publicationSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await registry.prepare(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
        request.body,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.publication;
    },
  );

  app.get(
    '/v1/me/strategies/:strategyId/versions/:versionId/publication',
    {
      preHandler: read,
      schema: {
        tags: ['registry'],
        summary: 'The latest registration attempt of a version, re-checked against the chain',
        params: versionParams,
        response: { 200: publicationSchema, ...errorResponses },
      },
    },
    async (request) =>
      registry.versionPublication(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
      ),
  );

  app.post(
    '/v1/me/strategies/:strategyId/versions/:versionId/status-changes',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['registry'],
        summary:
          'Prepare a deprecation or reactivation of a registered version (publisher wallet only)',
        description:
          'Only the wallet that registered the version can sign; the economic content of the record never changes.',
        params: versionParams,
        body: statusChangeRequestSchema,
        response: { 200: publicationSchema, 201: publicationSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await registry.prepareStatusChange(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
        request.body,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.publication;
    },
  );

  app.get(
    '/v1/me/strategies/:strategyId/versions/:versionId/status-changes',
    {
      preHandler: read,
      schema: {
        tags: ['registry'],
        summary:
          'The latest deprecation or reactivation attempt of a version, re-checked against the chain',
        description:
          'Registration attempts live under `…/publication`; this answers the newest status change only, or 404 before any was prepared.',
        params: versionParams,
        response: { 200: publicationSchema, ...errorResponses },
      },
    },
    async (request) =>
      registry.versionStatusChange(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
      ),
  );

  app.post(
    '/v1/me/publications/:publicationId/submit',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['registry'],
        summary: 'Submit the signed transaction of a prepared publication',
        description:
          'The signed bytes must carry exactly the prepared message and a valid signature by the publisher wallet; anything else is refused with SIGNATURE_MISMATCH and nothing is sent. A node rejection is recorded on the publication (state failed or expired); an accepted submission is `submitted` until the chain finalizes it.',
        params: publicationParams,
        body: publicationSubmitRequestSchema,
        response: { 200: publicationSchema, ...errorResponses },
      },
    },
    async (request) =>
      registry.submit(principalOf(request), request.params.publicationId, request.body, request.id),
  );

  app.get(
    '/v1/me/publications/:publicationId',
    {
      preHandler: read,
      schema: {
        tags: ['registry'],
        summary: 'A publication, re-checked against the chain',
        params: publicationParams,
        response: { 200: publicationSchema, ...errorResponses },
      },
    },
    async (request) => registry.getPublication(principalOf(request), request.params.publicationId),
  );

  app.get(
    '/v1/strategies/:strategyId',
    {
      schema: {
        tags: ['registry'],
        summary: 'Public view of a strategy: its registered versions',
        params: strategyParams,
        response: { 200: publicStrategySchema, 404: errorResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request) => registry.publicStrategy(request.params.strategyId),
  );

  app.get(
    '/v1/strategies/:strategyId/versions/:versionId',
    {
      schema: {
        tags: ['registry'],
        summary:
          'Public view of a registered version with its manifest, hash, chain evidence and verification',
        description:
          'The manifest hash is recomputed from the canonical bytes and compared with the record the indexer read from finalized chain state; both results are reported. 404 unless the version is registered and not withheld.',
        params: versionParams,
        response: { 200: publicVersionSchema, 404: errorResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request) => registry.publicVersion(request.params.strategyId, request.params.versionId),
  );

  app.get(
    '/v1/registry/records/:address',
    {
      schema: {
        tags: ['registry'],
        summary: 'An indexed registry record, whether or not a Markov version matches it',
        params: recordParams,
        response: { 200: registryRecordSchema, 404: errorResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request) => registry.record(request.params.address),
  );
};
