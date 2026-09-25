import {
  base58AddressSchema,
  creatorProfileSchema,
  creatorQuerySchema,
  discoveryQuerySchema,
  discoveryResponseSchema,
  errorResponseSchema,
  idSchema,
  moderationDecisionRequestSchema,
  moderationDecisionSchema,
  moderationHistoryResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { DiscoveryService } from '../discovery/service.js';

export interface DiscoveryRoutesOptions {
  readonly discovery: DiscoveryService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};
/** Every explorer page values the whole public population's model series on read; bounded per client like a series. */
const exploreRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const creatorParams = z.object({ publisherWallet: base58AddressSchema });
const strategyParams = z.object({ strategyId: idSchema });
const versionParams = z.object({ strategyId: idSchema, versionId: idSchema });
const moderationRead = [requireClass('operator'), requireScope('ops:discovery:read')];
const moderationWrite = [requireClass('operator'), requireScope('ops:discovery:write')];

/**
 * Discovery (B14): the public explorer over registered strategies, creator
 * pages keyed by the publishing wallet, and operator moderation with a
 * recorded reason. Public routes take no token; nothing they answer names
 * an account, a wallet other than the publisher, an instance or a draft.
 */
export const discoveryRoutes: FastifyPluginAsyncZod<DiscoveryRoutesOptions> = async (
  app,
  { discovery },
) => {
  app.get(
    '/v1/strategies',
    {
      config: exploreRateLimit,
      schema: {
        tags: ['discovery'],
        summary: 'Explore public strategies',
        description:
          'Active strategies with at least one registered version that moderation has not withheld, one row per strategy with its newest public version, chain provenance, follower count and the model-series ranking entry for the requested period. Filters: text, issuer, constituent instrument, creator wallet. Sort by rank (ranked first, then newest registration), newest or followers; cursor pagination over a stable order. An entry without the minimum complete history, with an incomplete window or a stale end price is listed without a rank and without a return.',
        querystring: discoveryQuerySchema,
        response: { 200: discoveryResponseSchema, ...errorResponses },
      },
    },
    async (request) => discovery.explore(request.query),
  );

  app.get(
    '/v1/creators/:publisherWallet',
    {
      config: exploreRateLimit,
      schema: {
        tags: ['discovery'],
        summary: 'A creator: the strategies whose newest public version this wallet registered',
        description:
          'Provenance from chain records only: registered versions signed by the wallet, first and latest registration, follower counts, and each strategy row as the explorer lists it. NOT_FOUND when the wallet registered no listed strategy.',
        params: creatorParams,
        querystring: creatorQuerySchema,
        response: { 200: creatorProfileSchema, ...errorResponses },
      },
    },
    async (request) => discovery.creator(request.params.publisherWallet, request.query),
  );

  app.post(
    '/v1/operator/strategies/:strategyId/versions/:versionId/moderation',
    {
      preHandler: moderationWrite,
      schema: {
        tags: ['discovery'],
        summary: 'Hide a version from discovery, or make it visible again, with a recorded reason',
        description:
          'Platform moderation, separate from the chain: a hidden version leaves the explorer, the rankings, the public strategy and version routes and the follow targets; its registry record stays readable, the owner still reads it, and no instance pin moves (proposals to it are withdrawn from other people’s instances). 201 with the decision; 200 with the decision in force when the status already applied.',
        params: versionParams,
        body: moderationDecisionRequestSchema,
        response: {
          200: moderationDecisionSchema,
          201: moderationDecisionSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await discovery.moderate(
        principalOf(request),
        request.params.strategyId,
        request.params.versionId,
        request.body,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.decision;
    },
  );

  app.get(
    '/v1/operator/strategies/:strategyId/moderation',
    {
      preHandler: moderationRead,
      schema: {
        tags: ['discovery'],
        summary: 'Moderation status of every version of a strategy and the decisions behind it',
        params: strategyParams,
        response: { 200: moderationHistoryResponseSchema, ...errorResponses },
      },
    },
    async (request) => discovery.moderationHistory(request.params.strategyId),
  );
};
