import type {
  InstrumentAvailability,
  InstrumentKind,
  InstrumentStatus,
  Issuer,
  SolanaCluster,
} from '@markov/contracts';
import type { StatusTone } from '@markov/ui';
import type { PlatformSnapshot } from '../auth/session-types';

/** Issuer names as people know them; the id stays the contract value. */
export const ISSUER_LABELS: Readonly<Record<Issuer, string>> = {
  prestocks: 'PreStocks',
  xstocks: 'xStocks',
  tessera: 'Tessera',
};

export const KIND_LABELS: Readonly<Record<InstrumentKind, string>> = {
  pre_ipo_exposure: 'Pre-IPO exposure',
  listed_stock: 'Listed stock',
};

export const STATUS_LABELS: Readonly<Record<InstrumentStatus, string>> = {
  admitted: 'Admitted',
  paused: 'Paused',
  quarantined: 'Not admitted',
  rejected: 'Rejected',
  delisted: 'Delisted',
};

export function statusTone(status: InstrumentStatus): StatusTone {
  switch (status) {
    case 'admitted':
      return 'success';
    case 'paused':
      return 'attention';
    case 'delisted':
    case 'rejected':
      return 'error';
    default:
      return 'neutral';
  }
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  INSTRUMENT_PAUSED: 'paused by Markov operators',
  INSTRUMENT_QUARANTINED: 'not admitted yet',
  INSTRUMENT_REJECTED: 'rejected by Markov operators',
  INSTRUMENT_DELISTED: 'delisted',
  ISSUER_HALTED: 'halted by the issuer',
  MIGRATION_REQUIRED: 'migrating to a successor token',
  INSTRUMENT_SUNSET: 'past its sunset date',
  CORPORATE_ACTION_PENDING: 'a corporate action is due and not yet applied',
  MULTIPLIER_UNKNOWN: 'no multiplier evidence yet',
  EXECUTION_NOT_ENABLED: 'trading is not enabled in this build',
};

/** Reasons that are true for every instrument in this build and are said once, not per row. */
export const BUILD_WIDE_REASONS: ReadonlySet<string> = new Set(['EXECUTION_NOT_ENABLED']);

/** A reason code from the catalog or policy as a phrase; unknown codes are shown as words, never hidden. */
export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code.toLowerCase().replace(/_/g, ' ');
}

export interface AvailabilitySummary {
  readonly tone: StatusTone;
  readonly label: string;
  readonly reasons: readonly string[];
}

/** One-line reading of the public availability block; execution is never implied. */
export function summariseAvailability(
  status: InstrumentStatus,
  availability: InstrumentAvailability,
): AvailabilitySummary {
  const reasons = availability.reasons
    .filter((code) => !BUILD_WIDE_REASONS.has(code))
    .map(reasonLabel);
  if (availability.strategy) {
    return { tone: 'success', label: 'Research and strategy building', reasons };
  }
  if (availability.research) {
    return { tone: 'attention', label: 'Research only', reasons };
  }
  return { tone: 'error', label: STATUS_LABELS[status], reasons };
}

/** Human name of the cluster the platform is bound to. */
export function networkLabel(cluster: SolanaCluster | null | undefined): string {
  switch (cluster) {
    case 'mainnet-beta':
      return 'Solana mainnet';
    case 'devnet':
      return 'Solana devnet';
    case 'testnet':
      return 'Solana testnet';
    case 'localnet':
      return 'Solana localnet';
    default:
      return 'Solana (network unknown)';
  }
}

/** Explorer link for a mint on a public cluster; none for localnet or an unknown network. */
export function explorerAddressUrl(
  address: string,
  cluster: SolanaCluster | null | undefined,
): string | null {
  switch (cluster) {
    case 'mainnet-beta':
      return `https://explorer.solana.com/address/${address}`;
    case 'devnet':
    case 'testnet':
      return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
    default:
      return null;
  }
}

/** Deterministic monogram for an instrument; the catalog carries no images and none are fetched. */
export function monogramOf(symbol: string): string {
  return symbol.replace(/[^A-Z0-9]/g, '').slice(0, 2) || '?';
}

const CLUSTERS: readonly SolanaCluster[] = ['localnet', 'devnet', 'testnet', 'mainnet-beta'];

/** The cluster the backend is bound to, once the platform facts are known; unknown values are not guessed. */
export function clusterOf(platform: PlatformSnapshot): SolanaCluster | null {
  if (platform.state !== 'connected' || platform.solanaCluster === null) {
    return null;
  }
  return (CLUSTERS as readonly string[]).includes(platform.solanaCluster)
    ? (platform.solanaCluster as SolanaCluster)
    : null;
}
