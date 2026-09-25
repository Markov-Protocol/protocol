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
 * row yet; the seed inserts only missing rows and never overwrites one.
 * Statuses here describe the state after session B17 (closed after its first
 * increment, the xAI adapter) and match the state column of
 * `docs/markov/provider-capabilities.md`. No CLI command or route calls
 * `upsertCapabilityReadiness` yet, so a database seeded before a seed change
 * keeps its earlier row until an operator write path exists.
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
        'Temporal worker with the platform health workflow (B01), the execution reconciliation workflow (B10) and the maintenance workflow (B16); verified against a local Temporal dev server. The workflows never build or sign a transaction and spend nothing.',
      evidence: { sessions: ['B01', 'B10', 'B16'] },
    },
    {
      capability: 'solana.rpc.read',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Bounded JSON-RPC reads (getGenesisHash, getHealth, getVersion, getSlot; getAccountInfo for mint verification, B03; getBalance, getTokenAccountsByOwner and getMinimumBalanceForRentExemption for funding readiness, F04) verified against fixture servers only. The client itself has never reached a live cluster (SR-SOL-01); verify with `markov solana probe` before enabling any environment.',
      evidence: {
        sessions: ['B01', 'B03', 'F04'],
        sourceRegister: ['SR-SOL-01', 'SR-SOL-02', 'SR-SOL-RPC-02'],
      },
    },
    {
      capability: 'solana.rpc.submit',
      status: 'FIXTURE_VERIFIED',
      summary:
        'sendTransaction (base64, preflight on), simulateTransaction, getLatestBlockhash, getBlockHeight, getSignatureStatuses, getTransaction and getProgramAccounts implemented and verified against the fixture chain for registry publication (B08) and the execution lifecycle (B10, B11). No transaction has been sent to a live cluster.',
      evidence: { sessions: ['B08', 'B10', 'B11'] },
    },
    {
      capability: 'catalog.prestocks.ingest',
      status: 'BLOCKED',
      summary:
        'Ingestion pipeline implemented and fixture-verified (B03): sanitised snapshots, quarantine, counterfeit rules, on-chain mint verification, operator admission. The live PreStocks feed endpoint and schema are unverified (OD-17); no live read exists.',
      evidence: { session: 'B03', openDecision: 'OD-17', sourceRegister: 'SR-PRESTOCKS-02' },
    },
    {
      capability: 'catalog.xstocks.ingest',
      status: 'BLOCKED',
      summary:
        'Listed-stock pipeline implemented and fixture-verified (B04): Token-2022 extension policy, scaled-amount multiplier evidence, exact quantities, corporate-action lifecycle. The live xStocks endpoints and real mints are unverified (OD-18).',
      evidence: { session: 'B04', openDecision: 'OD-18', sourceRegister: 'SR-XSTOCKS-01' },
    },
    {
      capability: 'catalog.tessera.ingest',
      status: 'DISABLED',
      summary:
        'Not started; planned as E02 (Tessera catalog). API access, schema and terms are unverified (OD-15) and docs.tessera.finance was blocked by egress (SR-EGRESS-01).',
      evidence: { openDecision: 'OD-15', sourceRegister: 'SR-EGRESS-01' },
    },
    {
      capability: 'identity.provider.verify',
      status: 'IMPLEMENTED',
      summary:
        'Provider-neutral identity token verification and session exchange, verified end to end with the nonproduction test issuer (B02). Live provider configuration is unverified.',
      evidence: { session: 'B02', openDecision: 'OD-05', sourceRegister: 'SR-PRIVY-01' },
    },
    {
      capability: 'policy.eligibility.rules',
      status: 'BLOCKED',
      summary:
        'Versioned eligibility, terms acknowledgements, tighten-only limits, capability states, deterministic policy decisions and race-safe reservations implemented and fixture-verified (B05). No counsel-approved rule set or terms exist (OD-06); declarations answer unknown until operators publish them.',
      evidence: { session: 'B05', openDecision: 'OD-06' },
    },
    {
      capability: 'execution.jupiter.quote',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Execution plans (B09) quote every constituent through the Markov quote contract: the fixture venue (local/test) and an operator-configured gateway URL are implemented and fixture-verified against synthetic stand-ins. No Jupiter response has been recorded: every Jupiter host was unreachable from the build environment (OD-21, SR-JUP-01) and no live quote has been taken.',
      evidence: { session: 'B09', openDecision: 'OD-21', sourceRegister: 'SR-JUP-01' },
    },
    {
      capability: 'execution.jupiter.build',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Transactions (B10) are built from the acknowledged plan by the fixture venue (local/test) or a configured gateway build URL, decoded instruction by instruction, validated against the plan and simulated before they are stored; baskets (B11) are composed into one transaction at plan time and atomic only when the composition fits the packet and passes simulation, staged otherwise; no live route builds or composes (OD-21) and the route matrix reviews no live program.',
      evidence: { sessions: ['B10', 'B11'], openDecision: 'OD-21', sourceRegister: 'SR-JUP-01' },
    },
    {
      capability: 'execution.spot.submit',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Owner-signed submission and recovery (B10) verified against the fixture chain: signature over the exact prepared message, policy with a reservation per leg at submission, attempt persisted before the one broadcast, chain-derived states to finality with fills from transaction meta, resend of the same bytes, expiry and cancellation on evidence; baskets (B11) atomic in one transaction or staged one leg at a time with re-quoted later legs, partial completion on evidence and reviewed completion of the unfilled legs. Nothing has been sent to a live cluster.',
      evidence: { sessions: ['B10', 'B11'] },
    },
    {
      capability: 'accounting.journal',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Append-only quantity journal (B12) balanced per asset in raw units: settled fills, network fees and rent projected once per signature and leg, FIFO lots attributed to the one matching strategy instance or kept at wallet level, external flows recorded against the chain with owner acknowledgement, corrections by reversal. Verified against the fixture chain; no live balance has been reconciled.',
      evidence: { session: 'B12' },
    },
    {
      capability: 'receipts.signing',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Canonical execution and decision receipts (B12) signed with a versioned Ed25519 key from configuration (local_key, refused in production) and verified offline by the CLI against the published keys; the KMS-backed signer is not implemented (OD-22). A signature attests to the record; settlement is the chain evidence it references.',
      evidence: { session: 'B12', openDecision: 'OD-22' },
    },
    {
      capability: 'analytics.performance',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Valuation series and window metrics (B13): recorded reference observations with freshness and kind precedence, historical multipliers, model and actual series on a daily grid with flow points, time-weighted and Modified Dietz returns, drawdown, turnover, realized and unrealized P&L, completeness, model-only rankings. Verified against independently derived fixture vectors and the fixture chain; the only price sources are the fixture feeds and operator entries (OD-23), so no live series exists.',
      evidence: { session: 'B13', openDecision: 'OD-23' },
    },
    {
      capability: 'registry.strategy.publish',
      status: 'FIXTURE_VERIFIED',
      summary:
        'Anchor program verified under solana-program-test (registration evidence, duplicate initialisation, unauthorized publishing, seed and account misuse, weight overflow, lineage, immutable content) with shared Rust/TypeScript vectors; publication flow and indexer verified against the fixture ledger and PostgreSQL (B08). No SBF build, no validator run, nothing deployed. Publication is enabled whenever REGISTRY_PROGRAM_ID is configured (never in mainnet-read-only); mainnet-beta publication also requires MARKOV_ENV=production and RELEASE_EVIDENCE_REF. Configuration does not check that the deployment was reviewed (OD-09, OD-10).',
      evidence: { session: 'B08', openDecisions: ['OD-09', 'OD-10', 'OD-20'] },
    },
    {
      capability: 'research.model.generate',
      status: 'BLOCKED',
      summary:
        'Manual research is implemented (B06); the adapter contract, output validation and provenance are fixture-verified with the deterministic fixture adapter, which configuration refuses outside local/test. The xAI adapter (`@markov/model-xai`, B17; xAI selected, OD-19 partly decided) is implemented and verified against an in-process stand-in only; api.x.ai was unreachable from the build environment (SR-XAI-01), so no live run exists.',
      evidence: {
        sessions: ['B06', 'B17'],
        config: 'RESEARCH_MODEL_PROVIDER',
        openDecision: 'OD-19',
        sourceRegister: 'SR-XAI-01',
      },
    },
    {
      capability: 'companion.model.run',
      status: 'BLOCKED',
      summary:
        'Typed agent tools with the caller’s own authority are implemented (B15); the bounded companion loop, proposals and the Mark I event log are fixture-verified with the deterministic fixture adapter, which configuration refuses outside local/test. The xAI adapter (B17; xAI selected, OD-19 partly decided) is implemented and verified against an in-process stand-in only (SR-XAI-01); no live run exists.',
      evidence: {
        sessions: ['B15', 'B17'],
        config: 'COMPANION_MODEL_PROVIDER',
        openDecision: 'OD-19',
        sourceRegister: 'SR-XAI-01',
      },
    },
    {
      capability: 'maintenance.scheduler',
      status: 'IMPLEMENTED',
      summary:
        'Schedules prepare proposals for the owner’s review on a durable loop; occurrences are deduplicated, missed ones skipped, review windows expire and nothing spends (B16).',
      evidence: {
        session: 'B16',
        tests: ['apps/api/test/maintenance.test.ts', 'apps/worker/test/worker.test.ts'],
        journey: 'scripts/ci/startup-check.sh',
      },
    },
    {
      capability: 'notifications.email',
      status: 'BLOCKED',
      summary:
        'In-app outbox, preferences, address verification, retries and dead letters implemented (B16); the email adapter is fixture-verified and no provider is integrated (OD-25).',
      evidence: {
        session: 'B16',
        openDecision: 'OD-25',
        tests: ['packages/notifications/test', 'apps/api/test/maintenance.test.ts'],
      },
    },
    {
      capability: 'liquidity.meteora.read',
      status: 'DISABLED',
      summary: 'Not started; planned as E04 (Meteora observation and DBC simulation).',
      evidence: {},
    },
    {
      capability: 'liquidity.meteora.dbc-simulate',
      status: 'DISABLED',
      summary: 'Not started; planned as E04 (Meteora observation and DBC simulation).',
      evidence: {},
    },
    {
      capability: 'automation.unattended',
      status: 'DISABLED',
      summary:
        'Deliberately disabled until an independently enforced mandate mechanism is reviewed (release gate, OD-26).',
      evidence: { openDecision: 'OD-26' },
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
