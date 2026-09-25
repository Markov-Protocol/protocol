import type { JournalAsset, JournalEntry } from '@markov/contracts';
import { type AssetBalance, entryForExternalFlow } from './journal.js';

/**
 * Reconciliation of the journal's `wallet` account against what the chain
 * shows. Every difference becomes an explicit external-flow entry that
 * needs the owner's acknowledgement; assets the chain holds that the
 * journal never saw stay unassigned. Nothing is assumed to belong to a
 * strategy.
 */

export interface ChainBalance {
  readonly asset: JournalAsset;
  readonly raw: bigint;
  /** Known when the asset is a mint the platform recognises. */
  readonly symbol: string | null;
  readonly decimals: number | null;
}

export type ReconciliationOutcome =
  | 'matched'
  | 'external_inflow_recorded'
  | 'external_outflow_recorded'
  | 'unassigned_asset'
  | 'already_flagged';

export interface ReconciledAsset {
  readonly asset: JournalAsset;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly ledgerBeforeRaw: bigint;
  readonly chainRaw: bigint;
  readonly differenceRaw: bigint;
  readonly outcome: ReconciliationOutcome;
  readonly entry: JournalEntry | null;
}

export interface ReconciliationInput {
  readonly ownerUserId: string;
  readonly walletId: string;
  /** The checkpoint id this observation is recorded under; part of every flow entry's source reference. */
  readonly observationId: string;
  readonly slot: number;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly ledger: readonly AssetBalance[];
  readonly chain: readonly ChainBalance[];
  /** Assets with an external flow still awaiting acknowledgement; a repeat difference is not flagged twice. */
  readonly pendingFlowAssets: ReadonlySet<JournalAsset>;
  readonly entryIdFor: (asset: JournalAsset) => string;
}

export interface ReconciliationResult {
  readonly status: 'matched' | 'needs_review';
  readonly assets: ReconciledAsset[];
  readonly entries: JournalEntry[];
}

export function reconcileBalances(input: ReconciliationInput): ReconciliationResult {
  const ledger = new Map(input.ledger.map((balance) => [balance.asset, balance]));
  const chain = new Map(input.chain.map((balance) => [balance.asset, balance]));
  const assets = new Set<JournalAsset>([...ledger.keys(), ...chain.keys()]);
  const results: ReconciledAsset[] = [];
  const entries: JournalEntry[] = [];
  for (const asset of [...assets].sort()) {
    const ledgerBalance = ledger.get(asset) ?? null;
    const chainBalance = chain.get(asset) ?? null;
    const ledgerRaw = ledgerBalance?.raw ?? 0n;
    const chainRaw = chainBalance?.raw ?? 0n;
    const difference = chainRaw - ledgerRaw;
    const symbol = ledgerBalance?.symbol ?? chainBalance?.symbol ?? null;
    const decimals = ledgerBalance?.decimals ?? chainBalance?.decimals ?? null;
    const known = symbol !== null && decimals !== null;
    let outcome: ReconciliationOutcome;
    let entry: JournalEntry | null = null;
    if (difference === 0n) {
      outcome = 'matched';
    } else if (!known) {
      // The platform cannot name the asset: it stays visible and unassigned, never journaled.
      outcome = 'unassigned_asset';
    } else if (input.pendingFlowAssets.has(asset)) {
      outcome = 'already_flagged';
    } else {
      entry = entryForExternalFlow({
        entryId: input.entryIdFor(asset),
        ownerUserId: input.ownerUserId,
        walletId: input.walletId,
        observationId: input.observationId,
        asset,
        symbol,
        decimals,
        differenceRaw: difference,
        slot: input.slot,
        observedAt: input.observedAt,
        recordedAt: input.recordedAt,
      });
      entries.push(entry);
      outcome = difference > 0n ? 'external_inflow_recorded' : 'external_outflow_recorded';
    }
    results.push({
      asset,
      symbol,
      decimals,
      ledgerBeforeRaw: ledgerRaw,
      chainRaw,
      differenceRaw: difference,
      outcome,
      entry,
    });
  }
  const status = results.every((result) => result.outcome === 'matched')
    ? 'matched'
    : 'needs_review';
  return { status, assets: results, entries };
}
