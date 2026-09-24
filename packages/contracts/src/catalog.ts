import { z } from 'zod';
import { base58AddressSchema, idSchema } from './identity.js';
import { genesisHashSchema } from './platform.js';
import { decimalStringSchema, rawAmountSchema, typedPriceSchema } from './price.js';

/**
 * Instrument catalog. Every instrument is a token issued by a known issuer
 * and admitted by an operator after on-chain verification; nothing here is
 * a quote, an offer or an eligibility decision.
 */
export const ISSUERS = ['prestocks', 'xstocks', 'tessera'] as const;
export const issuerSchema = z.enum(ISSUERS);
export type Issuer = z.infer<typeof issuerSchema>;

export const INSTRUMENT_KINDS = ['pre_ipo_exposure', 'listed_stock'] as const;
export const instrumentKindSchema = z.enum(INSTRUMENT_KINDS);
export type InstrumentKind = z.infer<typeof instrumentKindSchema>;

/**
 * Lifecycle. Ingested products start quarantined; only an operator decision
 * admits them, and only after the mint matched on chain. Paused instruments
 * stay visible for research but cannot enter a new strategy version.
 */
export const INSTRUMENT_STATUSES = [
  'quarantined',
  'admitted',
  'paused',
  'rejected',
  'delisted',
] as const;
export const instrumentStatusSchema = z.enum(INSTRUMENT_STATUSES);
export type InstrumentStatus = z.infer<typeof instrumentStatusSchema>;

export const TOKEN_PROGRAMS = ['spl-token', 'token-2022', 'unknown'] as const;
export const tokenProgramSchema = z.enum(TOKEN_PROGRAMS);
export type TokenProgram = z.infer<typeof tokenProgramSchema>;

/** Symbol rule shared by ingestion and search: uppercase letters, digits, dot and dash, 1 to 12 characters. */
export const INSTRUMENT_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
export const instrumentSymbolSchema = z.string().regex(INSTRUMENT_SYMBOL_PATTERN);

/** Reference prices a catalog may carry. Never an execution quote. */
export const CATALOG_PRICE_KINDS = [
  'issuer_mark',
  'implied_valuation',
  'secondary_market',
  'underlying_equity',
] as const;
export const catalogPriceSchema = typedPriceSchema.extend({
  kind: z.enum(CATALOG_PRICE_KINDS),
  expiresAt: z.null(),
});
export type CatalogPrice = z.infer<typeof catalogPriceSchema>;

/**
 * What a principal may do with an instrument right now. `trade` is false
 * for every instrument until execution and policy sessions (B05, B09, B10)
 * turn it on per action and per owner; the catalog never implies it.
 */
export const instrumentAvailabilitySchema = z.object({
  research: z.boolean(),
  strategy: z.boolean(),
  trade: z.literal(false),
  reasons: z.array(z.string().max(100)),
});
export type InstrumentAvailability = z.infer<typeof instrumentAvailabilitySchema>;

export const onChainMintSchema = z.object({
  tokenProgram: tokenProgramSchema,
  decimals: z.number().int().min(0).max(255),
  /** Supply in base units as a digit string; never a float. */
  supply: z.string().regex(/^\d+$/),
  mintAuthority: base58AddressSchema.nullable(),
  freezeAuthority: base58AddressSchema.nullable(),
  isInitialized: z.boolean(),
  /** Token-2022 extension names present on the mint (empty for spl-token). */
  extensions: z.array(z.string().max(60)),
  /** Extension type numbers the parser did not recognise; presence blocks admission until reviewed. */
  unknownExtensionTypes: z.array(z.number().int()),
});
export type OnChainMint = z.infer<typeof onChainMintSchema>;

export const MINT_VERIFICATION_RESULTS = [
  'verified',
  'mismatch',
  'not_found',
  'not_a_mint',
  'error',
] as const;
export const mintVerificationResultSchema = z.enum(MINT_VERIFICATION_RESULTS);
export type MintVerificationResult = z.infer<typeof mintVerificationResultSchema>;

export const mintVerificationSchema = z.object({
  verificationId: z.number().int(),
  instrumentId: idSchema,
  verifiedAt: z.iso.datetime(),
  /** Host of the RPC endpoint used, never the URL with its key. */
  rpcHost: z.string().max(253),
  slot: z.number().int().nullable(),
  result: mintVerificationResultSchema,
  onChain: onChainMintSchema.nullable(),
  mismatches: z.array(z.string().max(200)),
  /** Token extension policy verdict for the parsed mint; null when nothing was parsed. */
  compatibility: z.lazy(() => extensionAssessmentSchema).nullable(),
});
export type MintVerification = z.infer<typeof mintVerificationSchema>;

const instrumentBaseSchema = z.object({
  instrumentId: idSchema,
  issuer: issuerSchema,
  issuerProductId: z.string().min(1).max(100),
  symbol: instrumentSymbolSchema,
  name: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  kind: instrumentKindSchema,
  chain: z.literal('solana'),
  genesisHash: genesisHashSchema,
  mint: base58AddressSchema,
  decimals: z.number().int().min(0).max(18),
  tokenProgram: tokenProgramSchema,
  status: instrumentStatusSchema,
  statusReason: z.string().max(500).nullable(),
  /** Sanitised, length-limited issuer metadata; never HTML. */
  metadata: z.object({
    website: z.url().nullable(),
    description: z.string().max(1000).nullable(),
  }),
  referencePrice: catalogPriceSchema.nullable(),
  underlying: z.object({
    ticker: z.string().max(20).nullable(),
    exchange: z.string().max(40).nullable(),
  }),
  lifecycle: z.lazy(() => instrumentLifecycleSchema),
  availability: instrumentAvailabilitySchema,
  admittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Public projection: only admitted or paused instruments are ever listed publicly. */
export const instrumentSchema = instrumentBaseSchema;
export type Instrument = z.infer<typeof instrumentSchema>;

export const instrumentDetailSchema = instrumentBaseSchema.extend({
  latestMintVerification: mintVerificationSchema.nullable(),
});
export type InstrumentDetail = z.infer<typeof instrumentDetailSchema>;

export const instrumentListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  issuer: issuerSchema.optional(),
  kind: instrumentKindSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const operatorInstrumentListQuerySchema = instrumentListQuerySchema.extend({
  status: instrumentStatusSchema.optional(),
});

export const instrumentListResponseSchema = z.object({
  instruments: z.array(instrumentSchema),
  nextCursor: z.string().nullable(),
});
export type InstrumentListResponse = z.infer<typeof instrumentListResponseSchema>;

/** Operator lifecycle decisions. Admission needs a matching mint verification; nothing admits automatically. */
export const INSTRUMENT_DECISIONS = ['admit', 'reject', 'pause', 'resume', 'delist'] as const;
export const instrumentDecisionKindSchema = z.enum(INSTRUMENT_DECISIONS);
export type InstrumentDecisionKind = z.infer<typeof instrumentDecisionKindSchema>;

export const instrumentDecisionRequestSchema = z.object({
  decision: instrumentDecisionKindSchema,
  reason: z.string().trim().min(3).max(500),
  /** Secret-free references: terms review ids, document hashes, ticket links. */
  evidence: z.record(z.string().max(60), z.string().max(500)).default({}),
});

export const instrumentDecisionSchema = z.object({
  decisionId: z.number().int(),
  instrumentId: idSchema,
  decision: instrumentDecisionKindSchema,
  reason: z.string(),
  evidence: z.record(z.string(), z.string()),
  previousStatus: instrumentStatusSchema,
  newStatus: instrumentStatusSchema,
  decidedBy: z.string(),
  decidedAt: z.iso.datetime(),
});
export type InstrumentDecision = z.infer<typeof instrumentDecisionSchema>;

/** Where an ingestion reads from. Fixture sources exist only in local and test modes. */
export const INGESTION_SOURCES = ['fixture', 'configured_url'] as const;
export const ingestionSourceSchema = z.enum(INGESTION_SOURCES);
export type IngestionSource = z.infer<typeof ingestionSourceSchema>;

export const ingestionRequestSchema = z.object({
  issuer: issuerSchema,
  source: ingestionSourceSchema,
});

export const SNAPSHOT_STATUSES = ['accepted', 'rejected'] as const;
export const snapshotStatusSchema = z.enum(SNAPSHOT_STATUSES);

export const SNAPSHOT_KINDS = ['products', 'corporate_actions'] as const;
export const snapshotKindSchema = z.enum(SNAPSHOT_KINDS);
export type SnapshotKindSchemaType = z.infer<typeof snapshotKindSchema>;

export const issuerSnapshotSchema = z.object({
  snapshotId: idSchema,
  issuer: issuerSchema,
  kind: snapshotKindSchema,
  source: ingestionSourceSchema,
  /** Fixture name or the URL without query string or credentials. */
  sourceRef: z.string().max(500),
  fetchedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  schemaVersion: z.string().max(20).nullable(),
  itemCount: z.number().int().min(0),
  status: snapshotStatusSchema,
  rejectionReason: z.string().max(1000).nullable(),
  createdBy: z.string(),
});
export type IssuerSnapshot = z.infer<typeof issuerSnapshotSchema>;

export const ingestionProductOutcomeSchema = z.object({
  issuerProductId: z.string(),
  symbol: z.string().nullable(),
  outcome: z.enum(['inserted', 'updated', 'unchanged', 'rejected', 'paused']),
  reasons: z.array(z.string().max(200)),
});

export const ingestionReportSchema = z.object({
  snapshot: issuerSnapshotSchema,
  products: z.array(ingestionProductOutcomeSchema),
  counts: z.object({
    inserted: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    paused: z.number().int(),
  }),
});
export type IngestionReport = z.infer<typeof ingestionReportSchema>;

export const snapshotListResponseSchema = z.object({ snapshots: z.array(issuerSnapshotSchema) });

/**
 * Issuer product feed, schema version 1. This is a Markov-owned contract for
 * what an issuer source must deliver after its adapter mapped the upstream
 * response; it is not a claim about any issuer's public API.
 */
export const ISSUER_FEED_SCHEMA_VERSION = '1' as const;

/**
 * Field-level problems (empty names, bad mints, out-of-range decimals) are
 * rejected per product by the catalog rules with every reason listed; only
 * structural drift (renamed or missing keys, unknown schema version) rejects
 * a whole snapshot.
 */
export const issuerFeedProductSchema = z.object({
  productId: z.string().max(100),
  symbol: z.string().max(40),
  name: z.string().max(200),
  companyName: z.string().max(200),
  kind: instrumentKindSchema,
  mint: z.string().max(60),
  decimals: z.number().int(),
  tokenProgram: tokenProgramSchema.optional(),
  website: z.string().max(500).optional(),
  description: z.string().max(4000).optional(),
  referencePrice: z
    .object({
      value: z.string().max(60),
      unit: z.string().max(20),
      kind: z.enum(CATALOG_PRICE_KINDS),
      observedAt: z.iso.datetime(),
      source: z.string().max(200),
    })
    .optional(),
  /** Listed stocks: the underlying security, never a claim of fungibility across issuers. */
  underlying: z
    .object({
      ticker: z.string().max(20),
      exchange: z.string().max(40).optional(),
    })
    .optional(),
});
export type IssuerFeedProduct = z.infer<typeof issuerFeedProductSchema>;

export const issuerFeedSchema = z.object({
  schemaVersion: z.literal(ISSUER_FEED_SCHEMA_VERSION),
  issuer: issuerSchema,
  generatedAt: z.iso.datetime(),
  products: z.array(issuerFeedProductSchema).max(5000),
});
export type IssuerFeed = z.infer<typeof issuerFeedSchema>;

/* ---------------------------------------------------------------------------
 * Listed stocks (B04): token extension policy, multipliers, corporate actions,
 * lifecycle and quantity conversions.
 * ------------------------------------------------------------------------- */

export const EXTENSION_COMPATIBILITY = ['supported', 'review_required', 'unsupported'] as const;
export const extensionCompatibilitySchema = z.enum(EXTENSION_COMPATIBILITY);
export type ExtensionCompatibility = z.infer<typeof extensionCompatibilitySchema>;

export const extensionFindingSchema = z.object({
  extension: z.string().max(60),
  verdict: extensionCompatibilitySchema,
  /** What the extension lets the issuer or program do, in plain words. */
  detail: z.string().max(400),
});
export type ExtensionFindingSchemaType = z.infer<typeof extensionFindingSchema>;

export const scaledUiAmountEvidenceSchema = z.object({
  authority: base58AddressSchema.nullable(),
  /** Shortest decimal that round-trips to the on-chain double. */
  multiplier: decimalStringSchema,
  /** Exact decimal expansion of the on-chain double. */
  multiplierExact: decimalStringSchema,
  newMultiplier: decimalStringSchema,
  newMultiplierExact: decimalStringSchema,
  /** Null when no future multiplier is scheduled (timestamp 0). */
  newMultiplierEffectiveAt: z.iso.datetime().nullable(),
});

export const transferFeeEvidenceSchema = z.object({
  basisPoints: z.number().int().min(0).max(10_000),
  maximumFee: rawAmountSchema,
  /** Fee that applies after `newerEpoch`; the older schedule is kept for completeness. */
  newerEpoch: z.string().regex(/^\d+$/),
  olderBasisPoints: z.number().int().min(0).max(10_000),
});

/** Policy verdict for a mint's Token-2022 extension set. `unsupported` blocks admission; `review_required` needs evidence. */
export const extensionAssessmentSchema = z.object({
  compatibility: extensionCompatibilitySchema,
  findings: z.array(extensionFindingSchema),
  scaledUiAmount: scaledUiAmountEvidenceSchema.nullable(),
  transferFee: transferFeeEvidenceSchema.nullable(),
  paused: z.boolean().nullable(),
  defaultAccountState: z.enum(['initialized', 'frozen']).nullable(),
  permanentDelegate: base58AddressSchema.nullable(),
  transferHookProgram: base58AddressSchema.nullable(),
  interestBearing: z.object({ currentRateBasisPoints: z.number().int() }).nullable(),
});
export type ExtensionAssessment = z.infer<typeof extensionAssessmentSchema>;

export const MULTIPLIER_SOURCES = [
  'on_chain',
  'corporate_action',
  'operator',
  'issuer_feed',
] as const;
export const multiplierSourceSchema = z.enum(MULTIPLIER_SOURCES);
export type MultiplierSource = z.infer<typeof multiplierSourceSchema>;

export const instrumentMultiplierSchema = z.object({
  multiplierId: z.number().int(),
  instrumentId: idSchema,
  effectiveAt: z.iso.datetime(),
  multiplier: decimalStringSchema,
  multiplierExact: decimalStringSchema,
  source: multiplierSourceSchema,
  evidence: z.record(z.string(), z.string()),
  recordedAt: z.iso.datetime(),
});
export type InstrumentMultiplier = z.infer<typeof instrumentMultiplierSchema>;

export const multiplierHistoryResponseSchema = z.object({
  instrumentId: idSchema,
  multipliers: z.array(instrumentMultiplierSchema),
});

/** The multiplier in force at `asOf`. `complete: false` means no evidence covers that time; never assume 1. */
export const multiplierAsOfResponseSchema = z.object({
  instrumentId: idSchema,
  asOf: z.iso.datetime(),
  multiplier: decimalStringSchema.nullable(),
  effectiveAt: z.iso.datetime().nullable(),
  source: multiplierSourceSchema.nullable(),
  complete: z.boolean(),
  detail: z.string().max(300),
});
export type MultiplierAsOfResponse = z.infer<typeof multiplierAsOfResponseSchema>;

export const CORPORATE_ACTION_TYPES = [
  'split',
  'reverse_split',
  'distribution',
  'migration',
  'sunset',
  'halt',
  'resume',
  'multiplier_change',
] as const;
export const corporateActionTypeSchema = z.enum(CORPORATE_ACTION_TYPES);
export type CorporateActionType = z.infer<typeof corporateActionTypeSchema>;

export const CORPORATE_ACTION_STATUSES = ['pending', 'applied', 'rejected', 'superseded'] as const;
export const corporateActionStatusSchema = z.enum(CORPORATE_ACTION_STATUSES);
export type CorporateActionStatus = z.infer<typeof corporateActionStatusSchema>;

/** Issuer corporate-action feed, schema version 1 (a Markov contract, not an issuer API). */
export const corporateActionFeedEventSchema = z.object({
  eventId: z.string().max(100),
  productId: z.string().max(100),
  type: corporateActionTypeSchema,
  announcedAt: z.iso.datetime(),
  effectiveAt: z.iso.datetime(),
  summary: z.string().max(2000),
  /** Split: `numerator` new units per `denominator` old units (2:1 doubles the display quantity). */
  ratio: z.object({ numerator: z.number().int(), denominator: z.number().int() }).optional(),
  newMultiplier: z.string().max(60).optional(),
  distribution: z
    .object({ amountPerToken: z.string().max(60), unit: z.string().max(20) })
    .optional(),
  migration: z
    .object({ targetProductId: z.string().max(100), deadlineAt: z.iso.datetime() })
    .optional(),
  sunsetAt: z.iso.datetime().optional(),
  reference: z.string().max(500).optional(),
});
export type CorporateActionFeedEvent = z.infer<typeof corporateActionFeedEventSchema>;

export const corporateActionFeedSchema = z.object({
  schemaVersion: z.literal(ISSUER_FEED_SCHEMA_VERSION),
  issuer: issuerSchema,
  generatedAt: z.iso.datetime(),
  events: z.array(corporateActionFeedEventSchema).max(5000),
});
export type CorporateActionFeed = z.infer<typeof corporateActionFeedSchema>;

export const corporateActionDetailsSchema = z.object({
  ratio: z
    .object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() })
    .nullable(),
  newMultiplier: decimalStringSchema.nullable(),
  distribution: z
    .object({ amountPerToken: decimalStringSchema, unit: z.string().max(20) })
    .nullable(),
  migration: z
    .object({ targetProductId: z.string().max(100), deadlineAt: z.iso.datetime() })
    .nullable(),
  sunsetAt: z.iso.datetime().nullable(),
  reference: z.url().nullable(),
});
export type CorporateActionDetails = z.infer<typeof corporateActionDetailsSchema>;

export const corporateActionSchema = z.object({
  actionId: idSchema,
  instrumentId: idSchema,
  issuer: issuerSchema,
  externalId: z.string().max(100),
  type: corporateActionTypeSchema,
  status: corporateActionStatusSchema,
  announcedAt: z.iso.datetime(),
  effectiveAt: z.iso.datetime(),
  summary: z.string().max(2000),
  details: corporateActionDetailsSchema,
  appliedAt: z.iso.datetime().nullable(),
  appliedBy: z.string().nullable(),
  statusReason: z.string().max(500).nullable(),
  sourceSnapshotId: idSchema,
  createdAt: z.iso.datetime(),
});
export type CorporateAction = z.infer<typeof corporateActionSchema>;

export const corporateActionListResponseSchema = z.object({
  actions: z.array(corporateActionSchema),
});

export const corporateActionIngestionReportSchema = z.object({
  snapshot: issuerSnapshotSchema,
  events: z.array(
    z.object({
      externalId: z.string(),
      productId: z.string(),
      outcome: z.enum(['inserted', 'updated', 'unchanged', 'rejected', 'unmatched']),
      reasons: z.array(z.string().max(200)),
    }),
  ),
  counts: z.object({
    inserted: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    unmatched: z.number().int(),
  }),
});
export type CorporateActionIngestionReport = z.infer<typeof corporateActionIngestionReportSchema>;

export const corporateActionApplyRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  evidence: z.record(z.string().max(60), z.string().max(500)).default({}),
});

export const corporateActionApplyResponseSchema = z.object({
  action: corporateActionSchema,
  /** Multiplier evidence written by this application, if the action changes the multiplier. */
  multiplier: instrumentMultiplierSchema.nullable(),
});

/** Issuer lifecycle state derived from applied corporate actions and on-chain flags. */
export const instrumentLifecycleSchema = z.object({
  halted: z.boolean(),
  haltedReason: z.string().max(500).nullable(),
  pendingActions: z.array(
    z.object({
      actionId: idSchema,
      type: corporateActionTypeSchema,
      effectiveAt: z.iso.datetime(),
    }),
  ),
  migration: z
    .object({
      targetProductId: z.string().max(100),
      targetInstrumentId: idSchema.nullable(),
      deadlineAt: z.iso.datetime(),
    })
    .nullable(),
  sunsetAt: z.iso.datetime().nullable(),
  /** Multiplier currently in force ("1" for unscaled tokens) and since when; null when no evidence exists. */
  currentMultiplier: decimalStringSchema.nullable(),
  multiplierEffectiveAt: z.iso.datetime().nullable(),
});
export type InstrumentLifecycle = z.infer<typeof instrumentLifecycleSchema>;

export const ROUNDING_MODE_NAMES = ['down', 'up', 'half_up', 'half_even'] as const;

export const quantityConversionQuerySchema = z.object({
  raw: rawAmountSchema.optional(),
  scaled: decimalStringSchema.optional(),
  asOf: z.iso.datetime().optional(),
  rounding: z.enum(ROUNDING_MODE_NAMES).default('down'),
});

/** raw ↔ scaled for one instrument at one time; the multiplier used is always returned. */
export const quantityConversionResponseSchema = z.object({
  instrumentId: idSchema,
  asOf: z.iso.datetime(),
  decimals: z.number().int(),
  multiplier: decimalStringSchema,
  multiplierEffectiveAt: z.iso.datetime().nullable(),
  multiplierSource: multiplierSourceSchema,
  raw: rawAmountSchema,
  scaled: decimalStringSchema,
  scaledExact: decimalStringSchema,
  rounding: z.enum(ROUNDING_MODE_NAMES),
  rounded: z.boolean(),
});
export type QuantityConversionResponse = z.infer<typeof quantityConversionResponseSchema>;
