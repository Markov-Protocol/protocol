import {
  CAPABILITY_STATUSES,
  type CatalogPrice,
  CORPORATE_ACTION_STATUSES,
  CORPORATE_ACTION_TYPES,
  type CorporateActionDetails,
  ELIGIBILITY_CAPABILITIES,
  ELIGIBILITY_OUTCOMES,
  type ExtensionAssessment,
  INGESTION_SOURCES,
  INSTRUMENT_DECISIONS,
  INSTRUMENT_KINDS,
  INSTRUMENT_STATUSES,
  ISSUERS,
  JURISDICTION_EVIDENCE_KINDS,
  type JurisdictionRule,
  MINT_VERIFICATION_RESULTS,
  MULTIPLIER_SOURCES,
  type OnChainMint,
  type OwnerLimits,
  type PolicyDenial,
  RESERVATION_STATUSES,
  SNAPSHOT_KINDS,
  SNAPSHOT_STATUSES,
  TOKEN_PROGRAMS,
} from '@markov/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
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
      sql.raw(`"${table.principalClass.name}" IN ('agent', 'operator')`),
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
