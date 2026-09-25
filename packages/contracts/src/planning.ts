import { z } from 'zod';
import { issuerSchema, tokenProgramSchema } from './catalog.js';
import { base58AddressSchema, idSchema } from './identity.js';
import { policyDenialSchema, venueSchema } from './policy.js';
import { basisPointsSchema, rawAmountSchema } from './price.js';
import { networkIdentitySchema, sha256HexSchema } from './registry.js';

/**
 * Execution planning (B09). An intent is the owner's request to invest a
 * stablecoin budget into a pinned strategy version (or one instrument) from
 * one verified wallet. A plan is the immutable, hashed answer: integer
 * base-unit allocation, one venue quote per constituent with its bounds,
 * the fee budget, how the transactions group, what evidence the plan rests
 * on and when it expires. A plan is never a fill and never reserves or
 * moves funds; it is what the owner reviews before any wallet signature
 * (B10). Quotes come from a venue adapter that is either the synthetic
 * fixture (local and test only) or an operator-configured gateway serving
 * this contract; a plan says which.
 */
export const PLANNING_SCHEMA_VERSION = '1' as const;

export const INTENT_KINDS = ['basket_investment', 'single_buy', 'single_sell'] as const;

/** Which way a leg moves value: buys spend the stablecoin, sells spend the instrument. */
export const PLAN_SIDES = ['buy', 'sell'] as const;
export const planSideSchema = z.enum(PLAN_SIDES);
export type PlanSide = z.infer<typeof planSideSchema>;
export const intentKindSchema = z.enum(INTENT_KINDS);
export type IntentKind = z.infer<typeof intentKindSchema>;

/** `all_in_stablecoin`: the budget is the most that leaves the wallet in stablecoin; `investable_notional`: fees come on top. */
export const BUDGET_MODES = ['all_in_stablecoin', 'investable_notional'] as const;
export const budgetModeSchema = z.enum(BUDGET_MODES);
export type BudgetMode = z.infer<typeof budgetModeSchema>;

export const EXECUTION_PREFERENCES = ['atomic_or_explicit_staged_review'] as const;
export const executionPreferenceSchema = z.enum(EXECUTION_PREFERENCES);
export const APPROVAL_MODES = ['owner_each_plan'] as const;
export const approvalModeSchema = z.enum(APPROVAL_MODES);

/** The full intent lifecycle; B09 moves an intent through DRAFT, QUOTED, AWAITING_APPROVAL, EXPIRED, REJECTED and CANCELLED. */
export const INTENT_STATES = [
  'DRAFT',
  'QUOTED',
  'AWAITING_APPROVAL',
  'AUTHORIZED',
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMED',
  'FINALIZED',
  'PARTIALLY_COMPLETED',
  'EXPIRED',
  'REJECTED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
] as const;
export const intentStateSchema = z.enum(INTENT_STATES);
export type IntentState = z.infer<typeof intentStateSchema>;

/** Which adapter produced a quote: the synthetic fixture, or a configured gateway serving this contract. */
export const VENUE_QUOTE_MODES = ['fixture', 'configured_url'] as const;
export const venueQuoteModeSchema = z.enum(VENUE_QUOTE_MODES);
export type VenueQuoteMode = z.infer<typeof venueQuoteModeSchema>;

/** A plan built from fixture quotes is labelled so; only live quotes make a live plan. */
export const PLAN_MODES = ['fixture', 'live'] as const;
export const planModeSchema = z.enum(PLAN_MODES);
export type PlanMode = z.infer<typeof planModeSchema>;

export const GROUPING_MODES = ['atomic', 'staged'] as const;
export const groupingModeSchema = z.enum(GROUPING_MODES);

/** `valid` until `validity.expiresAt`; `superseded` once the intent has a newer plan. */
export const PLAN_STATUSES = ['valid', 'expired', 'superseded'] as const;
export const planStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof planStatusSchema>;

/** Markov's own quote request; a gateway maps it onto the venue's current API. Nothing here is a claim about that API. */
export const venueQuoteRequestSchema = z.object({
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  venue: venueSchema,
  inputMint: base58AddressSchema,
  outputMint: base58AddressSchema,
  /** Exact input, raw base units of the input mint. */
  inAmountRaw: rawAmountSchema,
  slippageBps: basisPointsSchema.min(1),
  swapMode: z.literal('exact_in'),
});
export type VenueQuoteRequest = z.infer<typeof venueQuoteRequestSchema>;

export const routeProgramSchema = z.object({
  programId: base58AddressSchema,
  label: z.string().max(80),
  /** Share of the input routed through this program. */
  percent: z.number().int().min(0).max(100),
});
export type RouteProgram = z.infer<typeof routeProgramSchema>;

/** One venue quote as the adapter answered it, validated before anything is built on it. */
export const venueQuoteSchema = z.object({
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  venue: venueSchema,
  mode: venueQuoteModeSchema,
  /** Opaque reference for evidence and support; never a credential. */
  quoteRef: z.string().min(1).max(200),
  inputMint: base58AddressSchema,
  outputMint: base58AddressSchema,
  inAmountRaw: rawAmountSchema,
  outAmountRaw: rawAmountSchema,
  /** The minimum output the route commits to at the quoted slippage (raw base units of the output mint). */
  otherAmountThresholdRaw: rawAmountSchema,
  slippageBps: basisPointsSchema.min(1),
  priceImpactBps: z.number().int().nonnegative().nullable(),
  routePlan: z.array(routeProgramSchema).min(1).max(8),
  contextSlot: z.number().int().nonnegative().nullable(),
  observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** The adapter and endpoint (without credentials) the quote came from. */
  sourceRef: z.string().max(200),
});
export type VenueQuote = z.infer<typeof venueQuoteSchema>;

/** What a gateway receives to build the transaction for a quote it gave (configured venues). */
export const venueBuildRequestSchema = z.object({
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  quote: venueQuoteSchema,
  owner: base58AddressSchema,
  inputTokenProgram: base58AddressSchema,
  outputTokenProgram: base58AddressSchema,
  recentBlockhash: z.string().min(32).max(44),
  computeUnitLimit: z.number().int().positive().max(1_400_000),
  computeUnitPriceMicroLamports: rawAmountSchema,
  createOutputAccount: z.boolean(),
});
export type VenueBuildRequestPayload = z.infer<typeof venueBuildRequestSchema>;

export const venueBuildResponseSchema = z.object({
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  /** Base64 of the unsigned wire transaction (zeroed signature slots in front of the message). */
  unsignedTransaction: z.string().min(1).max(4000),
  version: z.enum(['legacy', 'v0']),
});
export type VenueBuildResponsePayload = z.infer<typeof venueBuildResponseSchema>;

export const intentCreateRequestSchema = z
  .object({
    schemaVersion: z.literal(PLANNING_SCHEMA_VERSION).default(PLANNING_SCHEMA_VERSION),
    kind: intentKindSchema,
    /** The pinned version to invest in (basket investment). */
    strategyVersionId: idSchema.nullable().default(null),
    /** The instrument to buy (single buy) or to sell (single sell). */
    instrumentId: idSchema.nullable().default(null),
    /** One of the caller's verified wallets: it pays, signs later and receives the constituents. */
    walletId: idSchema,
    /**
     * Raw base units of what leaves the wallet: the platform stablecoin for a
     * basket investment or a single buy, the instrument itself for a single
     * sell (an exact quantity, never a stablecoin target).
     */
    budget: z.object({ rawAmount: rawAmountSchema }),
    budgetMode: budgetModeSchema.default('all_in_stablecoin'),
    executionPreference: executionPreferenceSchema.default('atomic_or_explicit_staged_review'),
    approvalMode: approvalModeSchema.default('owner_each_plan'),
    /** Null takes the policy default; never above the owner's slippage limit. */
    slippageBps: basisPointsSchema.min(1).max(1000).nullable().default(null),
    /** Client-generated, scoped to the caller; reuse with another payload is a conflict. */
    idempotencyKey: z
      .string()
      .min(8)
      .max(100)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .superRefine((value, context) => {
    if (value.kind === 'basket_investment' && value.strategyVersionId === null) {
      context.addIssue({
        code: 'custom',
        path: ['strategyVersionId'],
        message: 'a basket investment names the pinned version',
      });
    }
    if (
      (value.kind === 'single_buy' || value.kind === 'single_sell') &&
      value.instrumentId === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['instrumentId'],
        message: 'a single buy or sell names the instrument',
      });
    }
    if (value.kind === 'single_sell' && value.budgetMode !== 'all_in_stablecoin') {
      context.addIssue({
        code: 'custom',
        path: ['budgetMode'],
        message:
          'a sell spends an exact quantity of the instrument; there is no investable notional',
      });
    }
  });
export type IntentCreateRequest = z.infer<typeof intentCreateRequestSchema>;

export const intentSchema = z.object({
  intentId: idSchema,
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  kind: intentKindSchema,
  state: intentStateSchema,
  /** Why the intent is in a terminal or waiting state, when there is a reason worth telling. */
  stateReason: z.string().max(500).nullable(),
  wallet: z.object({ walletId: idSchema, address: base58AddressSchema }),
  strategy: z
    .object({
      strategyId: idSchema,
      versionId: idSchema,
      versionNumber: z.number().int().positive(),
      title: z.string(),
      manifestHash: sha256HexSchema,
    })
    .nullable(),
  instrumentId: idSchema.nullable(),
  budget: z.object({
    mint: base58AddressSchema,
    symbol: z.string().max(10),
    decimals: z.number().int().min(0).max(18),
    rawAmount: rawAmountSchema,
  }),
  budgetMode: budgetModeSchema,
  executionPreference: executionPreferenceSchema,
  approvalMode: approvalModeSchema,
  /** The slippage the plans of this intent are quoted at. */
  slippageBps: basisPointsSchema.min(1),
  latestPlanId: idSchema.nullable(),
  latestPlanHash: sha256HexSchema.nullable(),
  idempotencyKey: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** After this the intent is EXPIRED whatever its plans say. */
  expiresAt: z.iso.datetime(),
});
export type Intent = z.infer<typeof intentSchema>;

export const intentListResponseSchema = z.object({ intents: z.array(intentSchema) });
export type IntentListResponse = z.infer<typeof intentListResponseSchema>;

export const allocationEntrySchema = z.object({
  key: z.string().max(80),
  weightBps: basisPointsSchema,
  /** floor(investable × weight / 10,000), raw base units. */
  exactFloorRaw: rawAmountSchema,
  /** The unit the largest-remainder step added, 0 or 1. */
  roundingRaw: rawAmountSchema,
  targetRaw: rawAmountSchema,
});

export const planAllocationSchema = z.object({
  method: z.literal('largest_remainder'),
  legs: z.array(allocationEntrySchema),
  cash: allocationEntrySchema,
  /** Stablecoin-denominated fees set aside before allocating; 0 under the beta fee policy. */
  feeReserveRaw: rawAmountSchema,
  /** Input the quotes did not consume, kept as cash. */
  dustRaw: rawAmountSchema,
  investableRaw: rawAmountSchema,
  /** Every leg target plus cash, which equals the investable amount exactly. */
  sumRaw: rawAmountSchema,
  conserved: z.literal(true),
});

export const planLegSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  instrumentId: idSchema,
  symbol: z.string(),
  issuer: issuerSchema,
  mint: base58AddressSchema,
  tokenProgram: tokenProgramSchema,
  decimals: z.number().int().min(0).max(18),
  side: planSideSchema,
  weightBps: basisPointsSchema,
  /** What this leg spends and what it receives, with the units each amount is quoted in. */
  inputMint: base58AddressSchema,
  inputSymbol: z.string().max(10),
  inputDecimals: z.number().int().min(0).max(18),
  outputMint: base58AddressSchema,
  outputSymbol: z.string().max(10),
  outputDecimals: z.number().int().min(0).max(18),
  /** The allocation target for this leg. */
  targetInputRaw: rawAmountSchema,
  /** The most that may leave the wallet for this leg: the quote's exact input, never above the target. */
  maxInputRaw: rawAmountSchema,
  expectedOutputRaw: rawAmountSchema,
  /** The route's commitment at the quoted slippage; an execution below it must fail. */
  minimumOutputRaw: rawAmountSchema,
  slippageBps: basisPointsSchema.min(1),
  priceImpactBps: z.number().int().nonnegative().nullable(),
  quote: venueQuoteSchema,
  policyDecision: z.object({
    decisionId: idSchema,
    outcome: z.literal('allow'),
    policyVersion: z.string().nullable(),
    expiresAt: z.iso.datetime(),
  }),
  /** Batch (transaction) the leg belongs to; every leg of an atomic plan shares batch 0. */
  batch: z.number().int().nonnegative(),
});
export type PlanLeg = z.infer<typeof planLegSchema>;

export const planFeesSchema = z.object({
  feePayer: base58AddressSchema,
  network: z.object({
    unit: z.literal('lamports'),
    baseFeeLamportsPerSignature: rawAmountSchema,
    signaturesPerBatch: z.number().int().positive(),
    batches: z.number().int().positive(),
    baseFeeLamports: rawAmountSchema,
    /** Upper bound of priority fees across the plan; the build step (B10) may use less, never more. */
    priorityFeeCapLamports: rawAmountSchema,
    rentExemptTokenAccountLamports: rawAmountSchema,
    /** Worst case: one new token account per constituent. */
    newTokenAccounts: z.number().int().nonnegative(),
    rentLamports: rawAmountSchema,
    totalLamportsMax: rawAmountSchema,
  }),
  protocol: z.object({
    feePolicyVersion: z.string().max(40),
    feeBps: basisPointsSchema,
    /** Raw stablecoin base units. */
    feeRaw: rawAmountSchema,
  }),
});

export const planGroupingSchema = z.object({
  mode: groupingModeSchema,
  batches: z.array(
    z.object({
      batch: z.number().int().nonnegative(),
      legIndexes: z.array(z.number().int().nonnegative()).min(1),
      description: z.string().max(300),
      /** Stablecoin that has left the wallet after this batch in the worst case, raw. */
      worstCaseSpentRaw: rawAmountSchema,
      /** Cash still in the wallet after this batch, raw. */
      remainingCashRaw: rawAmountSchema,
    }),
  ),
  /** A staged plan needs the owner's explicit acknowledgement of partial-completion semantics. */
  acknowledgementRequired: z.boolean(),
  note: z.string().max(600),
});

export const planFundsSchema = z.object({
  observedAt: z.iso.datetime(),
  slot: z.number().int().nonnegative(),
  /** The wallet's platform stablecoin balance at observation. */
  stablecoinRaw: rawAmountSchema,
  /** The wallet's balance of what the plan spends (the stablecoin for buys, the instrument for a sell). */
  inputRaw: rawAmountSchema,
  lamports: rawAmountSchema,
  sufficient: z.boolean(),
  shortfalls: z.array(
    z.object({
      asset: z.enum(['stablecoin', 'sol', 'instrument']),
      requiredRaw: rawAmountSchema,
      observedRaw: rawAmountSchema,
    }),
  ),
});

export const executionPlanSchema = z.object({
  planId: idSchema,
  planHash: sha256HexSchema,
  schemaVersion: z.literal(PLANNING_SCHEMA_VERSION),
  intentId: idSchema,
  kind: intentKindSchema,
  side: planSideSchema,
  mode: planModeSchema,
  network: networkIdentitySchema,
  wallet: z.object({ walletId: idSchema, address: base58AddressSchema }),
  strategy: z
    .object({
      strategyId: idSchema,
      versionId: idSchema,
      versionNumber: z.number().int().positive(),
      manifestHash: sha256HexSchema,
    })
    .nullable(),
  input: z.object({
    mint: base58AddressSchema,
    symbol: z.string().max(10),
    decimals: z.number().int().min(0).max(18),
    budgetRaw: rawAmountSchema,
    budgetMode: budgetModeSchema,
    /** Budget minus stablecoin-denominated fees (all-in) or the budget itself (investable notional). */
    investableRaw: rawAmountSchema,
    /** The most stablecoin that leaves the wallet under this plan. */
    totalSpendRaw: rawAmountSchema,
  }),
  allocation: planAllocationSchema,
  legs: z.array(planLegSchema).min(1),
  fees: planFeesSchema,
  grouping: planGroupingSchema,
  bounds: z.object({
    maxTotalInputRaw: rawAmountSchema,
    maxTotalLamports: rawAmountSchema,
    minimumOutputs: z.array(
      z.object({
        legIndex: z.number().int().nonnegative(),
        mint: base58AddressSchema,
        minimumOutputRaw: rawAmountSchema,
      }),
    ),
    residualCashRaw: rawAmountSchema,
  }),
  validity: z.object({
    quotesObservedAt: z.iso.datetime(),
    quotesExpireAt: z.iso.datetime(),
    policyExpiresAt: z.iso.datetime(),
    /** The earliest of the quote and policy expiries; nothing may be signed against an expired plan. */
    expiresAt: z.iso.datetime(),
    /** Whole-transaction simulation arrives with B10/B11; null says none happened. */
    simulation: z.null(),
    evidence: z.object({
      eligibilityDecisionId: idSchema.nullable(),
      policyVersion: z.string().nullable(),
      policyDecisionIds: z.array(idSchema),
      quoteRefs: z.array(z.string()),
      instrumentUpdatedAt: z.array(z.iso.datetime()),
    }),
  }),
  funds: planFundsSchema,
  warnings: z.array(z.string().max(300)),
  review: z.object({
    acknowledgedAt: z.iso.datetime().nullable(),
    acknowledgedHash: sha256HexSchema.nullable(),
    stagedAcknowledged: z.boolean(),
  }),
  status: planStatusSchema,
  createdAt: z.iso.datetime(),
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export const planAcknowledgementRequestSchema = z.object({
  /** The hash the person reviewed; a plan with another hash is refused (PLAN_CHANGED). */
  planHash: sha256HexSchema,
  /** Required for a staged plan: the person accepts that batches land one by one. */
  stagedAcknowledged: z.boolean().default(false),
});
export type PlanAcknowledgementRequest = z.infer<typeof planAcknowledgementRequestSchema>;

/** Why a plan could not be built; the intent keeps its state and the reason. */
export const planRefusalSchema = z.object({
  code: z.enum([
    'BUDGET_TOO_SMALL',
    'QUOTE_UNAVAILABLE',
    'QUOTE_REJECTED',
    'POLICY_DENIED',
    'INSUFFICIENT_FUNDS',
    'ASSET_NOT_ADMITTED',
  ]),
  message: z.string().max(500),
  denials: z.array(policyDenialSchema),
});
export type PlanRefusal = z.infer<typeof planRefusalSchema>;
