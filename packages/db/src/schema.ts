import { CAPABILITY_STATUSES } from '@markov/contracts';
import { sql } from 'drizzle-orm';
import {
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
