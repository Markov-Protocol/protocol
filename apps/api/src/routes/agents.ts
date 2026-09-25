import { AGENT_TOOLS, type AnyToolDefinition } from '@markov/agent-tools';
import {
  agentProposalSchema,
  agentToolCatalogSchema,
  agentToolResultSchema,
  companionRunListResponseSchema,
  companionRunRequestSchema,
  companionRunSchema,
  errorResponseSchema,
  eventListResponseSchema,
  eventQuerySchema,
  idSchema,
  proposalListResponseSchema,
  proposalOpenResponseSchema,
  proposalQuerySchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type AgentService, EVENTS_NOTE, PROPOSAL_NOTE } from '../agents/service.js';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';

export interface AgentRoutesOptions {
  readonly agents: AgentService;
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
/** Tools read and validate; the propose family writes a proposal. Bounded per client like other owner writes. */
const toolRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
/** A run drives a model through several tool calls; bounded more tightly. */
const runRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const runParams = z.object({ runId: idSchema });
const proposalParams = z.object({ proposalId: idSchema });
const actor = requireClass('user', 'agent');
const ownerRead = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const interactive = requireClass('user');
const eventReader = [requireClass('user', 'device'), requireScope('status:read')];

/**
 * Agent tools, companion runs, proposals and the Mark I event log (B15).
 * Every tool route is a typed façade over one domain method and runs with
 * the caller's own principal; the companion loop uses the same routes'
 * service. Nothing here signs, approves, spends or widens a permission:
 * proposals wait for the owner's own session.
 */
export const agentRoutes: FastifyPluginAsyncZod<AgentRoutesOptions> = async (app, { agents }) => {
  app.get(
    '/v1/agent/tools',
    {
      preHandler: actor,
      schema: {
        tags: ['agents'],
        summary: 'The typed tools this principal may call, with their JSON Schemas',
        description:
          'Filtered by the caller’s scopes: a person’s session sees every tool, an agent credential the ones its scopes unlock, and the description of each says what it reads or writes. The catalog is what a model client is given; the schemas are generated from the validators the routes enforce.',
        response: { 200: agentToolCatalogSchema, ...errorResponses },
      },
    },
    async (request) => agents.catalog(principalOf(request)),
  );

  for (const tool of AGENT_TOOLS) {
    app.post(
      `/v1/agent/tools/${tool.name}`,
      {
        preHandler: [actor, ...tool.scopes.map((scope) => requireScope(scope))],
        config: toolRateLimit,
        schema: {
          tags: ['agents'],
          summary: `Tool ${tool.name}: ${tool.summary}`,
          description: `${tool.description} Requires ${tool.scopes.join(' and ')}; ${tool.mutation ? 'writes and is audited' : 'reads only'}. Unknown or widened arguments are refused (VALIDATION_FAILED), never stripped.`,
          body: tool.input,
          response: { 200: agentToolResultSchema(tool.output), ...errorResponses },
        },
      },
      async (request) =>
        (await agents.invoke(principalOf(request), tool.name, request.body, request.id)) as {
          tool: typeof tool.name;
          invokedAt: string;
          output: z.infer<AnyToolDefinition['output']>;
        },
    );
  }

  app.post(
    '/v1/me/companion/runs',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      config: runRateLimit,
      schema: {
        tags: ['agents'],
        summary: 'Run the bounded companion model over the caller’s tools',
        description:
          'The model sees the question, a redacted context (a thesis title, claim and fetched excerpts; an instance label and pinned version; public instrument facts), the tools the caller may use and the transcript so far, and answers one step at a time. Every tool call is validated and authorised with the caller’s own principal, refused calls are recorded, tool calls, output characters, cost and time are bounded by the request budget and the account’s daily cost cap, and the provenance keeps digests and summaries only. The answer is plain text to review; anything to act on is a proposal. 503 when no provider is configured; 409 BUDGET_EXHAUSTED when the daily cap is spent.',
        body: companionRunRequestSchema,
        response: { 201: companionRunSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return agents.createRun(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/companion/runs',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      schema: {
        tags: ['agents'],
        summary: 'Companion runs, newest first',
        response: { 200: companionRunListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({ runs: await agents.listRuns(principalOf(request)) }),
  );

  app.get(
    '/v1/me/companion/runs/:runId',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      schema: {
        tags: ['agents'],
        summary: 'Status, redacted provenance and validated output of a run',
        params: runParams,
        response: { 200: companionRunSchema, ...errorResponses },
      },
    },
    async (request) => agents.getRun(principalOf(request), request.params.runId),
  );

  app.post(
    '/v1/me/companion/runs/:runId/cancel',
    {
      preHandler: [requireClass('user', 'agent'), requireScope('research:read')],
      schema: {
        tags: ['agents'],
        summary: 'Cancel a queued or running companion run',
        description: 'A finished run is unchanged; the response shows its final state either way.',
        params: runParams,
        response: { 200: companionRunSchema, ...errorResponses },
      },
    },
    async (request) => agents.cancelRun(principalOf(request), request.params.runId, request.id),
  );

  app.get(
    '/v1/me/proposals',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['agents'],
        summary: 'Proposals awaiting the owner, newest first',
        description: PROPOSAL_NOTE,
        querystring: proposalQuerySchema,
        response: { 200: proposalListResponseSchema, ...errorResponses },
      },
    },
    async (request) => ({
      proposals: await agents.listProposals(principalOf(request), request.query),
      note: PROPOSAL_NOTE,
    }),
  );

  app.get(
    '/v1/me/proposals/:proposalId',
    {
      preHandler: ownerRead,
      schema: {
        tags: ['agents'],
        summary: 'One proposal with its typed payload',
        params: proposalParams,
        response: { 200: agentProposalSchema, ...errorResponses },
      },
    },
    async (request) => agents.getProposal(principalOf(request), request.params.proposalId),
  );

  app.post(
    '/v1/me/proposals/:proposalId/open',
    {
      preHandler: interactive,
      schema: {
        tags: ['agents'],
        summary: 'Open a proposal as the owner (an investment proposal becomes an ordinary intent)',
        description:
          'Owner sessions only: an agent credential is refused whatever its scopes. An investment proposal creates the intent in the owner’s name under the idempotency key of the proposal, so opening twice answers the same intent; the plan, its acknowledgement and the wallet signature follow through the ordinary execution routes. A basket proposal is marked opened and its draft is edited in the builder; a rebalance proposal is marked opened and places nothing. Dismissed and expired proposals cannot be opened.',
        params: proposalParams,
        response: { 200: proposalOpenResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      agents.openProposal(principalOf(request), request.params.proposalId, request.id),
  );

  app.post(
    '/v1/me/proposals/:proposalId/dismiss',
    {
      preHandler: interactive,
      schema: {
        tags: ['agents'],
        summary: 'Dismiss a proposal as the owner',
        params: proposalParams,
        response: { 200: agentProposalSchema, ...errorResponses },
      },
    },
    async (request) =>
      agents.dismissProposal(principalOf(request), request.params.proposalId, request.id),
  );

  app.get(
    '/v1/me/events',
    {
      preHandler: eventReader,
      schema: {
        tags: ['agents'],
        summary: 'The owner’s Mark I event log, resumable by sequence',
        description: `${EVENTS_NOTE} Read by the owner’s session or a paired device holding status:read; agents and operators cannot read it. Pass the last sequence you saw as after.`,
        querystring: eventQuerySchema,
        response: { 200: eventListResponseSchema, ...errorResponses },
      },
    },
    async (request) => agents.listEvents(principalOf(request), request.query),
  );
};
