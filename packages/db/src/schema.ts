import {
  ACKNOWLEDGEMENT_KINDS,
  ATTEMPT_STATES,
  BUDGET_MODES,
  CAPABILITY_STATUSES,
  type Cadence,
  type CatalogPrice,
  type CategoryPreferences,
  CORPORATE_ACTION_STATUSES,
  CORPORATE_ACTION_TYPES,
  type CompanionBudget,
  type CompanionContext,
  type CompanionOutput,
  type CompanionProvenance,
  type CompanionUsage,
  type CorporateActionDetails,
  DELIVERY_STATUSES,
  type DecodedInstruction,
  type Disclosures,
  type DriftTarget,
  ELIGIBILITY_CAPABILITIES,
  ELIGIBILITY_OUTCOMES,
  EXECUTION_EVENT_KINDS,
  type ExecutionPlan,
  type ExtensionAssessment,
  type FrozenLeg,
  INGESTION_SOURCES,
  INSTANCE_STATUSES,
  INSTRUMENT_DECISIONS,
  INSTRUMENT_KINDS,
  INSTRUMENT_STATUSES,
  INTENT_KINDS,
  INTENT_STATES,
  type InstrumentReference,
  type InvestmentTarget,
  ISSUERS,
  JOURNAL_ACCOUNTS,
  JOURNAL_ATTRIBUTIONS,
  JOURNAL_ENTRY_KINDS,
  JOURNAL_SOURCE_KINDS,
  JURISDICTION_EVIDENCE_KINDS,
  type JurisdictionRule,
  LOT_STATUSES,
  MARK_EVENT_KINDS,
  MARK_EVENT_SUBJECT_TYPES,
  type Maintenance,
  MINT_VERIFICATION_RESULTS,
  MISSED_RUN_POLICIES,
  MODERATION_STATUSES,
  MULTIPLIER_SOURCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LINK_TYPES,
  OBSERVABLE_PRICE_KINDS,
  OCCURRENCE_REASONS,
  type OnChainMint,
  type OwnerLimits,
  PLAN_MODES,
  PLAN_SIDES,
  PLAN_STATUSES,
  type PolicyDenial,
  PRICE_OBSERVATION_SOURCE_KINDS,
  PROPOSAL_KINDS,
  PUBLICATION_LIFECYCLE,
  PUBLICATION_OPERATIONS,
  PUBLICATION_STATES,
  type PublicationFailure,
  RECEIPT_KINDS,
  REGISTRY_RECORD_STATUSES,
  REGISTRY_RELATIONS,
  RESERVATION_STATUSES,
  type ReceiptBody,
  type ReconciliationCheckpoint,
  type RegistrationEvidence,
  type RegistryRecord,
  type ResearchSubject,
  RUN_STATUSES,
  SCHEDULE_KINDS,
  SCHEDULE_MODES,
  SCHEDULE_STATUSES,
  type SimulationEvidence,
  SNAPSHOT_KINDS,
  SNAPSHOT_STATUSES,
  SOURCE_ROLES,
  SOURCE_STATUSES,
  STRATEGY_STATUSES,
  type StrategyDraftContent,
  THESIS_STATUSES,
  THESIS_VISIBILITIES,
  type ThesisStatement,
  TOKEN_PROGRAMS,
  TRANSACTION_VERSIONS,
  type TransactionEffects,
  VENUE_QUOTE_MODES,
  type VenueQuote,
} from '@markov/contracts';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Single-row binding between a database and the runtime it serves. Written
 * once by `markov db migrate`; every service refuses to start if its own
 * configuration disagrees with this row.
 */
export const platformIdentity = pgTable(
  'platform_identity',
  {
    id: integer('id').primaryKey(),
    markovEnv: text('markov_env').notNull(),
    solanaCluster: text('solana_cluster').notNull(),
    genesisHash: text('genesis_hash').notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    boundBy: text('bound_by').notNull(),
  },
  (table) => [check('platform_identity_singleton', sql`${table.id} = 1`)],
);

/**
 * Verification state of every externally dependent capability. Seeded from
 * code by `markov db migrate`; updated by operators with evidence.
 */
export const capabilityReadiness = pgTable(
  'capability_readiness',
  {
    capability: text('capability').primaryKey(),
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    check(
      'capability_readiness_status_check',
      sql.raw(
        `"${table.status.name}" IN (${CAPABILITY_STATUSES.map((status) => `'${status}'`).join(', ')})`,
      ),
    ),
  ],
);

/* ---------------------------------------------------------------------------
 * Identity (session B02). Identity and role are always derived from a
 * verified credential; these tables never store a raw secret.
 * ------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Identity-provider issuer and subject; the only link to the provider. */
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [uniqueIndex('users_issuer_subject_unique').on(table.issuer, table.subject)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull(),
    authTime: timestamp('auth_time', { withTimezone: true, mode: 'date' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('sessions_prefix_unique').on(table.prefix),
    index('sessions_user_idx').on(table.userId),
  ],
);

export const walletChallenges = pgTable(
  'wallet_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    chain: text('chain').notNull(),
    genesisHash: text('genesis_hash').notNull(),
    address: text('address').notNull(),
    nonce: text('nonce').notNull(),
    message: text('message').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('wallet_challenges_nonce_unique').on(table.nonce),
    index('wallet_challenges_user_idx').on(table.userId),
  ],
);

export const walletLinks = pgTable(
  'wallet_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    chain: text('chain').notNull(),
    genesisHash: text('genesis_hash').notNull(),
    address: text('address').notNull(),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => walletChallenges.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // One active link per wallet across all accounts; relinking after unlinking is allowed.
    uniqueIndex('wallet_links_active_unique')
      .on(table.chain, table.genesisHash, table.address)
      .where(sql`${table.unlinkedAt} IS NULL`),
    index('wallet_links_user_idx').on(table.userId),
  ],
);

export const apiCredentials = pgTable(
  'api_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for operator credentials, which belong to no user. */
    userId: uuid('user_id').references(() => users.id),
    principalClass: text('principal_class').notNull(),
    label: text('label').notNull(),
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('api_credentials_prefix_unique').on(table.prefix),
    index('api_credentials_user_idx').on(table.userId),
    check(
      'api_credentials_class_check',
      sql.raw(`"${table.principalClass.name}" IN ('agent', 'operator', 'worker')`),
    ),
  ],
);

export const devicePairings = pgTable(
  'device_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    capabilities: text('capabilities').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [uniqueIndex('device_pairings_code_unique').on(table.codeHash)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    pairingId: uuid('pairing_id')
      .notNull()
      .references(() => devicePairings.id),
    name: text('name').notNull(),
    capabilities: text('capabilities').array().notNull(),
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull(),
    pairedAt: timestamp('paired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('devices_prefix_unique').on(table.prefix),
    index('devices_user_idx').on(table.userId),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    actorClass: text('actor_class').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id'),
    /** Secret-free structured details. */
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_events_target_idx').on(table.targetType, table.targetId),
    index('audit_events_occurred_idx').on(table.occurredAt),
  ],
);

/* ---------------------------------------------------------------------------
 * Catalog (session B03). Products enter quarantined and only an operator
 * decision admits them after the mint matched on chain. Catalog prices are
 * reference marks, never quotes.
 * ------------------------------------------------------------------------- */

function enumCheck(name: string, column: { name: string }, values: readonly string[]) {
  return check(
    name,
    sql.raw(`"${column.name}" IN (${values.map((value) => `'${value}'`).join(', ')})`),
  );
}

export const issuerSnapshots = pgTable(
  'issuer_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issuer: text('issuer').notNull(),
    kind: text('kind').notNull().default('products'),
    source: text('source').notNull(),
    /** Fixture name or the URL without query string and credentials. */
    sourceRef: text('source_ref').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull(),
    contentHash: text('content_hash').notNull(),
    schemaVersion: text('schema_version'),
    itemCount: integer('item_count').notNull().default(0),
    status: text('status').notNull(),
    rejectionReason: text('rejection_reason'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('issuer_snapshots_issuer_fetched_idx').on(table.issuer, table.fetchedAt),
    enumCheck('issuer_snapshots_issuer_check', table.issuer, ISSUERS),
    enumCheck('issuer_snapshots_kind_check', table.kind, SNAPSHOT_KINDS),
    enumCheck('issuer_snapshots_source_check', table.source, INGESTION_SOURCES),
    enumCheck('issuer_snapshots_status_check', table.status, SNAPSHOT_STATUSES),
  ],
);

export const instruments = pgTable(
  'instruments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issuer: text('issuer').notNull(),
    issuerProductId: text('issuer_product_id').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    companyName: text('company_name').notNull(),
    kind: text('kind').notNull(),
    chain: text('chain').notNull().default('solana'),
    genesisHash: text('genesis_hash').notNull(),
    mint: text('mint').notNull(),
    decimals: integer('decimals').notNull(),
    tokenProgram: text('token_program').notNull().default('unknown'),
    status: text('status').notNull(),
    statusReason: text('status_reason'),
    website: text('website'),
    description: text('description'),
    referencePrice: jsonb('reference_price').$type<CatalogPrice>(),
    underlyingTicker: text('underlying_ticker'),
    underlyingExchange: text('underlying_exchange'),
    /** Lifecycle overrides written by applied corporate actions (B04). */
    haltedAt: timestamp('halted_at', { withTimezone: true, mode: 'date' }),
    haltedReason: text('halted_reason'),
    migrationTargetProductId: text('migration_target_product_id'),
    migrationDeadlineAt: timestamp('migration_deadline_at', { withTimezone: true, mode: 'date' }),
    sunsetAt: timestamp('sunset_at', { withTimezone: true, mode: 'date' }),
    /** Fingerprint of the stored upstream fields; unchanged feeds are detected without a diff. */
    fingerprint: text('fingerprint').notNull(),
    sourceSnapshotId: uuid('source_snapshot_id')
      .notNull()
      .references(() => issuerSnapshots.id),
    admittedAt: timestamp('admitted_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('instruments_issuer_product_unique').on(table.issuer, table.issuerProductId),
    uniqueIndex('instruments_live_mint_unique')
      .on(table.mint)
      .where(sql`${table.status} <> 'rejected'`),
    index('instruments_issuer_symbol_idx').on(table.issuer, table.symbol),
    index('instruments_status_idx').on(table.status),
    enumCheck('instruments_issuer_check', table.issuer, ISSUERS),
    enumCheck('instruments_kind_check', table.kind, INSTRUMENT_KINDS),
    enumCheck('instruments_status_check', table.status, INSTRUMENT_STATUSES),
    enumCheck('instruments_token_program_check', table.tokenProgram, TOKEN_PROGRAMS),
    check('instruments_decimals_check', sql`${table.decimals} BETWEEN 0 AND 18`),
  ],
);

export const instrumentMintVerifications = pgTable(
  'instrument_mint_verifications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Host of the RPC endpoint, never the URL with its key. */
    rpcHost: text('rpc_host').notNull(),
    slot: bigint('slot', { mode: 'number' }),
    result: text('result').notNull(),
    onChain: jsonb('on_chain').$type<OnChainMint>(),
    mismatches: jsonb('mismatches').$type<string[]>().notNull().default([]),
    /** Extension policy verdict (B04); null for spl-token mints and failed reads. */
    compatibility: jsonb('compatibility').$type<ExtensionAssessment>(),
  },
  (table) => [
    index('instrument_mint_verifications_instrument_idx').on(table.instrumentId, table.verifiedAt),
    enumCheck(
      'instrument_mint_verifications_result_check',
      table.result,
      MINT_VERIFICATION_RESULTS,
    ),
  ],
);

export const instrumentDecisions = pgTable(
  'instrument_decisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').$type<Record<string, string>>().notNull().default({}),
    previousStatus: text('previous_status').notNull(),
    newStatus: text('new_status').notNull(),
    /** Operator credential id; never a secret. */
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('instrument_decisions_instrument_idx').on(table.instrumentId, table.decidedAt),
    enumCheck('instrument_decisions_decision_check', table.decision, INSTRUMENT_DECISIONS),
    enumCheck(
      'instrument_decisions_previous_status_check',
      table.previousStatus,
      INSTRUMENT_STATUSES,
    ),
    enumCheck('instrument_decisions_new_status_check', table.newStatus, INSTRUMENT_STATUSES),
  ],
);

/* ---------------------------------------------------------------------------
 * Listed stocks (session B04): corporate actions and multiplier evidence.
 * ------------------------------------------------------------------------- */

export const corporateActions = pgTable(
  'corporate_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    announcedAt: timestamp('announced_at', { withTimezone: true, mode: 'date' }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }).notNull(),
    summary: text('summary').notNull(),
    details: jsonb('details').$type<CorporateActionDetails>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    statusReason: text('status_reason'),
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }),
    appliedBy: text('applied_by'),
    sourceSnapshotId: uuid('source_snapshot_id')
      .notNull()
      .references(() => issuerSnapshots.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('corporate_actions_issuer_external_unique').on(table.issuer, table.externalId),
    index('corporate_actions_instrument_idx').on(table.instrumentId, table.effectiveAt),
    index('corporate_actions_status_idx').on(table.status),
    enumCheck('corporate_actions_issuer_check', table.issuer, ISSUERS),
    enumCheck('corporate_actions_type_check', table.type, CORPORATE_ACTION_TYPES),
    enumCheck('corporate_actions_status_check', table.status, CORPORATE_ACTION_STATUSES),
  ],
);

export const instrumentMultipliers = pgTable(
  'instrument_multipliers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Decimal strings; never floats. */
    multiplier: text('multiplier').notNull(),
    multiplierExact: text('multiplier_exact').notNull(),
    source: text('source').notNull(),
    evidence: jsonb('evidence').$type<Record<string, string>>().notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('instrument_multipliers_point_unique').on(
      table.instrumentId,
      table.effectiveAt,
      table.source,
    ),
    index('instrument_multipliers_instrument_idx').on(table.instrumentId, table.effectiveAt),
    enumCheck('instrument_multipliers_source_check', table.source, MULTIPLIER_SOURCES),
  ],
);

/* ---------------------------------------------------------------------------
 * Eligibility, terms, limits and policy (session B05). Decisions and
 * evidence are recorded; rules are published by operators, never invented.
 * ------------------------------------------------------------------------- */

export const jurisdictionRuleSets = pgTable(
  'jurisdiction_rule_sets',
  {
    policyVersion: text('policy_version').primaryKey(),
    validityDays: integer('validity_days').notNull(),
    rules: jsonb('rules').$type<JurisdictionRule[]>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, string>>().notNull().default({}),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    publishedBy: text('published_by').notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [index('jurisdiction_rule_sets_active_idx').on(table.active, table.publishedAt)],
);

export const termsDocuments = pgTable(
  'terms_documents',
  {
    termsVersion: text('terms_version').primaryKey(),
    title: text('title').notNull(),
    contentHash: text('content_hash').notNull(),
    url: text('url').notNull(),
    requiredFor: jsonb('required_for').$type<string[]>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    publishedBy: text('published_by').notNull(),
    active: integer('active').notNull().default(1),
  },
  (table) => [index('terms_documents_active_idx').on(table.active, table.publishedAt)],
);

export const termsAcknowledgements = pgTable(
  'terms_acknowledgements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    termsVersion: text('terms_version')
      .notNull()
      .references(() => termsDocuments.termsVersion),
    contentHash: text('content_hash').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    channel: text('channel').notNull(),
  },
  (table) => [
    uniqueIndex('terms_acknowledgements_user_version_unique').on(table.userId, table.termsVersion),
  ],
);

export const eligibilityDecisions = pgTable(
  'eligibility_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Monotonic insertion order; the latest decision is the highest `seq`, whatever the clock says. */
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    policyVersion: text('policy_version'),
    jurisdiction: text('jurisdiction').notNull(),
    evidenceKind: text('evidence_kind').notNull(),
    outcome: text('outcome').notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    issuers: jsonb('issuers').$type<string[]>().notNull().default([]),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: text('revoked_reason'),
    decidedBy: text('decided_by').notNull(),
  },
  (table) => [
    index('eligibility_decisions_user_idx').on(table.userId, table.capability, table.seq),
    enumCheck('eligibility_decisions_capability_check', table.capability, ELIGIBILITY_CAPABILITIES),
    enumCheck(
      'eligibility_decisions_evidence_check',
      table.evidenceKind,
      JURISDICTION_EVIDENCE_KINDS,
    ),
    enumCheck('eligibility_decisions_outcome_check', table.outcome, ELIGIBILITY_OUTCOMES),
  ],
);

export const ownerLimits = pgTable('owner_limits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  limits: jsonb('limits').$type<Partial<OwnerLimits>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const spendReservations = pgTable(
  'spend_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intentId: text('intent_id').notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    side: text('side').notNull(),
    /** Raw USDC digit string. */
    notionalUsdcRaw: text('notional_usdc_raw').notNull(),
    status: text('status').notNull().default('held'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('spend_reservations_user_intent_unique').on(table.userId, table.intentId),
    index('spend_reservations_user_status_idx').on(table.userId, table.status, table.createdAt),
    enumCheck('spend_reservations_status_check', table.status, RESERVATION_STATUSES),
    check('spend_reservations_side_check', sql`${table.side} IN ('buy', 'sell')`),
  ],
);

export const betaParticipants = pgTable('beta_participants', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  note: text('note').notNull().default(''),
  addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  addedBy: text('added_by').notNull(),
});

export const policyDecisions = pgTable(
  'policy_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id),
    side: text('side').notNull(),
    stage: text('stage').notNull(),
    notionalUsdcRaw: text('notional_usdc_raw').notNull(),
    outcome: text('outcome').notNull(),
    denials: jsonb('denials').$type<PolicyDenial[]>().notNull().default([]),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    limits: jsonb('limits').$type<OwnerLimits>().notNull(),
    budget: jsonb('budget').$type<Record<string, string>>().notNull(),
    reservationId: uuid('reservation_id').references(() => spendReservations.id),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('policy_decisions_user_idx').on(table.userId, table.seq),
    check('policy_decisions_outcome_check', sql`${table.outcome} IN ('allow', 'deny')`),
  ],
);

/* ---------------------------------------------------------------------------
 * Research: theses, immutable revisions, source records and bounded runs
 * (session B06). Revisions are never edited; a change is a new revision.
 * ------------------------------------------------------------------------- */

export const theses = pgTable(
  'theses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    visibility: text('visibility').notNull().default('private'),
    status: text('status').notNull().default('draft'),
    currentRevisionNumber: integer('current_revision_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('theses_owner_idx').on(table.ownerUserId, table.updatedAt),
    enumCheck('theses_visibility_check', table.visibility, THESIS_VISIBILITIES),
    enumCheck('theses_status_check', table.status, THESIS_STATUSES),
  ],
);

export const thesisRevisions = pgTable(
  'thesis_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thesisId: uuid('thesis_id')
      .notNull()
      .references(() => theses.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    title: text('title').notNull(),
    claim: text('claim').notNull(),
    statements: jsonb('statements').$type<ThesisStatement[]>().notNull().default([]),
    counterarguments: jsonb('counterarguments').$type<string[]>().notNull().default([]),
    instruments: jsonb('instruments').$type<InstrumentReference[]>().notNull().default([]),
    subjects: jsonb('subjects').$type<ResearchSubject[]>().notNull().default([]),
    /** Never part of a public projection or the content hash. */
    privateNotes: text('private_notes'),
    authorPrincipal: text('author_principal').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('thesis_revisions_number_unique').on(table.thesisId, table.revisionNumber),
  ],
);

export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thesisId: uuid('thesis_id')
      .notNull()
      .references(() => theses.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    title: text('title'),
    status: text('status').notNull(),
    blockedReason: text('blocked_reason'),
    contentType: text('content_type'),
    byteLength: integer('byte_length'),
    contentHash: text('content_hash'),
    excerpt: text('excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    redirects: jsonb('redirects').$type<string[]>().notNull().default([]),
  },
  (table) => [
    index('source_records_thesis_idx').on(table.thesisId, table.retrievedAt),
    enumCheck('source_records_role_check', table.role, SOURCE_ROLES),
    enumCheck('source_records_status_check', table.status, SOURCE_STATUSES),
  ],
);

export const researchRuns = pgTable(
  'research_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    thesisId: uuid('thesis_id')
      .notNull()
      .references(() => theses.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    question: text('question').notNull(),
    sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
    budget: jsonb('budget').$type<{ maxOutputChars: number; maxStatements: number }>().notNull(),
    provenance: jsonb('provenance').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('research_runs_owner_idx').on(table.ownerUserId, table.createdAt),
    index('research_runs_thesis_idx').on(table.thesisId, table.createdAt),
    enumCheck('research_runs_status_check', table.status, RUN_STATUSES),
  ],
);

/* -------------------------------------------------------------------------
 * Watchlists (F05): one versioned list per person; items reference catalog
 * instruments and stay visible whatever the instrument's later status.
 * ------------------------------------------------------------------------- */

export const watchlists = pgTable('watchlists', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
});

export const watchlistItems = pgTable(
  'watchlist_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    note: text('note'),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.instrumentId] }),
    index('watchlist_items_user_idx').on(table.userId, table.addedAt),
  ],
);

/* -------------------------------------------------------------------------
 * Strategies (B07): a person's recipes. One working draft per strategy with
 * a revision counter; versions are immutable rows written once at freeze;
 * instances pin a version explicitly and only move when the owner accepts.
 * ------------------------------------------------------------------------- */

export const strategies = pgTable(
  'strategies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    forkOfStrategyId: uuid('fork_of_strategy_id').references((): AnyPgColumn => strategies.id),
    forkOfVersionId: uuid('fork_of_version_id').references((): AnyPgColumn => strategyVersions.id),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => strategyVersions.id),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('strategies_owner_idx').on(table.ownerUserId, table.updatedAt),
    enumCheck('strategies_status_check', table.status, STRATEGY_STATUSES),
  ],
);

export const strategyDrafts = pgTable('strategy_drafts', {
  strategyId: uuid('strategy_id')
    .primaryKey()
    .references(() => strategies.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(1),
  content: jsonb('content').$type<StrategyDraftContent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const strategyVersions = pgTable(
  'strategy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    schemaVersion: text('schema_version').notNull(),
    kind: text('kind').notNull(),
    authorPrincipal: text('author_principal').notNull(),
    publisherWallet: text('publisher_wallet'),
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => strategyVersions.id),
    forkOfStrategyId: uuid('fork_of_strategy_id'),
    forkOfVersionId: uuid('fork_of_version_id'),
    title: text('title').notNull(),
    thesis: text('thesis').notNull(),
    thesisId: uuid('thesis_id'),
    legs: jsonb('legs').$type<FrozenLeg[]>().notNull(),
    cashWeightBps: integer('cash_weight_bps').notNull(),
    maintenance: jsonb('maintenance').$type<Maintenance>().notNull(),
    disclosures: jsonb('disclosures').$type<Disclosures>().notNull(),
    references: jsonb('reference_urls').$type<string[]>().notNull().default([]),
    /** The exact bytes hashed; kept so a manifest can be re-verified and served. */
    canonicalManifest: text('canonical_manifest').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    /** Lineage-free digest of the economic content; equal across versions whose recipe did not change. */
    contentDigest: text('content_digest').notNull(),
    publication: text('publication').notNull().default('unpublished'),
    moderation: text('moderation').notNull().default('none'),
    deprecatedBy: uuid('deprecated_by'),
    frozenAt: timestamp('frozen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('strategy_versions_number_unique').on(table.strategyId, table.versionNumber),
    index('strategy_versions_hash_idx').on(table.manifestHash),
    enumCheck('strategy_versions_publication_check', table.publication, PUBLICATION_STATES),
    enumCheck('strategy_versions_moderation_check', table.moderation, MODERATION_STATUSES),
    check(
      'strategy_versions_cash_check',
      sql`${table.cashWeightBps} >= 0 AND ${table.cashWeightBps} <= 10000`,
    ),
  ],
);

export const portfolioInstances = pgTable(
  'portfolio_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id),
    pinnedVersionId: uuid('pinned_version_id')
      .notNull()
      .references(() => strategyVersions.id),
    proposedVersionId: uuid('proposed_version_id').references(() => strategyVersions.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    label: text('label'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('portfolio_instances_owner_idx').on(table.ownerUserId, table.updatedAt),
    index('portfolio_instances_strategy_idx').on(table.strategyId),
    enumCheck('portfolio_instances_status_check', table.status, INSTANCE_STATUSES),
  ],
);

/* -------------------------------------------------------------------------
 * Registry (B08): publications are the owner's attempts to register a
 * frozen version on chain with a verified wallet; registry records are what
 * the indexer has read from finalized chain state, whether or not a Markov
 * version matches them. A row here is evidence of an attempt or of an
 * observation, never registration by itself.
 * ------------------------------------------------------------------------- */

export const strategyPublications = pgTable(
  'strategy_publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull().default('register'),
    state: text('state').notNull().default('awaiting_signature'),
    programId: text('program_id').notNull(),
    genesisHash: text('genesis_hash').notNull(),
    recordAddress: text('record_address').notNull(),
    publisherWalletId: uuid('publisher_wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    publisherAddress: text('publisher_address').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    contentDigest: text('content_digest').notNull(),
    /** Wire transaction with zeroed signatures, base64: exactly what the wallet was asked to sign. */
    unsignedTransaction: text('unsigned_transaction').notNull(),
    /** The message bytes (base64) the signature must cover; a submission whose message differs is refused. */
    message: text('message').notNull(),
    recentBlockhash: text('recent_blockhash').notNull(),
    lastValidBlockHeight: bigint('last_valid_block_height', { mode: 'number' }).notNull(),
    estimatedCostLamports: bigint('estimated_cost_lamports', { mode: 'number' }).notNull(),
    signature: text('signature'),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    /** The node's confirmation level at the last check; only `finalized` can register. */
    confirmationStatus: text('confirmation_status'),
    evidence: jsonb('evidence').$type<RegistrationEvidence>(),
    failure: jsonb('failure').$type<PublicationFailure>(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('strategy_publications_version_idx').on(table.versionId, table.createdAt),
    index('strategy_publications_state_idx').on(table.state, table.updatedAt),
    // At most one publication of an operation may be in flight for a version.
    uniqueIndex('strategy_publications_in_flight_unique')
      .on(table.versionId, table.operation)
      .where(sql`${table.state} IN ('validated', 'awaiting_signature', 'submitted')`),
    enumCheck('strategy_publications_state_check', table.state, PUBLICATION_LIFECYCLE),
    enumCheck('strategy_publications_operation_check', table.operation, PUBLICATION_OPERATIONS),
  ],
);

export const registryRecords = pgTable(
  'registry_records',
  {
    address: text('address').primaryKey(),
    programId: text('program_id').notNull(),
    genesisHash: text('genesis_hash').notNull(),
    publisher: text('publisher').notNull(),
    status: text('status').notNull(),
    layoutVersion: integer('layout_version').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    relation: text('relation').notNull(),
    parentManifestHash: text('parent_manifest_hash'),
    manifestHash: text('manifest_hash').notNull(),
    contentDigest: text('content_digest').notNull(),
    cashWeightBps: integer('cash_weight_bps').notNull(),
    legs: jsonb('legs').$type<RegistryRecord['legs']>().notNull(),
    registeredSlot: bigint('registered_slot', { mode: 'number' }).notNull(),
    registeredUnixTime: bigint('registered_unix_time', { mode: 'number' }).notNull(),
    statusUpdatedSlot: bigint('status_updated_slot', { mode: 'number' }).notNull(),
    /** The exact account bytes, base64, so a reader can re-decode and re-verify. */
    data: text('data').notNull(),
    /** The Markov version carrying this manifest hash, when one exists. */
    versionId: uuid('version_id').references(() => strategyVersions.id),
    /** Registration transaction when the indexer learned it from a publication. */
    signature: text('signature'),
    observedSlot: bigint('observed_slot', { mode: 'number' }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('registry_records_manifest_idx').on(table.programId, table.manifestHash),
    index('registry_records_publisher_idx').on(table.publisher),
    index('registry_records_version_idx').on(table.versionId),
    enumCheck('registry_records_status_check', table.status, REGISTRY_RECORD_STATUSES),
    enumCheck('registry_records_relation_check', table.relation, REGISTRY_RELATIONS),
  ],
);

/** One row per program: when the indexer last ran and how far it has looked. */
export const registryIndexerState = pgTable('registry_indexer_state', {
  programId: text('program_id').primaryKey(),
  genesisHash: text('genesis_hash').notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }),
  lastObservedSlot: bigint('last_observed_slot', { mode: 'number' }),
  recordsIndexed: integer('records_indexed').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------
 * Follows (F08): a person subscribes to a public strategy's registered
 * versions. Bookkeeping only: no instance, no pin, no order.
 * ------------------------------------------------------------------------- */

export const strategyFollows = pgTable(
  'strategy_follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.strategyId] }),
    index('strategy_follows_strategy_idx').on(table.strategyId),
    index('strategy_follows_user_idx').on(table.userId, table.createdAt),
  ],
);

/* ---------------------------------------------------------------------------
 * Execution planning (session B09): the owner's intents, the immutable hashed
 * plans built for them and the venue quotes each plan rests on. A plan never
 * moves funds and never reserves budget; transactions arrive with B10.
 * ------------------------------------------------------------------------- */

export const intents = pgTable(
  'intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Client-supplied, scoped to the owner; the same key with another request hash is a conflict. */
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    schemaVersion: text('schema_version').notNull(),
    kind: text('kind').notNull(),
    state: text('state').notNull().default('DRAFT'),
    stateReason: text('state_reason'),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    walletAddress: text('wallet_address').notNull(),
    strategyId: uuid('strategy_id').references(() => strategies.id),
    versionId: uuid('version_id').references(() => strategyVersions.id),
    instrumentId: uuid('instrument_id').references(() => instruments.id),
    budgetMint: text('budget_mint').notNull(),
    budgetSymbol: text('budget_symbol').notNull(),
    budgetDecimals: integer('budget_decimals').notNull(),
    budgetRaw: text('budget_raw').notNull(),
    budgetMode: text('budget_mode').notNull(),
    executionPreference: text('execution_preference').notNull(),
    approvalMode: text('approval_mode').notNull(),
    slippageBps: integer('slippage_bps').notNull(),
    latestPlanId: uuid('latest_plan_id'),
    latestPlanHash: text('latest_plan_hash'),
    /** A reviewed completion (B11): the partially completed intent and plan this one continues, and its legs. */
    continuationOfIntentId: uuid('continuation_of_intent_id'),
    continuationOfPlanId: uuid('continuation_of_plan_id'),
    continuationLegIndexes: jsonb('continuation_leg_indexes').$type<number[]>(),
    continuedByIntentId: uuid('continued_by_intent_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    uniqueIndex('intents_owner_key_unique').on(table.ownerUserId, table.idempotencyKey),
    index('intents_owner_idx').on(table.ownerUserId, table.createdAt),
    enumCheck('intents_state_check', table.state, INTENT_STATES),
    enumCheck('intents_kind_check', table.kind, INTENT_KINDS),
    enumCheck('intents_budget_mode_check', table.budgetMode, BUDGET_MODES),
    check(
      'intents_slippage_check',
      sql`${table.slippageBps} >= 1 AND ${table.slippageBps} <= 10000`,
    ),
  ],
);

export const executionPlans = pgTable(
  'execution_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planHash: text('plan_hash').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('valid'),
    /** The immutable plan document exactly as hashed; the review fields live in the columns below. */
    plan: jsonb('plan').$type<ExecutionPlan>().notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    acknowledgedHash: text('acknowledged_hash'),
    stagedAcknowledged: boolean('staged_acknowledged').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('execution_plans_intent_idx').on(table.intentId, table.createdAt),
    index('execution_plans_hash_idx').on(table.planHash),
    enumCheck('execution_plans_status_check', table.status, PLAN_STATUSES),
    enumCheck('execution_plans_mode_check', table.mode, PLAN_MODES),
  ],
);

export const venueQuotes = pgTable(
  'venue_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => executionPlans.id, { onDelete: 'set null' }),
    legIndex: integer('leg_index').notNull(),
    venue: text('venue').notNull(),
    mode: text('mode').notNull(),
    quoteRef: text('quote_ref').notNull(),
    inputMint: text('input_mint').notNull(),
    outputMint: text('output_mint').notNull(),
    inAmountRaw: text('in_amount_raw').notNull(),
    outAmountRaw: text('out_amount_raw').notNull(),
    otherAmountThresholdRaw: text('other_amount_threshold_raw').notNull(),
    slippageBps: integer('slippage_bps').notNull(),
    priceImpactBps: integer('price_impact_bps'),
    /** The validated quote; never the raw provider response and never a credential. */
    quote: jsonb('quote').$type<VenueQuote>().notNull(),
    accepted: boolean('accepted').notNull(),
    issues: jsonb('issues').$type<{ code: string; message: string }[]>().notNull().default([]),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('venue_quotes_intent_idx').on(table.intentId, table.createdAt),
    enumCheck('venue_quotes_mode_check', table.mode, VENUE_QUOTE_MODES),
  ],
);

/* ------------------------------------------------------------ execution (B10) */

/**
 * A built, validated and simulated transaction for one batch of an approved
 * plan. The unsigned bytes are stored exactly as validated; the approval and
 * the owner's signature bind to `message_hash`. An older prepared transaction
 * of the same index is superseded when a fresh blockhash is needed.
 */
export const preparedTransactions = pgTable(
  'prepared_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => executionPlans.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionIndex: integer('transaction_index').notNull(),
    batch: integer('batch').notNull(),
    legIndexes: jsonb('leg_indexes').$type<number[]>().notNull(),
    version: text('version').notNull(),
    messageHash: text('message_hash').notNull(),
    /** Base64 unsigned wire transaction: zeroed signature slots in front of the message. */
    unsignedTransaction: text('unsigned_transaction').notNull(),
    feePayer: text('fee_payer').notNull(),
    expectedSigner: text('expected_signer').notNull(),
    recentBlockhash: text('recent_blockhash').notNull(),
    lastValidBlockHeight: bigint('last_valid_block_height', { mode: 'number' }).notNull(),
    buildSource: text('build_source').notNull(),
    instructions: jsonb('instructions').$type<DecodedInstruction[]>().notNull(),
    effects: jsonb('effects').$type<TransactionEffects>().notNull(),
    simulation: jsonb('simulation').$type<SimulationEvidence>().notNull(),
    state: text('state').notNull().default('prepared'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('prepared_transactions_intent_idx').on(
      table.intentId,
      table.transactionIndex,
      table.createdAt,
    ),
    index('prepared_transactions_hash_idx').on(table.messageHash),
    enumCheck('prepared_transactions_state_check', table.state, ATTEMPT_STATES),
    enumCheck('prepared_transactions_version_check', table.version, TRANSACTION_VERSIONS),
  ],
);

/**
 * One owner-signed submission of a prepared transaction. Persisted with its
 * signature and signed bytes before any broadcast; the same bytes may be sent
 * again while the blockhash is valid. At most one live attempt per intent.
 */
export const executionAttempts = pgTable(
  'execution_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => preparedTransactions.id, { onDelete: 'cascade' }),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => executionPlans.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionIndex: integer('transaction_index').notNull(),
    /** The base58 fee-payer signature: the transaction id on chain. */
    signature: text('signature').notNull(),
    /** Base64 signed wire transaction, kept for safe resends; never logged. */
    signedTransaction: text('signed_transaction').notNull(),
    messageHash: text('message_hash').notNull(),
    state: text('state').notNull(),
    reason: text('reason'),
    /** The policy spend reservation taken at submission, released or consumed with the outcome. */
    reservationId: uuid('reservation_id'),
    lastValidBlockHeight: bigint('last_valid_block_height', { mode: 'number' }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true, mode: 'date' }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    confirmationStatus: text('confirmation_status'),
    slot: bigint('slot', { mode: 'number' }),
    resendCount: integer('resend_count').notNull().default(0),
    chainError: text('chain_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('execution_attempts_signature_unique').on(table.signature),
    uniqueIndex('execution_attempts_live_unique')
      .on(table.intentId)
      .where(sql`"state" IN ('submitting', 'submitted', 'confirmed', 'unknown')`),
    index('execution_attempts_intent_idx').on(table.intentId, table.createdAt),
    index('execution_attempts_state_idx').on(table.state, table.updatedAt),
    enumCheck('execution_attempts_state_check', table.state, ATTEMPT_STATES),
  ],
);

/** Observed settlement of one leg from the landed transaction's own balance changes. */
export const executionFills = pgTable(
  'execution_fills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => executionPlans.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => executionAttempts.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    legIndex: integer('leg_index').notNull(),
    signature: text('signature').notNull(),
    slot: bigint('slot', { mode: 'number' }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true, mode: 'date' }),
    side: text('side').notNull(),
    inputMint: text('input_mint').notNull(),
    outputMint: text('output_mint').notNull(),
    inputSpentRaw: text('input_spent_raw').notNull(),
    outputReceivedRaw: text('output_received_raw').notNull(),
    feeLamports: text('fee_lamports').notNull(),
    lamportsSpent: text('lamports_spent').notNull(),
    withinBounds: boolean('within_bounds').notNull(),
    source: text('source').notNull().default('transaction_meta'),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('execution_fills_signature_leg_unique').on(table.signature, table.legIndex),
    index('execution_fills_intent_idx').on(table.intentId, table.createdAt),
    enumCheck('execution_fills_side_check', table.side, PLAN_SIDES),
  ],
);

/**
 * Transactional outbox: events written in the same database transaction as
 * the state they announce, published by a worker later. Nothing here is a
 * message to a person; consumers arrive with the maintenance and companion
 * sessions.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('outbox_events_pending_idx').on(table.publishedAt, table.createdAt),
    index('outbox_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
    enumCheck('outbox_events_kind_check', table.kind, EXECUTION_EVENT_KINDS),
  ],
);

/* -------------------------------------------------------------------------
 * Accounting (B12): the append-only quantity journal (balanced per asset),
 * lots, reconciliation checkpoints and signed receipts. Entries are never
 * updated except for the owner's acknowledgement of an external flow; a
 * mistake is reversed by a correction entry that names what it reverses.
 * ---------------------------------------------------------------------- */

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    instanceId: uuid('instance_id').references(() => portfolioInstances.id),
    kind: text('kind').notNull(),
    sourceKind: text('source_kind').notNull(),
    /** Idempotency key per owner: the same observation recorded twice is one entry. */
    sourceRef: text('source_ref').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** The entry a correction reverses (no foreign key: the reversed entry is never deleted). */
    reversesEntryId: uuid('reverses_entry_id'),
    attribution: text('attribution').notNull(),
    acknowledgementKind: text('acknowledgement_kind'),
    acknowledgementNote: text('acknowledgement_note'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, mode: 'date' }),
    memo: text('memo').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('journal_entries_source_unique').on(table.ownerUserId, table.sourceRef),
    index('journal_entries_wallet_idx').on(table.walletId, table.occurredAt),
    index('journal_entries_instance_idx').on(table.instanceId),
    enumCheck('journal_entries_kind_check', table.kind, JOURNAL_ENTRY_KINDS),
    enumCheck('journal_entries_source_kind_check', table.sourceKind, JOURNAL_SOURCE_KINDS),
    enumCheck('journal_entries_attribution_check', table.attribution, JOURNAL_ATTRIBUTIONS),
    enumCheck('journal_entries_ack_kind_check', table.acknowledgementKind, [
      ...ACKNOWLEDGEMENT_KINDS,
    ]),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    account: text('account').notNull(),
    /** A mint address, or `SOL` for lamports. */
    asset: text('asset').notNull(),
    symbol: text('symbol').notNull(),
    decimals: integer('decimals').notNull(),
    /** Signed raw base units as a decimal string. */
    deltaRaw: text('delta_raw').notNull(),
    lotId: uuid('lot_id'),
  },
  (table) => [
    uniqueIndex('journal_lines_entry_position_unique').on(table.entryId, table.position),
    index('journal_lines_asset_idx').on(table.asset, table.account),
    enumCheck('journal_lines_account_check', table.account, JOURNAL_ACCOUNTS),
  ],
);

export const lots = pgTable(
  'lots',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    instanceId: uuid('instance_id').references(() => portfolioInstances.id),
    intentId: uuid('intent_id').references(() => intents.id),
    asset: text('asset').notNull(),
    symbol: text('symbol').notNull(),
    decimals: integer('decimals').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull(),
    quantityRaw: text('quantity_raw').notNull(),
    remainingRaw: text('remaining_raw').notNull(),
    costAsset: text('cost_asset').notNull(),
    costRaw: text('cost_raw').notNull(),
    feeLamports: text('fee_lamports').notNull(),
    sourceEntryId: uuid('source_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('lots_wallet_asset_idx').on(table.walletId, table.asset, table.openedAt),
    index('lots_instance_idx').on(table.instanceId),
    enumCheck('lots_status_check', table.status, LOT_STATUSES),
  ],
);

export const lotConsumptions = pgTable(
  'lot_consumptions',
  {
    id: uuid('id').primaryKey(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    quantityRaw: text('quantity_raw').notNull(),
    costRaw: text('cost_raw').notNull(),
    proceedsRaw: text('proceeds_raw').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('lot_consumptions_lot_idx').on(table.lotId),
    index('lot_consumptions_entry_idx').on(table.entryId),
  ],
);

export const reconciliationCheckpoints = pgTable(
  'reconciliation_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => walletLinks.id),
    slot: bigint('slot', { mode: 'number' }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    commitment: text('commitment').notNull(),
    status: text('status').notNull(),
    assets: jsonb('assets').$type<ReconciliationCheckpoint['assets']>().notNull(),
    /** Insertion order: the latest checkpoint is the highest sequence, whatever the clock says. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('reconciliation_checkpoints_wallet_idx').on(table.walletId, table.sequence),
    enumCheck('reconciliation_checkpoints_status_check', table.status, ['matched', 'needs_review']),
  ],
);

export const receiptSigningKeys = pgTable(
  'receipt_signing_keys',
  {
    keyId: text('key_id').primaryKey(),
    algorithm: text('algorithm').notNull().default('ed25519'),
    publicKey: text('public_key').notNull(),
    status: text('status').notNull().default('active'),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [enumCheck('receipt_signing_keys_status_check', table.status, ['active', 'retired'])],
);

export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').notNull(),
    intentState: text('intent_state').notNull(),
    /** The signed body exactly as hashed. */
    body: jsonb('body').$type<ReceiptBody>().notNull(),
    canonicalHash: text('canonical_hash').notNull(),
    keyId: text('key_id')
      .notNull()
      .references(() => receiptSigningKeys.keyId),
    signerPublicKey: text('signer_public_key').notNull(),
    signature: text('signature').notNull(),
    public: boolean('public').notNull().default(false),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Insertion order for listings; issuedAt can tie within a burst. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('receipts_owner_idx').on(table.ownerUserId, table.sequence),
    uniqueIndex('receipts_intent_kind_state_unique').on(
      table.intentId,
      table.kind,
      table.intentState,
    ),
    enumCheck('receipts_kind_check', table.kind, RECEIPT_KINDS),
    enumCheck('receipts_intent_state_check', table.intentState, INTENT_STATES),
  ],
);

/* ------------------------------------------------------- analytics (B13) */

/**
 * Recorded reference price observations: one row per asset, kind, source
 * and observation time, never updated. Issuer feeds add one per ingestion,
 * operators record evidence by hand, the fixture sources exist only outside
 * production. A valuation reads the latest observation at or before its
 * point; nothing here is an executable quote.
 */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** A mint address, or `SOL` for lamports. */
    asset: text('asset').notNull(),
    instrumentId: uuid('instrument_id').references(() => instruments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Decimal string; never a float. */
    value: text('value').notNull(),
    unit: text('unit').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    source: text('source').notNull(),
    sourceKind: text('source_kind').notNull(),
    evidence: jsonb('evidence').$type<Record<string, string>>().notNull().default({}),
    /** The operator credential that recorded a manual observation; null for feeds. */
    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('price_observations_point_unique').on(
      table.asset,
      table.kind,
      table.source,
      table.observedAt,
    ),
    index('price_observations_asset_idx').on(table.asset, table.observedAt),
    enumCheck('price_observations_kind_check', table.kind, OBSERVABLE_PRICE_KINDS),
    enumCheck(
      'price_observations_source_kind_check',
      table.sourceKind,
      PRICE_OBSERVATION_SOURCE_KINDS,
    ),
  ],
);

/* ------------------------------------------------------- discovery (B14) */

/**
 * Platform moderation decisions on strategy versions. The flag in force
 * lives on `strategy_versions.moderation`; this table is its append-only
 * history with the reason and the operator credential. A hidden version
 * leaves discovery, rankings, public reads and follow targets; the chain
 * record stays readable and no instance moves.
 */
export const moderationDecisions = pgTable(
  'moderation_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    previousStatus: text('previous_status').notNull(),
    reason: text('reason').notNull(),
    reference: text('reference'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('moderation_decisions_strategy_idx').on(table.strategyId, table.decidedAt),
    index('moderation_decisions_version_idx').on(table.versionId, table.decidedAt),
    enumCheck('moderation_decisions_status_check', table.status, MODERATION_STATUSES),
    enumCheck('moderation_decisions_previous_check', table.previousStatus, MODERATION_STATUSES),
  ],
);

/* -------------------------------------------------------------------------
 * Agents and companion (B15): bounded companion runs with redacted
 * provenance, proposals that only the owner opens, and the owner's event
 * log for the software and physical Mark I. Nothing here holds authority:
 * a proposal is a request for the owner's review, an event is a fact.
 * ------------------------------------------------------------------------- */

export const companionRuns = pgTable(
  'companion_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `user:<id>` or `agent:<credential id>`: whose authority every tool call ran with. */
    principal: text('principal').notNull(),
    status: text('status').notNull().default('queued'),
    question: text('question').notNull(),
    context: jsonb('context').$type<CompanionContext>().notNull(),
    budget: jsonb('budget').$type<CompanionBudget>().notNull(),
    usage: jsonb('usage').$type<CompanionUsage>(),
    /** Digests and summaries only; the prompt, the tool inputs and the model prose are never stored. */
    provenance: jsonb('provenance').$type<CompanionProvenance>(),
    output: jsonb('output').$type<CompanionOutput>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('companion_runs_owner_idx').on(table.ownerUserId, table.createdAt),
    enumCheck('companion_runs_status_check', table.status, RUN_STATUSES),
  ],
);

/** Stored proposal statuses; `expired` is derived from `expires_at` on read. */
export const STORED_PROPOSAL_STATUSES = ['proposed', 'opened', 'dismissed'] as const;

export const agentProposals = pgTable(
  'agent_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => companionRuns.id, { onDelete: 'set null' }),
    /** The schedule occurrence that produced it (B16); the occurrence row points back once written. */
    scheduleId: uuid('schedule_id'),
    occurrenceId: uuid('occurrence_id'),
    /** One proposal per key: a restarted maintenance pass finds the proposal it already made. */
    dedupKey: text('dedup_key'),
    createdBy: text('created_by').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('proposed'),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    reviewNote: text('review_note').notNull(),
    /** The intent the owner's open created (investment proposals). */
    intentId: uuid('intent_id').references(() => intents.id),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_proposals_owner_idx').on(table.ownerUserId, table.createdAt),
    index('agent_proposals_owner_status_idx').on(table.ownerUserId, table.status),
    uniqueIndex('agent_proposals_dedup_key_unique').on(table.dedupKey),
    enumCheck('agent_proposals_kind_check', table.kind, PROPOSAL_KINDS),
    enumCheck('agent_proposals_status_check', table.status, STORED_PROPOSAL_STATUSES),
  ],
);

export const markEvents = pgTable(
  'mark_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: uuid('id').notNull().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** Secret-free identifiers and states. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('mark_events_id_unique').on(table.id),
    index('mark_events_owner_seq_idx').on(table.ownerUserId, table.seq),
    enumCheck('mark_events_kind_check', table.kind, MARK_EVENT_KINDS),
    enumCheck('mark_events_subject_check', table.subjectType, MARK_EVENT_SUBJECT_TYPES),
  ],
);

/* -------------------------------------------------------------------------
 * Maintenance and notifications (B16): durable schedules whose occurrences
 * prepare proposals for the owner's approval, the in-app notification outbox
 * projected from the owner's events with per-channel deliveries, the owner's
 * preferences and the projection cursor. Nothing here holds spending
 * authority: a schedule ends in a proposal, a notification in a link.
 * ---------------------------------------------------------------------- */

/** Stored occurrence statuses; `opened` and `dismissed` are read from the proposal. */
export const STORED_OCCURRENCE_STATUSES = ['proposed', 'skipped', 'failed', 'expired'] as const;

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('active'),
    mode: text('mode').notNull().default('prepare_for_approval'),
    label: text('label').notNull(),
    cadence: jsonb('cadence').$type<Cadence>().notNull(),
    target: jsonb('target').$type<InvestmentTarget | DriftTarget>().notNull(),
    /** Denormalised from the target for revocation when the resource goes away. */
    walletId: uuid('wallet_id').references(() => walletLinks.id),
    instanceId: uuid('instance_id').references(() => portfolioInstances.id),
    strategyVersionId: uuid('strategy_version_id').references(() => strategyVersions.id),
    instrumentId: uuid('instrument_id').references(() => instruments.id),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
    reviewWindowHours: integer('review_window_hours').notNull(),
    missedRunPolicy: text('missed_run_policy').notNull().default('skip'),
    /** Next instant an active schedule considers; the tick selects on it. */
    nextDueAt: timestamp('next_due_at', { withTimezone: true, mode: 'date' }),
    lastSequence: integer('last_sequence').notNull().default(0),
    /** Drift schedules: when the last rebalance proposal was made. */
    lastProposalAt: timestamp('last_proposal_at', { withTimezone: true, mode: 'date' }),
    proposedCount: integer('proposed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    statusReason: text('status_reason'),
    pausedAt: timestamp('paused_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('schedules_owner_idx').on(table.ownerUserId, table.createdAt),
    index('schedules_due_idx').on(table.status, table.nextDueAt),
    enumCheck('schedules_kind_check', table.kind, SCHEDULE_KINDS),
    enumCheck('schedules_status_check', table.status, SCHEDULE_STATUSES),
    enumCheck('schedules_mode_check', table.mode, SCHEDULE_MODES),
    enumCheck('schedules_missed_check', table.missedRunPolicy, MISSED_RUN_POLICIES),
  ],
);

export const scheduleOccurrences = pgTable(
  'schedule_occurrences',
  {
    id: uuid('id').primaryKey(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }).notNull(),
    windowEndsAt: timestamp('window_ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    detail: text('detail'),
    proposalId: uuid('proposal_id').references(() => agentProposals.id),
    dedupKey: text('dedup_key').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Set once the owner was told the proposal expired unopened. */
    expiryNotifiedAt: timestamp('expiry_notified_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('schedule_occurrences_sequence_unique').on(table.scheduleId, table.sequence),
    uniqueIndex('schedule_occurrences_dedup_unique').on(table.dedupKey),
    index('schedule_occurrences_owner_idx').on(table.ownerUserId, table.decidedAt),
    index('schedule_occurrences_status_idx').on(table.status, table.windowEndsAt),
    enumCheck('schedule_occurrences_status_check', table.status, STORED_OCCURRENCE_STATUSES),
    enumCheck('schedule_occurrences_reason_check', table.reason, OCCURRENCE_REASONS),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    /** A unique constraint rather than an index, so deliveries can reference it. */
    id: uuid('id').notNull().defaultRandom().unique('notifications_id_unique'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    linkType: text('link_type'),
    linkId: text('link_id'),
    /** The Mark I event this was projected from; unique so a rerun projects nothing twice. */
    sourceEventSeq: bigint('source_event_seq', { mode: 'number' }),
    /** Other sources (schedule outcomes) carry their own unique key. */
    sourceKey: text('source_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('notifications_source_event_unique').on(table.sourceEventSeq),
    uniqueIndex('notifications_source_key_unique').on(table.sourceKey),
    index('notifications_owner_seq_idx').on(table.ownerUserId, table.seq),
    index('notifications_owner_unread_idx').on(table.ownerUserId, table.readAt),
    enumCheck('notifications_category_check', table.category, NOTIFICATION_CATEGORIES),
    enumCheck('notifications_link_type_check', table.linkType, NOTIFICATION_LINK_TYPES),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    /** Provider receipt or the last error; never the message body, never a secret. */
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_channel_unique').on(table.notificationId, table.channel),
    index('notification_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    enumCheck('notification_deliveries_channel_check', table.channel, NOTIFICATION_CHANNELS),
    enumCheck('notification_deliveries_status_check', table.status, DELIVERY_STATUSES),
  ],
);

export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  emailAddress: text('email_address'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
  /** Pending verification: HMAC of the code under the server pepper and a per-attempt salt. */
  emailPendingHash: text('email_pending_hash'),
  emailPendingSalt: text('email_pending_salt'),
  emailPendingExpiresAt: timestamp('email_pending_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  emailPendingAttempts: integer('email_pending_attempts').notNull().default(0),
  categories: jsonb('categories').$type<CategoryPreferences>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/** One row per deployment: the last Mark I event projected into notifications. */
export const notificationProjectionCursor = pgTable('notification_projection_cursor', {
  id: text('id').primaryKey(),
  lastEventSeq: bigint('last_event_seq', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
