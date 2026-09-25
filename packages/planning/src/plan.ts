import type { ExecutionPlan, IntentKind, PlanMode, PlanSide, VenueQuote } from '@markov/contracts';
import type { Allocation } from './allocate.js';
import { canonicalJson, sha256Hex } from './canonical.js';
import {
  BASE_FEE_LAMPORTS_PER_SIGNATURE,
  FEE_POLICY_VERSION,
  networkFeeBudget,
  PROTOCOL_FEE_BPS,
} from './fees.js';

/** Price impact above which a plan carries a warning (the refusal limit is the caller's). */
export const PRICE_IMPACT_WARNING_BPS = 100;
export const PLAN_HASH_DOMAIN_PREFIX = 'markov-execution-plan/v1/';

export interface PlanLegInput {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly issuer: ExecutionPlan['legs'][number]['issuer'];
  readonly mint: string;
  readonly tokenProgram: ExecutionPlan['legs'][number]['tokenProgram'];
  readonly decimals: number;
  readonly weightBps: number;
  /** Raw units of the leg's input: the stablecoin for buys, the instrument for a sell. */
  readonly targetInputRaw: bigint;
  readonly quote: VenueQuote;
  readonly policyDecision: {
    readonly decisionId: string;
    readonly policyVersion: string | null;
    readonly expiresAt: string;
  };
}

export interface PlanAssemblyInput {
  readonly planId: string;
  readonly intentId: string;
  readonly kind: IntentKind;
  /** Buys spend the stablecoin for the constituents; a sell spends the instrument for the stablecoin. */
  readonly side: PlanSide;
  readonly mode: PlanMode;
  readonly network: ExecutionPlan['network'];
  readonly wallet: ExecutionPlan['wallet'];
  readonly strategy: ExecutionPlan['strategy'];
  readonly input: {
    readonly mint: string;
    readonly symbol: string;
    readonly decimals: number;
    readonly budgetRaw: bigint;
    readonly budgetMode: ExecutionPlan['input']['budgetMode'];
  };
  /** The platform stablecoin: what buys spend and what a sell receives. */
  readonly stablecoin: {
    readonly mint: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly allocation: Allocation;
  readonly legs: readonly PlanLegInput[];
  readonly fees: {
    readonly feePayer: string;
    readonly rentExemptTokenAccountLamports: bigint;
    /** Constituents whose token account may not exist yet (worst case: all of them). */
    readonly newTokenAccounts: number;
  };
  readonly funds: {
    readonly observedAt: string;
    readonly slot: number;
    readonly stablecoinRaw: bigint;
    /** The wallet's balance of the plan's input asset (equals `stablecoinRaw` for buys). */
    readonly inputRaw: bigint;
    readonly lamports: bigint;
  };
  readonly evidence: {
    readonly eligibilityDecisionId: string | null;
    readonly policyVersion: string | null;
    readonly instrumentUpdatedAt: readonly string[];
  };
  readonly createdAt: Date;
}

const str = (value: bigint): string => value.toString();

function earliest(instants: readonly string[]): string {
  return instants.reduce((min, value) => (Date.parse(value) < Date.parse(min) ? value : min));
}

function latest(instants: readonly string[]): string {
  return instants.reduce((max, value) => (Date.parse(value) > Date.parse(max) ? value : max));
}

/**
 * Assembles the immutable plan document from a conserved allocation, one
 * checked quote per leg and the fee policy. Single-leg plans are one
 * transaction (atomic by construction); multi-leg plans are staged, one
 * batch per constituent in weight order, until whole-basket composition and
 * simulation exist (B11). Every bound is an integer in raw base units.
 */
export function assemblePlan(input: PlanAssemblyInput): ExecutionPlan {
  const staged = input.legs.length > 1;
  if (input.side === 'sell' && staged) {
    throw new Error('a sell plan has exactly one leg');
  }
  const legs: ExecutionPlan['legs'] = input.legs.map((leg, index) => ({
    legIndex: index,
    instrumentId: leg.instrumentId,
    symbol: leg.symbol,
    issuer: leg.issuer,
    mint: leg.mint,
    tokenProgram: leg.tokenProgram,
    decimals: leg.decimals,
    side: input.side,
    weightBps: leg.weightBps,
    inputMint: input.side === 'buy' ? input.stablecoin.mint : leg.mint,
    inputSymbol: input.side === 'buy' ? input.stablecoin.symbol : leg.symbol,
    inputDecimals: input.side === 'buy' ? input.stablecoin.decimals : leg.decimals,
    outputMint: input.side === 'buy' ? leg.mint : input.stablecoin.mint,
    outputSymbol: input.side === 'buy' ? leg.symbol : input.stablecoin.symbol,
    outputDecimals: input.side === 'buy' ? leg.decimals : input.stablecoin.decimals,
    targetInputRaw: str(leg.targetInputRaw),
    maxInputRaw: leg.quote.inAmountRaw,
    expectedOutputRaw: leg.quote.outAmountRaw,
    minimumOutputRaw: leg.quote.otherAmountThresholdRaw,
    slippageBps: leg.quote.slippageBps,
    priceImpactBps: leg.quote.priceImpactBps,
    quote: leg.quote,
    policyDecision: {
      decisionId: leg.policyDecision.decisionId,
      outcome: 'allow',
      policyVersion: leg.policyDecision.policyVersion,
      expiresAt: leg.policyDecision.expiresAt,
    },
    batch: staged ? index : 0,
  }));
  const dustRaw = input.legs.reduce(
    (sum, leg) => sum + (leg.targetInputRaw - BigInt(leg.quote.inAmountRaw)),
    0n,
  );
  const residualCashRaw = input.allocation.cash.targetRaw + dustRaw;
  const maxTotalInputRaw = legs.reduce((sum, leg) => sum + BigInt(leg.maxInputRaw), 0n);
  const batches = staged ? legs.length : 1;
  const network = networkFeeBudget({
    batches,
    signaturesPerBatch: 1,
    rentExemptTokenAccountLamports: input.fees.rentExemptTokenAccountLamports,
    newTokenAccounts: input.fees.newTokenAccounts,
  });
  const totalSpendRaw = input.allocation.totalSpendRaw;
  let spent = 0n;
  const groupingBatches: ExecutionPlan['grouping']['batches'] = staged
    ? legs.map((leg) => {
        spent += BigInt(leg.maxInputRaw);
        return {
          batch: leg.batch,
          legIndexes: [leg.legIndex],
          description: `Buy ${leg.symbol} with at most ${leg.maxInputRaw} raw ${input.input.symbol}`,
          worstCaseSpentRaw: str(spent),
          remainingCashRaw: str(totalSpendRaw - spent),
        };
      })
    : [
        {
          batch: 0,
          legIndexes: legs.map((leg) => leg.legIndex),
          description:
            input.side === 'sell'
              ? `One transaction selling at most ${legs[0]?.maxInputRaw ?? '0'} raw ${input.input.symbol} of ${legs.map((leg) => leg.symbol).join(', ')} for at least ${legs[0]?.minimumOutputRaw ?? '0'} raw ${input.stablecoin.symbol}`
              : `One transaction buying ${legs.map((leg) => leg.symbol).join(', ')}`,
          worstCaseSpentRaw: str(maxTotalInputRaw),
          remainingCashRaw: str(totalSpendRaw - maxTotalInputRaw),
        },
      ];
  const quoteExpiries = legs.map((leg) => leg.quote.expiresAt);
  const policyExpiries = legs.map((leg) => leg.policyDecision.expiresAt);
  const quotesExpireAt = earliest(quoteExpiries);
  const policyExpiresAt = earliest(policyExpiries);
  const expiresAt = earliest([quotesExpireAt, policyExpiresAt]);
  const shortfalls: ExecutionPlan['funds']['shortfalls'] = [];
  if (input.funds.inputRaw < totalSpendRaw) {
    shortfalls.push({
      asset: input.side === 'sell' ? 'instrument' : 'stablecoin',
      requiredRaw: str(totalSpendRaw),
      observedRaw: str(input.funds.inputRaw),
    });
  }
  if (input.funds.lamports < network.totalLamportsMax) {
    shortfalls.push({
      asset: 'sol',
      requiredRaw: str(network.totalLamportsMax),
      observedRaw: str(input.funds.lamports),
    });
  }
  const warnings: string[] = [];
  if (input.mode === 'fixture') {
    warnings.push(
      'Fixture mode: quotes are synthetic and no route exists on any network; nothing here can be executed.',
    );
  }
  if (staged) {
    warnings.push(
      `Staged execution: ${legs.length} separate transactions land one by one; a later batch can fail or expire after earlier ones filled, and no budget is moved between constituents on its own.`,
    );
  }
  for (const leg of legs) {
    if (leg.priceImpactBps !== null && leg.priceImpactBps > PRICE_IMPACT_WARNING_BPS) {
      warnings.push(
        `${leg.symbol}: price impact ${leg.priceImpactBps} bps is above ${PRICE_IMPACT_WARNING_BPS} bps.`,
      );
    }
  }
  if (dustRaw > 0n) {
    warnings.push(
      `${dustRaw} raw ${input.input.symbol} of the allocation stays as cash (dust the routes did not consume).`,
    );
  }
  const plan: Omit<ExecutionPlan, 'planHash'> = {
    planId: input.planId,
    schemaVersion: '1',
    intentId: input.intentId,
    kind: input.kind,
    side: input.side,
    mode: input.mode,
    network: input.network,
    wallet: input.wallet,
    strategy: input.strategy,
    input: {
      mint: input.input.mint,
      symbol: input.input.symbol,
      decimals: input.input.decimals,
      budgetRaw: str(input.input.budgetRaw),
      budgetMode: input.input.budgetMode,
      investableRaw: str(input.allocation.investableRaw),
      totalSpendRaw: str(totalSpendRaw),
    },
    allocation: {
      method: 'largest_remainder',
      legs: input.allocation.legs.map((entry) => ({
        key: entry.key,
        weightBps: entry.weightBps,
        exactFloorRaw: str(entry.exactFloorRaw),
        roundingRaw: str(entry.roundingRaw),
        targetRaw: str(entry.targetRaw),
      })),
      cash: {
        key: input.allocation.cash.key,
        weightBps: input.allocation.cash.weightBps,
        exactFloorRaw: str(input.allocation.cash.exactFloorRaw),
        roundingRaw: str(input.allocation.cash.roundingRaw),
        targetRaw: str(input.allocation.cash.targetRaw),
      },
      feeReserveRaw: str(input.allocation.feeReserveRaw),
      dustRaw: str(dustRaw),
      investableRaw: str(input.allocation.investableRaw),
      sumRaw: str(input.allocation.sumRaw),
      conserved: true,
    },
    legs,
    fees: {
      feePayer: input.fees.feePayer,
      network: {
        unit: 'lamports',
        baseFeeLamportsPerSignature: str(BASE_FEE_LAMPORTS_PER_SIGNATURE),
        signaturesPerBatch: 1,
        batches,
        baseFeeLamports: str(network.baseFeeLamports),
        priorityFeeCapLamports: str(network.priorityFeeCapLamports),
        rentExemptTokenAccountLamports: str(input.fees.rentExemptTokenAccountLamports),
        newTokenAccounts: input.fees.newTokenAccounts,
        rentLamports: str(network.rentLamports),
        totalLamportsMax: str(network.totalLamportsMax),
      },
      protocol: {
        feePolicyVersion: FEE_POLICY_VERSION,
        feeBps: PROTOCOL_FEE_BPS,
        feeRaw: str(input.allocation.feeReserveRaw),
      },
    },
    grouping: {
      mode: staged ? 'staged' : 'atomic',
      batches: groupingBatches,
      acknowledgementRequired: staged,
      note: staged
        ? 'Whole-basket composition and simulation arrive with B11; until then a basket is a sequence of single-constituent transactions, each reviewed against the approved bounds before it is built.'
        : 'One transaction: it lands entirely or not at all. It is simulated before submission (B10); no simulation has happened yet.',
    },
    bounds: {
      maxTotalInputRaw: str(maxTotalInputRaw),
      maxTotalLamports: str(network.totalLamportsMax),
      minimumOutputs: legs.map((leg) => ({
        legIndex: leg.legIndex,
        mint: leg.mint,
        minimumOutputRaw: leg.minimumOutputRaw,
      })),
      residualCashRaw: str(residualCashRaw),
    },
    validity: {
      quotesObservedAt: latest(legs.map((leg) => leg.quote.observedAt)),
      quotesExpireAt,
      policyExpiresAt,
      expiresAt,
      simulation: null,
      evidence: {
        eligibilityDecisionId: input.evidence.eligibilityDecisionId,
        policyVersion: input.evidence.policyVersion,
        policyDecisionIds: legs.map((leg) => leg.policyDecision.decisionId),
        quoteRefs: legs.map((leg) => leg.quote.quoteRef),
        instrumentUpdatedAt: [...input.evidence.instrumentUpdatedAt],
      },
    },
    funds: {
      observedAt: input.funds.observedAt,
      slot: input.funds.slot,
      stablecoinRaw: str(input.funds.stablecoinRaw),
      inputRaw: str(input.funds.inputRaw),
      lamports: str(input.funds.lamports),
      sufficient: shortfalls.length === 0,
      shortfalls,
    },
    warnings,
    review: { acknowledgedAt: null, acknowledgedHash: null, stagedAcknowledged: false },
    status: 'valid',
    createdAt: input.createdAt.toISOString(),
  };
  return { ...plan, planHash: planHashOf(plan) };
}

/** The economically binding fields of a plan: what an approval and a signature commit to. */
export function planBinding(plan: Omit<ExecutionPlan, 'planHash'>): Record<string, unknown> {
  return {
    schemaVersion: plan.schemaVersion,
    intentId: plan.intentId,
    kind: plan.kind,
    side: plan.side,
    mode: plan.mode,
    network: plan.network,
    walletAddress: plan.wallet.address,
    strategy: plan.strategy
      ? { versionId: plan.strategy.versionId, manifestHash: plan.strategy.manifestHash }
      : null,
    input: plan.input,
    allocation: plan.allocation,
    legs: plan.legs.map((leg) => ({
      legIndex: leg.legIndex,
      instrumentId: leg.instrumentId,
      mint: leg.mint,
      tokenProgram: leg.tokenProgram,
      side: leg.side,
      inputMint: leg.inputMint,
      outputMint: leg.outputMint,
      targetInputRaw: leg.targetInputRaw,
      maxInputRaw: leg.maxInputRaw,
      expectedOutputRaw: leg.expectedOutputRaw,
      minimumOutputRaw: leg.minimumOutputRaw,
      slippageBps: leg.slippageBps,
      quote: {
        venue: leg.quote.venue,
        mode: leg.quote.mode,
        quoteRef: leg.quote.quoteRef,
        observedAt: leg.quote.observedAt,
        expiresAt: leg.quote.expiresAt,
        routePlan: leg.quote.routePlan,
      },
      policyDecisionId: leg.policyDecision.decisionId,
      batch: leg.batch,
    })),
    fees: plan.fees,
    grouping: { mode: plan.grouping.mode, batches: plan.grouping.batches },
    bounds: plan.bounds,
    validity: {
      quotesExpireAt: plan.validity.quotesExpireAt,
      policyExpiresAt: plan.validity.policyExpiresAt,
      expiresAt: plan.validity.expiresAt,
    },
  };
}

export function planHashDomain(genesisHash: string): string {
  return `${PLAN_HASH_DOMAIN_PREFIX}${genesisHash}`;
}

/** sha256(domain || 0x00 || canonical JSON of the binding fields), hex. */
export function planHashOf(plan: Omit<ExecutionPlan, 'planHash'>): string {
  return sha256Hex(
    planHashDomain(plan.network.genesisHash),
    new Uint8Array([0]),
    canonicalJson(planBinding(plan)),
  );
}

/** True when the stored hash equals the hash recomputed from the document. */
export function verifyPlanHash(plan: ExecutionPlan): boolean {
  const { planHash, ...rest } = plan;
  return planHashOf(rest) === planHash;
}
