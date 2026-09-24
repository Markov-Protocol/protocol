import {
  CAPABILITY_STATUSES,
  type CatalogPrice,
  INGESTION_SOURCES,
  INSTRUMENT_DECISIONS,
  INSTRUMENT_KINDS,
  INSTRUMENT_STATUSES,
  ISSUERS,
  MINT_VERIFICATION_RESULTS,
  type OnChainMint,
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
