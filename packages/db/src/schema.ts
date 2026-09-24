import { CAPABILITY_STATUSES } from '@markov/contracts';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
