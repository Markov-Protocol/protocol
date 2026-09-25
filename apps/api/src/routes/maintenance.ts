import { hasScope } from '@markov/auth';
import {
  errorResponseSchema,
  idSchema,
  maintenanceRunReportSchema,
  maintenanceRunRequestSchema,
  mandateDryRunRequestSchema,
  mandateDryRunResponseSchema,
  occurrenceListResponseSchema,
  occurrenceQuerySchema,
  scheduleCreateRequestSchema,
  scheduleListResponseSchema,
  schedulePreviewRequestSchema,
  schedulePreviewResponseSchema,
  scheduleQuerySchema,
  scheduleSchema,
  scheduleUpdateRequestSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import { ApiError } from '../errors.js';
import type { MaintenanceService } from '../maintenance/service.js';

export interface MaintenanceRoutesOptions {
  readonly maintenance: MaintenanceService;
}

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
};
const scheduleParams = z.object({ scheduleId: idSchema });
const owner = requireClass('user');
const reader = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const writeRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const runRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/**
 * Maintenance (B16): schedules that prepare proposals for the owner's
 * approval, their occurrences, a cadence preview, the maintenance pass a
 * worker or operator runs, and the mandate dry run. Nothing here executes.
 */
export const maintenanceRoutes: FastifyPluginAsyncZod<MaintenanceRoutesOptions> = async (
  app,
  { maintenance },
) => {
  app.post(
    '/v1/me/schedules',
    {
      preHandler: owner,
      config: writeRateLimit,
      schema: {
        tags: ['maintenance'],
        summary: 'Create a schedule that prepares proposals for your approval',
        description:
          'A recurring investment names a pinned version or one admitted instrument, one of your wallets and the most an occurrence may suggest; a drift schedule watches one of your instances against a threshold. The mode is prepare_for_approval and nothing else is accepted: every occurrence ends in a proposal you open yourself, and every order still needs its plan, your acknowledgement and your wallet signature. Missed occurrences are skipped.',
        body: scheduleCreateRequestSchema,
        response: { 201: scheduleSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      reply.code(201);
      return maintenance.createSchedule(principalOf(request), request.body, request.id);
    },
  );

  app.get(
    '/v1/me/schedules',
    {
      preHandler: reader,
      schema: {
        tags: ['maintenance'],
        summary: 'Your schedules, newest first',
        querystring: scheduleQuerySchema,
        response: { 200: scheduleListResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      maintenance.listSchedules(principalOf(request), {
        ...(request.query.status !== undefined ? { status: request.query.status } : {}),
        limit: request.query.limit,
      }),
  );

  app.post(
    '/v1/me/schedules/preview',
    {
      preHandler: reader,
      schema: {
        tags: ['maintenance'],
        summary: 'Preview the next instants a cadence fires at, in its time zone',
        body: schedulePreviewRequestSchema,
        response: { 200: schedulePreviewResponseSchema, ...errorResponses },
      },
    },
    async (request) => maintenance.preview(principalOf(request), request.body),
  );

  app.get(
    '/v1/me/schedules/:scheduleId',
    {
      preHandler: reader,
      schema: {
        tags: ['maintenance'],
        summary: 'One schedule with its last occurrence',
        params: scheduleParams,
        response: { 200: scheduleSchema, ...errorResponses },
      },
    },
    async (request) => maintenance.getSchedule(principalOf(request), request.params.scheduleId),
  );

  app.patch(
    '/v1/me/schedules/:scheduleId',
    {
      preHandler: owner,
      config: writeRateLimit,
      schema: {
        tags: ['maintenance'],
        summary: 'Change a schedule’s label, cadence, budget, window or policy',
        description:
          'The kind, the wallet and the instance never change in place: cancel and create instead. A cancelled or revoked schedule cannot be changed.',
        params: scheduleParams,
        body: scheduleUpdateRequestSchema,
        response: { 200: scheduleSchema, ...errorResponses },
      },
    },
    async (request) =>
      maintenance.updateSchedule(
        principalOf(request),
        request.params.scheduleId,
        request.body,
        request.id,
      ),
  );

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    app.post(
      `/v1/me/schedules/:scheduleId/${action}`,
      {
        preHandler: owner,
        config: writeRateLimit,
        schema: {
          tags: ['maintenance'],
          summary:
            action === 'pause'
              ? 'Pause a schedule: it keeps its place and creates nothing'
              : action === 'resume'
                ? 'Resume a paused schedule; occurrences missed meanwhile follow the missed-run policy'
                : 'Cancel a schedule for good; proposals already made and intents already opened are untouched',
          params: scheduleParams,
          response: { 200: scheduleSchema, ...errorResponses },
        },
      },
      async (request) => {
        const principal = principalOf(request);
        const { scheduleId } = request.params;
        if (action === 'pause') {
          return maintenance.pauseSchedule(principal, scheduleId, request.id);
        }
        if (action === 'resume') {
          return maintenance.resumeSchedule(principal, scheduleId, request.id);
        }
        return maintenance.cancelSchedule(principal, scheduleId, request.id);
      },
    );
  }

  app.get(
    '/v1/me/schedules/:scheduleId/occurrences',
    {
      preHandler: reader,
      schema: {
        tags: ['maintenance'],
        summary: 'Every occurrence the scheduler decided for a schedule, newest first',
        params: scheduleParams,
        querystring: occurrenceQuerySchema,
        response: { 200: occurrenceListResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      maintenance.listOccurrences(
        principalOf(request),
        request.params.scheduleId,
        request.query.limit,
      ),
  );

  app.post(
    '/v1/me/mandates/dry-run',
    {
      preHandler: owner,
      config: writeRateLimit,
      schema: {
        tags: ['maintenance'],
        summary: 'Evaluate a hypothetical mandate against one action (dry run; changes nothing)',
        description:
          'Every bound a mandate would enforce is checked and reported: revocation, expiry, nonce, owner, wallet, chain, the pinned version, instruments, venue, action, sides (reduce-only forbids buys and two-sided rebalances), destinations, per-order and period budgets, cumulative turnover, fee and slippage. The response names the automation.unattended capability, which stays DISABLED.',
        body: mandateDryRunRequestSchema,
        response: { 200: mandateDryRunResponseSchema, ...errorResponses },
      },
    },
    async (request) => maintenance.mandateDryRun(principalOf(request), request.body, request.id),
  );

  app.post(
    '/v1/ops/maintenance/run',
    {
      preHandler: [
        requireClass('worker', 'operator'),
        async (request) => {
          const principal = principalOf(request);
          const needed = principal.class === 'worker' ? 'maintenance:run' : 'ops:maintenance:run';
          if (!hasScope(principal, needed)) {
            throw new ApiError('FORBIDDEN', `missing scope ${needed}`);
          }
        },
      ],
      config: runRateLimit,
      schema: {
        tags: ['maintenance'],
        summary: 'Run one maintenance pass (worker or operator)',
        description:
          'Decides every due schedule occurrence (proposal, skip or failure), expires proposals not opened in their window, projects the owners’ events into notifications and attempts due deliveries with bounded retries. Idempotent: a pass repeated after a crash finds the occurrences and proposals it already made. The durable Temporal workflow of the worker calls this on its tick; an operator calls it to recover.',
        body: maintenanceRunRequestSchema,
        response: { 200: maintenanceRunReportSchema, ...errorResponses },
      },
    },
    async (request) => maintenance.run(principalOf(request), request.body, request.id),
  );
};
