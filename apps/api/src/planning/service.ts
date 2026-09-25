import { randomUUID } from 'node:crypto';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type ExecutionPlan,
  type FrozenLeg,
  type InstrumentDetail,
  type Intent,
  type IntentCreateRequest,
  type IntentListResponse,
  type IntentState,
  PLANNING_SCHEMA_VERSION,
  type PlanAcknowledgementRequest,
  type PlanSide,
  type PolicyDecision,
  type VenueQuote,
} from '@markov/contracts';
import {
  acknowledgePlan as acknowledgePlanRow,
  createIntent as createIntentRow,
  type Database,
  type ExecutionPlanRow,
  findIntent,
  findPlan,
  findPublicVersion,
  findStrategy,
  findVersionById,
  type IntentRow,
  insertOutboxEvent,
  insertPlan,
  insertVenueQuotes,
  listCurrentPreparedTransactions,
  listIntents,
  listWallets,
  markPlanStatus,
  recordAuditEvent,
  type StrategyVersionRow,
  transitionIntent,
  updatePreparedTransactionState,
} from '@markov/db';
import {
  allocateBudget,
  assemblePlan,
  canonicalJson,
  checkQuote,
  networkFeeBudget,
  PLANNABLE_STATES,
  type PlanLegInput,
  protocolFeeRaw,
  sha256Hex,
  type VenueAdapter,
  VenueQuoteError,
} from '@markov/planning';
import type { CatalogService } from '../catalog/service.js';
import { ApiError } from '../errors.js';
import type { FundingService } from '../funding/service.js';
import type { PolicyService } from '../policy/service.js';

/** An intent outlives its plans by a day at most; after that it is EXPIRED whatever its plans say. */
export const INTENT_TTL_SECONDS = 24 * 3600;
/** Price impact above which a quote is refused outright (the plan warns from 100 bps). */
export const PRICE_IMPACT_LIMIT_BPS = 300;
/** Slippage a plan is quoted at when the request leaves it to the platform; never above the owner's limit. */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_INTENTS_LISTED = 50;

export interface PlanningServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly catalog: CatalogService;
  readonly policy: PolicyService;
  readonly funding: FundingService;
  /** Null when no venue is configured: every plan build then fails closed with PROVIDER_UNAVAILABLE. */
  readonly venue: VenueAdapter | null;
  readonly genesisHash: string;
  readonly now?: () => Date;
}

export interface PlanningService {
  createIntent(
    principal: Principal,
    request: IntentCreateRequest,
    requestId: string,
  ): Promise<{ intent: Intent; created: boolean }>;
  listIntents(principal: Principal): Promise<IntentListResponse>;
  getIntent(principal: Principal, intentId: string): Promise<Intent>;
  buildPlan(principal: Principal, intentId: string, requestId: string): Promise<ExecutionPlan>;
  getPlan(principal: Principal, intentId: string, planId: string): Promise<ExecutionPlan>;
  acknowledgePlan(
    principal: Principal,
    intentId: string,
    planId: string,
    request: PlanAcknowledgementRequest,
    requestId: string,
  ): Promise<ExecutionPlan>;
  cancelIntent(principal: Principal, intentId: string, requestId: string): Promise<Intent>;
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

const OPEN_STATES: readonly IntentState[] = ['DRAFT', 'QUOTED', 'AWAITING_APPROVAL'];

/**
 * Execution planning (B09). An intent is the owner's request; a plan is the
 * immutable, hashed answer built from a conserved integer allocation, one
 * checked venue quote and one policy decision per constituent, the fee
 * policy and the wallet's observed funds. Building a plan reserves nothing
 * and moves nothing; acknowledging one binds the owner's review to its hash
 * so that what gets signed later (B10) is exactly what was reviewed.
 */
export function createPlanningService(deps: PlanningServiceDeps): PlanningService {
  const { config, db, catalog, policy, funding } = deps;
  const now = deps.now ?? (() => new Date());

  const strategyRef = (version: StrategyVersionRow | null): Intent['strategy'] =>
    version === null
      ? null
      : {
          strategyId: version.strategyId,
          versionId: version.id,
          versionNumber: version.versionNumber,
          title: version.title,
          manifestHash: version.manifestHash,
        };

  const toIntent = async (row: IntentRow): Promise<Intent> => {
    const version = row.versionId === null ? null : await findVersionById(db, row.versionId);
    return {
      intentId: row.id,
      schemaVersion: PLANNING_SCHEMA_VERSION,
      kind: row.kind as Intent['kind'],
      state: row.state as IntentState,
      stateReason: row.stateReason,
      wallet: { walletId: row.walletId, address: row.walletAddress },
      strategy: strategyRef(version),
      instrumentId: row.instrumentId,
      budget: {
        mint: row.budgetMint,
        symbol: row.budgetSymbol,
        decimals: row.budgetDecimals,
        rawAmount: row.budgetRaw,
      },
      budgetMode: row.budgetMode as Intent['budgetMode'],
      executionPreference: row.executionPreference as Intent['executionPreference'],
      approvalMode: row.approvalMode as Intent['approvalMode'],
      slippageBps: row.slippageBps,
      latestPlanId: row.latestPlanId,
      latestPlanHash: row.latestPlanHash,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  };

  const toPlan = (row: ExecutionPlanRow, at: Date): ExecutionPlan => ({
    ...row.plan,
    review: {
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedHash: row.acknowledgedHash,
      stagedAcknowledged: row.stagedAcknowledged,
    },
    status:
      row.status === 'valid' && row.expiresAt.getTime() <= at.getTime()
        ? 'expired'
        : (row.status as ExecutionPlan['status']),
  });

  /** The owner's intent, moved to EXPIRED first when its lifetime has passed while still open. */
  const requireIntent = async (userId: string, intentId: string, at: Date): Promise<IntentRow> => {
    const row = await findIntent(db, userId, intentId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no intent with that id');
    }
    if (OPEN_STATES.includes(row.state as IntentState) && row.expiresAt.getTime() <= at.getTime()) {
      const expired = await transitionIntent(db, {
        intentId: row.id,
        from: OPEN_STATES,
        to: 'EXPIRED',
        reason: `the intent expired at ${row.expiresAt.toISOString()}`,
        now: at,
      });
      return expired ?? row;
    }
    return row;
  };

  const requireAdmitted = async (
    instrumentId: string,
    label: string,
  ): Promise<InstrumentDetail> => {
    let instrument: InstrumentDetail;
    try {
      instrument = await catalog.getPublic(instrumentId);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        throw new ApiError('ASSET_NOT_ADMITTED', `${label} is not an admitted instrument any more`);
      }
      throw error;
    }
    if (instrument.status !== 'admitted') {
      throw new ApiError(
        'ASSET_NOT_ADMITTED',
        `${instrument.symbol} is ${instrument.status}${instrument.statusReason ? ` (${instrument.statusReason})` : ''}; only admitted instruments can be planned`,
      );
    }
    return instrument;
  };

  const audit = (
    principal: Principal,
    action: string,
    targetType: 'intent' | 'execution_plan',
    targetId: string,
    requestId: string,
    details: Record<string, unknown>,
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

  return {
    async createIntent(principal, request, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const stablecoin = config.funding.stablecoin;
      if (stablecoin === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          `no stablecoin mint is configured for ${config.solana.cluster}; intents are budgeted in the platform stablecoin`,
        );
      }
      const wallet = (await listWallets(db, userId)).find((row) => row.id === request.walletId);
      if (!wallet) {
        throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
      }
      if (BigInt(request.budget.rawAmount) <= 0n) {
        throw new ApiError('VALIDATION_FAILED', 'the budget must be positive', [
          { path: 'budget.rawAmount', message: 'must be at least 1 raw unit' },
        ]);
      }
      let version: StrategyVersionRow | null = null;
      let instrumentId: string | null = null;
      /** What the budget is denominated in: the stablecoin, or the instrument itself for a sell. */
      let budgetUnit = {
        mint: stablecoin.mint,
        symbol: stablecoin.symbol,
        decimals: stablecoin.decimals,
      };
      if (request.kind === 'basket_investment') {
        const versionId = request.strategyVersionId as string;
        const found = await findVersionById(db, versionId);
        if (!found) {
          throw new ApiError('NOT_FOUND', 'no frozen version with that id');
        }
        const owned = await findStrategy(db, userId, found.strategyId);
        if (!owned) {
          const isPublic = await findPublicVersion(db, found.strategyId, versionId);
          if (!isPublic) {
            throw new ApiError('NOT_FOUND', 'no frozen version with that id');
          }
        }
        if (found.legs.length === 0) {
          throw new ApiError('VALIDATION_FAILED', 'the version has no constituents to invest in');
        }
        version = found;
      } else {
        const instrument = await requireAdmitted(request.instrumentId as string, 'the instrument');
        instrumentId = instrument.instrumentId;
        if (request.kind === 'single_sell') {
          budgetUnit = {
            mint: instrument.mint,
            symbol: instrument.symbol,
            decimals: instrument.decimals,
          };
        }
      }
      const limits = await policy.limits(principal);
      const maxSlippage = limits.effective.maxSlippageBps;
      const slippageBps = request.slippageBps ?? Math.min(DEFAULT_SLIPPAGE_BPS, maxSlippage);
      if (slippageBps > maxSlippage) {
        throw new ApiError('VALIDATION_FAILED', 'slippage is above your limit', [
          {
            path: 'slippageBps',
            message: `at most ${maxSlippage} bps under your effective limits`,
          },
        ]);
      }
      const requestHash = sha256Hex(
        canonicalJson({
          schemaVersion: request.schemaVersion,
          kind: request.kind,
          strategyVersionId: request.strategyVersionId,
          instrumentId: request.instrumentId,
          walletId: request.walletId,
          budget: request.budget,
          budgetMode: request.budgetMode,
          executionPreference: request.executionPreference,
          approvalMode: request.approvalMode,
          slippageBps: request.slippageBps,
        }),
      );
      const outcome = await createIntentRow(db, {
        ownerUserId: userId,
        idempotencyKey: request.idempotencyKey,
        requestHash,
        schemaVersion: PLANNING_SCHEMA_VERSION,
        kind: request.kind,
        walletId: wallet.id,
        walletAddress: wallet.address,
        strategyId: version?.strategyId ?? null,
        versionId: version?.id ?? null,
        instrumentId,
        budget: {
          mint: budgetUnit.mint,
          symbol: budgetUnit.symbol,
          decimals: budgetUnit.decimals,
          raw: request.budget.rawAmount,
        },
        budgetMode: request.budgetMode,
        executionPreference: request.executionPreference,
        approvalMode: request.approvalMode,
        slippageBps,
        now: at,
        expiresAt: new Date(at.getTime() + INTENT_TTL_SECONDS * 1000),
      });
      if (outcome.kind === 'existing') {
        if (outcome.row.requestHash !== requestHash) {
          throw new ApiError(
            'IDEMPOTENCY_CONFLICT',
            `idempotency key ${request.idempotencyKey} was already used with a different request`,
          );
        }
        return { intent: await toIntent(outcome.row), created: false };
      }
      await audit(principal, 'planning.intent.created', 'intent', outcome.row.id, requestId, {
        kind: request.kind,
        budgetRaw: request.budget.rawAmount,
        budgetMode: request.budgetMode,
        walletId: wallet.id,
      });
      return { intent: await toIntent(outcome.row), created: true };
    },

    async listIntents(principal) {
      const userId = ownerOf(principal);
      const rows = await listIntents(db, userId, MAX_INTENTS_LISTED);
      const intents: Intent[] = [];
      for (const row of rows) {
        intents.push(await toIntent(row));
      }
      return { intents };
    },

    async getIntent(principal, intentId) {
      const userId = ownerOf(principal);
      return toIntent(await requireIntent(userId, intentId, now()));
    },

    async buildPlan(principal, intentId, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      if (!PLANNABLE_STATES.has(intent.state as IntentState)) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `the intent is ${intent.state}${intent.stateReason ? ` (${intent.stateReason})` : ''}; create a new intent`,
        );
      }
      const venue = deps.venue;
      if (venue === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'no execution venue is configured (EXECUTION_VENUE_PROVIDER); plans cannot be quoted',
        );
      }
      const side: PlanSide = intent.kind === 'single_sell' ? 'sell' : 'buy';
      const stablecoin = config.funding.stablecoin;
      if (stablecoin === null || (side === 'buy' && stablecoin.mint !== intent.budgetMint)) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'the configured stablecoin differs from the one the intent was budgeted in',
        );
      }

      // 1. The recipe: the pinned version's frozen legs, or the single instrument.
      let version: StrategyVersionRow | null = null;
      let recipe: readonly { instrumentId: string; weightBps: number }[];
      let cashWeightBps = 0;
      if (intent.kind === 'basket_investment') {
        version = await findVersionById(db, intent.versionId as string);
        if (!version) {
          throw new ApiError('NOT_FOUND', 'the pinned version no longer exists');
        }
        recipe = version.legs.map((leg: FrozenLeg) => ({
          instrumentId: leg.instrumentId,
          weightBps: leg.weightBps,
        }));
        cashWeightBps = version.cashWeightBps;
      } else {
        recipe = [{ instrumentId: intent.instrumentId as string, weightBps: 10_000 }];
      }
      const instruments: InstrumentDetail[] = [];
      for (const leg of recipe) {
        instruments.push(
          await requireAdmitted(leg.instrumentId, `constituent ${leg.instrumentId}`),
        );
      }
      const sold = side === 'sell' ? (instruments[0] as InstrumentDetail) : null;
      if (sold !== null && sold.mint !== intent.budgetMint) {
        throw new ApiError(
          'PLAN_CHANGED',
          'the instrument mint differs from the one the intent was budgeted in; create a new intent',
        );
      }

      // 2. Funds as the network reports them now; nothing is reserved.
      const funds = await funding.walletFunding(principal, intent.walletId);
      if (funds.stablecoin === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          funds.stablecoinUnavailableReason ?? 'stablecoin balance unavailable',
        );
      }
      const stablecoinRaw = BigInt(funds.stablecoin.raw);
      const lamports = BigInt(funds.sol.lamports);
      const rentExempt = BigInt(funds.requirements.rentExemptTokenAccountLamports);
      // What the plan spends: the stablecoin for buys, the instrument's own balance for a sell.
      const inputRaw =
        sold === null
          ? stablecoinRaw
          : (await funding.tokenBalance(principal, intent.walletId, sold.mint)).raw;

      // 3. Integer allocation, refused (not reshaped) when a route minimum is not met.
      const budgetRaw = BigInt(intent.budgetRaw);
      const budgetMode = intent.budgetMode as Intent['budgetMode'];
      const allocation = allocateBudget({
        budgetRaw,
        mode: budgetMode,
        legs: recipe.map((leg) => ({
          key: leg.instrumentId,
          weightBps: leg.weightBps,
          // Route minimums are documented in stablecoin units; a sell's input is the instrument.
          minimumInputRaw: side === 'buy' ? venue.minimumInputRaw : null,
        })),
        cashWeightBps,
        feeReserveRaw: side === 'buy' ? protocolFeeRaw(budgetRaw) : 0n,
      });
      if (!allocation.ok) {
        await audit(principal, 'planning.plan.refused', 'intent', intent.id, requestId, {
          code: allocation.code,
          minimumBudgetRaw: allocation.minimumBudgetRaw?.toString() ?? null,
        });
        throw new ApiError('VALIDATION_FAILED', allocation.message, [
          ...(allocation.minimumBudgetRaw === null
            ? []
            : [
                {
                  path: 'budget.rawAmount',
                  message: `the smallest workable budget is ${allocation.minimumBudgetRaw} raw ${stablecoin.symbol}`,
                },
              ]),
          ...allocation.shortfalls.map((shortfall) => ({
            path: `legs.${shortfall.key}`,
            message: `target ${shortfall.targetRaw} is below the route minimum of ${shortfall.minimumInputRaw}`,
          })),
        ]);
      }

      // 4. Funds preflight against the all-in spend and the SOL fee bound, before any venue call.
      const batches = recipe.length > 1 ? recipe.length : 1;
      const feeBound = networkFeeBudget({
        batches,
        signaturesPerBatch: 1,
        rentExemptTokenAccountLamports: rentExempt,
        newTokenAccounts: recipe.length,
      });
      const shortfalls: { path: string; message: string }[] = [];
      if (inputRaw < allocation.totalSpendRaw) {
        shortfalls.push({
          path: sold === null ? 'funds.stablecoin' : 'funds.instrument',
          message: `the plan spends up to ${allocation.totalSpendRaw} raw ${sold === null ? stablecoin.symbol : sold.symbol}; the wallet holds ${inputRaw}`,
        });
      }
      if (lamports < feeBound.totalLamportsMax) {
        shortfalls.push({
          path: 'funds.sol',
          message: `network fees and rent need up to ${feeBound.totalLamportsMax} lamports; the wallet holds ${lamports}`,
        });
      }
      if (shortfalls.length > 0) {
        throw new ApiError('INSUFFICIENT_FUNDS', 'the wallet cannot fund this plan', shortfalls);
      }

      // 5. One quote and one policy decision per constituent; every quote is checked before use.
      // Exposure declared to policy: the other legs as positions, and the cash the wallet keeps after the plan
      // (a sell leaves the stablecoin untouched until its output arrives).
      const cashAfterRaw =
        side === 'buy'
          ? stablecoinRaw - allocation.totalSpendRaw + allocation.cash.targetRaw
          : stablecoinRaw;
      const limits = await policy.limits(principal);
      const mode = venue.mode === 'fixture' ? 'fixture' : 'live';
      const planLegs: PlanLegInput[] = [];
      const decisions: PolicyDecision[] = [];
      const accepted: { legIndex: number; quote: VenueQuote }[] = [];
      for (const [index, leg] of allocation.legs.entries()) {
        const instrument = instruments[index] as InstrumentDetail;
        const inputMint = side === 'buy' ? stablecoin.mint : instrument.mint;
        const outputMint = side === 'buy' ? instrument.mint : stablecoin.mint;
        let quote: VenueQuote;
        try {
          quote = await venue.quote({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            venue: 'jupiter',
            inputMint,
            outputMint,
            inAmountRaw: leg.targetRaw.toString(),
            slippageBps: intent.slippageBps,
            swapMode: 'exact_in',
          });
        } catch (error) {
          if (error instanceof VenueQuoteError) {
            throw new ApiError(
              'PROVIDER_UNAVAILABLE',
              `the venue could not quote ${instrument.symbol} (${error.kind}): ${error.message}`,
            );
          }
          throw error;
        }
        const issues = checkQuote(quote, {
          inputMint,
          outputMint,
          targetInputRaw: leg.targetRaw,
          slippageBps: intent.slippageBps,
          maxSlippageBps: limits.effective.maxSlippageBps,
          maxQuoteAgeSeconds: limits.effective.maxQuoteAgeSeconds,
          maxPriceImpactBps: PRICE_IMPACT_LIMIT_BPS,
          mode,
          now: at,
        });
        if (issues.length > 0) {
          await insertVenueQuotes(db, [
            {
              intentId: intent.id,
              planId: null,
              legIndex: index,
              quote,
              accepted: false,
              issues,
              now: at,
            },
          ]);
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            `the venue quote for ${instrument.symbol} failed ${issues.length} check${issues.length === 1 ? '' : 's'} and was refused`,
            issues.map((issue) => ({
              path: `legs[${index}]`,
              message: `${issue.code}: ${issue.message}`,
            })),
          );
        }
        const decision = await policy.evaluate(
          principal,
          {
            stage: 'quote',
            side,
            instrumentId: instrument.instrumentId,
            // Stablecoin notional: what a buy spends, what a sell is expected to receive.
            notionalUsdcRaw: side === 'buy' ? quote.inAmountRaw : quote.outAmountRaw,
            intentId: `${intent.id}:${index}`,
            venue: 'jupiter',
            slippageBps: intent.slippageBps,
            quoteObservedAt: quote.observedAt,
            exposure: {
              source: 'caller_declared',
              observedAt: funds.observedAt,
              positions: allocation.legs
                .filter((_, other) => other !== index)
                .map((other) => ({
                  instrumentId: other.key,
                  notionalUsdcRaw: other.targetRaw.toString(),
                })),
              cashUsdcRaw: cashAfterRaw.toString(),
            },
            reserve: false,
          },
          requestId,
        );
        if (decision.outcome !== 'allow') {
          await insertVenueQuotes(db, [
            {
              intentId: intent.id,
              planId: null,
              legIndex: index,
              quote,
              accepted: false,
              issues: decision.denials.map((denial) => ({
                code: denial.code,
                message: denial.message,
              })),
              now: at,
            },
          ]);
          throw new ApiError(
            'POLICY_DENIED',
            `policy denied the ${instrument.symbol} leg`,
            decision.denials.map((denial) => ({
              path: `legs[${index}]`,
              message: `${denial.code}: ${denial.message}`,
            })),
          );
        }
        decisions.push(decision);
        accepted.push({ legIndex: index, quote });
        planLegs.push({
          instrumentId: instrument.instrumentId,
          symbol: instrument.symbol,
          issuer: instrument.issuer,
          mint: instrument.mint,
          tokenProgram: instrument.tokenProgram,
          decimals: instrument.decimals,
          weightBps: leg.weightBps,
          targetInputRaw: leg.targetRaw,
          quote,
          policyDecision: {
            decisionId: decision.decisionId,
            policyVersion: decision.evidence.policyVersion,
            expiresAt: decision.expiresAt,
          },
        });
      }

      // 6. The immutable plan, hashed over its binding fields.
      const first = decisions[0] as PolicyDecision;
      const plan = assemblePlan({
        planId: randomUUID(),
        intentId: intent.id,
        kind: intent.kind as Intent['kind'],
        side,
        mode,
        network: { cluster: config.solana.cluster, genesisHash: deps.genesisHash },
        wallet: { walletId: intent.walletId, address: intent.walletAddress },
        strategy:
          version === null
            ? null
            : {
                strategyId: version.strategyId,
                versionId: version.id,
                versionNumber: version.versionNumber,
                manifestHash: version.manifestHash,
              },
        input: {
          mint: intent.budgetMint,
          symbol: intent.budgetSymbol,
          decimals: intent.budgetDecimals,
          budgetRaw,
          budgetMode,
        },
        stablecoin: {
          mint: stablecoin.mint,
          symbol: stablecoin.symbol,
          decimals: stablecoin.decimals,
        },
        allocation,
        legs: planLegs,
        fees: {
          feePayer: intent.walletAddress,
          rentExemptTokenAccountLamports: rentExempt,
          newTokenAccounts: recipe.length,
        },
        funds: {
          observedAt: funds.observedAt,
          slot: funds.slot,
          stablecoinRaw,
          inputRaw,
          lamports,
        },
        evidence: {
          eligibilityDecisionId: first.evidence.eligibilityDecisionId,
          policyVersion: first.evidence.policyVersion,
          instrumentUpdatedAt: instruments.map((instrument) => instrument.updatedAt),
        },
        createdAt: at,
      });
      const row = await insertPlan(db, {
        intentId: intent.id,
        ownerUserId: userId,
        planHash: plan.planHash,
        mode,
        plan,
        expiresAt: new Date(plan.validity.expiresAt),
        now: at,
      });
      await insertVenueQuotes(
        db,
        accepted.map((entry) => ({
          intentId: intent.id,
          planId: plan.planId,
          legIndex: entry.legIndex,
          quote: entry.quote,
          accepted: true,
          issues: [],
          now: at,
        })),
      );
      const moved = await transitionIntent(db, {
        intentId: intent.id,
        from: [...PLANNABLE_STATES],
        to: 'QUOTED',
        reason: null,
        latestPlan: { id: plan.planId, hash: plan.planHash },
        now: at,
      });
      if (!moved) {
        await markPlanStatus(db, plan.planId, 'superseded');
        throw new ApiError('PLAN_CHANGED', 'the intent changed while the plan was being built');
      }
      await audit(principal, 'planning.plan.built', 'execution_plan', plan.planId, requestId, {
        intentId: intent.id,
        planHash: plan.planHash,
        mode,
        legs: plan.legs.length,
        grouping: plan.grouping.mode,
        totalSpendRaw: plan.input.totalSpendRaw,
        expiresAt: plan.validity.expiresAt,
      });
      return toPlan(row, at);
    },

    async getPlan(principal, intentId, planId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      const row = await findPlan(db, userId, planId);
      if (!row || row.intentId !== intent.id) {
        throw new ApiError('NOT_FOUND', 'no plan with that id for this intent');
      }
      return toPlan(row, at);
    },

    async acknowledgePlan(principal, intentId, planId, request, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      const row = await findPlan(db, userId, planId);
      if (!row || row.intentId !== intent.id) {
        throw new ApiError('NOT_FOUND', 'no plan with that id for this intent');
      }
      if (row.status === 'superseded') {
        throw new ApiError('PLAN_CHANGED', 'a newer plan exists for this intent; review that one');
      }
      if (row.status === 'expired' || row.expiresAt.getTime() <= at.getTime()) {
        if (row.status === 'valid') {
          await markPlanStatus(db, row.id, 'expired');
        }
        throw new ApiError(
          'QUOTE_EXPIRED',
          `the plan expired at ${row.expiresAt.toISOString()}; build a new plan`,
        );
      }
      if (request.planHash !== row.planHash) {
        throw new ApiError(
          'PLAN_CHANGED',
          'the hash you reviewed is not the hash of this plan; read the plan again before acknowledging',
        );
      }
      if (row.plan.grouping.acknowledgementRequired && !request.stagedAcknowledged) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'this plan is staged and needs explicit acknowledgement',
          [
            {
              path: 'stagedAcknowledged',
              message: `${row.plan.grouping.batches.length} transactions land one by one; set stagedAcknowledged to accept partial completion`,
            },
          ],
        );
      }
      if (intent.state === 'AWAITING_APPROVAL' && row.acknowledgedHash === request.planHash) {
        return toPlan(row, at);
      }
      if (intent.state !== 'QUOTED' && intent.state !== 'AWAITING_APPROVAL') {
        throw new ApiError(
          'VALIDATION_FAILED',
          `the intent is ${intent.state}; it cannot be acknowledged`,
        );
      }
      const updated = await acknowledgePlanRow(db, {
        planId: row.id,
        hash: request.planHash,
        stagedAcknowledged: request.stagedAcknowledged,
        now: at,
      });
      if (!updated) {
        throw new ApiError('PLAN_CHANGED', 'the plan changed while it was being acknowledged');
      }
      const moved = await transitionIntent(db, {
        intentId: intent.id,
        from: ['QUOTED', 'AWAITING_APPROVAL'],
        to: 'AWAITING_APPROVAL',
        reason: `plan ${row.planHash.slice(0, 16)} acknowledged; a wallet signature (B10) is the next step`,
        now: at,
      });
      if (!moved) {
        throw new ApiError(
          'PLAN_CHANGED',
          'the intent changed while the plan was being acknowledged',
        );
      }
      await audit(principal, 'planning.plan.acknowledged', 'execution_plan', row.id, requestId, {
        intentId: intent.id,
        planHash: row.planHash,
        stagedAcknowledged: request.stagedAcknowledged,
      });
      return toPlan(updated, at);
    },

    async cancelIntent(principal, intentId, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      if (intent.state === 'CANCELLED' || intent.state === 'CANCEL_REQUESTED') {
        return toIntent(intent);
      }
      if (intent.state === 'AUTHORIZED') {
        // A prepared, unsigned transaction is withdrawn; nothing was broadcast.
        const moved = await transitionIntent(db, {
          intentId: intent.id,
          from: ['AUTHORIZED'],
          to: 'CANCELLED',
          reason: 'cancelled by the owner before any signature was submitted',
          now: at,
        });
        if (!moved) {
          throw new ApiError('PLAN_CHANGED', 'the intent changed while it was being cancelled');
        }
        if (intent.latestPlanId !== null) {
          for (const row of await listCurrentPreparedTransactions(db, intent.latestPlanId)) {
            if (row.state === 'prepared' || row.state === 'expired') {
              await updatePreparedTransactionState(db, row.id, 'cancelled', at);
            }
          }
        }
        await insertOutboxEvent(db, {
          kind: 'execution.cancelled',
          aggregateType: 'intent',
          aggregateId: intent.id,
          ownerUserId: userId,
          payload: { fromState: intent.state },
          now: at,
        });
        await audit(principal, 'planning.intent.cancelled', 'intent', intent.id, requestId, {
          fromState: intent.state,
        });
        return toIntent(moved);
      }
      if (
        intent.state === 'SUBMITTING' ||
        intent.state === 'SUBMITTED' ||
        intent.state === 'UNKNOWN_REQUIRES_RECONCILIATION'
      ) {
        // Signed bytes may already be with a node: the request is recorded, the transaction can
        // still land, and reconciliation settles CANCELLED (expired unseen) or the landed outcome.
        const moved = await transitionIntent(db, {
          intentId: intent.id,
          from: ['SUBMITTING', 'SUBMITTED', 'UNKNOWN_REQUIRES_RECONCILIATION'],
          to: 'CANCEL_REQUESTED',
          reason:
            'cancellation requested after broadcast; the signed transaction can still land and reconciliation decides',
          now: at,
        });
        if (!moved) {
          throw new ApiError('PLAN_CHANGED', 'the intent changed while it was being cancelled');
        }
        await audit(principal, 'planning.intent.cancel_requested', 'intent', intent.id, requestId, {
          fromState: intent.state,
        });
        return toIntent(moved);
      }
      const moved = await transitionIntent(db, {
        intentId: intent.id,
        from: OPEN_STATES,
        to: 'CANCELLED',
        reason: 'cancelled by the owner before any signature',
        now: at,
      });
      if (!moved) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `the intent is ${intent.state}; only open intents can be cancelled`,
        );
      }
      await audit(principal, 'planning.intent.cancelled', 'intent', intent.id, requestId, {
        fromState: intent.state,
      });
      return toIntent(moved);
    },
  };
}
