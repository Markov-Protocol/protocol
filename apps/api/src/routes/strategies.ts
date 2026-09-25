import {
  errorResponseSchema,
  forkRequestSchema,
  freezeRequestSchema,
  idSchema,
  instanceCreateRequestSchema,
  instanceListResponseSchema,
  instancePinRequestSchema,
  portfolioInstanceSchema,
  strategyCreateRequestSchema,
  strategyDetailSchema,
  strategyDraftSaveRequestSchema,
  strategyDraftSchema,
  strategyLimitsSchema,
  strategyListResponseSchema,
  strategySchema,
  strategyUpdateRequestSchema,
  strategyVersionSchema,
  versionDiffSchema,
  versionListResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { StrategyService } from '../strategies/service.js';

export interface StrategyRoutesOptions {
  readonly strategies: StrategyService;
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
const strategyParams = z.object({ strategyId: idSchema });
const versionParams = z.object({ strategyId: idSchema, versionId: idSchema });
const instanceParams = z.object({ instanceId: idSchema });
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const draftWrite = [requireClass('user', 'agent'), requireScope('proposals:create')];
const interactive = requireClass('user');

/**
 * Versioned recipes. Drafts are the only mutable thing and carry a
 * revision; freezing creates an immutable version; forks keep provenance
 * under a new author; instances pin a version and never move without the
 * owner's explicit acceptance. Nothing here quotes, spends or publishes.
 */
export const strategyRoutes: FastifyPluginAsyncZod<StrategyRoutesOptions> = async (
  app,
  { strategies },
) => {
  app.get(
    '/v1/strategies/limits',
    {
      schema: {
        tags: ['strategies'],
        summary: 'Recipe rules this deployment enforces',
        description:
          'Schema version, kinds, the exact 10,000 basis-point total, the leg cap and the advisory concentration ceilings (policy defaults tightened by beta caps). Fetch these instead of assuming defaults.',
        response: { 200: strategyLimitsSchema, 429: errorResponseSchema },
      },
    },
    async () => strategies.limits(),
  );

  app.post(
    '/v1/me/strategies',
    {
      preHandler: draftWrite,
      schema: {
        tags: ['strategies'],
        summary: 'Create a strategy with its first draft',
        description:
          'The draft is saved as given and validated in the response; nothing is renormalised. Legs reference admitted catalog instruments by id.',
        body: strategyCreateRequestSchema,
        response: { 201: strategyDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return strategies.create(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/strategies',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'The signed-in person’s strategies, newest first',
        response: { 200: strategyListResponseSchema, ...errorResponses },
      },
    },
    async (request) => strategies.list(principalOf(request)),
  );

  app.get(
    '/v1/me/strategies/:strategyId',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'A strategy with its validated draft and version history',
        params: strategyParams,
        response: { 200: strategyDetailSchema, ...errorResponses },
      },
    },
    async (request) => strategies.get(principalOf(request), request.params.strategyId),
  );

  app.patch(
    '/v1/me/strategies/:strategyId',
    {
      preHandler: interactive,
      schema: {
        tags: ['strategies'],
        summary: 'Archive or restore a strategy (person only)',
        description: 'Archiving hides it from new work; versions and their evidence stay.',
        params: strategyParams,
        body: strategyUpdateRequestSchema,
        response: { 200: strategySchema, ...errorResponses },
      },
    },
    async (request) =>
      strategies.updateStatus(
        principalOf(request),
        request.params.strategyId,
        request.body.status,
        request.id,
      ),
  );

  app.put(
    '/v1/me/strategies/:strategyId/draft',
    {
      preHandler: draftWrite,
      schema: {
        tags: ['strategies'],
        summary: 'Replace the working draft (revision-checked)',
        description:
          '`ifRevision` must equal the stored revision; otherwise IDEMPOTENCY_CONFLICT (409) reports the current one so an edit made in another tab is never overwritten silently. The response carries the validation result.',
        params: strategyParams,
        body: strategyDraftSaveRequestSchema,
        response: { 200: strategyDraftSchema, ...errorResponses },
      },
    },
    async (request) =>
      strategies.saveDraft(
        principalOf(request),
        request.params.strategyId,
        request.body,
        request.id,
      ),
  );

  app.post(
    '/v1/me/strategies/:strategyId/versions',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['strategies'],
        summary: 'Freeze the draft as the next immutable version',
        description:
          'Refused with the rule violations when the draft is invalid. Legs are frozen with their admission snapshots and the canonical manifest is hashed under the network domain. A draft identical to the current version answers 200 with that version; a new version answers 201. Other people’s instances of this strategy get the version proposed; their pins do not move.',
        params: strategyParams,
        body: freezeRequestSchema,
        response: { 200: strategyVersionSchema, 201: strategyVersionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await strategies.freeze(
        principalOf(request),
        request.params.strategyId,
        request.body,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.version;
    },
  );

  app.get(
    '/v1/me/strategies/:strategyId/versions',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'Every frozen version, newest first',
        params: strategyParams,
        response: { 200: versionListResponseSchema, ...errorResponses },
      },
    },
    async (request) => strategies.listVersions(principalOf(request), request.params.strategyId),
  );

  app.get(
    '/v1/me/strategies/:strategyId/versions/:versionId',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'One frozen version',
        params: versionParams,
        response: { 200: strategyVersionSchema, ...errorResponses },
      },
    },
    async (request) =>
      strategies.getVersion(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
      ),
  );

  app.get(
    '/v1/me/strategies/:strategyId/versions/:versionId/diff',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'Machine-readable difference from another version of the same strategy',
        params: versionParams,
        querystring: z.object({ against: idSchema }),
        response: { 200: versionDiffSchema, ...errorResponses },
      },
    },
    async (request) =>
      strategies.diff(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
        request.query.against,
      ),
  );

  app.post(
    '/v1/me/strategies/:strategyId/forks',
    {
      preHandler: interactive,
      schema: {
        tags: ['strategies'],
        summary: 'Fork a version into a new strategy of your own',
        description:
          'The new strategy starts with a draft copied from the version and keeps the provenance (`forkOf`); the original is untouched. The owner may fork any of their versions; anyone else may fork a registered, unmoderated version (F08).',
        params: strategyParams,
        body: forkRequestSchema,
        response: { 201: strategyDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return strategies.fork(
        principalOf(request),
        request.params.strategyId,
        request.body.versionId,
        request.id,
      );
    },
  );

  app.post(
    '/v1/me/instances',
    {
      preHandler: interactive,
      schema: {
        tags: ['strategies'],
        summary: 'Create a portfolio instance pinned to a version in a verified wallet',
        description:
          'Bookkeeping only: holdings, drift and performance arrive with B12; execution with B09 and B10. Nothing is bought.',
        body: instanceCreateRequestSchema,
        response: { 201: portfolioInstanceSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return strategies.createInstance(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/instances',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'The signed-in person’s portfolio instances',
        response: { 200: instanceListResponseSchema, ...errorResponses },
      },
    },
    async (request) => strategies.listInstances(principalOf(request)),
  );

  app.get(
    '/v1/me/instances/:instanceId',
    {
      preHandler: read,
      schema: {
        tags: ['strategies'],
        summary: 'One portfolio instance with its pinned and proposed versions',
        params: instanceParams,
        response: { 200: portfolioInstanceSchema, ...errorResponses },
      },
    },
    async (request) => strategies.getInstance(principalOf(request), request.params.instanceId),
  );

  app.post(
    '/v1/me/instances/:instanceId/pin',
    {
      preHandler: interactive,
      schema: {
        tags: ['strategies'],
        summary: 'Accept a version for an instance (the only way a pin moves)',
        params: instanceParams,
        body: instancePinRequestSchema,
        response: { 200: portfolioInstanceSchema, ...errorResponses },
      },
    },
    async (request) =>
      strategies.pin(
        principalOf(request),
        request.params.instanceId,
        request.body.versionId,
        request.id,
      ),
  );
};
