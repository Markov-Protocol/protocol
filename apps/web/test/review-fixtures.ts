import type { ExecutionPlan, Intent } from '@markov/contracts';

/** Shared review fixtures: a staged two-constituent fixture plan exactly as the API answers one. */
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
export const MINT_B = 'A8GviP6cWZxAKfpCoKfQCvtSejyPh975CoLjsVVqmumh';
export const STABLECOIN = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
export const OWNER = 'EY3y13V2TYRa4FWBqpyD7D1ZbLZhGzEamNnDcY4fAFb5';
export const OTHER = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
export const FIXTURE_PROGRAM = 'Gb8BHynqtw8bVGTmRAuCD5iJqqBdRamwW9n4XR2cEvvq';
export const AERO = '11111111-1111-4111-8111-111111111111';
export const XSA = '22222222-2222-4222-8222-222222222222';
export const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const V1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const WALLET_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const INTENT_ID = '77777777-7777-4777-8777-777777777777';
export const PLAN_ID = '66666666-6666-4666-8666-666666666666';
export const PLAN_ID_2 = '55555555-5555-4555-8555-555555555555';
export const DECISION_A = '44444444-4444-4444-8444-444444444440';
export const DECISION_B = '44444444-4444-4444-8444-444444444441';
export const HASH = 'a1b2c3d4'.padEnd(64, '0');
export const HASH_2 = 'e5f6a7b8'.padEnd(64, '1');
export const MANIFEST = '9f9f9f9f'.padEnd(64, '2');
export const NOW = '2026-09-25T10:00:00.000Z';
export const QUOTES_EXPIRE = '2026-09-25T10:00:30.000Z';
export const POLICY_EXPIRES = '2026-09-25T10:01:00.000Z';

export function intent(overrides: Partial<Intent> = {}): Intent {
  return {
    intentId: INTENT_ID,
    schemaVersion: '1',
    kind: 'basket_investment',
    state: 'DRAFT',
    stateReason: null,
    wallet: { walletId: WALLET_ID, address: OWNER },
    strategy: {
      strategyId: S1,
      versionId: V1,
      versionNumber: 1,
      title: 'Aerospace tilt',
      manifestHash: MANIFEST,
    },
    instrumentId: null,
    budget: { mint: STABLECOIN, symbol: 'USDC', decimals: 6, rawAmount: '1000000000' },
    budgetMode: 'all_in_stablecoin',
    executionPreference: 'atomic_or_explicit_staged_review',
    approvalMode: 'owner_each_plan',
    slippageBps: 50,
    latestPlanId: null,
    latestPlanHash: null,
    continuation: null,
    continuedByIntentId: null,
    idempotencyKey: 'test-intent-0001',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

function leg(
  index: number,
  overrides: Partial<ExecutionPlan['legs'][number]> = {},
): ExecutionPlan['legs'][number] {
  const first = index === 0;
  const mint = first ? MINT_A : MINT_B;
  return {
    legIndex: index,
    instrumentId: first ? AERO : XSA,
    symbol: first ? 'FXAERO' : 'XSFXA',
    issuer: first ? 'prestocks' : 'xstocks',
    mint,
    tokenProgram: first ? 'spl-token' : 'token-2022',
    decimals: first ? 6 : 8,
    side: 'buy',
    weightBps: first ? 6000 : 3000,
    inputMint: STABLECOIN,
    inputSymbol: 'USDC',
    inputDecimals: 6,
    outputMint: mint,
    outputSymbol: first ? 'FXAERO' : 'XSFXA',
    outputDecimals: first ? 6 : 8,
    targetInputRaw: first ? '600000000' : '300000000',
    maxInputRaw: first ? '600000000' : '300000000',
    expectedOutputRaw: first ? '32777260' : '295566574',
    minimumOutputRaw: first ? '32613373' : '294088741',
    slippageBps: 50,
    priceImpactBps: 0,
    quote: {
      schemaVersion: '1',
      venue: 'jupiter',
      mode: 'fixture',
      quoteRef: `fixture:${index}abcdef0123456789`,
      inputMint: STABLECOIN,
      outputMint: mint,
      inAmountRaw: first ? '600000000' : '300000000',
      outAmountRaw: first ? '32777260' : '295566574',
      otherAmountThresholdRaw: first ? '32613373' : '294088741',
      slippageBps: 50,
      priceImpactBps: 0,
      routePlan: [{ programId: FIXTURE_PROGRAM, label: 'fixture-amm', percent: 100 }],
      contextSlot: 4242,
      observedAt: NOW,
      expiresAt: QUOTES_EXPIRE,
      sourceRef: 'fixture:venue',
    },
    policyDecision: {
      decisionId: first ? DECISION_A : DECISION_B,
      outcome: 'allow',
      policyVersion: '2026-09-24',
      expiresAt: POLICY_EXPIRES,
    },
    batch: index,
    ...overrides,
  };
}

/** A staged two-constituent plan for a 1,000 USDC budget (60/30/10 recipe) built from fixture quotes. */
export function plan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    planId: PLAN_ID,
    planHash: HASH,
    schemaVersion: '1',
    intentId: INTENT_ID,
    kind: 'basket_investment',
    side: 'buy',
    mode: 'fixture',
    network: { cluster: 'devnet', genesisHash: GENESIS },
    wallet: { walletId: WALLET_ID, address: OWNER },
    strategy: { strategyId: S1, versionId: V1, versionNumber: 1, manifestHash: MANIFEST },
    input: {
      mint: STABLECOIN,
      symbol: 'USDC',
      decimals: 6,
      budgetRaw: '1000000000',
      budgetMode: 'all_in_stablecoin',
      investableRaw: '1000000000',
      totalSpendRaw: '1000000000',
    },
    allocation: {
      method: 'largest_remainder',
      legs: [
        {
          key: AERO,
          weightBps: 6000,
          exactFloorRaw: '600000000',
          roundingRaw: '0',
          targetRaw: '600000000',
        },
        {
          key: XSA,
          weightBps: 3000,
          exactFloorRaw: '300000000',
          roundingRaw: '0',
          targetRaw: '300000000',
        },
      ],
      cash: {
        key: 'cash',
        weightBps: 1000,
        exactFloorRaw: '100000000',
        roundingRaw: '0',
        targetRaw: '100000000',
      },
      feeReserveRaw: '0',
      dustRaw: '0',
      investableRaw: '1000000000',
      sumRaw: '1000000000',
      conserved: true,
    },
    legs: [leg(0), leg(1)],
    fees: {
      feePayer: OWNER,
      network: {
        unit: 'lamports',
        baseFeeLamportsPerSignature: '5000',
        signaturesPerBatch: 1,
        batches: 2,
        baseFeeLamports: '10000',
        priorityFeeCapLamports: '200000',
        rentExemptTokenAccountLamports: '2039280',
        newTokenAccounts: 2,
        rentLamports: '4078560',
        totalLamportsMax: '4288560',
      },
      protocol: { feePolicyVersion: 'beta-0', feeBps: 0, feeRaw: '0' },
    },
    grouping: {
      mode: 'staged',
      reason: 'composition_unavailable',
      composition: null,
      batches: [
        {
          batch: 0,
          legIndexes: [0],
          description: 'Buy FXAERO with at most 600000000 raw USDC',
          worstCaseSpentRaw: '600000000',
          remainingCashRaw: '400000000',
        },
        {
          batch: 1,
          legIndexes: [1],
          description: 'Buy XSFXA with at most 300000000 raw USDC',
          worstCaseSpentRaw: '900000000',
          remainingCashRaw: '100000000',
        },
      ],
      acknowledgementRequired: true,
      note: 'Whole-basket composition and simulation arrive with B11; until then a basket is a sequence of single-constituent transactions, each reviewed against the approved bounds before it is built.',
    },
    bounds: {
      maxTotalInputRaw: '900000000',
      maxTotalLamports: '4288560',
      minimumOutputs: [
        { legIndex: 0, mint: MINT_A, minimumOutputRaw: '32613373' },
        { legIndex: 1, mint: MINT_B, minimumOutputRaw: '294088741' },
      ],
      residualCashRaw: '100000000',
    },
    validity: {
      quotesObservedAt: NOW,
      quotesExpireAt: QUOTES_EXPIRE,
      policyExpiresAt: POLICY_EXPIRES,
      expiresAt: QUOTES_EXPIRE,
      simulation: null,
      evidence: {
        eligibilityDecisionId: '33333333-3333-4333-8333-333333333333',
        policyVersion: '2026-09-24',
        policyDecisionIds: [DECISION_A, DECISION_B],
        quoteRefs: ['fixture:0abcdef0123456789', 'fixture:1abcdef0123456789'],
        instrumentUpdatedAt: [NOW, NOW],
      },
    },
    funds: {
      observedAt: NOW,
      slot: 4242,
      stablecoinRaw: '2500000000',
      inputRaw: '2500000000',
      lamports: '50000000',
      sufficient: true,
      shortfalls: [],
    },
    warnings: [
      'Fixture mode: quotes are synthetic and no route exists on any network; nothing here can be executed.',
      'Staged execution: 2 separate transactions land one by one; a later batch can fail or expire after earlier ones filled, and no budget is moved between constituents on its own.',
    ],
    review: { acknowledgedAt: null, acknowledgedHash: null, stagedAcknowledged: false },
    status: 'valid',
    createdAt: NOW,
    ...overrides,
  };
}

/** The same budget as one atomic single buy of FXAERO. */
export function singlePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  const base = plan();
  const only = leg(0, {
    weightBps: 10_000,
    targetInputRaw: '100000000',
    maxInputRaw: '100000000',
    expectedOutputRaw: '5462876',
    minimumOutputRaw: '5435561',
    batch: 0,
  });
  return {
    ...base,
    kind: 'single_buy',
    strategy: null,
    input: {
      ...base.input,
      budgetRaw: '100000000',
      investableRaw: '100000000',
      totalSpendRaw: '100000000',
    },
    allocation: {
      ...base.allocation,
      legs: [
        {
          key: AERO,
          weightBps: 10_000,
          exactFloorRaw: '100000000',
          roundingRaw: '0',
          targetRaw: '100000000',
        },
      ],
      cash: { key: 'cash', weightBps: 0, exactFloorRaw: '0', roundingRaw: '0', targetRaw: '0' },
      investableRaw: '100000000',
      sumRaw: '100000000',
    },
    legs: [only],
    fees: {
      ...base.fees,
      network: {
        ...base.fees.network,
        batches: 1,
        baseFeeLamports: '5000',
        priorityFeeCapLamports: '100000',
        newTokenAccounts: 1,
        rentLamports: '2039280',
        totalLamportsMax: '2144280',
      },
    },
    grouping: {
      mode: 'atomic',
      reason: 'single_leg',
      composition: null,
      batches: [
        {
          batch: 0,
          legIndexes: [0],
          description: 'One transaction buying FXAERO',
          worstCaseSpentRaw: '100000000',
          remainingCashRaw: '0',
        },
      ],
      acknowledgementRequired: false,
      note: 'One transaction: it lands entirely or not at all. It is simulated before submission (B10); no simulation has happened yet.',
    },
    bounds: {
      maxTotalInputRaw: '100000000',
      maxTotalLamports: '2144280',
      minimumOutputs: [{ legIndex: 0, mint: MINT_A, minimumOutputRaw: '5435561' }],
      residualCashRaw: '0',
    },
    validity: {
      ...base.validity,
      evidence: {
        ...base.validity.evidence,
        policyDecisionIds: [DECISION_A],
        quoteRefs: ['fixture:0abcdef0123456789'],
        instrumentUpdatedAt: [NOW],
      },
    },
    warnings: [base.warnings[0] as string],
    ...overrides,
  };
}
