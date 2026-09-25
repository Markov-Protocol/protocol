import type { ExecutionPlan, VenueQuote } from '@markov/contracts';
import { executionPlanSchema } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  allocateBudget,
  assemblePlan,
  BASE_FEE_LAMPORTS_PER_SIGNATURE,
  canonicalJson,
  canTransition,
  checkQuote,
  FIXTURE_ROUTE_PROGRAM_ID,
  minimumOutputFor,
  networkFeeBudget,
  PLANNABLE_STATES,
  PRIORITY_FEE_CAP_LAMPORTS_PER_BATCH,
  planHashOf,
  routeProgramVerdict,
  TERMINAL_INTENT_STATES,
  verifyPlanHash,
} from '../src/index.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AERO = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const BIO = '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL';
const WALLET = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const NOW = new Date('2026-09-25T10:00:00.000Z');

function quote(overrides: Partial<VenueQuote> = {}): VenueQuote {
  const outAmountRaw = overrides.outAmountRaw ?? '27397260';
  return {
    schemaVersion: '1',
    venue: 'jupiter',
    mode: 'fixture',
    quoteRef: 'fixture:abc',
    inputMint: USDC,
    outputMint: AERO,
    inAmountRaw: '500000000',
    outAmountRaw,
    otherAmountThresholdRaw: minimumOutputFor(BigInt(outAmountRaw), 50).toString(),
    slippageBps: 50,
    priceImpactBps: 12,
    routePlan: [{ programId: FIXTURE_ROUTE_PROGRAM_ID, label: 'fixture-amm', percent: 100 }],
    contextSlot: 1000,
    observedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    sourceRef: 'fixture',
    ...overrides,
  };
}

const expectation = {
  inputMint: USDC,
  outputMint: AERO,
  targetInputRaw: 500_000_000n,
  slippageBps: 50,
  maxSlippageBps: 100,
  maxQuoteAgeSeconds: 60,
  maxPriceImpactBps: 300,
  mode: 'fixture' as const,
  now: NOW,
};

describe('checkQuote', () => {
  it('accepts a consistent fixture quote', () => {
    expect(checkQuote(quote(), expectation)).toEqual([]);
  });

  it('refuses every inconsistency it checks for', () => {
    const codes = (issues: ReturnType<typeof checkQuote>) => issues.map((issue) => issue.code);
    expect(codes(checkQuote(quote({ inputMint: BIO }), expectation))).toContain(
      'INPUT_MINT_MISMATCH',
    );
    expect(codes(checkQuote(quote({ outputMint: BIO }), expectation))).toContain(
      'OUTPUT_MINT_MISMATCH',
    );
    expect(codes(checkQuote(quote({ inAmountRaw: '500000001' }), expectation))).toContain(
      'INPUT_EXCEEDS_TARGET',
    );
    expect(codes(checkQuote(quote({ inAmountRaw: '0' }), expectation))).toContain('ZERO_INPUT');
    expect(
      codes(checkQuote(quote({ outAmountRaw: '0', otherAmountThresholdRaw: '0' }), expectation)),
    ).toContain('ZERO_OUTPUT');
    expect(codes(checkQuote(quote({ otherAmountThresholdRaw: '1' }), expectation))).toContain(
      'MINIMUM_OUTPUT_INCONSISTENT',
    );
    expect(
      codes(checkQuote(quote({ otherAmountThresholdRaw: '27397261' }), expectation)),
    ).toContain('MINIMUM_OUTPUT_INCONSISTENT');
    expect(codes(checkQuote(quote({ slippageBps: 75 }), expectation))).toContain(
      'SLIPPAGE_MISMATCH',
    );
    expect(
      codes(checkQuote(quote({ slippageBps: 150 }), { ...expectation, slippageBps: 150 })),
    ).toContain('SLIPPAGE_ABOVE_LIMIT');
    expect(
      codes(
        checkQuote(
          quote({ observedAt: new Date(NOW.getTime() - 61_000).toISOString() }),
          expectation,
        ),
      ),
    ).toContain('QUOTE_STALE');
    expect(codes(checkQuote(quote({ expiresAt: NOW.toISOString() }), expectation))).toContain(
      'QUOTE_EXPIRED',
    );
    expect(codes(checkQuote(quote({ priceImpactBps: 301 }), expectation))).toContain(
      'PRICE_IMPACT_ABOVE_LIMIT',
    );
    expect(
      codes(
        checkQuote(
          quote({ routePlan: [{ programId: FIXTURE_ROUTE_PROGRAM_ID, label: 'x', percent: 60 }] }),
          expectation,
        ),
      ),
    ).toContain('ROUTE_PERCENT_TOTAL');
    expect(
      codes(
        checkQuote(
          quote({ routePlan: [{ programId: WALLET, label: 'unknown', percent: 100 }] }),
          expectation,
        ),
      ),
    ).toContain('PROGRAM_NOT_REVIEWED');
    expect(codes(checkQuote(quote(), { ...expectation, mode: 'live' }))).toContain(
      'PROGRAM_FIXTURE_ONLY',
    );
  });

  it('keeps the route program matrix closed for live plans', () => {
    expect(routeProgramVerdict(FIXTURE_ROUTE_PROGRAM_ID, 'fixture')).toBe('allowed');
    expect(routeProgramVerdict(FIXTURE_ROUTE_PROGRAM_ID, 'live')).toBe('fixture_only');
    expect(routeProgramVerdict(WALLET, 'live')).toBe('not_reviewed');
  });
});

describe('fees', () => {
  it('bounds network fees per batch and rent per new token account', () => {
    const budget = networkFeeBudget({
      batches: 2,
      signaturesPerBatch: 1,
      rentExemptTokenAccountLamports: 2_039_280n,
      newTokenAccounts: 2,
    });
    expect(budget.baseFeeLamports).toBe(BASE_FEE_LAMPORTS_PER_SIGNATURE * 2n);
    expect(budget.priorityFeeCapLamports).toBe(PRIORITY_FEE_CAP_LAMPORTS_PER_BATCH * 2n);
    expect(budget.rentLamports).toBe(4_078_560n);
    expect(budget.totalLamportsMax).toBe(10_000n + 200_000n + 4_078_560n);
  });
});

function buildPlan(legCount: 1 | 2): ExecutionPlan {
  const legs =
    legCount === 1
      ? [{ key: 'aero', weightBps: 10_000, minimumInputRaw: null }]
      : [
          { key: 'aero', weightBps: 5_000, minimumInputRaw: null },
          { key: 'bio', weightBps: 4_000, minimumInputRaw: null },
        ];
  const allocation = allocateBudget({
    budgetRaw: 1_000_000_000n,
    mode: 'all_in_stablecoin',
    legs,
    cashWeightBps: legCount === 1 ? 0 : 1_000,
    feeReserveRaw: 0n,
  });
  if (!allocation.ok) {
    throw new Error('expected an allocation');
  }
  const mints = [AERO, BIO];
  return assemblePlan({
    planId: '11111111-1111-4111-8111-111111111111',
    intentId: '22222222-2222-4222-8222-222222222222',
    kind: legCount === 1 ? 'single_buy' : 'basket_investment',
    mode: 'fixture',
    network: { cluster: 'localnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
    wallet: { walletId: '33333333-3333-4333-8333-333333333333', address: WALLET },
    strategy: null,
    input: {
      mint: USDC,
      symbol: 'USDC',
      decimals: 6,
      budgetRaw: 1_000_000_000n,
      budgetMode: 'all_in_stablecoin',
    },
    allocation,
    legs: allocation.legs.map((entry, index) => ({
      instrumentId: `44444444-4444-4444-8444-44444444444${index}`,
      symbol: index === 0 ? 'FXAERO' : 'FXBIO',
      issuer: 'prestocks',
      mint: mints[index] as string,
      tokenProgram: index === 0 ? 'spl-token' : 'token-2022',
      decimals: index === 0 ? 6 : 8,
      weightBps: entry.weightBps,
      targetInputRaw: entry.targetRaw,
      quote: quote({
        outputMint: mints[index] as string,
        inAmountRaw: (entry.targetRaw - 3n).toString(),
        quoteRef: `fixture:${index}`,
      }),
      policyDecision: {
        decisionId: `55555555-5555-4555-8555-55555555555${index}`,
        policyVersion: 'policy-1',
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    })),
    fees: {
      feePayer: WALLET,
      rentExemptTokenAccountLamports: 2_039_280n,
      newTokenAccounts: legCount,
    },
    funds: {
      observedAt: NOW.toISOString(),
      slot: 1000,
      stablecoinRaw: 1_000_000_000n,
      lamports: 5_000_000n,
    },
    evidence: {
      eligibilityDecisionId: null,
      policyVersion: 'policy-1',
      instrumentUpdatedAt: [NOW.toISOString()],
    },
    createdAt: NOW,
  });
}

describe('assemblePlan', () => {
  it('produces a valid, conserved, atomic single-leg plan with a verifiable hash', () => {
    const plan = buildPlan(1);
    expect(executionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.grouping.mode).toBe('atomic');
    expect(plan.grouping.acknowledgementRequired).toBe(false);
    expect(plan.legs[0]?.maxInputRaw).toBe('999999997');
    expect(plan.allocation.dustRaw).toBe('3');
    expect(plan.bounds.residualCashRaw).toBe('3');
    expect(plan.bounds.maxTotalInputRaw).toBe('999999997');
    expect(BigInt(plan.bounds.maxTotalInputRaw) + BigInt(plan.bounds.residualCashRaw)).toBe(
      BigInt(plan.input.totalSpendRaw),
    );
    expect(plan.fees.network.batches).toBe(1);
    expect(plan.fees.network.totalLamportsMax).toBe((5_000n + 100_000n + 2_039_280n).toString());
    expect(plan.validity.expiresAt).toBe(plan.validity.quotesExpireAt);
    expect(plan.validity.simulation).toBeNull();
    expect(plan.funds.sufficient).toBe(true);
    expect(plan.warnings.some((warning) => warning.startsWith('Fixture mode'))).toBe(true);
    expect(verifyPlanHash(plan)).toBe(true);
  });

  it('stages a multi-leg plan one batch per constituent with worst-case spend per batch', () => {
    const plan = buildPlan(2);
    expect(executionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.grouping.mode).toBe('staged');
    expect(plan.grouping.acknowledgementRequired).toBe(true);
    expect(plan.grouping.batches.map((batch) => batch.legIndexes)).toEqual([[0], [1]]);
    expect(plan.grouping.batches[0]?.worstCaseSpentRaw).toBe('499999997');
    expect(plan.grouping.batches[1]?.worstCaseSpentRaw).toBe('899999994');
    expect(plan.grouping.batches[1]?.remainingCashRaw).toBe('100000006');
    expect(plan.allocation.cash.targetRaw).toBe('100000000');
    expect(plan.bounds.residualCashRaw).toBe('100000006');
    expect(plan.fees.network.batches).toBe(2);
    expect(plan.warnings.some((warning) => warning.startsWith('Staged execution'))).toBe(true);
    expect(verifyPlanHash(plan)).toBe(true);
  });

  it('changes the hash when a binding field changes and not when a label changes', () => {
    const plan = buildPlan(2);
    const { planHash, ...rest } = plan;
    expect(planHashOf({ ...rest, warnings: [] })).toBe(planHash);
    expect(
      planHashOf({ ...rest, legs: rest.legs.map((leg) => ({ ...leg, symbol: 'OTHER' })) }),
    ).toBe(planHash);
    const tampered = {
      ...rest,
      legs: rest.legs.map((leg, index) =>
        index === 0 ? { ...leg, maxInputRaw: '499999998' } : leg,
      ),
    };
    expect(planHashOf(tampered)).not.toBe(planHash);
    expect(verifyPlanHash({ ...plan, bounds: { ...plan.bounds, maxTotalInputRaw: '1' } })).toBe(
      false,
    );
    expect(
      verifyPlanHash({
        ...plan,
        network: {
          cluster: 'localnet',
          genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        },
      }),
    ).toBe(false);
  });

  it('reports fund shortfalls instead of hiding them', () => {
    const plan = buildPlan(1);
    const short = assemblePlan({
      planId: plan.planId,
      intentId: plan.intentId,
      kind: 'single_buy',
      mode: 'fixture',
      network: plan.network,
      wallet: plan.wallet,
      strategy: null,
      input: {
        mint: USDC,
        symbol: 'USDC',
        decimals: 6,
        budgetRaw: 1_000_000_000n,
        budgetMode: 'all_in_stablecoin',
      },
      allocation: allocateBudget({
        budgetRaw: 1_000_000_000n,
        mode: 'all_in_stablecoin',
        legs: [{ key: 'aero', weightBps: 10_000, minimumInputRaw: null }],
        cashWeightBps: 0,
        feeReserveRaw: 0n,
      }) as Parameters<typeof assemblePlan>[0]['allocation'],
      legs: [
        {
          instrumentId: plan.legs[0]?.instrumentId as string,
          symbol: 'FXAERO',
          issuer: 'prestocks',
          mint: AERO,
          tokenProgram: 'spl-token',
          decimals: 6,
          weightBps: 10_000,
          targetInputRaw: 1_000_000_000n,
          quote: quote({ inAmountRaw: '1000000000' }),
          policyDecision: {
            decisionId: plan.legs[0]?.policyDecision.decisionId as string,
            policyVersion: null,
            expiresAt: plan.validity.policyExpiresAt,
          },
        },
      ],
      fees: { feePayer: WALLET, rentExemptTokenAccountLamports: 2_039_280n, newTokenAccounts: 1 },
      funds: { observedAt: NOW.toISOString(), slot: 1000, stablecoinRaw: 10n, lamports: 100n },
      evidence: { eligibilityDecisionId: null, policyVersion: null, instrumentUpdatedAt: [] },
      createdAt: NOW,
    });
    expect(short.funds.sufficient).toBe(false);
    expect(short.funds.shortfalls.map((entry) => entry.asset)).toEqual(['stablecoin', 'sol']);
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and refuses bigints', () => {
    expect(canonicalJson({ b: [{ z: 1, a: '2' }], a: null })).toBe(
      '{"a":null,"b":[{"a":"2","z":1}]}',
    );
    expect(() => canonicalJson({ amount: 1n })).toThrow(TypeError);
  });
});

describe('intent states', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('DRAFT', 'QUOTED')).toBe(true);
    expect(canTransition('QUOTED', 'AWAITING_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_APPROVAL', 'QUOTED')).toBe(true);
    expect(canTransition('QUOTED', 'AUTHORIZED')).toBe(false);
    expect(canTransition('SUBMITTING', 'UNKNOWN_REQUIRES_RECONCILIATION')).toBe(true);
    expect(canTransition('FINALIZED', 'DRAFT')).toBe(false);
    expect(TERMINAL_INTENT_STATES.has('CANCELLED')).toBe(true);
    expect(TERMINAL_INTENT_STATES.has('SUBMITTED')).toBe(false);
    expect([...PLANNABLE_STATES]).toEqual(['DRAFT', 'QUOTED', 'AWAITING_APPROVAL']);
  });
});
