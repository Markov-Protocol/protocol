import {
  type CapabilityId,
  type CapabilityReadiness,
  capabilityReadinessSchema,
} from '@markov/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { capabilityReadiness } from './schema.js';

export type CapabilityReadinessInput = Omit<CapabilityReadiness, 'updatedAt' | 'evidence'> & {
  readonly evidence?: Record<string, unknown>;
};

/**
 * Baseline readiness written by `markov db migrate` when a capability has no
 * row yet. Operators update rows with evidence; the seed never overwrites.
 * Statuses here describe the state at the end of session B01.
 */
export const BASELINE_CAPABILITY_READINESS: readonly Omit<CapabilityReadinessInput, 'updatedBy'>[] =
  [
    {
      capability: 'platform.api.health',
      status: 'IMPLEMENTED',
      summary:
        'Liveness, readiness and platform info endpoints; verified locally in B01 with inject and process tests.',
      evidence: { session: 'B01' },
    },
    {
      capability: 'platform.db.migrations',
      status: 'IMPLEMENTED',
      summary:
        'Reviewed SQL migrations, migration-state check and platform identity binding; verified against local PostgreSQL 16 in B01.',
      evidence: { session: 'B01' },
    },
    {
      capability: 'platform.worker.temporal',
      status: 'IMPLEMENTED',
      summary:
        'Temporal worker with a platform health workflow; verified against a local Temporal dev server in B01. No financial workflows exist yet.',
      evidence: { session: 'B01' },
    },
    {
      capability: 'solana.rpc.read',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Bounded JSON-RPC reads (getGenesisHash, getHealth, getVersion, getSlot) verified against a fixture server. Live cluster access was blocked in the B01 build environment; verify with `markov solana probe` before enabling any environment.',
      evidence: { session: 'B01', sourceRegister: 'SR-SOL-01' },
    },
    {
      capability: 'solana.rpc.submit',
      status: 'DISABLED',
      summary: 'Transaction submission is not implemented before session B10.',
      evidence: {},
    },
    {
      capability: 'catalog.prestocks.ingest',
      status: 'DISABLED',
      summary: 'Not started; planned for session B03.',
      evidence: {},
    },
    {
      capability: 'catalog.xstocks.ingest',
      status: 'DISABLED',
      summary: 'Not started; planned for session B04.',
      evidence: {},
    },
    {
      capability: 'catalog.tessera.ingest',
      status: 'DISABLED',
      summary: 'Not started; API access and terms unverified (session B17).',
      evidence: {},
    },
    {
      capability: 'identity.provider.verify',
      status: 'DISABLED',
      summary: 'Not started; planned for session B02.',
      evidence: {},
    },
    {
      capability: 'execution.jupiter.quote',
      status: 'DISABLED',
      summary: 'Not started; planned for session B09.',
      evidence: {},
    },
    {
      capability: 'execution.jupiter.build',
      status: 'DISABLED',
      summary: 'Not started; planned for session B09.',
      evidence: {},
    },
    {
      capability: 'execution.spot.submit',
      status: 'DISABLED',
      summary: 'Not started; planned for session B10.',
      evidence: {},
    },
    {
      capability: 'registry.strategy.publish',
      status: 'DISABLED',
      summary: 'Not started; planned for session B08.',
      evidence: {},
    },
    {
      capability: 'research.model.generate',
      status: 'DISABLED',
      summary: 'Not started; planned for session B06.',
      evidence: {},
    },
    {
      capability: 'notifications.email',
      status: 'DISABLED',
      summary: 'Not started; planned for session B16.',
      evidence: {},
    },
    {
      capability: 'liquidity.meteora.read',
      status: 'DISABLED',
      summary: 'Not started; planned for session B17.',
      evidence: {},
    },
    {
      capability: 'liquidity.meteora.dbc-simulate',
      status: 'DISABLED',
      summary: 'Not started; planned for session B17.',
      evidence: {},
    },
    {
      capability: 'automation.unattended',
      status: 'DISABLED',
      summary:
        'Deliberately disabled until an independently enforced mandate mechanism is reviewed (release gate).',
      evidence: {},
    },
  ];

export async function listCapabilityReadiness(db: Database): Promise<CapabilityReadiness[]> {
  const rows = await db.select().from(capabilityReadiness).orderBy(capabilityReadiness.capability);
  return rows.map((row) =>
    capabilityReadinessSchema.parse({
      capability: row.capability,
      status: row.status,
      summary: row.summary,
      evidence: row.evidence,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    }),
  );
}

export async function upsertCapabilityReadiness(
  db: Database,
  input: CapabilityReadinessInput,
): Promise<void> {
  await db
    .insert(capabilityReadiness)
    .values({
      capability: input.capability,
      status: input.status,
      summary: input.summary,
      evidence: input.evidence ?? {},
      updatedBy: input.updatedBy,
    })
    .onConflictDoUpdate({
      target: capabilityReadiness.capability,
      set: {
        status: input.status,
        summary: input.summary,
        evidence: input.evidence ?? {},
        updatedAt: sql`now()`,
        updatedBy: input.updatedBy,
      },
    });
}

/** Insert baseline rows for capabilities that have no row yet. Returns the ids that were created. */
export async function seedCapabilityReadiness(
  db: Database,
  updatedBy: string,
): Promise<CapabilityId[]> {
  const created: CapabilityId[] = [];
  for (const baseline of BASELINE_CAPABILITY_READINESS) {
    const inserted = await db
      .insert(capabilityReadiness)
      .values({
        capability: baseline.capability,
        status: baseline.status,
        summary: baseline.summary,
        evidence: baseline.evidence ?? {},
        updatedBy,
      })
      .onConflictDoNothing({ target: capabilityReadiness.capability })
      .returning({ capability: capabilityReadiness.capability });
    if (inserted.length > 0) {
      created.push(baseline.capability);
    }
  }
  return created;
}
