import { z } from 'zod';
import { issuerSchema } from './catalog.js';
import { idSchema } from './identity.js';
import { basisPointsSchema, rawAmountSchema } from './price.js';

/**
 * Eligibility, terms, owner limits and deterministic trading policy (B05).
 * The backend records decisions and evidence; it never invents a legal
 * rule. Until operators publish jurisdiction rules (OD-06) every
 * eligibility question answers `unknown`, and unknown blocks execution.
 */

/** V1 has one tradable capability; perps and redemption arrive as separate capabilities later. */
export const ELIGIBILITY_CAPABILITIES = ['trade_stocks'] as const;
export const eligibilityCapabilitySchema = z.enum(ELIGIBILITY_CAPABILITIES);
export type EligibilityCapability = z.infer<typeof eligibilityCapabilitySchema>;

/** ISO 3166-1 alpha-2; user-assigned codes (AA, QM–QZ, XA–XZ, ZZ) are reserved for fixtures. */
export const jurisdictionSchema = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code');
export const FIXTURE_JURISDICTIONS = ['AA', 'ZZ', 'XX', 'XY'] as const;

export const JURISDICTION_EVIDENCE_KINDS = [
  'self_declared',
  'operator_attested',
  'provider_verified',
] as const;
export const jurisdictionEvidenceKindSchema = z.enum(JURISDICTION_EVIDENCE_KINDS);
export type JurisdictionEvidenceKind = z.infer<typeof jurisdictionEvidenceKindSchema>;

export const RULE_DECISIONS = ['allow', 'deny', 'review'] as const;
export const ruleDecisionSchema = z.enum(RULE_DECISIONS);

/** One operator-published rule. Rules are versioned as a set; the newest published version is active. */
export const jurisdictionRuleSchema = z.object({
  jurisdiction: jurisdictionSchema,
  capability: eligibilityCapabilitySchema,
  decision: ruleDecisionSchema,
  /** Issuers the rule covers; `all` when it applies regardless of issuer. */
  issuers: z.union([z.literal('all'), z.array(issuerSchema).min(1)]),
  /** Minimum evidence the person must present for this rule to apply. */
  minimumEvidence: jurisdictionEvidenceKindSchema,
  reason: z.string().min(3).max(500),
});
export type JurisdictionRule = z.infer<typeof jurisdictionRuleSchema>;

export const jurisdictionRuleSetSchema = z.object({
  policyVersion: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/, 'date-based version such as 2026-09-24 or 2026-09-24.2'),
  /** Days an eligibility decision made under this version stays valid. */
  validityDays: z.number().int().min(1).max(365),
  rules: z.array(jurisdictionRuleSchema).max(500),
  /** Secret-free references: counsel memo ids, review tickets. */
  evidence: z.record(z.string().max(60), z.string().max(500)).default({}),
});
export type JurisdictionRuleSet = z.infer<typeof jurisdictionRuleSetSchema>;

export const publishedRuleSetSchema = jurisdictionRuleSetSchema.extend({
  publishedAt: z.iso.datetime(),
  publishedBy: z.string(),
  active: z.boolean(),
});
export type PublishedRuleSet = z.infer<typeof publishedRuleSetSchema>;

export const ELIGIBILITY_OUTCOMES = ['eligible', 'ineligible', 'unknown'] as const;
export const eligibilityOutcomeSchema = z.enum(ELIGIBILITY_OUTCOMES);
export type EligibilityOutcome = z.infer<typeof eligibilityOutcomeSchema>;

export const eligibilityDecisionSchema = z.object({
  decisionId: idSchema,
  userId: idSchema,
  capability: eligibilityCapabilitySchema,
  /** Null when no rule set was published at decision time. */
  policyVersion: z.string().nullable(),
  jurisdiction: jurisdictionSchema,
  evidenceKind: jurisdictionEvidenceKindSchema,
  outcome: eligibilityOutcomeSchema,
  reasons: z.array(z.string().max(300)),
  /** Issuers the decision covers when eligible; empty otherwise. */
  issuers: z.array(issuerSchema),
  decidedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  revokedReason: z.string().max(500).nullable(),
  decidedBy: z.string(),
});
export type EligibilityDecision = z.infer<typeof eligibilityDecisionSchema>;

export const eligibilityHistoryResponseSchema = z.object({
  decisions: z.array(eligibilityDecisionSchema),
});
export type EligibilityHistoryResponse = z.infer<typeof eligibilityHistoryResponseSchema>;

export const eligibilityRevocationRequestSchema = z.object({ reason: z.string().min(3).max(500) });

export const ruleSetListResponseSchema = z.object({ ruleSets: z.array(publishedRuleSetSchema) });
export type RuleSetListResponse = z.infer<typeof ruleSetListResponseSchema>;

/** Beta participants: the allowlist `BETA_PARTICIPANT_ALLOWLIST_ENABLED` enforces (OD-12). */
export const betaParticipantSchema = z.object({
  userId: idSchema,
  note: z.string().max(300),
  addedAt: z.iso.datetime(),
  addedBy: z.string(),
});
export type BetaParticipant = z.infer<typeof betaParticipantSchema>;
export const betaParticipantRequestSchema = z.object({
  userId: idSchema,
  note: z.string().max(300).default(''),
});
export const betaParticipantListResponseSchema = z.object({
  participants: z.array(betaParticipantSchema),
});
export type BetaParticipantListResponse = z.infer<typeof betaParticipantListResponseSchema>;

export const eligibilityDeclarationRequestSchema = z.object({
  jurisdiction: jurisdictionSchema,
  /** The person confirms the declaration is truthful; the API records it as self-declared evidence only. */
  attestation: z.literal(true),
});

export const termsDocumentSchema = z.object({
  termsVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/),
  title: z.string().min(1).max(200),
  /** SHA-256 of the canonical document text the person is shown. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Where the current text is published (https). */
  url: z.url(),
  requiredFor: z.array(eligibilityCapabilitySchema).min(1),
  publishedAt: z.iso.datetime(),
  publishedBy: z.string(),
  active: z.boolean(),
});
export type TermsDocument = z.infer<typeof termsDocumentSchema>;

export const termsPublishRequestSchema = termsDocumentSchema.pick({
  termsVersion: true,
  title: true,
  contentHash: true,
  url: true,
  requiredFor: true,
});
export type TermsPublishRequest = z.infer<typeof termsPublishRequestSchema>;

export const termsAcknowledgementSchema = z.object({
  userId: idSchema,
  termsVersion: z.string(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgedAt: z.iso.datetime(),
  channel: z.enum(['app', 'cli']),
});
export type TermsAcknowledgement = z.infer<typeof termsAcknowledgementSchema>;

export const termsAcknowledgementRequestSchema = z.object({
  termsVersion: z.string().max(40),
  /** Must equal the active document's hash so a person never accepts text they did not see. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  channel: z.enum(['app', 'cli']).default('app'),
});

export const currentTermsResponseSchema = z.object({ documents: z.array(termsDocumentSchema) });
export type CurrentTermsResponse = z.infer<typeof currentTermsResponseSchema>;

/** Steps a person must still complete before trading; the app renders exactly these. */
export const ELIGIBILITY_STEPS = [
  'declare_jurisdiction',
  'acknowledge_terms',
  'await_review',
  'verify_wallet',
] as const;
export const eligibilityStepSchema = z.enum(ELIGIBILITY_STEPS);
export type EligibilityStep = z.infer<typeof eligibilityStepSchema>;

export const eligibilityStatusResponseSchema = z.object({
  capability: eligibilityCapabilitySchema,
  outcome: eligibilityOutcomeSchema,
  decision: eligibilityDecisionSchema.nullable(),
  policyVersion: z.string().nullable(),
  terms: z.object({
    required: z.array(termsDocumentSchema),
    acknowledged: z.array(termsAcknowledgementSchema),
    complete: z.boolean(),
  }),
  steps: z.array(eligibilityStepSchema),
  /** Plain-language summary suitable for the UI; never a legal opinion. */
  summary: z.string().max(500),
});
export type EligibilityStatusResponse = z.infer<typeof eligibilityStatusResponseSchema>;

export const VENUES = ['jupiter'] as const;
export const venueSchema = z.enum(VENUES);

/** USDC has 6 decimals on Solana; every notional here is a raw USDC integer string. */
export const USDC_DECIMALS = 6 as const;

/** Limits an owner may set; each may only tighten the beta cap or policy default. */
export const ownerLimitsSchema = z.object({
  maxOrderNotionalUsdcRaw: rawAmountSchema,
  maxDailyNotionalUsdcRaw: rawAmountSchema,
  maxAccountNotionalUsdcRaw: rawAmountSchema,
  maxIssuerConcentrationBps: basisPointsSchema,
  maxCompanyConcentrationBps: basisPointsSchema,
  maxSlippageBps: basisPointsSchema,
  maxQuoteAgeSeconds: z.number().int().min(1).max(600),
  cashReserveBps: basisPointsSchema,
  allowedVenues: z.array(venueSchema).min(1),
});
export type OwnerLimits = z.infer<typeof ownerLimitsSchema>;

export const ownerLimitsUpdateRequestSchema = ownerLimitsSchema.partial();
export type OwnerLimitsUpdateRequest = z.infer<typeof ownerLimitsUpdateRequestSchema>;

export const effectiveLimitsResponseSchema = z.object({
  /** The limits that apply now: the tightest of policy defaults, beta caps and the owner's settings. */
  effective: ownerLimitsSchema,
  /** Exactly what the owner set; null until they tighten something. */
  owner: ownerLimitsUpdateRequestSchema.nullable(),
  /** Ceilings the owner cannot exceed. */
  ceiling: ownerLimitsSchema,
  ceilingSource: z.enum(['policy_defaults', 'beta_caps']),
  updatedAt: z.iso.datetime().nullable(),
});
export type EffectiveLimitsResponse = z.infer<typeof effectiveLimitsResponseSchema>;

export const CAPABILITY_STATES = [
  'discoverable',
  'researchable',
  'quoteable',
  'buyable',
  'sellable',
  'redeemable',
  'transferable',
] as const;
export const capabilityStateSchema = z.enum(CAPABILITY_STATES);

export const AVAILABILITY_CONDITIONS = [
  'stale_reference',
  'underlying_market_closed',
  'venue_disabled',
  'issuer_halted',
  'corporate_action_pending',
  'migration_required',
  'instrument_sunset',
  'instrument_not_admitted',
  'eligibility_unknown',
  'eligibility_denied',
  'terms_not_acknowledged',
  'execution_disabled',
  'multiplier_unknown',
] as const;
export const availabilityConditionSchema = z.enum(AVAILABILITY_CONDITIONS);

export const instrumentActionAvailabilitySchema = z.object({
  instrumentId: idSchema,
  capabilities: z.object({
    discoverable: z.boolean(),
    researchable: z.boolean(),
    quoteable: z.boolean(),
    buyable: z.boolean(),
    sellable: z.boolean(),
    /** Redemption goes through the issuer, never through Markov; always false in V1. */
    redeemable: z.literal(false),
    /** Transfers are wallet-native; Markov neither enables nor blocks them, so this reports the mint's own rule. */
    transferable: z.boolean(),
  }),
  conditions: z.array(availabilityConditionSchema),
  reasons: z.array(z.string().max(300)),
  evaluatedAt: z.iso.datetime(),
  policyVersion: z.string().nullable(),
});
export type InstrumentActionAvailability = z.infer<typeof instrumentActionAvailabilitySchema>;

export const POLICY_DENIAL_CODES = [
  'EXECUTION_DISABLED',
  'PARTICIPANT_NOT_ALLOWLISTED',
  'ELIGIBILITY_UNKNOWN',
  'ELIGIBILITY_DENIED',
  'ELIGIBILITY_EXPIRED',
  'ELIGIBILITY_SUPERSEDED',
  'TERMS_NOT_ACKNOWLEDGED',
  'INSTRUMENT_NOT_ADMITTED',
  'ISSUER_NOT_COVERED',
  'ISSUER_HALTED',
  'CORPORATE_ACTION_PENDING',
  'MIGRATION_REQUIRED',
  'INSTRUMENT_SUNSET',
  'MULTIPLIER_UNKNOWN',
  'REFERENCE_STALE',
  'ORDER_CAP_EXCEEDED',
  'DAILY_CAP_EXCEEDED',
  'ACCOUNT_CAP_EXCEEDED',
  'ISSUER_CONCENTRATION_EXCEEDED',
  'COMPANY_CONCENTRATION_EXCEEDED',
  'SLIPPAGE_LIMIT_EXCEEDED',
  'QUOTE_STALE',
  'VENUE_NOT_ALLOWED',
  'VENUE_DISABLED',
  'CASH_RESERVE_BREACHED',
  'EXPOSURE_UNKNOWN',
  'NOTIONAL_ZERO',
] as const;
export const policyDenialCodeSchema = z.enum(POLICY_DENIAL_CODES);
export type PolicyDenialCode = z.infer<typeof policyDenialCodeSchema>;

export const policyDenialSchema = z.object({
  code: policyDenialCodeSchema,
  message: z.string().max(400),
  /** The limit and the observed value in the same unit, when the denial is numeric. */
  limit: z.string().max(60).nullable(),
  observed: z.string().max(60).nullable(),
  unit: z.string().max(30).nullable(),
});
export type PolicyDenial = z.infer<typeof policyDenialSchema>;

export const POLICY_SIDES = ['buy', 'sell'] as const;
export const policySideSchema = z.enum(POLICY_SIDES);
export type PolicySide = z.infer<typeof policySideSchema>;

/** `quote` checks an intent while it is being planned; `submit` is the final check before anything is sent. */
export const POLICY_STAGES = ['quote', 'submit'] as const;
export const policyStageSchema = z.enum(POLICY_STAGES);
export type PolicyStage = z.infer<typeof policyStageSchema>;

/** Exposure the caller can prove (B12 supplies actual holdings later); the source is recorded with the decision. */
export const exposureSnapshotSchema = z.object({
  source: z.enum(['none', 'caller_declared', 'ledger']),
  observedAt: z.iso.datetime().nullable(),
  positions: z
    .array(z.object({ instrumentId: idSchema, notionalUsdcRaw: rawAmountSchema }))
    .max(500),
  /** Cash available to the strategy, raw USDC. */
  cashUsdcRaw: rawAmountSchema.nullable(),
});
export type ExposureSnapshot = z.infer<typeof exposureSnapshotSchema>;

export const policyEvaluationRequestSchema = z.object({
  stage: policyStageSchema.default('quote'),
  side: policySideSchema,
  instrumentId: idSchema,
  notionalUsdcRaw: rawAmountSchema,
  /** Opaque intent identity supplied by the caller (B09/B10); reservations are idempotent per intent. */
  intentId: z.string().min(1).max(100),
  venue: venueSchema.default('jupiter'),
  slippageBps: basisPointsSchema.default(50),
  /** When the quote behind this evaluation was observed; null means no quote yet (pre-quote check). */
  quoteObservedAt: z.iso.datetime().nullable().default(null),
  exposure: exposureSnapshotSchema.default({
    source: 'none',
    observedAt: null,
    positions: [],
    cashUsdcRaw: null,
  }),
  /** Hold the notional against the daily and account budgets when allowed. */
  reserve: z.boolean().default(false),
});
export type PolicyEvaluationRequest = z.infer<typeof policyEvaluationRequestSchema>;

export const RESERVATION_STATUSES = ['held', 'released', 'consumed', 'expired'] as const;
export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);

export const spendReservationSchema = z.object({
  reservationId: idSchema,
  userId: idSchema,
  intentId: z.string(),
  instrumentId: idSchema,
  side: policySideSchema,
  notionalUsdcRaw: rawAmountSchema,
  status: reservationStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
});
export type SpendReservation = z.infer<typeof spendReservationSchema>;

export const policyDecisionSchema = z.object({
  decisionId: idSchema,
  outcome: z.enum(['allow', 'deny']),
  stage: policyStageSchema,
  side: policySideSchema,
  instrumentId: idSchema,
  notionalUsdcRaw: rawAmountSchema,
  denials: z.array(policyDenialSchema),
  /** Versions of everything the decision depended on, so a later change is detectable. */
  evidence: z.object({
    policyVersion: z.string().nullable(),
    eligibilityDecisionId: idSchema.nullable(),
    termsVersions: z.array(z.string()),
    instrumentUpdatedAt: z.iso.datetime(),
    limitsUpdatedAt: z.iso.datetime().nullable(),
    ceilingSource: z.enum(['policy_defaults', 'beta_caps']),
    exposureSource: z.enum(['none', 'caller_declared', 'ledger']),
  }),
  limitsApplied: ownerLimitsSchema,
  /** Budget picture after this decision, raw USDC. */
  budget: z.object({
    dailyUsedUsdcRaw: rawAmountSchema,
    dailyRemainingUsdcRaw: rawAmountSchema,
    accountUsedUsdcRaw: rawAmountSchema,
    accountRemainingUsdcRaw: rawAmountSchema,
  }),
  reservation: spendReservationSchema.nullable(),
  evaluatedAt: z.iso.datetime(),
  /** Re-evaluate after this; submission must never rely on an expired decision. */
  expiresAt: z.iso.datetime(),
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const reservationListResponseSchema = z.object({
  reservations: z.array(spendReservationSchema),
});
export type ReservationListResponse = z.infer<typeof reservationListResponseSchema>;
