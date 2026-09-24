import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

/** Reviewed SQL migrations live beside the package, not in dist. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url));

export interface MigrationJournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

export function readMigrationJournal(folder: string = MIGRATIONS_FOLDER): MigrationJournalEntry[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  return journal.entries.map((entry) => ({ idx: entry.idx, tag: entry.tag, when: entry.when }));
}

export type MigrationStatus = 'current' | 'behind' | 'ahead' | 'unmigrated';

/** Extract the PostgreSQL SQLSTATE from a driver error, unwrapping drizzle's query error wrapper. */
export function pgErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') {
    return direct;
  }
  const cause = (error as { cause?: unknown }).cause;
  return cause !== error ? pgErrorCode(cause) : null;
}

export interface MigrationState {
  readonly status: MigrationStatus;
  readonly applied: number;
  readonly expected: number;
  readonly latestTag: string | null;
}

/** Apply every pending reviewed migration. Safe to re-run; drizzle records applied hashes. */
export async function runMigrations(
  db: Database,
  folder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}

/**
 * Compare the database's applied migrations with the journal bundled in this
 * build. `ahead` means the database knows migrations this code does not,
 * which is treated as incompatible.
 */
export async function getMigrationState(
  db: Database,
  folder: string = MIGRATIONS_FOLDER,
): Promise<MigrationState> {
  const journal = readMigrationJournal(folder);
  const expected = journal.length;
  const latestTag = journal.at(-1)?.tag ?? null;
  let applied = 0;
  try {
    const rows = await db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"`,
    );
    applied = rows.rows[0]?.count ?? 0;
  } catch (error) {
    if (pgErrorCode(error) === '42P01') {
      return { status: 'unmigrated', applied: 0, expected, latestTag };
    }
    throw error;
  }
  const status: MigrationStatus =
    applied === expected ? 'current' : applied < expected ? 'behind' : 'ahead';
  return { status, applied, expected, latestTag };
}
