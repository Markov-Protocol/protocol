import type { BoundPlatformIdentity, PlatformIdentity } from '@markov/contracts';
import { eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { platformIdentity } from './schema.js';

const SINGLETON_ID = 1;

export type PlatformIdentityVerification =
  | { readonly status: 'bound'; readonly stored: BoundPlatformIdentity }
  | { readonly status: 'unbound' }
  | {
      readonly status: 'mismatch';
      readonly stored: BoundPlatformIdentity;
      readonly differences: readonly string[];
    };

export class PlatformIdentityMismatchError extends Error {
  override readonly name = 'PlatformIdentityMismatchError';
  readonly differences: readonly string[];

  constructor(differences: readonly string[]) {
    super(`database is bound to a different platform identity: ${differences.join('; ')}`);
    this.differences = differences;
  }
}

function toBound(row: typeof platformIdentity.$inferSelect): BoundPlatformIdentity {
  return {
    markovEnv: row.markovEnv as BoundPlatformIdentity['markovEnv'],
    solanaCluster: row.solanaCluster as BoundPlatformIdentity['solanaCluster'],
    genesisHash: row.genesisHash,
    boundAt: row.boundAt.toISOString(),
    boundBy: row.boundBy,
  };
}

function differences(expected: PlatformIdentity, stored: PlatformIdentity): string[] {
  const out: string[] = [];
  if (expected.markovEnv !== stored.markovEnv) {
    out.push(`markovEnv expected ${expected.markovEnv}, database bound to ${stored.markovEnv}`);
  }
  if (expected.solanaCluster !== stored.solanaCluster) {
    out.push(
      `solanaCluster expected ${expected.solanaCluster}, database bound to ${stored.solanaCluster}`,
    );
  }
  if (expected.genesisHash !== stored.genesisHash) {
    out.push(
      `genesisHash expected ${expected.genesisHash}, database bound to ${stored.genesisHash}`,
    );
  }
  return out;
}

export async function readPlatformIdentity(db: Database): Promise<BoundPlatformIdentity | null> {
  const rows = await db
    .select()
    .from(platformIdentity)
    .where(eq(platformIdentity.id, SINGLETON_ID))
    .limit(1);
  const row = rows[0];
  return row ? toBound(row) : null;
}

export async function verifyPlatformIdentity(
  db: Database,
  expected: PlatformIdentity,
): Promise<PlatformIdentityVerification> {
  const stored = await readPlatformIdentity(db);
  if (stored === null) {
    return { status: 'unbound' };
  }
  const diff = differences(expected, stored);
  return diff.length === 0
    ? { status: 'bound', stored }
    : { status: 'mismatch', stored, differences: diff };
}

/**
 * Bind the database to an identity. Idempotent for an equal identity; throws
 * for a different one. Concurrent binders are serialised by the primary key:
 * the first insert wins and the loser observes a mismatch.
 */
export async function bindPlatformIdentity(
  db: Database,
  identity: PlatformIdentity,
  boundBy: string,
): Promise<{ readonly created: boolean; readonly stored: BoundPlatformIdentity }> {
  const inserted = await db
    .insert(platformIdentity)
    .values({
      id: SINGLETON_ID,
      markovEnv: identity.markovEnv,
      solanaCluster: identity.solanaCluster,
      genesisHash: identity.genesisHash,
      boundBy,
    })
    .onConflictDoNothing({ target: platformIdentity.id })
    .returning();
  const insertedRow = inserted[0];
  if (insertedRow) {
    return { created: true, stored: toBound(insertedRow) };
  }
  const verification = await verifyPlatformIdentity(db, identity);
  if (verification.status === 'bound') {
    return { created: false, stored: verification.stored };
  }
  if (verification.status === 'mismatch') {
    throw new PlatformIdentityMismatchError(verification.differences);
  }
  throw new Error('platform identity insert reported a conflict but no row exists');
}
