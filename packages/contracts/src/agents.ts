import { z } from 'zod';
import { receiptSchema } from './accounting.js';
import { instanceAllocationSchema } from './analytics.js';
import {
  corporateActionSchema,
  instrumentDetailSchema,
  instrumentKindSchema,
  instrumentSchema,
  issuerSchema,
} from './catalog.js';
import { agentScopeSchema, idSchema, principalClassSchema } from './identity.js';
import { rebalanceLegSchema, rebalanceOpenResultSchema } from './maintenance.js';
import {
  budgetModeSchema,
  executionPreferenceSchema,
  intentKindSchema,
  intentSchema,
  venueQuoteModeSchema,
  venueQuoteSchema,
} from './planning.js';
import {
  policyDecisionSchema,
  policyDenialCodeSchema,
  policySideSchema,
  venueSchema,
} from './policy.js';
import { basisPointsSchema, rawAmountSchema } from './price.js';
import { sha256HexSchema } from './registry.js';
import { plainTextSchema, runStatusSchema, thesisDetailSchema } from './research.js';
import { draftValidationSchema, strategyDraftContentSchema } from './strategy.js';

/**
 * Agent tools, companion runs and proposals (B15).
 *
 * A tool is a typed façade over one domain method, invoked with the
 * caller's own authority: the same scope checks, owner scoping and policy
 * as the ordinary route, nothing in parallel. A model never calls a tool
 * itself; the companion loop validates what it asks for, refuses what its
 * principal may not do, records every call in redacted provenance and
 * hands back typed results. Nothing here signs, approves, spends or widens
 * a permission: the most a tool produces is a proposal that the owner
 * opens through the same review as a manual action.
 */
export const AGENT_TOOL_NAMES = [
  'instruments.search',
  'instruments.facts',
  'exposures.compare',
  'thesis.draft',
  'weights.validate',
  'plan.indicative',
  'quote.request',
  'policy.explain',
  'basket.propose',
  'investment.propose',
  'rebalance.propose',
  'receipts.read',
] as const;
export const agentToolNameSchema = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;

export const AGENT_TOOL_FAMILIES = [
  'read',
  'research',
  'draft',
  'quote',
  'explain',
  'propose',
] as const;
export const agentToolFamilySchema = z.enum(AGENT_TOOL_FAMILIES);
export type AgentToolFamily = z.infer<typeof agentToolFamilySchema>;

/* ------------------------------------------------------------ inputs */

// Every tool input is a strict object: an argument the schema does not name
// (an approval mode, a caller identity, a widened limit) refuses the call
// instead of being stripped, so a model cannot smuggle intent past the shape.

export const instrumentsSearchInputSchema = z.strictObject({
  q: z.string().trim().max(60).optional(),
  issuer: issuerSchema.optional(),
  kind: instrumentKindSchema.optional(),
  limit: z.number().int().min(1).max(25).default(10),
});
export const instrumentsSearchOutputSchema = z.object({
  instruments: z.array(instrumentSchema),
  nextCursor: z.string().nullable(),
  asOf: z.iso.datetime(),
});

export const instrumentsFactsInputSchema = z.strictObject({ instrumentId: idSchema });
export const instrumentsFactsOutputSchema = z.object({
  instrument: instrumentDetailSchema,
  /** Public corporate actions, newest first. */
  corporateActions: z.array(corporateActionSchema),
  /** True when the reference price is missing or older than the freshness rule allows. */
  stale: z.boolean(),
  asOf: z.iso.datetime(),
});

export const exposuresCompareInputSchema = z.strictObject({
  instrumentIds: z.array(idSchema).min(2).max(6),
});
export const exposuresCompareOutputSchema = z.object({
  rows: z.array(instrumentSchema),
  /** Instruments that expose the same company through different issuers or products. */
  sameCompany: z.array(z.object({ companyName: z.string(), instrumentIds: z.array(idSchema) })),
  /** Instruments whose reference price is missing or stale. */
  stale: z.array(idSchema),
  asOf: z.iso.datetime(),
});

export const thesisDraftInputSchema = z.strictObject({
  title: plainTextSchema(160),
  claim: plainTextSchema(2000),
  counterarguments: z.array(plainTextSchema(1000)).max(20).default([]),
  /** Admitted or paused instruments the thesis is about; anything else is refused. */
  instrumentIds: z.array(idSchema).max(20).default([]),
  /** Companies without a catalog match, kept as research subjects. */
  subjects: z.array(plainTextSchema(120)).max(20).default([]),
});
export const thesisDraftOutputSchema = thesisDetailSchema;

export const weightsValidateInputSchema = z.strictObject({ content: strategyDraftContentSchema });
export const weightsValidateOutputSchema = draftValidationSchema;

const oneTarget = (value: { strategyVersionId: string | null; instrumentId: string | null }) =>
  (value.strategyVersionId === null) !== (value.instrumentId === null);

export const indicativePlanInputSchema = z
  .strictObject({
    /** A version the caller owns, or a registered public one. */
    strategyVersionId: idSchema.nullable().default(null),
    /** A single admitted instrument to buy. */
    instrumentId: idSchema.nullable().default(null),
    budget: z.object({ rawAmount: rawAmountSchema }),
    budgetMode: budgetModeSchema.default('all_in_stablecoin'),
  })
  .refine(oneTarget, 'name exactly one of strategyVersionId or instrumentId');
export type IndicativePlanInput = z.infer<typeof indicativePlanInputSchema>;

export const indicativeLegSchema = z.object({
  instrumentId: idSchema,
  symbol: z.string(),
  issuer: issuerSchema,
  weightBps: basisPointsSchema,
  /** The allocation target for this leg, raw stablecoin units. */
  targetInputRaw: rawAmountSchema,
  /** The venue's documented route minimum per leg, or null when no venue is configured or none is known. */
  minimumInputRaw: rawAmountSchema.nullable(),
});

/** An allocation without a quote, a reservation or an intent: what a plan would target if built now. */
export const indicativePlanSchema = z.object({
  kind: intentKindSchema,
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
  input: z.object({
    mint: z.string(),
    symbol: z.string().max(10),
    decimals: z.number().int().min(0).max(18),
    budgetRaw: rawAmountSchema,
    budgetMode: budgetModeSchema,
    investableRaw: rawAmountSchema,
    totalSpendRaw: rawAmountSchema,
    feeReserveRaw: rawAmountSchema,
  }),
  allocation: z.object({
    ok: z.boolean(),
    code: z.enum(['WEIGHTS_TOTAL', 'BUDGET_TOO_SMALL']).nullable(),
    message: z.string().max(300).nullable(),
    minimumBudgetRaw: rawAmountSchema.nullable(),
    shortfalls: z.array(
      z.object({
        instrumentId: idSchema,
        symbol: z.string(),
        targetRaw: rawAmountSchema,
        minimumInputRaw: rawAmountSchema,
      }),
    ),
  }),
  legs: z.array(indicativeLegSchema),
  cash: z.object({ weightBps: basisPointsSchema, targetRaw: rawAmountSchema }),
  venue: z
    .object({ venue: venueSchema, mode: venueQuoteModeSchema, sourceRef: z.string().max(200) })
    .nullable(),
  fees: z.object({ policyVersion: z.string().max(40), protocolFeeBps: z.number().int() }),
  asOf: z.iso.datetime(),
  note: z.string().max(400),
});
export type IndicativePlan = z.infer<typeof indicativePlanSchema>;

export const quoteRequestInputSchema = z.strictObject({
  instrumentId: idSchema,
  side: policySideSchema.default('buy'),
  /** Raw units of what is spent: the stablecoin for a buy, the instrument for a sell. */
  amountRaw: rawAmountSchema,
  /** Null takes the owner's effective slippage limit; above it the quote is refused, never widened. */
  slippageBps: basisPointsSchema.min(1).max(1000).nullable().default(null),
});
export const quoteRequestOutputSchema = z.object({
  quote: venueQuoteSchema,
  side: policySideSchema,
  instrument: z.object({
    instrumentId: idSchema,
    symbol: z.string(),
    mint: z.string(),
    decimals: z.number().int().min(0).max(18),
  }),
  /** The plan-time checks the quote failed; empty when it would be accepted. */
  checks: z.array(z.object({ code: z.string().max(60), message: z.string().max(300) })),
  accepted: z.boolean(),
  limits: z.object({
    maxSlippageBps: basisPointsSchema,
    maxQuoteAgeSeconds: z.number().int(),
    maxPriceImpactBps: basisPointsSchema,
  }),
  asOf: z.iso.datetime(),
  note: z.string().max(400),
});

export const policyExplainInputSchema = z
  .strictObject({
    /** An earlier decision of the caller's own account to explain. */
    decisionId: idSchema.nullable().default(null),
    /** Or a fresh evaluation without a reservation. */
    instrumentId: idSchema.nullable().default(null),
    side: policySideSchema.default('buy'),
    notionalUsdcRaw: rawAmountSchema.nullable().default(null),
    slippageBps: basisPointsSchema.min(1).max(1000).nullable().default(null),
  })
  .refine(
    (value) =>
      value.decisionId === null
        ? value.instrumentId !== null && value.notionalUsdcRaw !== null
        : value.instrumentId === null && value.notionalUsdcRaw === null,
    'name a decisionId, or an instrumentId with a notionalUsdcRaw to evaluate',
  );
export const policyExplanationSchema = z.object({
  code: policyDenialCodeSchema,
  message: z.string().max(400),
  /** What the owner can do about it, in their own words; never something a tool does for them. */
  remedy: z.string().max(400),
});
export const policyExplainOutputSchema = z.object({
  decision: policyDecisionSchema,
  /** True when the decision was evaluated for this call (no reservation was held). */
  fresh: z.boolean(),
  explanation: z.array(policyExplanationSchema),
  summary: z.string().max(600),
});

export const receiptsReadInputSchema = z.strictObject({
  receiptId: idSchema.nullable().default(null),
  limit: z.number().int().min(1).max(25).default(10),
});
export const receiptsReadOutputSchema = z.object({ receipts: z.array(receiptSchema) });

export type InstrumentsSearchInput = z.infer<typeof instrumentsSearchInputSchema>;
export type InstrumentsSearchOutput = z.infer<typeof instrumentsSearchOutputSchema>;
export type InstrumentsFactsInput = z.infer<typeof instrumentsFactsInputSchema>;
export type InstrumentsFactsOutput = z.infer<typeof instrumentsFactsOutputSchema>;
export type ExposuresCompareInput = z.infer<typeof exposuresCompareInputSchema>;
export type ExposuresCompareOutput = z.infer<typeof exposuresCompareOutputSchema>;
export type ThesisDraftInput = z.infer<typeof thesisDraftInputSchema>;
export type WeightsValidateInput = z.infer<typeof weightsValidateInputSchema>;
export type QuoteRequestInput = z.infer<typeof quoteRequestInputSchema>;
export type QuoteRequestOutput = z.infer<typeof quoteRequestOutputSchema>;
export type PolicyExplainInput = z.infer<typeof policyExplainInputSchema>;
export type PolicyExplainOutput = z.infer<typeof policyExplainOutputSchema>;
export type ReceiptsReadInput = z.infer<typeof receiptsReadInputSchema>;
export type ReceiptsReadOutput = z.infer<typeof receiptsReadOutputSchema>;

/* --------------------------------------------------------- proposals */

export const PROPOSAL_KINDS = ['strategy_draft', 'investment', 'rebalance'] as const;
export const proposalKindSchema = z.enum(PROPOSAL_KINDS);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

export const PROPOSAL_STATUSES = ['proposed', 'opened', 'dismissed', 'expired'] as const;
export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

/** Days a proposal waits for the owner before it expires unopened. */
export const PROPOSAL_TTL_DAYS = { strategy_draft: 30, investment: 1, rebalance: 7 } as const;

/** The intent request a proposal carries: the owner's open creates the intent with it, as the owner. */
export const proposedIntentRequestSchema = z.object({
  kind: intentKindSchema,
  strategyVersionId: idSchema.nullable(),
  instrumentId: idSchema.nullable(),
  walletId: idSchema,
  budget: z.object({ rawAmount: rawAmountSchema }),
  budgetMode: budgetModeSchema,
  executionPreference: executionPreferenceSchema,
  /** Never anything else: a proposal cannot ask for unattended execution. */
  approvalMode: z.literal('owner_each_plan'),
  slippageBps: basisPointsSchema.min(1).max(1000).nullable(),
});
export type ProposedIntentRequest = z.infer<typeof proposedIntentRequestSchema>;

const proposalBase = {
  proposalId: idSchema,
  ownerUserId: idSchema,
  /** The companion run that produced it, when one did. */
  runId: idSchema.nullable(),
  /** The schedule occurrence that produced it, when one did (B16). */
  scheduleId: idSchema.nullable(),
  occurrenceId: idSchema.nullable(),
  /** `user:<id>`, `agent:<credential id>` or `schedule:<schedule id>`. */
  createdBy: z.string().max(120),
  status: proposalStatusSchema,
  summary: z.string().max(300),
  review: z.object({
    requires: z.literal('owner'),
    note: z.string().max(400),
  }),
  /** The intent the owner's open created (investment proposals). */
  intentId: idSchema.nullable(),
  openedAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const strategyDraftProposalSchema = z.object({
  ...proposalBase,
  kind: z.literal('strategy_draft'),
  payload: z.object({
    strategyId: idSchema,
    title: z.string(),
    legs: z.array(
      z.object({ instrumentId: idSchema, symbol: z.string(), weightBps: basisPointsSchema }),
    ),
    cashWeightBps: basisPointsSchema,
    validation: draftValidationSchema,
  }),
});

export const investmentProposalSchema = z.object({
  ...proposalBase,
  kind: z.literal('investment'),
  payload: z.object({
    request: proposedIntentRequestSchema,
    indicative: indicativePlanSchema,
    /** The pre-quote policy decision (no reservation) the proposal was checked against. */
    policyDecisionId: idSchema,
    policyOutcome: z.enum(['allow', 'deny']),
  }),
});

export const rebalanceProposalSchema = z.object({
  ...proposalBase,
  kind: z.literal('rebalance'),
  payload: z.object({
    instanceId: idSchema,
    walletId: idSchema,
    strategyId: idSchema,
    versionId: idSchema,
    versionNumber: z.number().int().positive(),
    allocation: instanceAllocationSchema,
    suggestions: z.array(
      z.object({
        instrumentId: idSchema,
        symbol: z.string(),
        side: policySideSchema,
        driftBps: z.number().int(),
      }),
    ),
    /**
     * Sized legs the owner's open turns into ordinary sell and buy intents (B16); empty when the
     * allocation is incomplete or nothing exceeds the dust floor.
     */
    legs: z.array(rebalanceLegSchema),
    /** True when the legs above can be opened into reviewed intents; false for an incomplete or dust-only allocation. */
    executable: z.boolean(),
  }),
});

export const agentProposalSchema = z.discriminatedUnion('kind', [
  strategyDraftProposalSchema,
  investmentProposalSchema,
  rebalanceProposalSchema,
]);
export type AgentProposal = z.infer<typeof agentProposalSchema>;

export const proposalQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ProposalQuery = z.infer<typeof proposalQuerySchema>;

export const proposalListResponseSchema = z.object({
  proposals: z.array(agentProposalSchema),
  note: z.string().max(400),
});
export type ProposalListResponse = z.infer<typeof proposalListResponseSchema>;

export const proposalOpenResponseSchema = z.object({
  proposal: agentProposalSchema,
  /** The intent the open created or found (investment proposals); null for the other kinds. */
  intent: intentSchema.nullable(),
  /** The reviewed sell and buy intents the open created or found (rebalance proposals, B16); null for the other kinds. */
  rebalance: rebalanceOpenResultSchema.nullable(),
});
export type ProposalOpenResponse = z.infer<typeof proposalOpenResponseSchema>;

export const basketProposeInputSchema = z.strictObject({
  content: strategyDraftContentSchema,
  summary: plainTextSchema(300).nullable().default(null),
});
export const investmentProposeInputSchema = z
  .strictObject({
    strategyVersionId: idSchema.nullable().default(null),
    instrumentId: idSchema.nullable().default(null),
    walletId: idSchema,
    budget: z.object({ rawAmount: rawAmountSchema }),
    budgetMode: budgetModeSchema.default('all_in_stablecoin'),
    slippageBps: basisPointsSchema.min(1).max(1000).nullable().default(null),
    summary: plainTextSchema(300).nullable().default(null),
  })
  .refine(oneTarget, 'name exactly one of strategyVersionId or instrumentId');
export const rebalanceProposeInputSchema = z.strictObject({ instanceId: idSchema });
export type BasketProposeInput = z.infer<typeof basketProposeInputSchema>;
export type InvestmentProposeInput = z.infer<typeof investmentProposeInputSchema>;
export type RebalanceProposeInput = z.infer<typeof rebalanceProposeInputSchema>;

/* ------------------------------------------------------------ catalog */

export const agentToolDescriptorSchema = z.object({
  name: agentToolNameSchema,
  family: agentToolFamilySchema,
  /** Every scope the caller must hold; owners hold every owner scope. */
  scopes: z.array(agentScopeSchema).min(1),
  /** True when the tool writes (a thesis, a draft, a proposal); reads leave nothing behind but audit. */
  mutation: z.boolean(),
  summary: z.string().max(200),
  description: z.string().max(1000),
  /** JSON Schema of the input, generated from the runtime validator. */
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
});
export type AgentToolDescriptor = z.infer<typeof agentToolDescriptorSchema>;

export const agentToolCatalogSchema = z.object({
  tools: z.array(agentToolDescriptorSchema),
  principal: z.object({ class: principalClassSchema, scopes: z.array(z.string()) }),
  note: z.string().max(600),
});
export type AgentToolCatalog = z.infer<typeof agentToolCatalogSchema>;

/** Every tool route answers the same envelope around its typed output. */
export const agentToolResultSchema = <T extends z.ZodTypeAny>(output: T) =>
  z.object({
    tool: agentToolNameSchema,
    invokedAt: z.iso.datetime(),
    output,
  });

/* ---------------------------------------------------- companion runs */

export const COMPANION_MAX_TOOL_CALLS = 12;
export const COMPANION_DEFAULT_TOOL_CALLS = 6;
export const COMPANION_MAX_OUTPUT_CHARS = 4000;
export const COMPANION_DEFAULT_OUTPUT_CHARS = 1500;
/** Cost is accounted in millionths of the billing currency; the fixture charges one per token. */
export const COMPANION_MAX_COST_MICROS = 2_000_000;
export const COMPANION_DEFAULT_COST_MICROS = 200_000;
export const COMPANION_PROVENANCE_REDACTION = 'markov-companion-provenance/v1';

export const companionBudgetSchema = z.object({
  maxToolCalls: z
    .number()
    .int()
    .min(0)
    .max(COMPANION_MAX_TOOL_CALLS)
    .default(COMPANION_DEFAULT_TOOL_CALLS),
  maxOutputChars: z
    .number()
    .int()
    .min(200)
    .max(COMPANION_MAX_OUTPUT_CHARS)
    .default(COMPANION_DEFAULT_OUTPUT_CHARS),
  maxCostMicros: z
    .number()
    .int()
    .min(1000)
    .max(COMPANION_MAX_COST_MICROS)
    .default(COMPANION_DEFAULT_COST_MICROS),
});
export type CompanionBudget = z.infer<typeof companionBudgetSchema>;

export const companionContextSchema = z.object({
  /** A thesis the caller owns: its title, claim and fetched source excerpts are shown to the model. */
  thesisId: idSchema.nullable().default(null),
  /** An instance the caller owns: its pinned version and label are shown, never its lots or wallet. */
  instanceId: idSchema.nullable().default(null),
  strategyId: idSchema.nullable().default(null),
  instrumentIds: z.array(idSchema).max(6).default([]),
});
export type CompanionContext = z.infer<typeof companionContextSchema>;

export const companionRunRequestSchema = z.object({
  question: plainTextSchema(1000),
  context: companionContextSchema.default({
    thesisId: null,
    instanceId: null,
    strategyId: null,
    instrumentIds: [],
  }),
  budget: companionBudgetSchema.default({
    maxToolCalls: COMPANION_DEFAULT_TOOL_CALLS,
    maxOutputChars: COMPANION_DEFAULT_OUTPUT_CHARS,
    maxCostMicros: COMPANION_DEFAULT_COST_MICROS,
  }),
});
export type CompanionRunRequest = z.infer<typeof companionRunRequestSchema>;

export const COMPANION_STEP_OUTCOMES = ['ok', 'refused'] as const;
export const companionStepSchema = z.object({
  seq: z.number().int().nonnegative(),
  /** The tool the model asked for, as it named it (an unknown name is recorded and refused). */
  tool: z.string().max(80),
  /** SHA-256 of the canonical input; the input itself is not stored. */
  inputDigest: sha256HexSchema,
  /** Identifiers and enumerations from the input only; never free text. */
  inputSummary: z.string().max(200),
  outcome: z.enum(COMPANION_STEP_OUTCOMES),
  /** The error code of a refusal (`UNKNOWN_TOOL`, `BUDGET_EXHAUSTED`, or an API error code). */
  code: z.string().max(40).nullable(),
  message: z.string().max(300),
  outputDigest: sha256HexSchema.nullable(),
  outputChars: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type CompanionStep = z.infer<typeof companionStepSchema>;

export const companionProvenanceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  modelVersion: z.string(),
  /** SHA-256 of the exact first prompt (question, redacted context, tool names, budget); the text is not stored. */
  promptHash: sha256HexSchema,
  steps: z.array(companionStepSchema),
  redaction: z.literal(COMPANION_PROVENANCE_REDACTION),
});
export type CompanionProvenance = z.infer<typeof companionProvenanceSchema>;

export const companionUsageSchema = z.object({
  toolCalls: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type CompanionUsage = z.infer<typeof companionUsageSchema>;

export const COMPANION_SOURCE_KINDS = [
  'instrument',
  'source',
  'thesis',
  'receipt',
  'proposal',
  'instance',
] as const;
export const companionSourceSchema = z.object({
  kind: z.enum(COMPANION_SOURCE_KINDS),
  id: z.string().max(100),
  label: z.string().max(200),
});
export type CompanionSource = z.infer<typeof companionSourceSchema>;

export const companionOutputSchema = z.object({
  /** Plain text, sanitised and cut to the budget; never markup, never an instruction to the app. */
  answer: z.string().max(COMPANION_MAX_OUTPUT_CHARS),
  truncated: z.boolean(),
  /** Only things the run actually read or created; anything else the model cited is dropped. */
  sources: z.array(companionSourceSchema),
  proposalIds: z.array(idSchema),
  refusals: z.array(
    z.object({ tool: z.string().max(80), code: z.string().max(40), message: z.string().max(300) }),
  ),
  /** True when a tool result the answer rests on used stale or missing reference data. */
  stale: z.boolean(),
});
export type CompanionOutput = z.infer<typeof companionOutputSchema>;

export const companionRunSchema = z.object({
  runId: idSchema,
  ownerUserId: idSchema,
  /** `user:<id>` or `agent:<credential id>`: whose authority every tool call ran with. */
  principal: z.string().max(120),
  status: runStatusSchema,
  question: z.string(),
  context: companionContextSchema,
  budget: companionBudgetSchema,
  usage: companionUsageSchema.nullable(),
  provenance: companionProvenanceSchema.nullable(),
  output: companionOutputSchema.nullable(),
  error: z.string().max(300).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type CompanionRun = z.infer<typeof companionRunSchema>;

export const companionRunListResponseSchema = z.object({ runs: z.array(companionRunSchema) });
export type CompanionRunListResponse = z.infer<typeof companionRunListResponseSchema>;
