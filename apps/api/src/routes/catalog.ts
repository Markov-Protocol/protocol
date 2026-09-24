import {
  corporateActionApplyRequestSchema,
  corporateActionApplyResponseSchema,
  corporateActionIngestionReportSchema,
  corporateActionListResponseSchema,
  corporateActionSchema,
  corporateActionStatusSchema,
  errorResponseSchema,
  idSchema,
  ingestionReportSchema,
  ingestionRequestSchema,
  instrumentDecisionRequestSchema,
  instrumentDecisionSchema,
  instrumentDetailSchema,
  instrumentListQuerySchema,
  instrumentListResponseSchema,
  issuerSchema,
  mintVerificationSchema,
  multiplierAsOfResponseSchema,
  multiplierHistoryResponseSchema,
  operatorInstrumentListQuerySchema,
  quantityConversionQuerySchema,
  quantityConversionResponseSchema,
  snapshotListResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { CatalogService } from '../catalog/service.js';

export interface CatalogRoutesOptions {
  readonly catalog: CatalogService;
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
const instrumentParams = z.object({ instrumentId: idSchema });
const actionParams = z.object({ actionId: idSchema });
const operatorRead = [requireClass('operator'), requireScope('ops:catalog:read')];
const operatorWrite = [requireClass('operator'), requireScope('ops:catalog:write')];

/**
 * Public catalog reads and operator lifecycle writes. Public routes only ever
 * list admitted or paused instruments; quarantined and rejected products,
 * rejected corporate actions and ingestion are visible to operators alone.
 */
export const catalogRoutes: FastifyPluginAsyncZod<CatalogRoutesOptions> = async (
  app,
  { catalog },
) => {
  app.get(
    '/v1/catalog/instruments',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Search admitted and paused instruments',
        description:
          'Reference prices carry their kind (issuer mark, implied valuation, secondary market or underlying equity) and are never executable quotes. Lifecycle facts (halts, pending corporate actions, migrations, sunsets, the multiplier in force) come with every instrument.',
        querystring: instrumentListQuerySchema,
        response: { 200: instrumentListResponseSchema, ...errorResponses },
      },
    },
    async (request) => catalog.listPublic(request.query),
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Instrument detail with its latest mint verification and extension assessment',
        params: instrumentParams,
        response: { 200: instrumentDetailSchema, ...errorResponses },
      },
    },
    async (request) => catalog.getPublic(request.params.instrumentId),
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId/corporate-actions',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Pending and applied corporate actions of a visible instrument',
        params: instrumentParams,
        response: { 200: corporateActionListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({
      actions: await catalog.listInstrumentActions(request.params.instrumentId, true),
    }),
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId/multipliers',
    {
      schema: {
        tags: ['catalog'],
        summary:
          'Multiplier evidence history (on-chain reads, applied corporate actions, operator entries)',
        params: instrumentParams,
        response: { 200: multiplierHistoryResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({
      instrumentId: request.params.instrumentId,
      multipliers: await catalog.multiplierHistory(request.params.instrumentId, true),
    }),
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId/multiplier',
    {
      schema: {
        tags: ['catalog'],
        summary:
          'The multiplier in force at a time; incomplete evidence is reported, never assumed to be 1',
        params: instrumentParams,
        querystring: z.object({ asOf: z.iso.datetime().optional() }),
        response: { 200: multiplierAsOfResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      catalog.multiplierAt(
        request.params.instrumentId,
        request.query.asOf ? new Date(request.query.asOf) : new Date(),
        true,
      ),
  );

  app.get(
    '/v1/catalog/instruments/:instrumentId/quantities',
    {
      schema: {
        tags: ['catalog'],
        summary:
          'Convert between raw base units and scaled display quantities with explicit rounding',
        description:
          'Exactly one of `raw` or `scaled`. The multiplier used and whether rounding lost information are always returned.',
        params: instrumentParams,
        querystring: quantityConversionQuerySchema,
        response: { 200: quantityConversionResponseSchema, ...errorResponses },
      },
    },
    async (request) => catalog.convertQuantity(request.params.instrumentId, request.query, true),
  );

  app.get(
    '/v1/ops/catalog/instruments',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'List instruments in any status (operator)',
        querystring: operatorInstrumentListQuerySchema,
        response: { 200: instrumentListResponseSchema, ...errorResponses },
      },
    },
    async (request) => catalog.listForOperator(request.query),
  );

  app.get(
    '/v1/ops/catalog/instruments/:instrumentId',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Instrument detail in any status (operator)',
        params: instrumentParams,
        response: { 200: instrumentDetailSchema, ...errorResponses },
      },
    },
    async (request) => catalog.getForOperator(request.params.instrumentId),
  );

  app.get(
    '/v1/ops/catalog/instruments/:instrumentId/decisions',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Decision history of an instrument (operator)',
        params: instrumentParams,
        response: {
          200: z.object({ decisions: z.array(instrumentDecisionSchema) }),
          ...errorResponses,
        },
      },
    },
    async (request) => ({ decisions: await catalog.listDecisions(request.params.instrumentId) }),
  );

  app.post(
    '/v1/ops/catalog/ingestions',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Ingest an issuer product feed into quarantine (operator)',
        description:
          'Fixture sources exist only in local and test modes. A feed that drifts from the contract is recorded as a rejected snapshot and changes nothing.',
        body: ingestionRequestSchema,
        response: { 201: ingestionReportSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await catalog.ingest(principalOf(request), request.body, request.id)),
  );

  app.post(
    '/v1/ops/catalog/corporate-actions/ingestions',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Ingest an issuer corporate-action feed as pending events (operator)',
        description:
          'Events for unknown products are reported as unmatched and never create instruments; applied or rejected events are never rewritten by a feed.',
        body: ingestionRequestSchema,
        response: { 201: corporateActionIngestionReportSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await catalog.ingestCorporateActions(principalOf(request), request.body, request.id)),
  );

  app.get(
    '/v1/ops/catalog/corporate-actions',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Corporate actions in any status (operator)',
        querystring: z.object({
          issuer: issuerSchema.optional(),
          status: corporateActionStatusSchema.optional(),
        }),
        response: { 200: corporateActionListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ actions: await catalog.listActions(request.query) }),
  );

  app.post(
    '/v1/ops/catalog/corporate-actions/:actionId/apply',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Apply a pending corporate action once it is effective (operator)',
        description:
          'Halts, resumes, migrations and sunsets change the lifecycle; splits, reverse splits and multiplier changes record multiplier evidence derived from the multiplier in force before the effective time.',
        params: actionParams,
        body: corporateActionApplyRequestSchema,
        response: { 201: corporateActionApplyResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.applyAction(
            principalOf(request),
            request.params.actionId,
            request.body,
            request.id,
          ),
        ),
  );

  app.post(
    '/v1/ops/catalog/corporate-actions/:actionId/reject',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Reject a pending corporate action (operator)',
        params: actionParams,
        body: z.object({ reason: z.string().trim().min(3).max(500) }),
        response: { 201: corporateActionSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.rejectAction(
            principalOf(request),
            request.params.actionId,
            request.body.reason,
            request.id,
          ),
        ),
  );

  app.post(
    '/v1/ops/catalog/instruments/:instrumentId/mint-verifications',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary:
          'Compare the declared mint with the chain and assess its token extensions (operator)',
        params: instrumentParams,
        response: { 201: mintVerificationSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.verifyMint(principalOf(request), request.params.instrumentId, request.id),
        ),
  );

  app.post(
    '/v1/ops/catalog/instruments/:instrumentId/decisions',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Admit, reject, pause, resume or delist an instrument (operator)',
        description:
          'Admission and resumption require a matching mint verification recorded after the last upstream change, no unsupported token extension, and `evidence.extensionReview` when extensions need review.',
        params: instrumentParams,
        body: instrumentDecisionRequestSchema,
        response: { 201: instrumentDecisionSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await catalog.decide(
            principalOf(request),
            request.params.instrumentId,
            request.body,
            request.id,
          ),
        ),
  );

  app.get(
    '/v1/ops/catalog/snapshots',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['catalog', 'operations'],
        summary: 'Recent issuer snapshots (operator)',
        querystring: z.object({ issuer: issuerSchema.optional() }),
        response: { 200: snapshotListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ snapshots: await catalog.listSnapshots(request.query.issuer ?? null) }),
  );
};
