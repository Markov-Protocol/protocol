import {
  betaParticipantListResponseSchema,
  betaParticipantRequestSchema,
  betaParticipantSchema,
  currentTermsResponseSchema,
  effectiveLimitsResponseSchema,
  eligibilityDecisionSchema,
  eligibilityDeclarationRequestSchema,
  eligibilityHistoryResponseSchema,
  eligibilityRevocationRequestSchema,
  eligibilityStatusResponseSchema,
  errorResponseSchema,
  idSchema,
  instrumentActionAvailabilitySchema,
  jurisdictionRuleSetSchema,
  ownerLimitsUpdateRequestSchema,
  policyDecisionSchema,
  policyEvaluationRequestSchema,
  publishedRuleSetSchema,
  reservationListResponseSchema,
  ruleSetListResponseSchema,
  spendReservationSchema,
  termsAcknowledgementRequestSchema,
  termsAcknowledgementSchema,
  termsDocumentSchema,
  termsPublishRequestSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { PolicyService } from '../policy/service.js';

export interface PolicyRoutesOptions {
  readonly policy: PolicyService;
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
const instrumentParams = z.object({ instrumentId: idSchema });
const intentParams = z.object({ intentId: z.string().min(1).max(100) });
const decisionParams = z.object({ decisionId: idSchema });
const userParams = z.object({ userId: idSchema });
const ownerRead = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const ownerPropose = [requireClass('user', 'agent'), requireScope('proposals:create')];
const interactive = requireClass('user');
const operatorRead = [requireClass('operator'), requireScope('ops:policy:read')];
const operatorWrite = [requireClass('operator'), requireScope('ops:policy:write')];

/**
 * Eligibility, terms, limits, capability states and policy decisions.
 * Every denial is machine-readable; nothing here is a legal opinion and
 * nothing here spends funds. Owners can only tighten what operators and
 * configuration allow.
 */
export const policyRoutes: FastifyPluginAsyncZod<PolicyRoutesOptions> = async (app, { policy }) => {
  app.get(
    '/v1/me/eligibility',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['policy'],
        summary: 'Eligibility, terms and next steps for the signed-in person',
        description:
          'The latest eligibility decision and whether it still stands (expiry, revocation, superseded policy version), the terms still to acknowledge and the exact steps left before trading. Unknown eligibility blocks execution.',
        response: { 200: eligibilityStatusResponseSchema, ...errorResponses },
      },
    },
    async (request) => policy.eligibilityStatus(principalOf(request)),
  );

  app.post(
    '/v1/me/eligibility/declarations',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['policy'],
        summary: 'Declare a jurisdiction and record a versioned eligibility decision',
        description:
          'Self-declared evidence only. The decision is evaluated against the active operator-published rule set; without rules the outcome is unknown. Every declaration records a new decision with its policy version and expiry.',
        body: eligibilityDeclarationRequestSchema,
        response: { 201: eligibilityDecisionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.declareJurisdiction(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/terms/current',
    {
      schema: {
        tags: ['policy'],
        summary: 'Active terms and disclosure documents with their content hashes',
        response: { 200: currentTermsResponseSchema, ...errorResponses },
      },
    },
    async () => policy.currentTerms(),
  );

  app.post(
    '/v1/me/terms/acknowledgements',
    {
      preHandler: interactive,
      config: strictRateLimit,
      schema: {
        tags: ['policy'],
        summary: 'Acknowledge an active terms document by version and content hash',
        description:
          'The hash must equal the published document so nobody accepts text they were not shown. Idempotent per version.',
        body: termsAcknowledgementRequestSchema,
        response: { 201: termsAcknowledgementSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.acknowledgeTerms(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/limits',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['policy'],
        summary:
          'Effective trading limits: policy defaults, beta caps and the owner’s own settings',
        response: { 200: effectiveLimitsResponseSchema, ...errorResponses },
      },
    },
    async (request) => policy.limits(principalOf(request)),
  );

  app.put(
    '/v1/me/limits',
    {
      preHandler: interactive,
      schema: {
        tags: ['policy'],
        summary: 'Tighten the owner’s limits (step-up required)',
        description:
          'Each field may only be at or below the ceiling; a looser value is refused with the ceiling in the details. Omitted fields keep their previous value.',
        body: ownerLimitsUpdateRequestSchema,
        response: { 200: effectiveLimitsResponseSchema, ...errorResponses },
      },
    },
    async (request) => policy.updateLimits(principalOf(request), request.body, request.id),
  );

  app.get(
    '/v1/me/instruments/:instrumentId/availability',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['policy'],
        summary: 'Capability states of an instrument for the signed-in person',
        description:
          'discoverable, researchable, quoteable, buyable, sellable, redeemable (always false) and transferable, each with the conditions that switch it off: stale reference, venue disabled, issuer halted, corporate action pending, migration required, sunset, eligibility, terms, execution disabled.',
        params: instrumentParams,
        response: { 200: instrumentActionAvailabilitySchema, ...errorResponses },
      },
    },
    async (request) => policy.availability(principalOf(request), request.params.instrumentId),
  );

  app.post(
    '/v1/me/policy/evaluations',
    {
      preHandler: ownerPropose,
      schema: {
        tags: ['policy'],
        summary: 'Evaluate an intent against policy; optionally hold its notional',
        description:
          'Deterministic decision with every failing check reported (code, limit, observed value). Caps include pending reservations; concentration is measured per issuer and per underlying company across issuers. With `reserve: true` an allowed intent holds its notional against the daily and account budgets, serialised per account so concurrent intents can never overspend. Stage `submit` additionally requires execution writes, an enabled venue and declared exposure.',
        body: policyEvaluationRequestSchema,
        response: { 201: policyDecisionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.evaluate(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/reservations',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['policy'],
        summary: 'Pending-spend reservations of the signed-in person',
        response: { 200: reservationListResponseSchema, ...errorResponses },
      },
    },
    async (request) => policy.listReservations(principalOf(request)),
  );

  app.delete(
    '/v1/me/reservations/:intentId',
    {
      preHandler: ownerPropose,
      schema: {
        tags: ['policy'],
        summary: 'Release a held reservation by intent id',
        params: intentParams,
        response: { 200: spendReservationSchema, ...errorResponses },
      },
    },
    async (request) =>
      policy.releaseReservation(principalOf(request), request.params.intentId, request.id),
  );

  app.post(
    '/v1/ops/policy/jurisdiction-rules',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['policy'],
        summary: 'Publish a jurisdiction rule set (becomes the active policy version)',
        description:
          'Versions are immutable. Fixture jurisdictions (user-assigned ISO codes) are refused outside local and test. Publishing does not extend existing decisions: decisions under another version are superseded until the person declares again.',
        body: jurisdictionRuleSetSchema,
        response: { 201: publishedRuleSetSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.publishRules(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/ops/policy/jurisdiction-rules',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['policy'],
        summary: 'Published rule sets, newest first',
        response: { 200: ruleSetListResponseSchema, ...errorResponses },
      },
    },
    async () => policy.listRuleSets(),
  );

  app.post(
    '/v1/ops/policy/terms',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['policy'],
        summary: 'Publish a terms document (retires the active one for the same capability)',
        body: termsPublishRequestSchema,
        response: { 201: termsDocumentSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.publishTerms(principalOf(request), request.body, request.id);
    },
  );

  app.post(
    '/v1/ops/policy/eligibility/:decisionId/revoke',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['policy'],
        summary: 'Revoke an eligibility decision',
        params: decisionParams,
        body: eligibilityRevocationRequestSchema,
        response: { 200: eligibilityDecisionSchema, ...errorResponses },
      },
    },
    async (request) =>
      policy.revokeEligibility(
        principalOf(request),
        request.params.decisionId,
        request.body.reason,
        request.id,
      ),
  );

  app.get(
    '/v1/ops/policy/users/:userId/eligibility',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['policy'],
        summary: 'Eligibility decision history of a user',
        params: userParams,
        response: { 200: eligibilityHistoryResponseSchema, ...errorResponses },
      },
    },
    async (request) => policy.eligibilityHistory(request.params.userId),
  );

  app.get(
    '/v1/ops/policy/participants',
    {
      preHandler: operatorRead,
      schema: {
        tags: ['policy'],
        summary: 'Beta participant allowlist',
        response: { 200: betaParticipantListResponseSchema, ...errorResponses },
      },
    },
    async () => policy.listParticipants(),
  );

  app.post(
    '/v1/ops/policy/participants',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['policy'],
        summary: 'Add or update a beta participant',
        body: betaParticipantRequestSchema,
        response: { 201: betaParticipantSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return policy.addParticipant(principalOf(request), request.body, request.id);
    },
  );

  app.delete(
    '/v1/ops/policy/participants/:userId',
    {
      preHandler: operatorWrite,
      schema: {
        tags: ['policy'],
        summary: 'Remove a beta participant',
        params: userParams,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await policy.removeParticipant(principalOf(request), request.params.userId, request.id);
      reply.code(204);
      return null;
    },
  );
};
