import { z } from 'zod';
import { idSchema } from './identity.js';
import { decimalStringSchema, priceKindSchema } from './price.js';

/**
 * Performance analytics (B13). Three things are kept apart and never mixed:
 * the price observations the platform recorded (typed, timed, sourced), the
 * valuation of a subject at a point in time (complete or not, with the
 * reasons), and the metrics derived from a series of valuations and the
 * external flows between them. A model series (a published version's
 * recipe held from its start) and an actual series (a person's executed
 * holdings) carry their kind everywhere so nothing ranks one as the other.
 */

export const PERFORMANCE_METHODOLOGY_VERSION = 'stocks-v1' as const;
export const VALUATION_CURRENCY = 'USD' as const;
/** A price older than this at a valuation point does not value anything; the point is incomplete. */
export const PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Product rule, not a statistical claim: a model series ranks only with at least this much complete history. */
export const RANKING_MIN_HISTORY_DAYS = 30;
/** A stablecoin observation this far from one unit of the currency is reported as a depeg. */
export const STABLECOIN_DEPEG_BPS = 50;
/** Reported decimal places of values, returns and ratios (the arithmetic itself is exact). */
export const VALUE_SCALE = 6;
export const RETURN_SCALE = 8;

export const PERFORMANCE_PERIODS = ['7d', '30d', '90d', '365d', 'all'] as const;
export const performancePeriodSchema = z.enum(PERFORMANCE_PERIODS);
export type PerformancePeriod = z.infer<typeof performancePeriodSchema>;
export const PERFORMANCE_PERIOD_DAYS: Record<PerformancePeriod, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
  all: null,
};

export const SERIES_KINDS = ['model', 'actual'] as const;
export const seriesKindSchema = z.enum(SERIES_KINDS);
export type SeriesKind = z.infer<typeof seriesKindSchema>;

export const SUBJECT_TYPES = ['version', 'instance', 'wallet'] as const;
export const subjectTypeSchema = z.enum(SUBJECT_TYPES);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

/* ------------------------------------------------------ price observations */

/** Where a recorded observation came from. `fixture` exists only outside production. */
export const PRICE_OBSERVATION_SOURCE_KINDS = ['issuer_feed', 'operator', 'fixture'] as const;
export const priceObservationSourceKindSchema = z.enum(PRICE_OBSERVATION_SOURCE_KINDS);
export type PriceObservationSourceKind = z.infer<typeof priceObservationSourceKindSchema>;

/** Kinds an observation may carry. Execution quotes and cost bases are not observations of a market. */
export const OBSERVABLE_PRICE_KINDS = [
  'secondary_market',
  'issuer_mark',
  'underlying_equity',
  'implied_valuation',
] as const;
export const observablePriceKindSchema = z.enum(OBSERVABLE_PRICE_KINDS);
export type ObservablePriceKind = z.infer<typeof observablePriceKindSchema>;

/** `SOL` for lamports, otherwise a mint address. */
export const priceAssetSchema = z.union([z.literal('SOL'), z.string().min(32).max(44)]);

export const priceObservationSchema = z.object({
  observationId: z.number().int(),
  asset: priceAssetSchema,
  instrumentId: idSchema.nullable(),
  kind: observablePriceKindSchema,
  value: decimalStringSchema,
  unit: z.string().min(1).max(20),
  observedAt: z.iso.datetime(),
  /** Secret-free source name (issuer, venue, operator label). */
  source: z.string().min(1).max(200),
  sourceKind: priceObservationSourceKindSchema,
  recordedAt: z.iso.datetime(),
});
export type PriceObservation = z.infer<typeof priceObservationSchema>;

/** An operator records an observation with its evidence; the value is never a quote. */
export const priceObservationRequestSchema = z
  .object({
    instrumentId: idSchema.optional(),
    /** `SOL` only; instruments are named by id. */
    asset: z.literal('SOL').optional(),
    kind: observablePriceKindSchema,
    value: decimalStringSchema.refine((value) => !value.startsWith('-'), 'a price is not negative'),
    unit: z.string().min(1).max(20).default('USD'),
    observedAt: z.iso.datetime(),
    source: z.string().min(1).max(200),
    evidence: z.record(z.string().max(60), z.string().max(500)).default({}),
  })
  .refine(
    (request) => (request.instrumentId === undefined) !== (request.asset === undefined),
    'name exactly one of instrumentId or asset',
  );
export type PriceObservationRequest = z.infer<typeof priceObservationRequestSchema>;

export const priceHistoryQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export type PriceHistoryQuery = z.infer<typeof priceHistoryQuerySchema>;

export const priceHistoryResponseSchema = z.object({
  asset: priceAssetSchema,
  instrumentId: idSchema.nullable(),
  observations: z.array(priceObservationSchema),
  /** Fixed wording: a reference price is not an executable offer. */
  note: z.string(),
});
export type PriceHistoryResponse = z.infer<typeof priceHistoryResponseSchema>;

/* ------------------------------------------------------------ valuation */

/** Why a position or point could not be valued. Any issue makes the point incomplete. */
export const VALUATION_ISSUE_CODES = [
  'no_observation',
  'stale_price',
  'price_unit_mismatch',
  'excluded_price_kind',
  'multiplier_unknown',
  'unpriced_flow',
  'zero_base',
  'negative_quantity',
] as const;
export const valuationIssueCodeSchema = z.enum(VALUATION_ISSUE_CODES);
export type ValuationIssueCode = z.infer<typeof valuationIssueCodeSchema>;

/** Stated assumptions a reader must know; they do not make a point incomplete. */
export const VALUATION_CAVEAT_CODES = [
  'stablecoin_par',
  'stablecoin_depeg',
  'underlying_as_token_price',
  'model_no_costs',
  'model_buy_and_hold',
] as const;
export const valuationCaveatCodeSchema = z.enum(VALUATION_CAVEAT_CODES);
export type ValuationCaveatCode = z.infer<typeof valuationCaveatCodeSchema>;

export const valuationIssueSchema = z.object({
  code: valuationIssueCodeSchema,
  asset: priceAssetSchema.nullable(),
  detail: z.string().max(300),
});
export type ValuationIssue = z.infer<typeof valuationIssueSchema>;

export const pricePointSchema = z.object({
  value: decimalStringSchema,
  unit: z.string(),
  kind: priceKindSchema,
  observedAt: z.iso.datetime(),
  source: z.string(),
  /** Milliseconds between the observation and the valuation point. */
  ageMs: z.number().int().nonnegative(),
});
export type PricePoint = z.infer<typeof pricePointSchema>;

export const valuationPositionSchema = z.object({
  asset: priceAssetSchema,
  symbol: z.string(),
  decimals: z.number().int().min(0).max(18),
  /** Signed raw base units held at the point. */
  raw: z.string().regex(/^-?\d+$/),
  /** The multiplier in force at the point (`1` for unscaled tokens); null when unknown. */
  multiplier: decimalStringSchema.nullable(),
  /** raw × multiplier / 10^decimals, exact. */
  scaledQuantity: decimalStringSchema.nullable(),
  price: pricePointSchema.nullable(),
  /** scaledQuantity × price in the valuation currency, exact to VALUE_SCALE; null when unpriced. */
  value: decimalStringSchema.nullable(),
  issues: z.array(valuationIssueSchema),
  caveats: z.array(valuationCaveatCodeSchema),
});
export type ValuationPosition = z.infer<typeof valuationPositionSchema>;

export const valuationPointSchema = z.object({
  at: z.iso.datetime(),
  /** Sum of the position values; null when any position is unpriced. */
  value: decimalStringSchema.nullable(),
  complete: z.boolean(),
  /** Net external flow into the subject since the previous point, in the valuation currency; null when a flow could not be valued. */
  netFlow: decimalStringSchema.nullable(),
  /** Chained time-weighted index (100 at the series start); null once the chain is broken. */
  index: decimalStringSchema.nullable(),
  issues: z.array(valuationIssueSchema),
  caveats: z.array(valuationCaveatCodeSchema),
});
export type ValuationPoint = z.infer<typeof valuationPointSchema>;

export const FLOW_KINDS = [
  'external_inflow',
  'external_outflow',
  'contribution',
  'withdrawal',
] as const;
export const flowKindSchema = z.enum(FLOW_KINDS);
export type FlowKind = z.infer<typeof flowKindSchema>;

/** One external flow of value into (+) or out of (−) the subject, valued at its time. */
export const valuedFlowSchema = z.object({
  at: z.iso.datetime(),
  kind: flowKindSchema,
  asset: priceAssetSchema,
  /** Signed raw base units from the subject's point of view. */
  raw: z.string().regex(/^-?\d+$/),
  /** Signed value in the valuation currency; null when the asset was unpriced at that time. */
  value: decimalStringSchema.nullable(),
  /** The journal entry, lot or consumption the flow comes from. */
  ref: z.string().max(120),
});
export type ValuedFlow = z.infer<typeof valuedFlowSchema>;

/* --------------------------------------------------------------- series */

export const seriesSubjectSchema = z.object({
  type: subjectTypeSchema,
  id: idSchema,
  label: z.string().max(200),
});
export type SeriesSubject = z.infer<typeof seriesSubjectSchema>;

export const performanceSeriesSchema = z.object({
  kind: seriesKindSchema,
  subject: seriesSubjectSchema,
  methodologyVersion: z.literal(PERFORMANCE_METHODOLOGY_VERSION),
  currency: z.literal(VALUATION_CURRENCY),
  /** Null when nothing could start the series (no holdings, or no priced start for a model). */
  start: z.iso.datetime().nullable(),
  end: z.iso.datetime(),
  points: z.array(valuationPointSchema),
  flows: z.array(valuedFlowSchema),
  /** The positions behind the last point. */
  latest: z.array(valuationPositionSchema),
});
export type PerformanceSeries = z.infer<typeof performanceSeriesSchema>;

export const drawdownSchema = z.object({
  /** Peak-to-trough decline of the time-weighted index as a fraction (0.25 = 25%). */
  value: decimalStringSchema,
  peakAt: z.iso.datetime(),
  troughAt: z.iso.datetime(),
});
export type Drawdown = z.infer<typeof drawdownSchema>;

/** Why a window's return is not reported. */
export const METRIC_UNAVAILABLE_REASONS = [
  'no_series',
  'insufficient_history',
  'incomplete_points',
  'zero_base',
  'unpriced_flow',
  'stale_end',
] as const;
export const metricUnavailableReasonSchema = z.enum(METRIC_UNAVAILABLE_REASONS);
export type MetricUnavailableReason = z.infer<typeof metricUnavailableReasonSchema>;

export const completenessSchema = z.object({
  expectedPoints: z.number().int().nonnegative(),
  completePoints: z.number().int().nonnegative(),
  /** completePoints / expectedPoints to RETURN_SCALE; `1` only when nothing is missing. */
  ratio: decimalStringSchema,
  /** The first (at most 30) incomplete points with their reasons. */
  missing: z.array(z.object({ at: z.iso.datetime(), issues: z.array(valuationIssueSchema) })),
  /** Whole days between the series start and its end. */
  historyDays: z.number().int().nonnegative(),
  /** The end point is complete and every price it uses is within PRICE_MAX_AGE_MS. */
  endFresh: z.boolean(),
});
export type Completeness = z.infer<typeof completenessSchema>;

export const windowMetricsSchema = z.object({
  period: performancePeriodSchema,
  /** The point the window starts at; null when the history is too short. */
  start: z.iso.datetime().nullable(),
  end: z.iso.datetime(),
  available: z.boolean(),
  reasons: z.array(metricUnavailableReasonSchema),
  /** Chained subperiod returns between flows, as a fraction (0.1 = 10%). */
  timeWeightedReturn: decimalStringSchema.nullable(),
  /** Modified Dietz return of the window: flows weighted by the time they were in the portfolio. */
  moneyWeightedReturn: decimalStringSchema.nullable(),
  maxDrawdown: drawdownSchema.nullable(),
  startValue: decimalStringSchema.nullable(),
  endValue: decimalStringSchema.nullable(),
  /** Sum of external flows in the window (a deposit raises this, never a return). */
  netFlows: decimalStringSchema.nullable(),
  /** Traded value in the window divided by the average valuation; 0 for a model series. */
  turnover: decimalStringSchema.nullable(),
  tradedValue: decimalStringSchema.nullable(),
  realizedPnl: decimalStringSchema.nullable(),
  unrealizedPnl: decimalStringSchema.nullable(),
  fees: z.object({ lamports: z.string().regex(/^\d+$/), value: decimalStringSchema.nullable() }),
  completeness: completenessSchema,
});
export type WindowMetrics = z.infer<typeof windowMetricsSchema>;

export const methodologySummarySchema = z.object({
  version: z.literal(PERFORMANCE_METHODOLOGY_VERSION),
  currency: z.literal(VALUATION_CURRENCY),
  priceMaxAgeMs: z.number().int().positive(),
  rankingMinHistoryDays: z.number().int().positive(),
  stablecoinDepegBps: z.number().int().positive(),
  pricing: z.string(),
  cashTreatment: z.string(),
  flows: z.string(),
  returns: z.string(),
  modelAssumptions: z.string(),
  document: z.string(),
});
export type MethodologySummary = z.infer<typeof methodologySummarySchema>;

export const performanceResponseSchema = z.object({
  series: performanceSeriesSchema,
  metrics: windowMetricsSchema,
  methodology: methodologySummarySchema,
  /** Fixed wording about what the numbers are and are not. */
  note: z.string(),
});
export type PerformanceResponse = z.infer<typeof performanceResponseSchema>;

export const performanceQuerySchema = z.object({
  period: performancePeriodSchema.default('all'),
});
export type PerformanceQuery = z.infer<typeof performanceQuerySchema>;

/** The complete record behind a performance answer, for offline checking. */
export const performanceExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  methodology: methodologySummarySchema,
  series: performanceSeriesSchema,
  metrics: z.array(windowMetricsSchema),
  observations: z.array(priceObservationSchema),
  multipliers: z.array(
    z.object({
      asset: priceAssetSchema,
      effectiveAt: z.iso.datetime(),
      multiplier: decimalStringSchema,
      source: z.string(),
    }),
  ),
});
export type PerformanceExport = z.infer<typeof performanceExportSchema>;

/* -------------------------------------------------------------- ranking */

export const RANKING_INELIGIBILITY_REASONS = [
  'insufficient_history',
  'incomplete_window',
  'stale_end',
  'no_series',
  'zero_base',
  'not_model_series',
] as const;
export const rankingIneligibilityReasonSchema = z.enum(RANKING_INELIGIBILITY_REASONS);
export type RankingIneligibilityReason = z.infer<typeof rankingIneligibilityReasonSchema>;

export const rankingEntrySchema = z.object({
  /** 1-based rank among the eligible entries; null when not ranked. */
  rank: z.number().int().positive().nullable(),
  strategyId: idSchema,
  versionId: idSchema,
  versionNumber: z.number().int().positive(),
  title: z.string(),
  kind: z.literal('model'),
  /** Null when not ranked: an incomplete series never shows a return next to a rank. */
  timeWeightedReturn: decimalStringSchema.nullable(),
  maxDrawdown: decimalStringSchema.nullable(),
  historyDays: z.number().int().nonnegative(),
  completeness: completenessSchema.nullable(),
  eligible: z.boolean(),
  reasons: z.array(rankingIneligibilityReasonSchema),
});
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

export const rankingQuerySchema = z.object({
  period: z.enum(['30d', '90d', '365d']).default('30d'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RankingQuery = z.infer<typeof rankingQuerySchema>;

export const rankingResponseSchema = z.object({
  period: z.enum(['30d', '90d', '365d']),
  kind: z.literal('model'),
  methodologyVersion: z.literal(PERFORMANCE_METHODOLOGY_VERSION),
  asOf: z.iso.datetime(),
  minHistoryDays: z.number().int().positive(),
  entries: z.array(rankingEntrySchema),
  /** Fixed wording: model series of published recipes, not anyone's account. */
  note: z.string(),
});
export type RankingResponse = z.infer<typeof rankingResponseSchema>;
