import { randomUUID } from 'node:crypto';
import {
  AGENT_TOOLS,
  type AnyToolDefinition,
  type CompanionModelAdapter,
  type CompanionModelContext,
  type CompanionToolView,
  type CompanionTranscriptEntry,
  describeTool,
  digestOf,
  emptyUsage,
  explainDecision,
  findTool,
  jsonSchemaOf,
  mayCall,
  outputIsStale,
  outputRefsOf,
  outputTextOf,
  parseToolInput,
  promptHashOf,
  remainingOf,
  summarizeInput,
  toolsFor,
  validateAnswer,
  validateSources,
} from '@markov/agent-tools';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type AgentProposal,
  type AgentToolCatalog,
  type AgentToolName,
  type BasketProposeInput,
  COMPANION_PROVENANCE_REDACTION,
  type CompanionOutput,
  type CompanionProvenance,
  type CompanionRun,
  type CompanionRunRequest,
  type CompanionSource,
  type CompanionStep,
  type CompanionUsage,
  companyKey,
  type EventListResponse,
  type EventQuery,
  type ExposuresCompareInput,
  type IndicativePlanInput,
  type InstrumentDetail,
  type InstrumentsFactsInput,
  type InstrumentsSearchInput,
  type Intent,
  type InvestmentProposeInput,
  type MarkEvent,
  PLANNING_SCHEMA_VERSION,
  type PolicyExplainInput,
  PROPOSAL_TTL_DAYS,
  type ProposalKind,
  type ProposalOpenResponse,
  type ProposalQuery,
  type ProposedIntentRequest,
  type QuoteRequestInput,
  type RebalanceProposeInput,
  type ReceiptsReadInput,
  type ThesisDraftInput,
  type WeightsValidateInput,
} from '@markov/contracts';
import {
  type AgentProposalRow,
  type CompanionRunRow,
  cancelCompanionRun,
  companionCostSince,
  createCompanionRun,
  createProposal,
  currentRevision,
  type Database,
  dismissProposal as dismissProposalRow,
  findCompanionRun,
  findInstance,
  findProposal,
  findProposalByDedupKey,
  findStrategy,
  findThesis,
  findVersionById,
  finishCompanionRun,
  latestMarkEventSeq,
  listCompanionRuns,
  listMarkEvents,
  listProposals,
  listSources,
  listWallets,
  type MarkEventRow,
  openProposal as openProposalRow,
  pgErrorCode,
  readDraft,
  recordAuditEvent,
  recordMarkEvent,
  startCompanionRun,
} from '@markov/db';
import { sizeRebalanceLegs } from '@markov/maintenance';
import type { AccountingService } from '../accounting/service.js';
import type { AnalyticsService } from '../analytics/service.js';
import type { CatalogService } from '../catalog/service.js';
import { ApiError } from '../errors.js';
import type { FundingService } from '../funding/service.js';
import type { PlanningService } from '../planning/service.js';
import type { PolicyService } from '../policy/service.js';
import type { ResearchService } from '../research/service.js';
import type { StrategyService } from '../strategies/service.js';

/** A model step is bounded in time; the run fails rather than hangs. */
export const STEP_TIMEOUT_MS = 20_000;
/** The whole run, tool calls included. */
export const RUN_DEADLINE_MS = 60_000;
/** The most output text a model may read from one tool call. */
export const TOOL_OUTPUT_TEXT_MAX = 4_000;
/** The rolling window the daily cost cap is measured over. */
export const COST_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const TOOL_CATALOG_NOTE =
  'Each tool is a typed façade over one domain method and runs with the caller’s own authority: the same scope checks, owner scoping and policy as the ordinary routes. None can sign, approve, spend, change a limit or act for another account; the most a tool produces is a proposal the owner opens through the same review as a manual action.';
export const PROPOSAL_NOTE =
  'A proposal is a request for the owner’s review. Only the owner opens it: an investment proposal then becomes an ordinary intent that still needs a plan, an acknowledgement and a wallet signature; a basket proposal is a draft in the builder; a rebalance proposal opens into one reviewed sell or buy intent per sized leg. Agents, models and schedules cannot open, approve or execute a proposal.';
export const EVENTS_NOTE =
  'Facts about the owner’s own resources, in sequence, for the software and physical Mark I. An event never carries authority: nothing proceeds because an event was read, and financial state stays on the intent, the plan and the attempt it names.';
export const REBALANCE_OPEN_NOTE =
  'Each leg is an ordinary intent in your name: plan it, acknowledge the plan and sign with your wallet, one at a time, sells first. Nothing was quoted or submitted by opening.';

export const REVIEW_NOTES: Record<ProposalKind, string> = {
  strategy_draft:
    'Open the draft in the builder to review, edit, freeze or discard it; nothing is published or invested by this proposal.',
  investment:
    'Opening creates an intent in your name; a plan is then built, reviewed and acknowledged by you and signed by your wallet. Nothing is bought until then.',
  rebalance:
    'A drift report with sized legs. Opening creates one ordinary sell or buy intent per leg in your name, each planned, acknowledged and signed by you; this proposal itself places no order.',
};

export interface AgentServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly catalog: CatalogService;
  readonly research: ResearchService;
  readonly strategies: StrategyService;
  readonly planning: PlanningService;
  readonly policy: PolicyService;
  readonly funding: FundingService;
  readonly accounting: AccountingService;
  readonly analytics: AnalyticsService;
  /** Null when no companion model provider is configured: tools work, runs answer 503. */
  readonly model: CompanionModelAdapter | null;
  readonly now?: () => Date;
}

export interface ToolInvocation {
  readonly tool: AgentToolName;
  readonly invokedAt: string;
  readonly output: unknown;
}

/**
 * Where a proposal comes from when a schedule occurrence makes it (B16): the
 * dedup key lets a restarted maintenance pass find the proposal it already
 * made, and the expiry follows the occurrence's review window.
 */
export interface ProposalSource {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly dedupKey: string;
  readonly expiresAt: Date;
}

export interface AgentService {
  catalog(principal: Principal): AgentToolCatalog;
  /** Validates, authorises and runs one tool with the principal's own authority. */
  invoke(
    principal: Principal,
    tool: string,
    input: unknown,
    requestId: string,
    runId?: string | null,
    source?: ProposalSource | null,
  ): Promise<ToolInvocation>;
  createRun(
    principal: Principal,
    request: CompanionRunRequest,
    requestId: string,
  ): Promise<CompanionRun>;
  getRun(principal: Principal, runId: string): Promise<CompanionRun>;
  listRuns(principal: Principal): Promise<CompanionRun[]>;
  cancelRun(principal: Principal, runId: string, requestId: string): Promise<CompanionRun>;
  listProposals(principal: Principal, query: ProposalQuery): Promise<AgentProposal[]>;
  getProposal(principal: Principal, proposalId: string): Promise<AgentProposal>;
  /** Owner only: opens the proposal, creating the intent for an investment proposal. */
  openProposal(
    principal: Principal,
    proposalId: string,
    requestId: string,
  ): Promise<ProposalOpenResponse>;
  dismissProposal(
    principal: Principal,
    proposalId: string,
    requestId: string,
  ): Promise<AgentProposal>;
  listEvents(principal: Principal, query: EventQuery): Promise<EventListResponse>;
}

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

function requireOwner(principal: Principal): string {
  if (principal.class !== 'user' || principal.userId === null) {
    throw new ApiError('FORBIDDEN', 'only the owner’s own session can do this; agents propose');
  }
  return principal.userId;
}

function labelOf(principal: Principal): string {
  return `${principal.class}:${principal.id}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function runOf(row: CompanionRunRow): CompanionRun {
  return {
    runId: row.id,
    ownerUserId: row.ownerUserId,
    principal: row.principal,
    status: row.status as CompanionRun['status'],
    question: row.question,
    context: row.context,
    budget: row.budget,
    usage: row.usage ?? null,
    provenance: row.provenance ?? null,
    output: row.output ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function eventOf(row: MarkEventRow): MarkEvent {
  return {
    eventId: row.id,
    seq: row.seq,
    kind: row.kind as MarkEvent['kind'],
    subject: { type: row.subjectType as MarkEvent['subject']['type'], id: row.subjectId },
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
  };
}

const PROPOSE_TOOLS = new Set<string>([
  'basket.propose',
  'investment.propose',
  'rebalance.propose',
]);

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const {
    config,
    db,
    catalog,
    research,
    strategies,
    planning,
    policy,
    funding,
    accounting,
    analytics,
  } = deps;
  const now = deps.now ?? (() => new Date());

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType,
      targetId,
      requestId,
      details,
    });

  const proposalOf = (row: AgentProposalRow, at: Date): AgentProposal => {
    const status =
      row.status === 'proposed' && row.expiresAt.getTime() <= at.getTime()
        ? 'expired'
        : (row.status as AgentProposal['status']);
    const base = {
      proposalId: row.id,
      ownerUserId: row.ownerUserId,
      runId: row.runId,
      scheduleId: row.scheduleId,
      occurrenceId: row.occurrenceId,
      createdBy: row.createdBy,
      status,
      summary: row.summary,
      review: { requires: 'owner' as const, note: row.reviewNote },
      intentId: row.intentId,
      openedAt: row.openedAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    switch (row.kind as ProposalKind) {
      case 'strategy_draft':
        return {
          ...base,
          kind: 'strategy_draft',
          payload: row.payload as Extract<AgentProposal, { kind: 'strategy_draft' }>['payload'],
        };
      case 'investment':
        return {
          ...base,
          kind: 'investment',
          payload: row.payload as Extract<AgentProposal, { kind: 'investment' }>['payload'],
        };
      default:
        return {
          ...base,
          kind: 'rebalance',
          payload: row.payload as Extract<AgentProposal, { kind: 'rebalance' }>['payload'],
        };
    }
  };

  const propose = async (input: {
    principal: Principal;
    runId: string | null;
    source: ProposalSource | null;
    kind: ProposalKind;
    summary: string;
    payload: Record<string, unknown>;
    requestId: string;
  }): Promise<AgentProposal> => {
    const ownerUserId = ownerOf(input.principal);
    const at = now();
    let row: AgentProposalRow;
    try {
      row = await createProposal(db, {
        ownerUserId,
        runId: input.runId,
        scheduleId: input.source?.scheduleId ?? null,
        occurrenceId: input.source?.occurrenceId ?? null,
        dedupKey: input.source?.dedupKey ?? null,
        createdBy: labelOf(input.principal),
        kind: input.kind,
        summary: input.summary.slice(0, 300),
        payload: input.payload,
        reviewNote: REVIEW_NOTES[input.kind],
        expiresAt:
          input.source?.expiresAt ??
          new Date(at.getTime() + PROPOSAL_TTL_DAYS[input.kind] * DAY_MS),
        now: at,
      });
    } catch (error) {
      // A restarted maintenance pass proposing the same occurrence again finds the proposal it made.
      if (input.source !== null && pgErrorCode(error) === '23505') {
        const existing = await findProposalByDedupKey(db, input.source.dedupKey);
        if (existing !== null && existing.ownerUserId === ownerUserId) {
          return proposalOf(existing, at);
        }
      }
      throw error;
    }
    const payload = {
      proposalId: row.id,
      kind: input.kind,
      createdBy: row.createdBy,
      runId: input.runId,
      expiresAt: row.expiresAt.toISOString(),
    };
    await recordMarkEvent(db, {
      ownerUserId,
      kind: 'proposal.created',
      subject: { type: 'proposal', id: row.id },
      payload,
      now: at,
    });
    await recordMarkEvent(db, {
      ownerUserId,
      kind: 'review.required',
      subject: { type: 'proposal', id: row.id },
      payload,
      now: at,
    });
    await audit(
      input.principal,
      'agent.proposal.create',
      'agent_proposal',
      row.id,
      input.requestId,
      {
        kind: input.kind,
        runId: input.runId,
      },
    );
    return proposalOf(row, at);
  };

  /**
   * The reviewed intents behind a rebalance proposal (B16): one ordinary sell or buy per sized leg,
   * created as the owner under an idempotent key, so opening twice answers the same intents. Each
   * still needs its own plan, acknowledgement and signature; nothing here quotes or submits.
   */
  const rebalanceIntentsOf = async (
    principal: Principal,
    proposal: Extract<AgentProposal, { kind: 'rebalance' }>,
    requestId: string,
  ): Promise<NonNullable<ProposalOpenResponse['rebalance']>> => {
    const intents: NonNullable<ProposalOpenResponse['rebalance']>['intents'] = [];
    for (const leg of proposal.payload.legs) {
      const kind = leg.side === 'sell' ? ('single_sell' as const) : ('single_buy' as const);
      const created = await planning.createIntent(
        principal,
        {
          schemaVersion: PLANNING_SCHEMA_VERSION,
          kind,
          strategyVersionId: null,
          instrumentId: leg.instrumentId,
          walletId: proposal.payload.walletId,
          budget: { rawAmount: leg.rawAmount },
          budgetMode: 'all_in_stablecoin',
          executionPreference: 'atomic_or_explicit_staged_review',
          approvalMode: 'owner_each_plan',
          slippageBps: null,
          continuationOfIntentId: null,
          idempotencyKey: `proposal:${proposal.proposalId}:${leg.instrumentId}:${leg.side}`,
        },
        requestId,
      );
      intents.push({
        intentId: created.intent.intentId,
        kind,
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        rawAmount: leg.rawAmount,
        created: created.created,
      });
    }
    return { intents, note: REBALANCE_OPEN_NOTE };
  };

  const requireWallet = async (userId: string, walletId: string) => {
    const wallet = (await listWallets(db, userId)).find((row) => row.id === walletId);
    if (!wallet) {
      throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
    }
    return wallet;
  };

  /** Every tool, as one call into the domain service that owns the operation. */
  const execute = async (
    principal: Principal,
    tool: AnyToolDefinition,
    input: unknown,
    context: { requestId: string; runId: string | null; source: ProposalSource | null },
  ): Promise<unknown> => {
    const at = now();
    switch (tool.name) {
      case 'instruments.search': {
        const query = input as InstrumentsSearchInput;
        const page = await catalog.listPublic({
          q: query.q,
          issuer: query.issuer,
          kind: query.kind,
          limit: query.limit,
        });
        return {
          instruments: page.instruments,
          nextCursor: page.nextCursor,
          asOf: at.toISOString(),
        };
      }
      case 'instruments.facts': {
        const { instrumentId } = input as InstrumentsFactsInput;
        const instrument = await catalog.getPublic(instrumentId);
        const corporateActions = await catalog.listInstrumentActions(instrumentId, true);
        return {
          instrument,
          corporateActions,
          stale: instrument.referencePrice === null || instrument.referencePrice.stale,
          asOf: at.toISOString(),
        };
      }
      case 'exposures.compare': {
        const { instrumentIds } = input as ExposuresCompareInput;
        const rows: InstrumentDetail[] = [];
        for (const id of new Set(instrumentIds)) {
          rows.push(await catalog.getPublic(id));
        }
        const byCompany = new Map<string, { companyName: string; instrumentIds: string[] }>();
        for (const row of rows) {
          const key = companyKey(row.companyName);
          const group = byCompany.get(key) ?? { companyName: row.companyName, instrumentIds: [] };
          group.instrumentIds.push(row.instrumentId);
          byCompany.set(key, group);
        }
        return {
          rows,
          sameCompany: [...byCompany.values()].filter((group) => group.instrumentIds.length > 1),
          stale: rows
            .filter((row) => row.referencePrice === null || row.referencePrice.stale)
            .map((row) => row.instrumentId),
          asOf: at.toISOString(),
        };
      }
      case 'thesis.draft': {
        const draft = input as ThesisDraftInput;
        return research.createThesis(
          principal,
          {
            visibility: 'private',
            revision: {
              title: draft.title,
              claim: draft.claim,
              statements: [],
              counterarguments: draft.counterarguments,
              instruments: draft.instrumentIds.map((instrumentId) => ({
                instrumentId,
                note: null,
              })),
              subjects: draft.subjects.map((name) => ({ name, note: null })),
              privateNotes: null,
            },
          },
          context.requestId,
        );
      }
      case 'weights.validate':
        return strategies.validateContent((input as WeightsValidateInput).content);
      case 'plan.indicative':
        return planning.indicative(principal, input as IndicativePlanInput);
      case 'quote.request':
        return planning.quoteIndicative(principal, input as QuoteRequestInput);
      case 'policy.explain': {
        const request = input as PolicyExplainInput;
        const fresh = request.decisionId === null;
        const decision = fresh
          ? await policy.evaluate(
              principal,
              {
                stage: 'quote',
                side: request.side,
                instrumentId: request.instrumentId as string,
                notionalUsdcRaw: request.notionalUsdcRaw as string,
                intentId: `explain:${randomUUID()}`,
                venue: 'jupiter',
                slippageBps: request.slippageBps ?? 50,
                quoteObservedAt: null,
                exposure: { source: 'none', observedAt: null, positions: [], cashUsdcRaw: null },
                reserve: false,
              },
              context.requestId,
            )
          : await policy.decision(principal, request.decisionId as string);
        const explained = explainDecision(decision);
        return { decision, fresh, explanation: explained.explanation, summary: explained.summary };
      }
      case 'basket.propose': {
        const request = input as BasketProposeInput;
        const validation = await strategies.validateContent(request.content);
        if (!validation.valid) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'the basket breaks a strategy rule; nothing was proposed',
            validation.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => ({ path: issue.path, message: `${issue.code}: ${issue.message}` })),
          );
        }
        const detail = await strategies.create(
          principal,
          { content: request.content },
          context.requestId,
        );
        const legs = [];
        for (const leg of request.content.legs) {
          const instrument = await catalog.getPublic(leg.instrumentId);
          legs.push({
            instrumentId: leg.instrumentId,
            symbol: instrument.symbol,
            weightBps: leg.weightBps,
          });
        }
        return propose({
          principal,
          runId: context.runId,
          source: context.source,
          kind: 'strategy_draft',
          summary:
            request.summary ??
            `Basket draft "${request.content.title}": ${legs.length} constituent${legs.length === 1 ? '' : 's'}, ${(request.content.cashWeightBps / 100).toFixed(2)}% cash`,
          payload: {
            strategyId: detail.strategy.strategyId,
            title: request.content.title,
            legs,
            cashWeightBps: request.content.cashWeightBps,
            validation,
          },
          requestId: context.requestId,
        });
      }
      case 'investment.propose': {
        const request = input as InvestmentProposeInput;
        const userId = ownerOf(principal);
        const wallet = await requireWallet(userId, request.walletId);
        const indicative = await planning.indicative(principal, {
          strategyVersionId: request.strategyVersionId,
          instrumentId: request.instrumentId,
          budget: request.budget,
          budgetMode: request.budgetMode,
        });
        if (!indicative.allocation.ok) {
          throw new ApiError(
            'VALIDATION_FAILED',
            indicative.allocation.message ?? 'the budget cannot be allocated',
            indicative.allocation.minimumBudgetRaw === null
              ? []
              : [
                  {
                    path: 'budget.rawAmount',
                    message: `the smallest workable budget is ${indicative.allocation.minimumBudgetRaw} raw ${indicative.input.symbol}`,
                  },
                ],
          );
        }
        // The exposure the planner will declare: the other legs as positions and the cash the wallet
        // keeps after the plan, from the network as it stands now (null when it cannot be observed).
        let cashAfterRaw: string | null = null;
        try {
          const funds = await funding.walletFunding(principal, wallet.id);
          if (funds.stablecoin !== null) {
            cashAfterRaw = (
              BigInt(funds.stablecoin.raw) -
              BigInt(indicative.input.totalSpendRaw) +
              BigInt(indicative.cash.targetRaw)
            ).toString();
            if (cashAfterRaw.startsWith('-')) {
              cashAfterRaw = '0';
            }
          }
        } catch (error) {
          if (!(error instanceof ApiError)) {
            throw error;
          }
        }
        // One pre-quote policy decision per constituent, without a reservation; a denial refuses the proposal.
        let firstDecisionId: string | null = null;
        for (const [index, leg] of indicative.legs.entries()) {
          const decision = await policy.evaluate(
            principal,
            {
              stage: 'quote',
              side: 'buy',
              instrumentId: leg.instrumentId,
              notionalUsdcRaw: leg.targetInputRaw,
              intentId: `proposal:${randomUUID()}:${index}`,
              venue: 'jupiter',
              slippageBps: request.slippageBps ?? 50,
              quoteObservedAt: null,
              exposure: {
                source: 'caller_declared',
                observedAt: at.toISOString(),
                positions: indicative.legs
                  .filter((_, other) => other !== index)
                  .map((other) => ({
                    instrumentId: other.instrumentId,
                    notionalUsdcRaw: other.targetInputRaw,
                  })),
                cashUsdcRaw: cashAfterRaw,
              },
              reserve: false,
            },
            context.requestId,
          );
          firstDecisionId ??= decision.decisionId;
          if (decision.outcome !== 'allow') {
            throw new ApiError(
              'POLICY_DENIED',
              `policy denied the ${leg.symbol} leg; nothing was proposed`,
              decision.denials.map((denial) => ({
                path: `legs[${index}]`,
                message: `${denial.code}: ${denial.message}`,
              })),
            );
          }
        }
        const proposed: ProposedIntentRequest = {
          kind: indicative.kind,
          strategyVersionId: request.strategyVersionId,
          instrumentId: request.instrumentId,
          walletId: wallet.id,
          budget: request.budget,
          budgetMode: request.budgetMode,
          executionPreference: 'atomic_or_explicit_staged_review',
          approvalMode: 'owner_each_plan',
          slippageBps: request.slippageBps,
        };
        const target = indicative.strategy
          ? `"${indicative.strategy.title}" version ${indicative.strategy.versionNumber}`
          : (indicative.legs[0]?.symbol ?? 'the instrument');
        return propose({
          principal,
          runId: context.runId,
          source: context.source,
          kind: 'investment',
          summary:
            request.summary ??
            `Invest ${request.budget.rawAmount} raw ${indicative.input.symbol} in ${target}; opens as an intent for your review`,
          payload: {
            request: proposed,
            indicative,
            policyDecisionId: firstDecisionId as string,
            policyOutcome: 'allow',
          },
          requestId: context.requestId,
        });
      }
      case 'rebalance.propose': {
        const { instanceId } = input as RebalanceProposeInput;
        const allocation = await analytics.instanceAllocation(principal, instanceId);
        if (allocation.stale) {
          await recordMarkEvent(db, {
            ownerUserId: ownerOf(principal),
            kind: 'data.stale',
            subject: { type: 'instance', id: instanceId },
            payload: {
              instanceId,
              assets: allocation.rows
                .filter((row) => row.issues.length > 0)
                .map((row) => ({
                  asset: row.asset,
                  issues: row.issues.map((issue) => issue.code),
                })),
            },
            now: at,
          });
        }
        const suggestions = allocation.rows
          .filter((row) => row.instrumentId !== null && row.driftBps !== null && row.driftBps !== 0)
          .map((row) => ({
            instrumentId: row.instrumentId as string,
            symbol: row.symbol,
            side: (row.driftBps as number) > 0 ? ('sell' as const) : ('buy' as const),
            driftBps: row.driftBps as number,
          }));
        const summary = allocation.complete
          ? `Rebalance review: largest drift ${((allocation.largestDriftBps ?? 0) / 100).toFixed(2)}% against version ${allocation.versionNumber}${allocation.exceedsThreshold ? ' (above the creator’s threshold)' : ''}`
          : `Rebalance review: drift unknown, ${allocation.rows.filter((row) => row.issues.length > 0).length} leg(s) unpriced or stale`;
        // Reviewed rebalance legs (B16): sells of the excess, buys of the shortfall, each an ordinary intent once opened.
        const legs = sizeRebalanceLegs(allocation, {
          stablecoinDecimals: config.funding.stablecoin?.decimals ?? 6,
        });
        return propose({
          principal,
          runId: context.runId,
          source: context.source,
          kind: 'rebalance',
          summary,
          payload: {
            instanceId: allocation.instanceId,
            walletId: allocation.walletId,
            strategyId: allocation.strategyId,
            versionId: allocation.versionId,
            versionNumber: allocation.versionNumber,
            allocation,
            suggestions,
            legs,
            executable: legs.length > 0,
          },
          requestId: context.requestId,
        });
      }
      case 'receipts.read': {
        const request = input as ReceiptsReadInput;
        if (request.receiptId !== null) {
          return { receipts: [await accounting.readReceipt(principal, request.receiptId)] };
        }
        const list = await accounting.listReceipts(principal);
        return { receipts: list.receipts.slice(0, request.limit) };
      }
      default:
        throw new ApiError('NOT_FOUND', 'no such tool');
    }
  };

  const invoke: AgentService['invoke'] = async (
    principal,
    toolName,
    input,
    requestId,
    runId = null,
    source = null,
  ) => {
    const tool = findTool(toolName);
    if (tool === null) {
      throw new ApiError('NOT_FOUND', `no such tool: ${toolName.slice(0, 80)}`);
    }
    if (!mayCall(tool, principal)) {
      throw new ApiError(
        'FORBIDDEN',
        `this credential cannot call ${tool.name} (needs ${tool.scopes.join(', ')})`,
      );
    }
    const parsed = parseToolInput(tool, input);
    if (!parsed.ok) {
      throw new ApiError('VALIDATION_FAILED', `the ${tool.name} input is invalid`, [
        ...parsed.issues,
      ]);
    }
    const output = await execute(principal, tool, parsed.value, { requestId, runId, source });
    if (tool.mutation) {
      await audit(principal, 'agent.tool.invoke', 'agent_tool', tool.name, requestId, {
        inputDigest: digestOf(parsed.value),
        inputSummary: summarizeInput(parsed.value),
        runId,
      });
    }
    return { tool: tool.name, invokedAt: now().toISOString(), output };
  };

  /** What the model may see of the run's context: titles, claims, excerpts and public instrument facts; never lots, wallets or credentials. */
  const loadContext = async (
    principal: Principal,
    context: CompanionRunRequest['context'],
  ): Promise<{ model: CompanionModelContext; seen: CompanionSource[] }> => {
    const userId = ownerOf(principal);
    const seen: CompanionSource[] = [];
    let thesis: CompanionModelContext['thesis'] = null;
    if (context.thesisId !== null) {
      const row = await findThesis(db, userId, context.thesisId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no thesis with that id');
      }
      const revision = await currentRevision(db, row);
      const sources = (await listSources(db, row.id)).filter(
        (source) => source.status === 'fetched',
      );
      thesis = {
        thesisId: row.id,
        title: revision.title,
        claim: revision.claim,
        sources: sources.map((source) => ({
          sourceId: source.id,
          role: source.role,
          excerpt: source.excerpt ?? '',
        })),
      };
      seen.push({ kind: 'thesis', id: row.id, label: revision.title.slice(0, 200) });
      for (const source of sources) {
        seen.push({
          kind: 'source',
          id: source.id,
          label: (source.title ?? source.url).slice(0, 200),
        });
      }
    }
    let instance: CompanionModelContext['instance'] = null;
    if (context.instanceId !== null) {
      const row = await findInstance(db, userId, context.instanceId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no instance with that id');
      }
      const version = await findVersionById(db, row.pinnedVersionId);
      instance = {
        instanceId: row.id,
        label: row.label,
        versionTitle: version?.title ?? '',
        versionNumber: version?.versionNumber ?? 0,
      };
      seen.push({
        kind: 'instance',
        id: row.id,
        label: (row.label ?? version?.title ?? 'instance').slice(0, 200),
      });
    }
    let strategy: CompanionModelContext['strategy'] = null;
    if (context.strategyId !== null) {
      const row = await findStrategy(db, userId, context.strategyId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no strategy with that id');
      }
      const draft = await readDraft(db, row.id);
      strategy = { strategyId: row.id, title: draft.content.title };
    }
    const instruments: {
      instrumentId: string;
      symbol: string;
      companyName: string;
      issuer: string;
    }[] = [];
    for (const instrumentId of new Set(context.instrumentIds)) {
      const instrument = await catalog.getPublic(instrumentId);
      instruments.push({
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        companyName: instrument.companyName,
        issuer: instrument.issuer,
      });
      seen.push({
        kind: 'instrument',
        id: instrument.instrumentId,
        label: `${instrument.symbol} · ${instrument.companyName} · ${instrument.issuer}`.slice(
          0,
          200,
        ),
      });
    }
    return { model: { thesis, instance, strategy, instruments }, seen };
  };

  const requireRun = async (principal: Principal, runId: string): Promise<CompanionRunRow> => {
    const row = await findCompanionRun(db, ownerOf(principal), runId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no companion run with that id');
    }
    return row;
  };

  const requireProposal = async (
    principal: Principal,
    proposalId: string,
  ): Promise<AgentProposalRow> => {
    const row = await findProposal(db, ownerOf(principal), proposalId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no proposal with that id');
    }
    return row;
  };

  return {
    catalog(principal) {
      return {
        tools: toolsFor(principal).map(describeTool),
        principal: { class: principal.class, scopes: [...principal.scopes] },
        note: TOOL_CATALOG_NOTE,
      };
    },

    invoke,

    async createRun(principal, request, requestId) {
      const model = deps.model;
      if (model === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'no companion model provider is configured; the typed tools work without one',
        );
      }
      const ownerUserId = ownerOf(principal);
      const at = now();
      const spent = await companionCostSince(
        db,
        ownerUserId,
        new Date(at.getTime() - COST_WINDOW_MS),
      );
      if (spent >= config.companion.dailyCostLimitMicros) {
        throw new ApiError(
          'BUDGET_EXHAUSTED',
          `this account spent ${spent} of ${config.companion.dailyCostLimitMicros} cost micros on companion runs in the last day; try again later`,
        );
      }
      const { model: modelContext, seen: contextSeen } = await loadContext(
        principal,
        request.context,
      );
      const tools = toolsFor(principal);
      const toolViews: CompanionToolView[] = tools.map((tool) => ({
        name: tool.name,
        summary: tool.summary,
        inputSchema: jsonSchemaOf(tool.input, 'input'),
      }));
      const queued = await createCompanionRun(db, {
        ownerUserId,
        principal: labelOf(principal),
        question: request.question,
        context: request.context,
        budget: request.budget,
        now: at,
      });
      const started = await startCompanionRun(db, queued.id, now());
      if (!started) {
        return runOf((await findCompanionRun(db, ownerUserId, queued.id)) ?? queued);
      }
      const startedAtMs = Date.now();
      const usage: CompanionUsage = emptyUsage();
      const steps: CompanionStep[] = [];
      const transcript: CompanionTranscriptEntry[] = [];
      const seen: CompanionSource[] = [...contextSeen];
      const refusals: CompanionOutput['refusals'] = [];
      const proposalIds: string[] = [];
      let stale = false;
      const promptHash = promptHashOf({
        question: request.question,
        context: modelContext,
        tools: toolViews,
        remaining: remainingOf(request.budget, usage),
      });
      const provenanceOf = (): CompanionProvenance => ({
        provider: model.provider,
        model: model.model,
        modelVersion: model.modelVersion,
        promptHash,
        steps,
        redaction: COMPANION_PROVENANCE_REDACTION,
      });
      const finish = async (
        status: 'succeeded' | 'failed',
        output: CompanionOutput | null,
        error: string | null,
      ): Promise<CompanionRunRow | null> => {
        usage.durationMs = Date.now() - startedAtMs;
        return finishCompanionRun(db, {
          runId: queued.id,
          status,
          usage,
          provenance: provenanceOf(),
          output,
          error: error === null ? null : error.slice(0, 300),
          now: now(),
        });
      };

      let finished: CompanionRunRow | null = null;
      try {
        let budgetRefusals = 0;
        for (let seq = 0; ; seq += 1) {
          const current = await findCompanionRun(db, ownerUserId, queued.id);
          if (current === null || current.status !== 'running') {
            // Cancelled meanwhile: the result is dropped, the cancelled state is the answer.
            finished = current;
            break;
          }
          if (Date.now() - startedAtMs > RUN_DEADLINE_MS) {
            finished = await finish('failed', null, 'the run exceeded its time budget');
            break;
          }
          if (budgetRefusals > 1) {
            finished = await finish(
              'failed',
              null,
              'the model kept calling tools after its tool-call budget was spent',
            );
            break;
          }
          const step = await withTimeout(
            model.step({
              question: request.question,
              context: modelContext,
              tools: toolViews,
              transcript,
              remaining: remainingOf(request.budget, usage),
            }),
            STEP_TIMEOUT_MS,
            'the model',
          );
          usage.inputTokens += Math.max(0, Math.trunc(step.usage.inputTokens));
          usage.outputTokens += Math.max(0, Math.trunc(step.usage.outputTokens));
          usage.costMicros += Math.max(0, Math.trunc(step.usage.costMicros));
          if (usage.costMicros > request.budget.maxCostMicros) {
            finished = await finish('failed', null, 'the run exceeded its cost budget');
            break;
          }
          if (step.kind === 'answer') {
            const { answer, truncated } = validateAnswer(step.text, request.budget.maxOutputChars);
            usage.outputChars = answer.length;
            const cited = validateSources(step.sources, seen);
            finished = await finish(
              'succeeded',
              {
                answer,
                truncated,
                sources: cited.sources,
                proposalIds,
                refusals,
                stale,
              },
              null,
            );
            break;
          }
          const stepStarted = Date.now();
          const toolName = String(step.tool).slice(0, 80);
          const inputDigest = digestOf(step.input);
          const inputSummary = summarizeInput(step.input);
          const refuse = (code: string, message: string) => {
            const clean = message.slice(0, 300);
            steps.push({
              seq,
              tool: toolName,
              inputDigest,
              inputSummary,
              outcome: 'refused',
              code,
              message: clean,
              outputDigest: null,
              outputChars: 0,
              durationMs: Date.now() - stepStarted,
            });
            transcript.push({
              seq,
              tool: toolName,
              input: step.input,
              outcome: 'refused',
              code,
              message: clean,
              outputText: null,
              refs: [],
            });
            refusals.push({ tool: toolName, code, message: clean });
          };
          if (usage.toolCalls >= request.budget.maxToolCalls) {
            budgetRefusals += 1;
            refuse(
              'BUDGET_EXHAUSTED',
              'the tool-call budget of this run is spent; answer from what you have',
            );
            continue;
          }
          usage.toolCalls += 1;
          let result: ToolInvocation;
          try {
            result = await invoke(principal, toolName, step.input, requestId, queued.id);
          } catch (error) {
            if (error instanceof ApiError) {
              refuse(error.code, error.message);
              continue;
            }
            throw error;
          }
          const outputText = outputTextOf(result.output, TOOL_OUTPUT_TEXT_MAX);
          const refs = outputRefsOf(result.tool, result.output);
          seen.push(...refs);
          if (outputIsStale(result.tool, result.output)) {
            stale = true;
          }
          if (PROPOSE_TOOLS.has(result.tool)) {
            const proposalId = (result.output as { proposalId?: unknown }).proposalId;
            if (typeof proposalId === 'string') {
              proposalIds.push(proposalId);
            }
          }
          steps.push({
            seq,
            tool: result.tool,
            inputDigest,
            inputSummary,
            outcome: 'ok',
            code: null,
            message: 'ok',
            outputDigest: digestOf(result.output),
            outputChars: outputText.length,
            durationMs: Date.now() - stepStarted,
          });
          transcript.push({
            seq,
            tool: result.tool,
            input: step.input,
            outcome: 'ok',
            code: null,
            message: 'ok',
            outputText,
            refs,
          });
        }
      } catch (error) {
        finished = await finish(
          'failed',
          null,
          error instanceof Error ? error.message : 'the companion run failed',
        );
      }
      const final = finished ?? (await findCompanionRun(db, ownerUserId, queued.id)) ?? queued;
      if (stale && final.status === 'succeeded') {
        await recordMarkEvent(db, {
          ownerUserId,
          kind: 'data.stale',
          subject: { type: 'run', id: queued.id },
          payload: {
            runId: queued.id,
            tools: steps.filter((step) => step.outcome === 'ok').map((step) => step.tool),
          },
          now: now(),
        });
      }
      await audit(principal, 'companion.run.create', 'companion_run', queued.id, requestId, {
        status: final.status,
        provider: model.provider,
        model: model.model,
        promptHash,
        toolCalls: usage.toolCalls,
        refusals: refusals.length,
        costMicros: usage.costMicros,
        proposals: proposalIds.length,
      });
      return runOf(final);
    },

    async getRun(principal, runId) {
      return runOf(await requireRun(principal, runId));
    },

    async listRuns(principal) {
      return (await listCompanionRuns(db, ownerOf(principal))).map(runOf);
    },

    async cancelRun(principal, runId, requestId) {
      const ownerUserId = ownerOf(principal);
      const cancelled = await cancelCompanionRun(db, ownerUserId, runId, now());
      if (cancelled) {
        await audit(principal, 'companion.run.cancel', 'companion_run', runId, requestId);
        return runOf(cancelled);
      }
      return runOf(await requireRun(principal, runId));
    },

    async listProposals(principal, query) {
      const at = now();
      const rows = await listProposals(db, ownerOf(principal), query.limit);
      return rows
        .map((row) => proposalOf(row, at))
        .filter((proposal) => query.status === undefined || proposal.status === query.status);
    },

    async getProposal(principal, proposalId) {
      return proposalOf(await requireProposal(principal, proposalId), now());
    },

    async openProposal(principal, proposalId, requestId) {
      const ownerUserId = requireOwner(principal);
      const row = await requireProposal(principal, proposalId);
      const at = now();
      const current = proposalOf(row, at);
      if (current.status === 'opened') {
        const intent: Intent | null =
          row.intentId === null ? null : await planning.getIntent(principal, row.intentId);
        const rebalance =
          current.kind === 'rebalance'
            ? await rebalanceIntentsOf(principal, current, requestId)
            : null;
        return { proposal: current, intent, rebalance };
      }
      if (current.status === 'dismissed') {
        throw new ApiError('VALIDATION_FAILED', 'the proposal was dismissed; ask for a new one');
      }
      if (current.status === 'expired') {
        throw new ApiError('VALIDATION_FAILED', 'the proposal expired; ask for a new one');
      }
      let intent: Intent | null = null;
      let rebalance: ProposalOpenResponse['rebalance'] = null;
      if (current.kind === 'rebalance') {
        rebalance = await rebalanceIntentsOf(principal, current, requestId);
      }
      if (current.kind === 'investment') {
        const request = current.payload.request;
        // The same route as a manual intent, as the owner: plan, acknowledgement and signature follow.
        const created = await planning.createIntent(
          principal,
          {
            schemaVersion: PLANNING_SCHEMA_VERSION,
            kind: request.kind,
            strategyVersionId: request.strategyVersionId,
            instrumentId: request.instrumentId,
            walletId: request.walletId,
            budget: request.budget,
            budgetMode: request.budgetMode,
            executionPreference: request.executionPreference,
            approvalMode: request.approvalMode,
            slippageBps: request.slippageBps,
            continuationOfIntentId: null,
            idempotencyKey: `proposal:${row.id}`,
          },
          requestId,
        );
        intent = created.intent;
      }
      const opened = await openProposalRow(db, {
        ownerUserId,
        proposalId: row.id,
        intentId: intent?.intentId ?? null,
        now: at,
      });
      await audit(principal, 'agent.proposal.open', 'agent_proposal', row.id, requestId, {
        kind: row.kind,
        intentId: intent?.intentId ?? null,
      });
      return {
        proposal: proposalOf(opened ?? (await requireProposal(principal, proposalId)), at),
        intent,
        rebalance,
      };
    },

    async dismissProposal(principal, proposalId, requestId) {
      const ownerUserId = requireOwner(principal);
      const at = now();
      const dismissed = await dismissProposalRow(db, ownerUserId, proposalId, at);
      if (dismissed) {
        await audit(principal, 'agent.proposal.dismiss', 'agent_proposal', proposalId, requestId);
        return proposalOf(dismissed, at);
      }
      return proposalOf(await requireProposal(principal, proposalId), at);
    },

    async listEvents(principal, query) {
      if (
        (principal.class !== 'user' && principal.class !== 'device') ||
        principal.userId === null
      ) {
        throw new ApiError(
          'FORBIDDEN',
          'events are read by the owner’s session or a paired device',
        );
      }
      const ownerUserId = principal.userId;
      const [rows, latestSeq] = await Promise.all([
        listMarkEvents(db, ownerUserId, {
          after: query.after,
          limit: query.limit,
          kind: query.kind ?? null,
        }),
        latestMarkEventSeq(db, ownerUserId),
      ]);
      const events = rows.map(eventOf);
      const last = events[events.length - 1];
      return {
        events,
        nextAfter:
          last !== undefined && events.length === query.limit && last.seq < latestSeq
            ? last.seq
            : null,
        latestSeq,
        note: EVENTS_NOTE,
      };
    },
  };
}

export { AGENT_TOOLS };
