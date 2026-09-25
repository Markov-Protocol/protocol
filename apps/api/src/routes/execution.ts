import {
  errorResponseSchema,
  executionStatusSchema,
  idSchema,
  preparedTransactionSchema,
  signedTransactionSubmissionSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';
import type { ExecutionService } from '../execution/service.js';

export interface ExecutionRoutesOptions {
  readonly execution: ExecutionService;
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
/** Builds call the venue and the node; submissions broadcast; both are bounded per client. */
const buildRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const submitRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const reconcileRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const intentParams = z.object({ intentId: idSchema });
const transactionParams = z.object({
  intentId: idSchema,
  transactionIndex: z.coerce.number().int().min(0).max(31),
});
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const interactive = requireClass('user');

/**
 * Execution (B10). A transaction is built only for a plan its owner
 * acknowledged by hash, decoded and validated against that plan, simulated
 * and stored before it is shown for signing; the owner's signature over the
 * exact message is verified, policy re-evaluated with a reservation and the
 * attempt persisted before the one broadcast. Status reads reconcile live
 * attempts from chain evidence. Agents read; only the person signs.
 */
export const executionRoutes: FastifyPluginAsyncZod<ExecutionRoutesOptions> = async (
  app,
  { execution },
) => {
  app.post(
    '/v1/me/intents/:intentId/transactions',
    {
      preHandler: interactive,
      config: buildRateLimit,
      schema: {
        tags: ['execution'],
        summary: 'Build, validate and simulate the transaction of an acknowledged plan',
        description:
          'For a single-leg plan (buy or sell) acknowledged by its hash: takes a finalized blockhash, asks the venue for the transaction, decodes every instruction and checks it against the plan (fee payer and sole signer, the owner’s token accounts, mints, exact input and minimum output, compute budget within the plan’s fee cap, account creation for the owner only, reviewed route programs), simulates it and stores it. Refusals answer TRANSACTION_REFUSED with the refusal code in details (VALIDATION_FAILED, SIMULATION_FAILED, STAGED_NOT_SUPPORTED, ATTEMPT_IN_FLIGHT, PLAN_NOT_APPROVED), QUOTE_EXPIRED when the plan expired, PLAN_CHANGED when the intent moved on, PROVIDER_UNAVAILABLE when no venue builds. A new build supersedes an unsigned earlier one. Nothing is signed or sent.',
        params: intentParams,
        response: { 201: preparedTransactionSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const prepared = await execution.buildTransaction(
        principalOf(request),
        request.params.intentId,
        request.id,
      );
      reply.code(201);
      return prepared;
    },
  );

  app.post(
    '/v1/me/intents/:intentId/transactions/:transactionIndex/submissions',
    {
      preHandler: interactive,
      config: submitRateLimit,
      schema: {
        tags: ['execution'],
        summary: 'Submit the owner-signed transaction (idempotent for the same signed bytes)',
        description:
          'The signed bytes must carry exactly the prepared message with one valid signature by the owner wallet; anything else is SIGNATURE_MISMATCH and nothing reaches a node. The plan and the blockhash are checked again, policy is re-evaluated at stage submit with a reservation (POLICY_DENIED refuses), the attempt with its signature and signed bytes is persisted before the broadcast, and the one broadcast is made. 201 with the execution status for a new attempt (SUBMITTED, FAILED when the node refused it before broadcast, or UNKNOWN_REQUIRES_RECONCILIATION when no answer came back); 200 with the status when the same signed transaction was submitted before. A retry never creates a second attempt.',
        params: transactionParams,
        body: signedTransactionSubmissionSchema,
        response: { 200: executionStatusSchema, 201: executionStatusSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await execution.submitTransaction(
        principalOf(request),
        request.params.intentId,
        request.params.transactionIndex,
        request.body,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.status;
    },
  );

  app.get(
    '/v1/me/intents/:intentId/execution',
    {
      preHandler: read,
      schema: {
        tags: ['execution'],
        summary:
          'Execution status: prepared transactions, attempts, fills and reconciliation evidence',
        description:
          'A live attempt is reconciled from the node on the way (signature status, finalized block height; the same signed bytes are resent while the blockhash is valid), at most every couple of seconds. Fills come from the landed transaction’s balance changes, never from a signature alone. nextAction says what is expected next: build, sign, wait, reconcile, review or none.',
        params: intentParams,
        response: { 200: executionStatusSchema, ...errorResponses },
      },
    },
    async (request) => execution.getExecution(principalOf(request), request.params.intentId),
  );

  app.post(
    '/v1/me/intents/:intentId/execution/reconciliations',
    {
      preHandler: interactive,
      config: reconcileRateLimit,
      schema: {
        tags: ['execution'],
        summary: 'Reconcile a live attempt from chain evidence now',
        description:
          'Asks the node about the attempt’s signature and the finalized block height and applies the outcome: observed → SUBMITTED/CONFIRMED/FINALIZED (with the fill read from the transaction), landed with an error → FAILED, blockhash expired unseen → FAILED (or CANCELLED when cancellation was requested), unknown and still valid → the same bytes are resent. Nothing new is built or signed.',
        params: intentParams,
        response: { 200: executionStatusSchema, ...errorResponses },
      },
    },
    async (request) =>
      execution.reconcile(principalOf(request), request.params.intentId, request.id),
  );
};
