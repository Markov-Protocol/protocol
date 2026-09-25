import { z } from 'zod';
import {
  completenessSchema,
  PERFORMANCE_METHODOLOGY_VERSION,
  rankingIneligibilityReasonSchema,
} from './analytics.js';
import { issuerSchema } from './catalog.js';
import { base58AddressSchema, idSchema } from './identity.js';
import { basisPointsSchema, decimalStringSchema } from './price.js';
import { registryRecordStatusSchema, sha256HexSchema } from './registry.js';
import { forkOfSchema, moderationStatusSchema } from './strategy.js';

/**
 * Discovery (B14): the public explorer over registered strategies, creator
 * provenance and platform moderation.
 *
 * Every row is a projection of public facts only: a registered, unmoderated
 * version of an active strategy, its chain record, the wallet that signed
 * the registration, the follower count and the model-series ranking entry
 * under one period and one methodology version. Drafts, unpublished
 * versions, instances, wallets, holdings and account identifiers are never
 * part of the projection; the schemas below have no field for them.
 */

export const DISCOVERY_SORTS = ['rank', 'newest', 'followers'] as const;
export const discoverySortSchema = z.enum(DISCOVERY_SORTS);
export type DiscoverySort = z.infer<typeof discoverySortSchema>;

export const DISCOVERY_PERIODS = ['30d', '90d', '365d'] as const;
export const discoveryPeriodSchema = z.enum(DISCOVERY_PERIODS);
export type DiscoveryPeriod = z.infer<typeof discoveryPeriodSchema>;

export const DISCOVERY_PAGE_MAX = 100;
export const DISCOVERY_POPULATION_MAX = 500;
/** Characters of the thesis shown in a row; the full text is on the public version. */
export const THESIS_EXCERPT_MAX = 240;

export const discoveryQuerySchema = z.object({
  /** Case-insensitive match on the title, the thesis, a constituent symbol or company name. */
  q: z.string().trim().max(60).optional(),
  /** Strategies with at least one constituent from this issuer. */
  issuer: issuerSchema.optional(),
  /** Strategies with this instrument among their constituents. */
  instrumentId: idSchema.optional(),
  /** Strategies whose newest public version was registered by this wallet. */
  creator: base58AddressSchema.optional(),
  /** The ranking period the performance column answers for. */
  period: discoveryPeriodSchema.default('30d'),
  sort: discoverySortSchema.default('rank'),
  limit: z.coerce.number().int().min(1).max(DISCOVERY_PAGE_MAX).default(25),
  cursor: z.string().max(200).optional(),
});
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;

export const creatorQuerySchema = z.object({
  period: discoveryPeriodSchema.default('30d'),
});
export type CreatorQuery = z.infer<typeof creatorQuerySchema>;

export const discoveryConstituentSchema = z.object({
  instrumentId: idSchema,
  symbol: z.string(),
  companyName: z.string(),
  issuer: issuerSchema,
  weightBps: basisPointsSchema.min(1),
});
export type DiscoveryConstituent = z.infer<typeof discoveryConstituentSchema>;

/** The ranking entry of the row's newest public version under the query's period; never a claim by the creator. */
export const discoveryPerformanceSchema = z.object({
  period: discoveryPeriodSchema,
  methodologyVersion: z.literal(PERFORMANCE_METHODOLOGY_VERSION),
  eligible: z.boolean(),
  /** 1-based position among the eligible versions of the model ranking; null when unranked. */
  rank: z.number().int().positive().nullable(),
  /** Null whenever the entry is unranked: an incomplete series never shows a return. */
  timeWeightedReturn: decimalStringSchema.nullable(),
  maxDrawdown: decimalStringSchema.nullable(),
  historyDays: z.number().int().nonnegative(),
  completeness: completenessSchema.nullable(),
  reasons: z.array(rankingIneligibilityReasonSchema),
});
export type DiscoveryPerformance = z.infer<typeof discoveryPerformanceSchema>;

export const discoveryVersionSchema = z.object({
  versionId: idSchema,
  versionNumber: z.number().int().positive(),
  title: z.string(),
  manifestHash: sha256HexSchema,
  recordAddress: base58AddressSchema,
  status: registryRecordStatusSchema,
  /** The wallet that signed the registration: the only creator identity the platform asserts. */
  publisher: base58AddressSchema,
  registeredAt: z.iso.datetime(),
  frozenAt: z.iso.datetime(),
  parentVersionId: idSchema.nullable(),
  legCount: z.number().int().positive(),
  cashWeightBps: basisPointsSchema,
  constituents: z.array(discoveryConstituentSchema),
});
export type DiscoveryVersion = z.infer<typeof discoveryVersionSchema>;

export const discoveryStrategySchema = z.object({
  strategyId: idSchema,
  title: z.string(),
  thesisExcerpt: z.string().max(THESIS_EXCERPT_MAX + 1),
  forkOf: forkOfSchema.nullable(),
  creator: z.object({ publisherWallet: base58AddressSchema }),
  /** Distinct issuers across the newest public version's constituents. */
  issuers: z.array(issuerSchema),
  /** Registered, unmoderated versions of the strategy. */
  versionCount: z.number().int().positive(),
  /** People following the strategy; a count, never who. */
  followerCount: z.number().int().nonnegative(),
  latestVersion: discoveryVersionSchema,
  performance: discoveryPerformanceSchema,
});
export type DiscoveryStrategy = z.infer<typeof discoveryStrategySchema>;

export const discoveryResponseSchema = z.object({
  strategies: z.array(discoveryStrategySchema).max(DISCOVERY_PAGE_MAX),
  nextCursor: z.string().nullable(),
  /** Rows matching the filters before pagination. */
  matched: z.number().int().nonnegative(),
  period: discoveryPeriodSchema,
  sort: discoverySortSchema,
  methodologyVersion: z.literal(PERFORMANCE_METHODOLOGY_VERSION),
  minHistoryDays: z.number().int().positive(),
  asOf: z.iso.datetime(),
  /** Fixed wording: what is listed, what ranks and what never does. */
  note: z.string(),
});
export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;

export const creatorProfileSchema = z.object({
  publisherWallet: base58AddressSchema,
  strategyCount: z.number().int().positive(),
  /** Registered, unmoderated versions this wallet signed across the listed strategies. */
  versionCount: z.number().int().positive(),
  followerCount: z.number().int().nonnegative(),
  firstRegisteredAt: z.iso.datetime(),
  latestRegisteredAt: z.iso.datetime(),
  strategies: z.array(discoveryStrategySchema).max(DISCOVERY_POPULATION_MAX),
  note: z.string(),
});
export type CreatorProfile = z.infer<typeof creatorProfileSchema>;

/* ------------------------------------------------------------ moderation */

export const moderationDecisionRequestSchema = z.object({
  status: moderationStatusSchema,
  reason: z.string().trim().min(3).max(500),
  /** Where the decision is documented (a ticket, a notice); never required. */
  reference: z.string().url().max(500).nullable().default(null),
});
export type ModerationDecisionRequest = z.infer<typeof moderationDecisionRequestSchema>;

export const moderationDecisionSchema = z.object({
  decisionId: idSchema,
  strategyId: idSchema,
  versionId: idSchema,
  versionNumber: z.number().int().positive(),
  status: moderationStatusSchema,
  previousStatus: moderationStatusSchema,
  reason: z.string(),
  reference: z.string().nullable(),
  /** The operator credential that decided; an id, never a person's name. */
  decidedBy: z.string(),
  decidedAt: z.iso.datetime(),
});
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

export const moderationHistoryResponseSchema = z.object({
  strategyId: idSchema,
  /** Every version of the strategy with its moderation status in force. */
  versions: z.array(
    z.object({
      versionId: idSchema,
      versionNumber: z.number().int().positive(),
      moderation: moderationStatusSchema,
      publication: z.string(),
    }),
  ),
  /** Newest decision first. */
  decisions: z.array(moderationDecisionSchema),
});
export type ModerationHistoryResponse = z.infer<typeof moderationHistoryResponseSchema>;
