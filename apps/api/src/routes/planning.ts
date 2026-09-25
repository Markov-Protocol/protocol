import {
  errorResponseSchema,
  executionPlanSchema,
  idSchema,
  intentCreateRequestSchema,
  intentListResponseSchema,
  intentSchema,
  planAcknowledgementRequestSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { PlanningService } from '../planning/service.js';

export interface PlanningRoutesOptions {
  readonly planning: PlanningService;
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
/** Intent creation is cheap; plan builds quote a venue per constituent and are bounded more tightly. */
const createRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const planRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const intentParams = z.object({ intentId: idSchema });
const planParams = z.object({ intentId: idSchema, planId: idSchema });
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const interactive = requireClass('user');

/**
 * Execution planning (B09). Intents and plans belong to the signed-in
 * person; agents may read them. A plan is bounded, hashed and reviewed
 * before anything is signed; nothing on these routes reserves, spends or
 * submits. Errors name the check that failed without revealing another
 * person's resources.
 */
export const planningRoutes: FastifyPluginAsyncZod<PlanningRoutesOptions> = async (
  app,
  { planning },
) => {
  app.post(
    '/v1/me/intents',
    {
      preHandler: interactive,
      config: createRateLimit,
      schema: {
        tags: ['execution'],
        summary: 'Create an investment intent (idempotent per key)',
        description:
          'A basket investment names a pinned version you own or a public one; a single buy names an admitted instrument. The budget is raw units of the platform stablecoin from one of your verified wallets. 201 for a new intent, 200 when the key was already used with the same request; IDEMPOTENCY_CONFLICT when it was used with another. Nothing is quoted or reserved here.',
        body: intentCreateRequestSchema,
        response: { 200: intentSchema, 201: intentSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await planning.createIntent(principalOf(request), request.body, request.id);
      reply.code(result.created ? 201 : 200);
      return result.intent;
    },
  );

  app.get(
    '/v1/me/intents',
    {
      preHandler: read,
      schema: {
        tags: ['execution'],
        summary: 'Your intents, newest first (at most 50)',
        response: { 200: intentListResponseSchema, ...errorResponses },
      },
    },
    async (request) => planning.listIntents(principalOf(request)),
  );

  app.get(
    '/v1/me/intents/:intentId',
    {
      preHandler: read,
      schema: {
        tags: ['execution'],
        summary: 'One of your intents with its state and latest plan reference',
        params: intentParams,
        response: { 200: intentSchema, ...errorResponses },
      },
    },
    async (request) => planning.getIntent(principalOf(request), request.params.intentId),
  );

  app.post(
    '/v1/me/intents/:intentId/plans',
    {
      preHandler: interactive,
      config: planRateLimit,
      schema: {
        tags: ['execution'],
        summary: 'Build a bounded execution plan for an intent',
        description:
          'Checks the recipe is still admitted, observes the wallet’s funds, allocates the budget in integer base units (largest remainder; refused with the smallest workable budget when a route minimum is not met), takes one venue quote per constituent, checks every quote against the request, policy and the reviewed route-program matrix, evaluates policy per constituent, and answers the immutable, hashed plan with its bounds, fee budget, grouping and validity. Fixture-mode plans are labelled and cannot be executed. A new plan supersedes the intent’s earlier plans. No funds move and nothing is reserved.',
        params: intentParams,
        response: { 201: executionPlanSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const plan = await planning.buildPlan(
        principalOf(request),
        request.params.intentId,
        request.id,
      );
      reply.code(201);
      return plan;
    },
  );

  app.get(
    '/v1/me/intents/:intentId/plans/:planId',
    {
      preHandler: read,
      schema: {
        tags: ['execution'],
        summary: 'A plan of yours, with its review state and current validity',
        params: planParams,
        response: { 200: executionPlanSchema, ...errorResponses },
      },
    },
    async (request) =>
      planning.getPlan(principalOf(request), request.params.intentId, request.params.planId),
  );

  app.post(
    '/v1/me/intents/:intentId/plans/:planId/acknowledgements',
    {
      preHandler: interactive,
      schema: {
        tags: ['execution'],
        summary: 'Acknowledge a reviewed plan by its hash',
        description:
          'Binds your review to the plan hash: PLAN_CHANGED when the hash differs or a newer plan exists, QUOTE_EXPIRED when the plan’s validity has passed, VALIDATION_FAILED when a staged plan is acknowledged without accepting partial completion. Moves the intent to AWAITING_APPROVAL; the wallet signature arrives with B10.',
        params: planParams,
        body: planAcknowledgementRequestSchema,
        response: { 200: executionPlanSchema, ...errorResponses },
      },
    },
    async (request) =>
      planning.acknowledgePlan(
        principalOf(request),
        request.params.intentId,
        request.params.planId,
        request.body,
        request.id,
      ),
  );

  app.post(
    '/v1/me/intents/:intentId/cancel',
    {
      preHandler: interactive,
      schema: {
        tags: ['execution'],
        summary: 'Cancel an intent before any signature (idempotent)',
        params: intentParams,
        response: { 200: intentSchema, ...errorResponses },
      },
    },
    async (request) =>
      planning.cancelIntent(principalOf(request), request.params.intentId, request.id),
  );
};
