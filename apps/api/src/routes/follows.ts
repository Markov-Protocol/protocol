import { errorResponseSchema, followListResponseSchema, idSchema } from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { FollowService } from '../follows/service.js';

export interface FollowRoutesOptions {
  readonly follows: FollowService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};
const strategyParams = z.object({ strategyId: idSchema });

/** Follows of public strategies: read by the person or an agent with research:read; changed by the person only. */
export const followRoutes: FastifyPluginAsyncZod<FollowRoutesOptions> = async (
  app,
  { follows },
) => {
  app.get(
    '/v1/me/follows',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      schema: {
        tags: ['follows'],
        summary: 'The public strategies the signed-in person follows, newest follow first',
        description:
          'Each row carries the strategy’s newest registered, unmoderated version at read time (null when none is public any more). A follow subscribes to updates; it never pins an instance or places an order.',
        response: { 200: followListResponseSchema, ...errorResponses },
      },
    },
    async (request) => follows.list(principalOf(request)),
  );

  app.put(
    '/v1/me/follows/:strategyId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['follows'],
        summary: 'Follow a public strategy (idempotent)',
        description:
          'NOT_FOUND unless the strategy has a registered, unmoderated version; VALIDATION_FAILED for your own strategy or beyond the follow limit. 201 for a new follow, 200 when it already existed; both answer the current list.',
        params: strategyParams,
        response: {
          200: followListResponseSchema,
          201: followListResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await follows.follow(
        principalOf(request),
        request.params.strategyId,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.follows;
    },
  );

  app.delete(
    '/v1/me/follows/:strategyId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['follows'],
        summary: 'Unfollow a strategy (idempotent); answers the current list',
        params: strategyParams,
        response: { 200: followListResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      follows.unfollow(principalOf(request), request.params.strategyId, request.id),
  );
};
