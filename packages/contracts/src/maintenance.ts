import { z } from 'zod';
import { instanceAllocationSchema } from './analytics.js';
import { capabilityStatusSchema } from './capabilities.js';
import { idSchema } from './identity.js';
import { budgetModeSchema } from './planning.js';
import { policySideSchema, venueSchema } from './policy.js';
import { basisPointsSchema, decimalStringSchema, rawAmountSchema } from './price.js';
import { plainTextSchema } from './research.js';

/**
 * Maintenance (B16): durable schedules that prepare proposals for the
 * owner's approval, drift-driven rebalance proposals, and the optional
 * mandate dry-run interface. Nothing here executes: a schedule creates a
 * proposal and a notification, never a transaction, and the API names the
 * mode explicitly (`prepare_for_approval`).
 */

export const MAINTENANCE_SCHEMA_VERSION = '1' as const;

/* ------------------------------------------------------------ schedules */

export const SCHEDULE_KINDS = ['recurring_investment', 'drift_rebalance'] as const;
export const scheduleKindSchema = z.enum(SCHEDULE_KINDS);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;

/**
 * `active` runs; `paused` keeps its place and creates nothing; `cancelled`
 * is the owner's end; `revoked` is the platform's end (the wallet was
 * unlinked, the instance archived, the credential revoked). Neither end
 * touches a proposal already made or an intent already opened.
 */
export const SCHEDULE_STATUSES = ['active', 'paused', 'cancelled', 'revoked'] as const;
export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);
export type ScheduleStatus = z.infer<typeof scheduleStatusSchema>;

/** The only mode in V1: the scheduler prepares a proposal that the owner reviews, plans, acknowledges and signs. */
export const SCHEDULE_MODES = ['prepare_for_approval'] as const;
export const scheduleModeSchema = z.enum(SCHEDULE_MODES);

export const CADENCE_UNITS = ['day', 'week', 'month'] as const;
export const cadenceUnitSchema = z.enum(CADENCE_UNITS);
export type CadenceUnit = z.infer<typeof cadenceUnitSchema>;

/**
 * Missed occurrences (whose review window closed before the scheduler saw
 * them) are skipped by default: several missed budgets never accumulate
 * into one surprise. `catch_up_latest` proposes only the most recent missed
 * occurrence, once.
 */
export const MISSED_RUN_POLICIES = ['skip', 'catch_up_latest'] as const;
export const missedRunPolicySchema = z.enum(MISSED_RUN_POLICIES);
export type MissedRunPolicy = z.infer<typeof missedRunPolicySchema>;

/** IANA time zone name; the pure cadence rules refuse a name the runtime does not know. */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/]+$/, 'must be an IANA time zone name');

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM (24 h)');

/**
 * A wall-clock rule in the owner's time zone. Daylight-saving changes keep
 * the wall-clock time: a rule at 09:00 fires at 09:00 local before and after
 * the change; a wall-clock time that does not exist on a change day fires at
 * the first instant after the gap, and an ambiguous one fires once, at its
 * first instant.
 */
export const cadenceSchema = z
  .object({
    unit: cadenceUnitSchema,
    /** Every `interval` units (every day, every 2 weeks, every 3 months). */
    interval: z.number().int().min(1).max(12).default(1),
    timeOfDay: timeOfDaySchema.default('09:00'),
    /** 0 = Sunday … 6 = Saturday; weekly rules only. */
    weekday: z.number().int().min(0).max(6).nullable().default(null),
    /** 1..31; a day the month lacks is clamped to its last day; monthly rules only. */
    dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
    timeZone: timeZoneSchema,
  })
  .refine((cadence) => cadence.unit !== 'week' || cadence.weekday !== null, {
    message: 'a weekly cadence names its weekday',
    path: ['weekday'],
  })
  .refine((cadence) => cadence.unit !== 'month' || cadence.dayOfMonth !== null, {
    message: 'a monthly cadence names its day of the month',
    path: ['dayOfMonth'],
  });
export type Cadence = z.infer<typeof cadenceSchema>;

/** What a recurring investment occurrence proposes: a pinned version or one admitted instrument, from one of the owner's wallets. */
export const investmentTargetSchema = z
  .object({
    strategyVersionId: idSchema.nullable().default(null),
    instrumentId: idSchema.nullable().default(null),
    walletId: idSchema,
    /** The most an occurrence may suggest, raw stablecoin units; the proposal carries exactly this budget. */
    budget: z.object({ rawAmount: rawAmountSchema }),
    budgetMode: budgetModeSchema.default('all_in_stablecoin'),
    /** Null takes the owner's effective slippage limit at proposal time; never widened by a schedule. */
    slippageBps: basisPointsSchema.min(1).max(1000).nullable().default(null),
  })
  .refine(
    (target) => (target.strategyVersionId === null) !== (target.instrumentId === null),
    'name exactly one of strategyVersionId or instrumentId',
  );
export type InvestmentTarget = z.infer<typeof investmentTargetSchema>;

/** What a drift schedule watches: one of the owner's instances, against a threshold. */
export const driftTargetSchema = z.object({
  instanceId: idSchema,
  /** Null takes the creator's suggested threshold from the pinned version; a version without one proposes nothing. */
  driftThresholdBps: basisPointsSchema.min(50).max(5000).nullable().default(null),
  /** No second rebalance proposal within this many hours of the last, whatever the drift. */
  minIntervalHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
});
export type DriftTarget = z.infer<typeof driftTargetSchema>;

const scheduleCommon = {
  schemaVersion: z.literal(MAINTENANCE_SCHEMA_VERSION).default(MAINTENANCE_SCHEMA_VERSION),
  label: plainTextSchema(100),
  cadence: cadenceSchema,
  /** First instant an occurrence may fall on; defaults to creation time. */
  startAt: z.iso.datetime().nullable().default(null),
  endAt: z.iso.datetime().nullable().default(null),
  /** Hours an occurrence's proposal stays open for review before it expires. */
  reviewWindowHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 7)
    .default(24),
  missedRunPolicy: missedRunPolicySchema.default('skip'),
  /** The API names the mode; nothing else is accepted. */
  mode: scheduleModeSchema.default('prepare_for_approval'),
};

export const scheduleCreateRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    ...scheduleCommon,
    kind: z.literal('recurring_investment'),
    target: investmentTargetSchema,
  }),
  z.object({ ...scheduleCommon, kind: z.literal('drift_rebalance'), target: driftTargetSchema }),
]);
export type ScheduleCreateRequest = z.infer<typeof scheduleCreateRequestSchema>;

/** Fields the owner may change in place; the kind, the target's wallet and instance never change (cancel and create instead). */
export const scheduleUpdateRequestSchema = z
  .object({
    label: plainTextSchema(100).optional(),
    cadence: cadenceSchema.optional(),
    endAt: z.iso.datetime().nullable().optional(),
    reviewWindowHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 7)
      .optional(),
    missedRunPolicy: missedRunPolicySchema.optional(),
    /** Recurring investments: the budget and slippage of future occurrences. */
    budget: z.object({ rawAmount: rawAmountSchema }).optional(),
    slippageBps: basisPointsSchema.min(1).max(1000).nullable().optional(),
    /** Drift schedules: threshold and spacing. */
    driftThresholdBps: basisPointsSchema.min(50).max(5000).nullable().optional(),
    minIntervalHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .optional(),
  })
  .refine((update) => Object.keys(update).length > 0, 'nothing to update');
export type ScheduleUpdateRequest = z.infer<typeof scheduleUpdateRequestSchema>;

export const OCCURRENCE_STATUSES = [
  'proposed',
  'skipped',
  'failed',
  'expired',
  'opened',
  'dismissed',
] as const;
export const occurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatus = z.infer<typeof occurrenceStatusSchema>;

/** Why an occurrence made no proposal (skipped or failed). */
export const OCCURRENCE_REASONS = [
  'missed_window',
  'superseded_by_catch_up',
  'schedule_not_active',
  'no_drift',
  'within_min_interval',
  'open_proposal_exists',
  'threshold_unset',
  'policy_denied',
  'target_unavailable',
  'error',
] as const;
export const occurrenceReasonSchema = z.enum(OCCURRENCE_REASONS);
export type OccurrenceReason = z.infer<typeof occurrenceReasonSchema>;

export const occurrenceSchema = z.object({
  occurrenceId: idSchema,
  scheduleId: idSchema,
  /** 1-based ordinal of the occurrence since the schedule's start; the dedup key is `schedule:<id>:<sequence>`. */
  sequence: z.number().int().positive(),
  dueAt: z.iso.datetime(),
  /** The proposal, when one exists, expires here at the latest. */
  windowEndsAt: z.iso.datetime(),
  status: occurrenceStatusSchema,
  reason: occurrenceReasonSchema.nullable(),
  detail: z.string().max(500).nullable(),
  proposalId: idSchema.nullable(),
  dedupKey: z.string().max(120),
  decidedAt: z.iso.datetime(),
});
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const scheduleSchema = z.object({
  schemaVersion: z.literal(MAINTENANCE_SCHEMA_VERSION),
  scheduleId: idSchema,
  kind: scheduleKindSchema,
  status: scheduleStatusSchema,
  mode: scheduleModeSchema,
  label: z.string(),
  cadence: cadenceSchema,
  target: z.union([investmentTargetSchema, driftTargetSchema]),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime().nullable(),
  reviewWindowHours: z.number().int(),
  missedRunPolicy: missedRunPolicySchema,
  /** The next occurrence an active schedule will consider; null when paused, ended or over. */
  nextDueAt: z.iso.datetime().nullable(),
  /** Sequence of the last occurrence decided (0 before the first). */
  lastSequence: z.number().int().nonnegative(),
  lastOccurrence: occurrenceSchema.nullable(),
  counts: z.object({
    proposed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  statusReason: z.string().max(300).nullable(),
  pausedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** What the platform does with an occurrence; the same sentence on every schedule. */
  note: z.string().max(600),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleQuerySchema = z.object({
  status: scheduleStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const scheduleListResponseSchema = z.object({
  schedules: z.array(scheduleSchema),
  note: z.string().max(600),
});
export type ScheduleListResponse = z.infer<typeof scheduleListResponseSchema>;
export const occurrenceQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const occurrenceListResponseSchema = z.object({
  occurrences: z.array(occurrenceSchema),
  note: z.string().max(600),
});
export type OccurrenceListResponse = z.infer<typeof occurrenceListResponseSchema>;

/** Preview of a cadence: the next instants it would fire, with the wall-clock time and UTC offset each one has. */
export const schedulePreviewRequestSchema = z.object({
  cadence: cadenceSchema,
  startAt: z.iso.datetime().nullable().default(null),
  count: z.number().int().min(1).max(30).default(5),
});
export type SchedulePreviewRequest = z.infer<typeof schedulePreviewRequestSchema>;
export const previewedOccurrenceSchema = z.object({
  sequence: z.number().int().positive(),
  dueAt: z.iso.datetime(),
  localTime: z.string().max(40),
  utcOffsetMinutes: z.number().int(),
});
export const schedulePreviewResponseSchema = z.object({
  timeZone: timeZoneSchema,
  occurrences: z.array(previewedOccurrenceSchema),
  note: z.string().max(600),
});
export type SchedulePreviewResponse = z.infer<typeof schedulePreviewResponseSchema>;

/* ------------------------------------------------------------ the tick */

/** One maintenance pass: what the worker (or an operator) ran and what it found. */
export const maintenanceRunRequestSchema = z.object({
  /** Schedules and notifications processed per pass; bounded so a pass stays short. */
  batchSize: z.number().int().min(1).max(500).default(100),
  requestedBy: z.string().min(1).max(200).default('worker'),
});
export type MaintenanceRunRequest = z.infer<typeof maintenanceRunRequestSchema>;

export const maintenanceRunReportSchema = z.object({
  ranAt: z.iso.datetime(),
  requestedBy: z.string(),
  schedules: z.object({
    considered: z.number().int().nonnegative(),
    proposed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    /** Occurrences whose review window closed unopened this pass. */
    expired: z.number().int().nonnegative(),
  }),
  notifications: z.object({
    projected: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    retried: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
  }),
  durationMs: z.number().int().nonnegative(),
});
export type MaintenanceRunReport = z.infer<typeof maintenanceRunReportSchema>;

/* ------------------------------------------------------------ rebalance */

/** A reviewed rebalance leg: one ordinary intent the owner's open creates, sized from the allocation the proposal carried. */
export const rebalanceLegSchema = z.object({
  instrumentId: idSchema,
  symbol: z.string().max(32),
  side: policySideSchema,
  driftBps: z.number().int(),
  /** Sells: raw units of the instrument to sell. Buys: raw stablecoin units to spend. */
  rawAmount: rawAmountSchema,
  /** The leg's value at the proposal's prices, in the allocation's currency. */
  value: decimalStringSchema,
});
export type RebalanceLeg = z.infer<typeof rebalanceLegSchema>;

export const rebalanceOpenResultSchema = z.object({
  /** Intents created by the open, in leg order: sells first, then buys; each needs its own plan, acknowledgement and signature. */
  intents: z.array(
    z.object({
      intentId: idSchema,
      kind: z.enum(['single_sell', 'single_buy']),
      instrumentId: idSchema,
      symbol: z.string().max(32),
      rawAmount: rawAmountSchema,
      created: z.boolean(),
    }),
  ),
  note: z.string().max(600),
});

/* ------------------------------------------------------------ mandates */

/**
 * The optional controlled-automation gate (dry run only). A mandate binds
 * everything a bounded permission would need; evaluating an action against
 * it is deterministic and has no effect. Unattended execution stays
 * DISABLED until an independently reviewed enforcement mechanism exists.
 */
export const MANDATE_ACTIONS = ['buy', 'sell', 'rebalance'] as const;
export const mandateActionKindSchema = z.enum(MANDATE_ACTIONS);
export type MandateActionKind = z.infer<typeof mandateActionKindSchema>;

export const mandateSchema = z.object({
  schemaVersion: z.literal(MAINTENANCE_SCHEMA_VERSION).default(MAINTENANCE_SCHEMA_VERSION),
  mandateId: idSchema,
  ownerUserId: idSchema,
  walletId: idSchema,
  strategyVersionId: idSchema,
  /** The chain the mandate is valid on: cluster and genesis hash. */
  chain: z.object({ cluster: z.string().max(20), genesisHash: z.string().max(64) }),
  allowedInstrumentIds: z.array(idSchema).min(1).max(50),
  allowedVenues: z.array(venueSchema).min(1),
  actions: z.array(mandateActionKindSchema).min(1),
  /** Where inputs come from and outputs go: only the owner's own wallet in V1. */
  destinations: z.object({ inputWalletId: idSchema, outputWalletId: idSchema }),
  perOrderBudgetRaw: rawAmountSchema,
  periodBudget: z.object({
    windowDays: z.number().int().min(1).max(365),
    rawAmount: rawAmountSchema,
  }),
  cumulativeTurnoverRaw: rawAmountSchema,
  maxFeeBps: basisPointsSchema,
  maintenance: z.object({
    allowBuys: z.boolean(),
    allowSells: z.boolean(),
    reduceOnly: z.boolean(),
    maxSlippageBps: basisPointsSchema.min(1).max(1000),
  }),
  expiresAt: z.iso.datetime(),
  nonce: z.number().int().nonnegative(),
  revokedAt: z.iso.datetime().nullable().default(null),
});
export type Mandate = z.infer<typeof mandateSchema>;

export const mandateActionSchema = z.object({
  kind: mandateActionKindSchema,
  ownerUserId: idSchema,
  walletId: idSchema,
  strategyVersionId: idSchema,
  chain: z.object({ cluster: z.string().max(20), genesisHash: z.string().max(64) }),
  venue: venueSchema,
  /** Every instrument the action touches; a rebalance names both sides. */
  instrumentIds: z.array(idSchema).min(1).max(50),
  /** Sides present in the action: a buy, a sell, or both for a rebalance. */
  sides: z.array(policySideSchema).min(1),
  notionalRaw: rawAmountSchema,
  feeBps: basisPointsSchema,
  slippageBps: basisPointsSchema.min(1).max(1000),
  destinations: z.object({ inputWalletId: idSchema, outputWalletId: idSchema }),
  nonce: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type MandateAction = z.infer<typeof mandateActionSchema>;

/** What the mandate has already been used for, supplied by the caller of a dry run. */
export const mandateUsageSchema = z.object({
  periodSpentRaw: rawAmountSchema.default('0'),
  cumulativeTurnoverRaw: rawAmountSchema.default('0'),
});
export type MandateUsage = z.infer<typeof mandateUsageSchema>;

export const MANDATE_CHECK_CODES = [
  'NOT_REVOKED',
  'NOT_EXPIRED',
  'NONCE_CURRENT',
  'OWNER_MATCHES',
  'WALLET_MATCHES',
  'CHAIN_MATCHES',
  'VERSION_BOUND',
  'INSTRUMENTS_ALLOWED',
  'VENUE_ALLOWED',
  'ACTION_PERMITTED',
  'SIDES_PERMITTED',
  'DESTINATIONS_OWN_WALLET',
  'PER_ORDER_BUDGET',
  'PERIOD_BUDGET',
  'CUMULATIVE_TURNOVER',
  'FEE_BOUND',
  'SLIPPAGE_BOUND',
] as const;
export const mandateCheckCodeSchema = z.enum(MANDATE_CHECK_CODES);
export type MandateCheckCode = z.infer<typeof mandateCheckCodeSchema>;

export const mandateCheckSchema = z.object({
  code: mandateCheckCodeSchema,
  ok: z.boolean(),
  detail: z.string().max(300),
});

export const mandateDryRunRequestSchema = z.object({
  mandate: mandateSchema,
  action: mandateActionSchema,
  usage: mandateUsageSchema.default({ periodSpentRaw: '0', cumulativeTurnoverRaw: '0' }),
});
export type MandateDryRunRequest = z.infer<typeof mandateDryRunRequestSchema>;

export const mandateDryRunResponseSchema = z.object({
  outcome: z.enum(['allow', 'deny']),
  checks: z.array(mandateCheckSchema),
  /** The gate itself: always DISABLED in V1; the dry run changes nothing. */
  unattended: z.object({
    capability: z.literal('automation.unattended'),
    status: capabilityStatusSchema,
  }),
  evaluatedAt: z.iso.datetime(),
  note: z.string().max(600),
});
export type MandateDryRunResponse = z.infer<typeof mandateDryRunResponseSchema>;

/** Drift decision carried on a drift occurrence's detail and used by the pure rules. */
export const driftDecisionSchema = z.object({
  propose: z.boolean(),
  reason: occurrenceReasonSchema.nullable(),
  largestDriftBps: z.number().int().nullable(),
  thresholdBps: z.number().int().nullable(),
  allocation: instanceAllocationSchema.nullable(),
});
export type DriftDecision = z.infer<typeof driftDecisionSchema>;

/**
 * Worker orchestration (B16): a durable Temporal loop asks the API for one
 * maintenance pass per tick with a worker credential. The workflow holds no
 * database and decides nothing; every pass is the API's `POST
 * /v1/ops/maintenance/run`, which is idempotent per occurrence.
 */
export const MAINTENANCE_WORKFLOW_TYPE = 'maintenanceWorkflow' as const;

export const maintenanceTickInputSchema = z.object({
  batchSize: z.number().int().min(1).max(500).default(100),
  requestedBy: z.string().min(1).max(200).default('worker'),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
});
export type MaintenanceTickInput = z.infer<typeof maintenanceTickInputSchema>;

export const maintenanceTickResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ran'), report: maintenanceRunReportSchema }),
  /** The API answered and refused the pass (expired or unscoped worker credential): configuration, not a transient fault. */
  z.object({
    status: z.literal('refused'),
    httpStatus: z.number().int(),
    detail: z.string().max(300),
  }),
  /** MAINTENANCE_API_URL and MAINTENANCE_API_TOKEN are unset on the worker. */
  z.object({ status: z.literal('not_configured'), detail: z.string().max(300) }),
  /** The API could not be reached within the activity's retries; the next tick tries again. */
  z.object({ status: z.literal('unreachable'), detail: z.string().max(300) }),
]);
export type MaintenanceTickResult = z.infer<typeof maintenanceTickResultSchema>;

export const maintenanceWorkflowInputSchema = z.object({
  requestedBy: z.string().min(1).max(200),
  /** Ticks to run before returning; null runs until the workflow is cancelled. */
  rounds: z.number().int().positive().max(100_000).nullable().default(null),
  intervalSeconds: z.number().int().min(1).max(3600).default(60),
  batchSize: z.number().int().min(1).max(500).default(100),
});
export type MaintenanceWorkflowInput = z.infer<typeof maintenanceWorkflowInputSchema>;

export const maintenanceWorkflowReportSchema = z.object({
  requestedBy: z.string(),
  rounds: z.number().int().nonnegative(),
  ticks: z.object({
    ran: z.number().int().nonnegative(),
    refused: z.number().int().nonnegative(),
    unreachable: z.number().int().nonnegative(),
    notConfigured: z.number().int().nonnegative(),
  }),
  schedules: z.object({
    proposed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
  notifications: z.object({
    delivered: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
  }),
  lastTick: maintenanceTickResultSchema.nullable(),
});
export type MaintenanceWorkflowReport = z.infer<typeof maintenanceWorkflowReportSchema>;
