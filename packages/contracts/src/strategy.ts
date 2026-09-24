import { z } from 'zod';
import { instrumentStatusSchema, issuerSchema, tokenProgramSchema } from './catalog.js';
import { base58AddressSchema, idSchema } from './identity.js';

import { basisPointsSchema } from './price.js';
import { plainTextSchema } from './research.js';

/**
 * Versioned stock strategies (B07). A strategy is a person's recipe: exact
 * instrument legs with integer basis-point weights and an explicit cash
 * weight that together equal 10,000. Drafts change with a revision counter;
 * freezing a draft creates an immutable version with admission snapshots
 * and a canonical manifest hash. Forks keep provenance under a new author;
 * instances pin a version explicitly and never move on their own.
 */
export const STRATEGY_SCHEMA_VERSION = '1' as const;
export const STRATEGY_KINDS = ['stock_spot_basket'] as const;
export const strategyKindSchema = z.enum(STRATEGY_KINDS);
export type StrategyKind = z.infer<typeof strategyKindSchema>;

export const STRATEGY_STATUSES = ['active', 'archived'] as const;
export const strategyStatusSchema = z.enum(STRATEGY_STATUSES);
export type StrategyStatus = z.infer<typeof strategyStatusSchema>;

/** Product complexity limit, tightened per deployment by STRATEGY_MAX_LEGS; never a promise that the legs fit one transaction. */
export const MAX_STRATEGY_LEGS = 10;
/** Weights and cash of a recipe always sum to exactly this. */
export const STRATEGY_TOTAL_BPS = 10_000;

export const MAINTENANCE_SUGGESTIONS = [
  'hold',
  'rebalance_on_drift',
  'review_periodically',
] as const;
export const maintenanceSuggestionSchema = z.enum(MAINTENANCE_SUGGESTIONS);

export const maintenanceSchema = z.object({
  suggestion: maintenanceSuggestionSchema.default('hold'),
  /** Drift (in basis points of a leg's target) at which the creator suggests a rebalance review. */
  driftThresholdBps: basisPointsSchema.nullable().default(null),
  reviewEveryDays: z.number().int().min(1).max(365).nullable().default(null),
});
export type Maintenance = z.infer<typeof maintenanceSchema>;

export const strategyLegInputSchema = z.object({
  instrumentId: idSchema,
  /** Integer basis points; zero-weight legs are not legs. */
  weightBps: basisPointsSchema.min(1),
  note: plainTextSchema(200).nullable().default(null),
});
export type StrategyLegInput = z.infer<typeof strategyLegInputSchema>;

/** What a person edits. Twice the leg cap is accepted here so the cap is reported as a validation issue, not a schema error. */
export const strategyDraftContentSchema = z.object({
  title: plainTextSchema(120),
  thesis: plainTextSchema(4000),
  /** A B06 thesis the recipe rests on, when there is one. */
  thesisId: idSchema.nullable().default(null),
  kind: strategyKindSchema.default('stock_spot_basket'),
  legs: z
    .array(strategyLegInputSchema)
    .max(MAX_STRATEGY_LEGS * 2)
    .default([]),
  cashWeightBps: basisPointsSchema.default(0),
  maintenance: maintenanceSchema.default({
    suggestion: 'hold',
    driftThresholdBps: null,
    reviewEveryDays: null,
  }),
  /** Public references (https URLs) the creator cites; never fetched by this service. */
  references: z
    .array(z.url({ protocol: /^https$/ }))
    .max(10)
    .default([]),
});
export type StrategyDraftContent = z.infer<typeof strategyDraftContentSchema>;

export const DRAFT_ISSUE_CODES = [
  'NO_LEGS',
  'TOO_MANY_LEGS',
  'WEIGHTS_TOTAL',
  'DUPLICATE_INSTRUMENT',
  'DUPLICATE_MINT',
  'UNKNOWN_INSTRUMENT',
  'INSTRUMENT_NOT_ADMITTED',
  'ISSUER_CONCENTRATION',
  'COMPANY_CONCENTRATION',
] as const;
export const draftIssueCodeSchema = z.enum(DRAFT_ISSUE_CODES);
export type DraftIssueCode = z.infer<typeof draftIssueCodeSchema>;

export const draftIssueSchema = z.object({
  code: draftIssueCodeSchema,
  /** `error` blocks freezing; `warning` is advisory (the execution policy re-checks the account's real exposure). */
  severity: z.enum(['error', 'warning']),
  path: z.string().max(100),
  message: z.string().max(300),
  /** Machine-readable comparison in the same unit, when one applies. */
  limit: z.number().int().nullable().default(null),
  observed: z.number().int().nullable().default(null),
});
export type DraftIssue = z.infer<typeof draftIssueSchema>;

export const strategyLimitsSchema = z.object({
  schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
  kinds: z.array(strategyKindSchema),
  totalBps: z.literal(STRATEGY_TOTAL_BPS),
  maxLegs: z.number().int().min(1).max(MAX_STRATEGY_LEGS),
  /** Advisory recipe concentration ceilings, from the policy defaults tightened by beta caps. */
  maxIssuerConcentrationBps: basisPointsSchema,
  maxCompanyConcentrationBps: basisPointsSchema,
  ceilingSource: z.enum(['policy_defaults', 'beta_caps']),
});
export type StrategyLimits = z.infer<typeof strategyLimitsSchema>;

export const draftValidationSchema = z.object({
  valid: z.boolean(),
  issues: z.array(draftIssueSchema),
  totals: z.object({
    legsBps: z.number().int(),
    cashBps: z.number().int(),
    totalBps: z.number().int(),
  }),
  limits: strategyLimitsSchema,
  evaluatedAt: z.iso.datetime(),
});
export type DraftValidation = z.infer<typeof draftValidationSchema>;

export const strategyDraftSchema = z.object({
  strategyId: idSchema,
  /** Increments on every save; send it back as `ifRevision` so an edit made elsewhere is detected. */
  revision: z.number().int().positive(),
  content: strategyDraftContentSchema,
  validation: draftValidationSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StrategyDraft = z.infer<typeof strategyDraftSchema>;

export const strategyCreateRequestSchema = z.object({ content: strategyDraftContentSchema });
export type StrategyCreateRequest = z.infer<typeof strategyCreateRequestSchema>;

export const strategyDraftSaveRequestSchema = z.object({
  content: strategyDraftContentSchema,
  ifRevision: z.number().int().positive().optional(),
});
export type StrategyDraftSaveRequest = z.infer<typeof strategyDraftSaveRequestSchema>;

/** The catalog facts captured when a version froze; the version keeps them even if the catalog moves on. */
export const admissionSnapshotSchema = z.object({
  status: instrumentStatusSchema,
  admittedAt: z.iso.datetime().nullable(),
  verificationId: z.number().int().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  mint: base58AddressSchema,
  tokenProgram: tokenProgramSchema,
  decimals: z.number().int().min(0).max(18),
  genesisHash: z.string(),
});
export type AdmissionSnapshot = z.infer<typeof admissionSnapshotSchema>;

export const frozenLegSchema = z.object({
  instrumentId: idSchema,
  weightBps: basisPointsSchema.min(1),
  note: z.string().max(200).nullable(),
  issuer: issuerSchema,
  symbol: z.string(),
  companyName: z.string(),
  admission: admissionSnapshotSchema,
});
export type FrozenLeg = z.infer<typeof frozenLegSchema>;

/** Exposure disclosures derived from the legs; countries are not disclosed until issuer jurisdictions are verified (OD-17, OD-18). */
export const disclosuresSchema = z.object({
  issuers: z.array(z.object({ issuer: issuerSchema, weightBps: basisPointsSchema })),
  companies: z.array(
    z.object({
      companyKey: z.string(),
      companyName: z.string(),
      weightBps: basisPointsSchema,
      instrumentIds: z.array(idSchema),
    }),
  ),
});
export type Disclosures = z.infer<typeof disclosuresSchema>;

export const PUBLICATION_STATES = [
  'unpublished',
  'validated',
  'awaiting_signature',
  'submitted',
  'registered',
  'failed',
  'expired',
  'unknown',
] as const;
export const publicationStateSchema = z.enum(PUBLICATION_STATES);
export const MODERATION_STATUSES = ['none', 'hidden'] as const;
export const moderationStatusSchema = z.enum(MODERATION_STATUSES);

export const forkOfSchema = z.object({ strategyId: idSchema, versionId: idSchema });

export const strategyVersionSchema = z.object({
  versionId: idSchema,
  strategyId: idSchema,
  versionNumber: z.number().int().positive(),
  schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
  kind: strategyKindSchema,
  /** `user:<id>` or `agent:<credential id>`; never published in the manifest. */
  authorPrincipal: z.string(),
  /** Set by on-chain registration (B08); null until then. */
  publisherWallet: base58AddressSchema.nullable(),
  parentVersionId: idSchema.nullable(),
  forkOf: forkOfSchema.nullable(),
  title: z.string(),
  thesis: z.string(),
  thesisId: idSchema.nullable(),
  legs: z.array(frozenLegSchema),
  cashWeightBps: basisPointsSchema,
  maintenance: maintenanceSchema,
  disclosures: disclosuresSchema,
  references: z.array(z.string()),
  /** SHA-256 of the canonical manifest under the domain `markov-strategy-manifest/v<schema>/<genesis>`. */
  manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** SHA-256 of the economic content alone under `markov-strategy-content/v<schema>/<genesis>`; equal for versions whose recipe did not change. */
  contentDigest: z.string().regex(/^[0-9a-f]{64}$/),
  publication: publicationStateSchema,
  moderation: moderationStatusSchema,
  deprecatedBy: idSchema.nullable(),
  frozenAt: z.iso.datetime(),
});
export type StrategyVersion = z.infer<typeof strategyVersionSchema>;

export const versionSummarySchema = strategyVersionSchema.pick({
  versionId: true,
  strategyId: true,
  versionNumber: true,
  title: true,
  manifestHash: true,
  publication: true,
  deprecatedBy: true,
  frozenAt: true,
});
export type VersionSummary = z.infer<typeof versionSummarySchema>;

export const strategySchema = z.object({
  strategyId: idSchema,
  ownerUserId: idSchema,
  status: strategyStatusSchema,
  forkOf: forkOfSchema.nullable(),
  currentVersion: versionSummarySchema.nullable(),
  draftRevision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Strategy = z.infer<typeof strategySchema>;

export const strategyDetailSchema = z.object({
  strategy: strategySchema,
  draft: strategyDraftSchema,
  versions: z.array(versionSummarySchema),
});
export type StrategyDetail = z.infer<typeof strategyDetailSchema>;

export const strategyListResponseSchema = z.object({
  strategies: z.array(strategySchema.extend({ title: z.string() })),
});
export type StrategyListResponse = z.infer<typeof strategyListResponseSchema>;

export const strategyUpdateRequestSchema = z.object({ status: strategyStatusSchema });

export const freezeRequestSchema = z.object({
  ifRevision: z.number().int().positive().optional(),
});
export type FreezeRequest = z.infer<typeof freezeRequestSchema>;

export const forkRequestSchema = z.object({ versionId: idSchema });

export const versionListResponseSchema = z.object({ versions: z.array(strategyVersionSchema) });
export type VersionListResponse = z.infer<typeof versionListResponseSchema>;

export const versionDiffSchema = z.object({
  fromVersionId: idSchema,
  toVersionId: idSchema,
  legs: z.object({
    added: z.array(
      z.object({ instrumentId: idSchema, symbol: z.string(), weightBps: basisPointsSchema }),
    ),
    removed: z.array(
      z.object({ instrumentId: idSchema, symbol: z.string(), weightBps: basisPointsSchema }),
    ),
    changed: z.array(
      z.object({
        instrumentId: idSchema,
        symbol: z.string(),
        fromBps: basisPointsSchema,
        toBps: basisPointsSchema,
      }),
    ),
  }),
  cashWeightBps: z.object({ from: basisPointsSchema, to: basisPointsSchema }),
  titleChanged: z.boolean(),
  thesisChanged: z.boolean(),
  maintenanceChanged: z.boolean(),
  referencesChanged: z.boolean(),
  /** Sum of absolute weight changes across legs and cash, in basis points (turnover, one-sided). */
  turnoverBps: z.number().int().nonnegative(),
});
export type VersionDiff = z.infer<typeof versionDiffSchema>;

/* -------------------------------------------------------------- instances */

export const INSTANCE_STATUSES = ['active', 'closed'] as const;
export const instanceStatusSchema = z.enum(INSTANCE_STATUSES);

/** One person's tracked implementation of a pinned version in a verified wallet. Holdings arrive with B12. */
export const portfolioInstanceSchema = z.object({
  instanceId: idSchema,
  ownerUserId: idSchema,
  strategyId: idSchema,
  pinnedVersionId: idSchema,
  pinnedVersionNumber: z.number().int().positive(),
  /** A newer version the owner has not accepted yet; the pin never moves without an explicit acceptance. */
  proposedVersionId: idSchema.nullable(),
  walletId: idSchema,
  label: z.string().max(80).nullable(),
  status: instanceStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PortfolioInstance = z.infer<typeof portfolioInstanceSchema>;

export const instanceCreateRequestSchema = z.object({
  strategyId: idSchema,
  versionId: idSchema,
  walletId: idSchema,
  label: plainTextSchema(80).nullable().default(null),
});
export type InstanceCreateRequest = z.infer<typeof instanceCreateRequestSchema>;

export const instancePinRequestSchema = z.object({ versionId: idSchema });
export const instanceListResponseSchema = z.object({ instances: z.array(portfolioInstanceSchema) });
export type InstanceListResponse = z.infer<typeof instanceListResponseSchema>;
