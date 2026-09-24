import {
  errorResponseSchema,
  idSchema,
  watchlistItemRequestSchema,
  watchlistRemoveQuerySchema,
  watchlistSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { WatchlistService } from '../watchlists/service.js';

export interface WatchlistRoutesOptions {
  readonly watchlists: WatchlistService;
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
const itemParams = z.object({ instrumentId: idSchema });

/** Personal watchlists: read by the person or an agent with research:read; edited by the person only. */
export const watchlistRoutes: FastifyPluginAsyncZod<WatchlistRoutesOptions> = async (
  app,
  { watchlists },
) => {
  app.get(
    '/v1/me/watchlist',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      schema: {
        tags: ['watchlists'],
        summary: 'The signed-in person’s watchlist with each instrument’s current projection',
        description:
          'Versioned (contract version 1, list version increments on every change). Items keep their instrument whatever its later status, so a paused or delisted instrument shows as such.',
        response: { 200: watchlistSchema, ...errorResponses },
      },
    },
    async (request) => watchlists.get(principalOf(request)),
  );

  app.put(
    '/v1/me/watchlist/items/:instrumentId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['watchlists'],
        summary: 'Save an admitted or paused instrument (idempotent; updates the note)',
        description:
          'ASSET_NOT_ADMITTED (409) for any other status, NOT_FOUND for an unknown id, IDEMPOTENCY_CONFLICT (409) when `ifVersion` no longer matches. Saving implies nothing about eligibility or execution.',
        params: itemParams,
        body: watchlistItemRequestSchema,
        response: { 200: watchlistSchema, ...errorResponses },
      },
    },
    async (request) =>
      watchlists.add(principalOf(request), request.params.instrumentId, request.body, request.id),
  );

  app.delete(
    '/v1/me/watchlist/items/:instrumentId',
    {
      preHandler: requireClass('user'),
      schema: {
        tags: ['watchlists'],
        summary: 'Remove an instrument from the watchlist (idempotent)',
        params: itemParams,
        querystring: watchlistRemoveQuerySchema,
        response: { 200: watchlistSchema, ...errorResponses },
      },
    },
    async (request) =>
      watchlists.remove(
        principalOf(request),
        request.params.instrumentId,
        request.query.ifVersion ?? null,
        request.id,
      ),
  );
};
