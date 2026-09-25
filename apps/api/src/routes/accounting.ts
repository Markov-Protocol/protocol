import {
  errorResponseSchema,
  externalFlowAcknowledgementRequestSchema,
  idSchema,
  instanceHoldingsResponseSchema,
  journalEntrySchema,
  journalListResponseSchema,
  journalProjectionReportSchema,
  receiptKeysResponseSchema,
  receiptKindSchema,
  receiptListResponseSchema,
  receiptSchema,
  walletHoldingsResponseSchema,
} from '@markov/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AccountingService } from '../accounting/service.js';
import { principalOf, requireClass, requireScope } from '../auth/plugin.js';

export interface AccountingRoutesOptions {
  readonly accounting: AccountingService;
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
/** Reconciliation reads every token account of the wallet from the node; bounded per client. */
const reconcileRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const issueRateLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
const read = [requireClass('user', 'agent'), requireScope('portfolio:read')];
const interactive = requireClass('user');
const walletParams = z.object({ walletId: idSchema });
const instanceParams = z.object({ instanceId: idSchema });
const entryParams = z.object({ entryId: idSchema });
const intentParams = z.object({ intentId: idSchema });
const receiptParams = z.object({ receiptId: idSchema });

/**
 * Accounting (B12): the wallet's journal and holdings reconciled against
 * the chain, strategy-attributed holdings, the owner's acknowledgement of
 * external flows, and signed receipts with public verification keys.
 * Owners and their read-scoped agents read; only the person acknowledges,
 * reconciles on demand, issues receipts and opts one into public reading.
 */
export const accountingRoutes: FastifyPluginAsyncZod<AccountingRoutesOptions> = async (
  app,
  { accounting },
) => {
  app.get(
    '/v1/me/wallets/:walletId/holdings',
    {
      preHandler: read,
      schema: {
        tags: ['accounting'],
        summary: 'Holdings of a verified wallet: the journal against the last chain observation',
        description:
          'Projects any settled fills not yet journaled, then answers every asset the journal or the last reconciliation checkpoint knows: the journal’s wallet balance, the chain balance observed at the checkpoint, the difference, the status (matched, unobserved, stale, needs_reconciliation, unassigned_asset) and how the quantity is attributed (open lots per strategy instance, wallet-level, or an external flow awaiting acknowledgement). Wallet totals stay separate from strategy-attributed totals; nothing is valued here.',
        params: walletParams,
        response: { 200: walletHoldingsResponseSchema, ...errorResponses },
      },
    },
    async (request) => accounting.walletHoldings(principalOf(request), request.params.walletId),
  );

  app.post(
    '/v1/me/wallets/:walletId/reconciliations',
    {
      preHandler: interactive,
      config: reconcileRateLimit,
      schema: {
        tags: ['accounting'],
        summary: 'Reconcile the wallet’s journal against the chain now',
        description:
          'Reads the wallet’s lamports and every SPL and Token-2022 account from the node, compares them with the journal’s wallet balances and records a checkpoint. A difference in a known asset becomes an external inflow or outflow entry that needs the owner’s acknowledgement (nothing is attributed to a strategy); an asset the platform cannot name stays visible as unassigned; a difference already flagged is not flagged twice. Answers the holdings after the checkpoint.',
        params: walletParams,
        response: { 200: walletHoldingsResponseSchema, ...errorResponses },
      },
    },
    async (request) =>
      accounting.reconcileWallet(principalOf(request), request.params.walletId, request.id),
  );

  app.get(
    '/v1/me/wallets/:walletId/journal',
    {
      preHandler: read,
      schema: {
        tags: ['accounting'],
        summary: 'The wallet’s quantity journal, oldest first',
        description:
          'Append-only entries balanced per asset in raw base units: fills (input to the venue, output from it), network fees, rent, external flows against the chain, corrections that reverse an earlier entry. Each entry names its source and idempotency reference, its attribution and any acknowledgement.',
        params: walletParams,
        response: { 200: journalListResponseSchema, ...errorResponses },
      },
    },
    async (request) => accounting.walletJournal(principalOf(request), request.params.walletId),
  );

  app.post(
    '/v1/me/journal/:entryId/acknowledgements',
    {
      preHandler: interactive,
      schema: {
        tags: ['accounting'],
        summary: 'Explain an external flow (a deposit, a withdrawal, a transfer you made)',
        description:
          'Moves an external-flow entry from needing reconciliation to wallet-level (unassigned) attribution with the owner’s explanation. It never attributes anything to a strategy and never changes quantities. Refused for entries that are not awaiting acknowledgement.',
        params: entryParams,
        body: externalFlowAcknowledgementRequestSchema,
        response: { 200: journalEntrySchema, ...errorResponses },
      },
    },
    async (request) =>
      accounting.acknowledgeFlow(
        principalOf(request),
        request.params.entryId,
        request.body,
        request.id,
      ),
  );

  app.post(
    '/v1/me/journal/projections',
    {
      preHandler: interactive,
      schema: {
        tags: ['accounting'],
        summary: 'Project settled fills into the journal now (idempotent)',
        description:
          'Appends the entries, lots and consumptions of every settled fill of the caller that the journal does not hold yet. A fill already journaled is counted as existing and changes nothing, so calling this twice leaves the totals unchanged.',
        response: { 200: journalProjectionReportSchema, ...errorResponses },
      },
    },
    async (request) => accounting.projectJournal(principalOf(request)),
  );

  app.get(
    '/v1/me/instances/:instanceId/holdings',
    {
      preHandler: read,
      schema: {
        tags: ['accounting'],
        summary: 'Strategy-attributed holdings of one instance (lots, FIFO)',
        description:
          'The open lots attributed to the instance per asset, their remaining quantity, the cost basis they carry in the stablecoin (bookkeeping, not a valuation or tax figure) and the fees they paid; the status says whether the wallet’s last reconciliation matched. A token counts towards one instance only; single buys and sells stay wallet holdings.',
        params: instanceParams,
        response: { 200: instanceHoldingsResponseSchema, ...errorResponses },
      },
    },
    async (request) => accounting.instanceHoldings(principalOf(request), request.params.instanceId),
  );

  app.post(
    '/v1/me/intents/:intentId/receipts',
    {
      preHandler: interactive,
      config: issueRateLimit,
      schema: {
        tags: ['accounting'],
        summary: 'Issue a signed receipt for an intent (idempotent per kind and state)',
        description:
          'A decision receipt records the acknowledged plan, its hash, the policy decisions and the approved limits; an execution receipt additionally records the message hashes, chain signatures and finality, the observed fills and fees and the failure or recovery status. The body is canonical JSON signed with the platform’s current Ed25519 receipt key; the same intent, kind and state answer the existing receipt (200). PROVIDER_UNAVAILABLE when no signing key is configured.',
        params: intentParams,
        body: z.object({ kind: receiptKindSchema.default('execution') }),
        response: { 200: receiptSchema, 201: receiptSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await accounting.issueReceipt(
        principalOf(request),
        request.params.intentId,
        request.body.kind,
        request.id,
      );
      reply.code(result.created ? 201 : 200);
      return result.receipt;
    },
  );

  app.get(
    '/v1/me/intents/:intentId/receipts',
    {
      preHandler: read,
      schema: {
        tags: ['accounting'],
        summary: 'Receipts issued for an intent, oldest first',
        params: intentParams,
        response: { 200: receiptListResponseSchema, ...errorResponses },
      },
    },
    async (request) => accounting.intentReceipts(principalOf(request), request.params.intentId),
  );

  app.get(
    '/v1/me/receipts',
    {
      preHandler: read,
      schema: {
        tags: ['accounting'],
        summary: 'The caller’s receipts, newest first (at most 100)',
        response: { 200: receiptListResponseSchema, ...errorResponses },
      },
    },
    async (request) => accounting.listReceipts(principalOf(request)),
  );

  app.post(
    '/v1/me/receipts/:receiptId/visibility',
    {
      preHandler: interactive,
      schema: {
        tags: ['accounting'],
        summary: 'Opt a receipt into or out of public reading',
        description:
          'A public receipt is readable without authentication at GET /v1/receipts/{receiptId} with its owner and actor identifiers redacted; the signature still verifies because redaction applies to the answer, not the signed body, which the reader receives complete only when authorised.',
        params: receiptParams,
        body: z.object({ public: z.boolean() }),
        response: { 200: receiptSchema, ...errorResponses },
      },
    },
    async (request) =>
      accounting.setReceiptPublic(
        principalOf(request),
        request.params.receiptId,
        request.body.public,
        request.id,
      ),
  );

  app.get(
    '/v1/receipts/keys',
    {
      schema: {
        tags: ['accounting'],
        summary: 'Verification keys for receipts (public)',
        description:
          'Every receipt signing key with its status: the active key and the retired ones, which still verify what they signed while active. The domain string is part of what is signed.',
        response: { 200: receiptKeysResponseSchema, ...errorResponses },
      },
    },
    async () => accounting.verificationKeys(),
  );

  app.get(
    '/v1/receipts/:receiptId',
    {
      schema: {
        tags: ['accounting'],
        summary: 'One receipt: complete for its owner and read-scoped agents, redacted when public',
        description:
          'Owners and their agents with portfolio:read receive the complete signed receipt. Anyone else receives it only when the owner opted it into public reading, with the owner and actor identifiers redacted; otherwise NOT_FOUND, so the existence of a private receipt is not revealed.',
        params: receiptParams,
        response: { 200: receiptSchema, ...errorResponses },
      },
    },
    async (request) => accounting.readReceipt(request.principal, request.params.receiptId),
  );
};
