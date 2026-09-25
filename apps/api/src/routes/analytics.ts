import {
  errorResponseSchema,
  idSchema,
  methodologySummarySchema,
  performanceExportSchema,
  performanceQuerySchema,
  performanceResponseSchema,
  priceHistoryQuerySchema,
  priceHistoryResponseSchema,
  priceObservationRequestSchema,
  priceObservationSchema,
  rankingQuerySchema,
  rankingResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AnalyticsService } from '../analytics/service.js';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';

export interface AnalyticsRoutesOptions {
  readonly analytics: AnalyticsService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const operatorWrite = [requireClass('operator'), requireScope('ops:catalog:write')];
/** Series are computed from the journal and every observation on read; bounded per client. */
const seriesRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const rankingRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const instanceParams = z.object({ instanceId: idSchema });
const walletParams = z.object({ walletId: idSchema });
const versionParams = z.object({
  strategyId: idSchema,
  versionNumber: z.coerce.number().int().positive(),
});
const instrumentParams = z.object({ instrumentId: idSchema });

/**
 * Performance analytics (B13): actual series for the person's instances and
 * wallets, model series for published versions, model-only rankings, the
 * methodology, and the price observation record. Nothing here is a quote,
 * a promise or anyone's account ranked against another's.
 */
export const analyticsRoutes: FastifyPluginAsyncZod<AnalyticsRoutesOptions> = async (
  app,
  { analytics },
) => {
  app.get(
    '/v1/me/instances/:instanceId/performance',
    {
      preHandler: read,
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Actual performance of a strategy instance',
        description:
          'The valuation series of the tokens attributed to the instance (daily points plus every purchase and sale as a flow), the window metrics for the requested period (time-weighted return, Modified Dietz, drawdown, turnover, realized and unrealized P&L, fees) and the completeness. Any incomplete point leaves the return null with the reason.',
        params: instanceParams,
        querystring: performanceQuerySchema,
        response: { 200: performanceResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      analytics.instancePerformance(principalOf(request), request.params.instanceId, request.query),
  );

  app.get(
    '/v1/me/instances/:instanceId/performance/export',
    {
      preHandler: read,
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Everything behind the instance performance, for offline checking',
        params: instanceParams,
        response: { 200: performanceExportSchema, ...errorResponses },
      },
    },
    async (request) => analytics.instanceExport(principalOf(request), request.params.instanceId),
  );

  app.get(
    '/v1/me/wallets/:walletId/performance',
    {
      preHandler: read,
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Actual performance of a verified wallet',
        description:
          'The valuation series of everything the journal records in the wallet from its first reconciliation checkpoint (earlier fills form the opening position), with deposits, withdrawals and transfers (acknowledged or pending) as external flows valued at their time, so money entering the wallet is never a return.',
        params: walletParams,
        querystring: performanceQuerySchema,
        response: { 200: performanceResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      analytics.walletPerformance(principalOf(request), request.params.walletId, request.query),
  );

  app.get(
    '/v1/me/wallets/:walletId/performance/export',
    {
      preHandler: read,
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Everything behind the wallet performance, for offline checking',
        params: walletParams,
        response: { 200: performanceExportSchema, ...errorResponses },
      },
    },
    async (request) => analytics.walletExport(principalOf(request), request.params.walletId),
  );

  app.get(
    '/v1/strategies/:strategyId/versions/:versionNumber/performance',
    {
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Model performance of a version: the recipe held from its start',
        description:
          'Public for registered, unmoderated versions; the strategy owner reads the others. The model buys whole base units at the first priced point after the freeze, holds them without costs or rebalancing and values them with recorded reference prices and historical multipliers. Not anyone’s account.',
        params: versionParams,
        querystring: performanceQuerySchema,
        response: { 200: performanceResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      analytics.versionPerformance(
        request.principal,
        request.params.strategyId,
        request.params.versionNumber,
        request.query,
      ),
  );

  app.get(
    '/v1/strategies/:strategyId/versions/:versionNumber/performance/export',
    {
      config: seriesRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Everything behind the model performance, for offline checking',
        params: versionParams,
        response: { 200: performanceExportSchema, ...errorResponses },
      },
    },
    async (request) =>
      analytics.versionExport(
        request.principal,
        request.params.strategyId,
        request.params.versionNumber,
      ),
  );

  app.get(
    '/v1/rankings/model',
    {
      config: rankingRateLimit,
      schema: {
        tags: ['analytics'],
        summary: 'Model-series ranking of published versions',
        description:
          'Registered, unmoderated versions ranked by the time-weighted return of their model series over one period under one methodology version. A version with less than the minimum complete history, an incomplete window or a stale end price is listed without a rank and without a return. No account is ranked.',
        querystring: rankingQuerySchema,
        response: { 200: rankingResponseSchema, ...errorResponses },
      },
    },
    async (request) => analytics.rankings(request.query),
  );

  app.get(
    '/v1/performance/methodology',
    {
      schema: {
        tags: ['analytics'],
        summary: 'The performance methodology in force',
        response: { 200: methodologySummarySchema, ...errorResponses },
      },
    },
    async () => analytics.methodology(),
  );

  app.post(
    '/v1/operator/prices/observations',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['analytics'],
        summary: 'Record a reference price observation with its evidence',
        description:
          'An operator records an observation for an instrument (by id) or for SOL: kind, value, unit, observation time and source. The same point recorded twice is one observation. Never an executable quote.',
        body: priceObservationRequestSchema,
        response: { 201: priceObservationSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const observation = await analytics.recordObservation(
        principalOf(request),
        request.body,
        request.id,
      );
      return reply.code(201).send(observation);
    },
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId/prices',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Recorded reference price observations of an admitted or paused instrument',
        params: instrumentParams,
        querystring: priceHistoryQuerySchema,
        response: { 200: priceHistoryResponseSchema, ...errorResponses },
      },
    },
    async (request) => {
      const principal = request.principal;
      const publicOnly = principal === null || principal.class !== 'operator';
      return analytics.instrumentPriceHistory(
        request.params.instrumentId,
        request.query,
        publicOnly,
      );
    },
  );

  app.get(
    '/v1/prices/sol',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Recorded SOL price observations (used to value network fees)',
        querystring: priceHistoryQuerySchema,
        response: { 200: priceHistoryResponseSchema, ...errorResponses },
      },
    },
    async (request) => analytics.solPriceHistory(request.query),
  );
};
