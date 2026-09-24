import {
  errorResponseSchema,
  idSchema,
  mappingRequestSchema,
  mappingResponseSchema,
  publicThesisSchema,
  researchRunRequestSchema,
  researchRunSchema,
  revisionListResponseSchema,
  runListResponseSchema,
  sourceAttachRequestSchema,
  sourceListResponseSchema,
  sourceRecordSchema,
  thesisCreateRequestSchema,
  thesisDetailSchema,
  thesisListResponseSchema,
  thesisRevisionInputSchema,
  thesisRevisionSchema,
  thesisUpdateRequestSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { ResearchService } from '../research/service.js';

export interface ResearchRoutesOptions {
  readonly research: ResearchService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  503: errorResponseSchema,
};
const strictRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const thesisParams = z.object({ thesisId: idSchema });
const runParams = z.object({ runId: idSchema });
const read = [requireClass('user', 'agent'), requireScope('research:read')];
const write = [requireClass('user', 'agent'), requireScope('research:write')];
const interactive = requireClass('user');

/**
 * Sourced research: versioned theses with typed statements, source records
 * retrieved under the SSRF policy, deterministic company mapping and bounded
 * model runs. Nothing here places an order or names a mint the catalog has
 * not admitted.
 */
export const researchRoutes: FastifyPluginAsyncZod<ResearchRoutesOptions> = async (
  app,
  { research },
) => {
  app.post(
    '/v1/me/theses',
    {
      preHandler: write,
      schema: {
        tags: ['research'],
        summary: 'Create a thesis with its first revision',
        description:
          'Facts and issuer assertions must cite fetched sources; claims about backing, rights, fees or redemption must cite issuer, legal or filing evidence; instruments must be admitted or paused catalog ids; unknown companies are research subjects. Private notes never leave the owner.',
        body: thesisCreateRequestSchema,
        response: { 201: thesisDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return research.createThesis(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/theses',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'The signed-in person’s theses, newest first',
        response: { 200: thesisListResponseSchema, ...errorResponses },
      },
    },
    async (request) => research.listTheses(principalOf(request)),
  );

  app.get(
    '/v1/me/theses/:thesisId',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'A thesis with its current revision and source records',
        params: thesisParams,
        response: { 200: thesisDetailSchema, ...errorResponses },
      },
    },
    async (request) => research.getThesis(principalOf(request), request.params.thesisId),
  );

  app.patch(
    '/v1/me/theses/:thesisId',
    {
      preHandler: interactive,
      schema: {
        tags: ['research'],
        summary: 'Change visibility or archive a thesis (person only)',
        description:
          'Publishing exposes the labelled public projection; archiving withdraws it and stops new revisions.',
        params: thesisParams,
        body: thesisUpdateRequestSchema,
        response: { 200: thesisDetailSchema, ...errorResponses },
      },
    },
    async (request) =>
      research.updateThesis(
        principalOf(request),
        request.params.thesisId,
        request.body,
        request.id,
      ),
  );

  app.post(
    '/v1/me/theses/:thesisId/revisions',
    {
      preHandler: write,
      schema: {
        tags: ['research'],
        summary: 'Append an immutable revision',
        description:
          'Revisions are numbered in order and never edited. The same research rules apply as on creation; model inferences must name a finished run of this thesis.',
        params: thesisParams,
        body: thesisRevisionInputSchema,
        response: { 201: thesisRevisionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return research.addRevision(
        principalOf(request),
        request.params.thesisId,
        request.body,
        request.id,
      );
    },
  );

  app.get(
    '/v1/me/theses/:thesisId/revisions',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'Every saved revision, newest first',
        params: thesisParams,
        response: { 200: revisionListResponseSchema, ...errorResponses },
      },
    },
    async (request) => research.listRevisions(principalOf(request), request.params.thesisId),
  );

  app.post(
    '/v1/me/theses/:thesisId/sources',
    {
      preHandler: write,
      config: strictRateLimit,
      schema: {
        tags: ['research'],
        summary: 'Attach a source by URL; the retriever fetches it under the safe-retrieval policy',
        description:
          'https only, no address literals or local names, every DNS answer must be public and the connection is pinned to it, at most 3 revalidated redirects, 2 MiB, text-like content types only. A refused or failed fetch is recorded as blocked or failed with its reason; only fetched sources can be cited.',
        params: thesisParams,
        body: sourceAttachRequestSchema,
        response: { 201: sourceRecordSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return research.attachSource(
        principalOf(request),
        request.params.thesisId,
        request.body,
        request.id,
      );
    },
  );

  app.get(
    '/v1/me/theses/:thesisId/sources',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'Source records of a thesis, newest first',
        params: thesisParams,
        response: { 200: sourceListResponseSchema, ...errorResponses },
      },
    },
    async (request) => research.listSources(principalOf(request), request.params.thesisId),
  );

  app.post(
    '/v1/me/research/mappings',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'Deterministic company-to-instrument mapping',
        description:
          'Exact match on the normalised company name against admitted or paused instruments. A company without a match stays unmatched: it never becomes a mint.',
        body: mappingRequestSchema,
        response: { 200: mappingResponseSchema, ...errorResponses },
      },
    },
    async (request) => research.mapCompanies(request.body),
  );

  app.post(
    '/v1/me/research/runs',
    {
      preHandler: write,
      config: strictRateLimit,
      schema: {
        tags: ['research'],
        summary: 'Run the bounded model adapter over chosen sources',
        description:
          'The model sees the question, the thesis title and claim, excerpts of the named fetched sources and the admitted candidates; it has no tools and no credentials. Output is validated: statements become labelled model inferences bound to the run, instrument ids must be admitted candidates, unknown companies are reported, everything else is rejected. 503 when no provider is configured.',
        body: researchRunRequestSchema,
        response: { 201: researchRunSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return research.createRun(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/research/runs',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'Research runs, newest first, optionally for one thesis',
        querystring: z.object({ thesisId: idSchema.optional() }),
        response: { 200: runListResponseSchema, ...errorResponses },
      },
    },
    async (request) => research.listRuns(principalOf(request), request.query.thesisId ?? null),
  );

  app.get(
    '/v1/me/research/runs/:runId',
    {
      preHandler: read,
      schema: {
        tags: ['research'],
        summary: 'Status, provenance and validated output of a run',
        params: runParams,
        response: { 200: researchRunSchema, ...errorResponses },
      },
    },
    async (request) => research.getRun(principalOf(request), request.params.runId),
  );

  app.post(
    '/v1/me/research/runs/:runId/cancel',
    {
      preHandler: write,
      schema: {
        tags: ['research'],
        summary: 'Cancel a queued or running run',
        description: 'A finished run is unchanged; the response shows its final state either way.',
        params: runParams,
        response: { 200: researchRunSchema, ...errorResponses },
      },
    },
    async (request) => research.cancelRun(principalOf(request), request.params.runId, request.id),
  );

  app.get(
    '/v1/research/theses/:thesisId',
    {
      schema: {
        tags: ['research'],
        summary: 'Public projection of a published thesis',
        description:
          'Labelled statements, counterarguments, instrument references, subjects and dated source records of the current revision. No private notes, no owner identity. 404 unless the owner published it.',
        params: thesisParams,
        response: { 200: publicThesisSchema, 404: errorResponseSchema, 429: errorResponseSchema },
      },
    },
    async (request) => research.publicThesis(request.params.thesisId),
  );
};
