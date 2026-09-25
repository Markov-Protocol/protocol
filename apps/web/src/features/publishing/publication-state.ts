import type {
  Maintenance,
  Publication,
  PublicationFailure,
  PublicVersion,
  StrategyVersion,
  VersionDiff,
} from '@markov/contracts';
import { formatRawAmount } from '@markov/formatters';
import type { StatusTone } from '@markov/ui';

/**
 * Pure readings of registration state for the publishing screens. Every
 * phase comes from what the API derived from the chain; a database row, a
 * built transaction or an accepted submission is never shown as registered.
 */
export type PublicationPhase =
  | 'saved'
  | 'publishing'
  | 'registered'
  | 'failed'
  | 'expired'
  | 'unknown';

export interface PublicationReading {
  readonly phase: PublicationPhase;
  readonly label: string;
  readonly tone: StatusTone;
  readonly detail: string;
}

const FAILURE_HEADLINES: Readonly<Record<PublicationFailure['code'], string>> = {
  program_error: 'The registry program refused the transaction',
  transaction_error: 'The transaction failed on chain',
  rejected_by_node: 'The node refused the transaction before it ran',
  blockhash_expired: 'The transaction expired before it landed',
  record_mismatch: 'The record on chain does not match this version',
};

export function describeFailure(failure: PublicationFailure): string {
  const program = failure.programError
    ? ` (${failure.programError}${failure.programErrorCode !== null ? `, code ${failure.programErrorCode}` : ''})`
    : '';
  return `${FAILURE_HEADLINES[failure.code]}${program}: ${failure.message}`;
}

/**
 * The registration state of a version: the latest registration attempt is
 * authoritative when there is one; a registered version stays registered
 * whatever later status changes do.
 */
export function readRegistration(
  versionState: StrategyVersion['publication'],
  latest: Publication | null,
): PublicationReading {
  const registration = latest && latest.operation === 'register' ? latest : null;
  const state =
    versionState === 'registered' ? 'registered' : (registration?.state ?? versionState);
  switch (state) {
    case 'registered':
      return {
        phase: 'registered',
        label: 'Registered on-chain',
        tone: 'success',
        detail:
          'The network finalized the registration. The record is public and permanent; only its status marker can change.',
      };
    case 'validated':
    case 'awaiting_signature':
      return {
        phase: 'publishing',
        label: 'Publishing',
        tone: 'pending',
        detail:
          'A registration is prepared and waits for the publisher wallet’s signature. Nothing is on chain yet.',
      };
    case 'submitted':
      return {
        phase: 'publishing',
        label: 'Publishing',
        tone: 'pending',
        detail:
          'The signed transaction was sent. Waiting for the network to finalize it; nothing is assumed before then.',
      };
    case 'failed':
      return {
        phase: 'failed',
        label: 'Failed',
        tone: 'error',
        detail: registration?.failure
          ? describeFailure(registration.failure)
          : 'The last registration attempt failed. Nothing is on chain.',
      };
    case 'expired':
      return {
        phase: 'expired',
        label: 'Expired',
        tone: 'attention',
        detail:
          'The prepared transaction expired before it landed. Nothing is on chain; prepare it again when you are ready.',
      };
    case 'unknown':
      return {
        phase: 'unknown',
        label: 'Status unknown',
        tone: 'attention',
        detail:
          'Markov sent the transaction but got no answer from the network. It re-checks the chain on every read and assumes nothing either way.',
      };
    default:
      return {
        phase: 'saved',
        label: 'Saved privately',
        tone: 'neutral',
        detail: 'Only you can see this version. Nothing is on chain.',
      };
  }
}

/** A deprecation or reactivation attempt, read the same way. */
export function readStatusChange(publication: Publication): PublicationReading {
  const verb = publication.operation === 'deprecate' ? 'Deprecation' : 'Reactivation';
  switch (publication.state) {
    case 'registered':
      return {
        phase: 'registered',
        label: `${verb} registered`,
        tone: 'success',
        detail: `The network finalized the status change; the record now reads ${publication.evidence?.status ?? 'as changed'}.`,
      };
    case 'submitted':
      return {
        phase: 'publishing',
        label: `${verb} sent`,
        tone: 'pending',
        detail: 'Waiting for the network to finalize the status change.',
      };
    case 'failed':
      return {
        phase: 'failed',
        label: `${verb} failed`,
        tone: 'error',
        detail: publication.failure
          ? describeFailure(publication.failure)
          : 'The status change failed; the record is unchanged.',
      };
    case 'expired':
      return {
        phase: 'expired',
        label: `${verb} expired`,
        tone: 'attention',
        detail: 'The prepared transaction expired before it landed; the record is unchanged.',
      };
    case 'unknown':
      return {
        phase: 'unknown',
        label: `${verb} status unknown`,
        tone: 'attention',
        detail: 'The network gave no answer after the send; Markov keeps re-checking.',
      };
    default:
      return {
        phase: 'publishing',
        label: `${verb} prepared`,
        tone: 'pending',
        detail: 'Waiting for the publisher wallet’s signature. The record is unchanged until then.',
      };
  }
}

/** Lamports as SOL with the exact base units beside it; no float anywhere. */
export function formatLamports(lamports: number): string {
  return `${formatRawAmount(String(lamports), 9)} SOL (${lamports.toLocaleString('en-US')} lamports)`;
}

export interface DiffableVersion {
  readonly versionId: string;
  readonly title: string;
  readonly thesis: string;
  readonly legs: readonly {
    readonly instrumentId: string;
    readonly symbol: string;
    readonly weightBps: number;
  }[];
  readonly cashWeightBps: number;
  readonly maintenance: Maintenance;
  readonly references: readonly string[];
}

/**
 * Readable difference between two immutable versions, computed from the
 * two payloads the API answered; the same rules as the backend's
 * `diffVersions` (turnover is the one-sided sum of absolute weight moves).
 */
export function diffVersions(from: DiffableVersion, to: DiffableVersion): VersionDiff {
  const before = new Map(from.legs.map((leg) => [leg.instrumentId, leg]));
  const after = new Map(to.legs.map((leg) => [leg.instrumentId, leg]));
  const added: VersionDiff['legs']['added'] = [];
  const removed: VersionDiff['legs']['removed'] = [];
  const changed: VersionDiff['legs']['changed'] = [];
  let moved = 0;
  for (const leg of to.legs) {
    const previous = before.get(leg.instrumentId);
    if (!previous) {
      added.push({ instrumentId: leg.instrumentId, symbol: leg.symbol, weightBps: leg.weightBps });
      moved += leg.weightBps;
    } else if (previous.weightBps !== leg.weightBps) {
      changed.push({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        fromBps: previous.weightBps,
        toBps: leg.weightBps,
      });
      moved += Math.abs(leg.weightBps - previous.weightBps);
    }
  }
  for (const leg of from.legs) {
    if (!after.has(leg.instrumentId)) {
      removed.push({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        weightBps: leg.weightBps,
      });
      moved += leg.weightBps;
    }
  }
  moved += Math.abs(to.cashWeightBps - from.cashWeightBps);
  const sameMaintenance =
    from.maintenance.suggestion === to.maintenance.suggestion &&
    from.maintenance.driftThresholdBps === to.maintenance.driftThresholdBps &&
    from.maintenance.reviewEveryDays === to.maintenance.reviewEveryDays;
  const fromReferences = [...from.references].sort();
  const toReferences = [...to.references].sort();
  const sameReferences =
    fromReferences.length === toReferences.length &&
    fromReferences.every((value, index) => value === toReferences[index]);
  return {
    fromVersionId: from.versionId,
    toVersionId: to.versionId,
    legs: { added, removed, changed },
    cashWeightBps: { from: from.cashWeightBps, to: to.cashWeightBps },
    titleChanged: from.title !== to.title,
    thesisChanged: from.thesis !== to.thesis,
    maintenanceChanged: !sameMaintenance,
    referencesChanged: !sameReferences,
    turnoverBps: Math.floor(moved / 2),
  };
}

export function diffIsEmpty(diff: VersionDiff): boolean {
  return (
    diff.legs.added.length === 0 &&
    diff.legs.removed.length === 0 &&
    diff.legs.changed.length === 0 &&
    diff.cashWeightBps.from === diff.cashWeightBps.to &&
    !diff.titleChanged &&
    !diff.thesisChanged &&
    !diff.maintenanceChanged &&
    !diff.referencesChanged
  );
}

/** One constituent as both version shapes describe it. */
export interface RecipeLeg {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly issuer: StrategyVersion['legs'][number]['issuer'];
  readonly mint: string;
  readonly tokenProgram: PublicVersion['legs'][number]['tokenProgram'];
  readonly weightBps: number;
}

export function recipeLegsOf(version: StrategyVersion | PublicVersion): readonly RecipeLeg[] {
  return version.legs.map((leg) =>
    'admission' in leg
      ? {
          instrumentId: leg.instrumentId,
          symbol: leg.symbol,
          companyName: leg.companyName,
          issuer: leg.issuer,
          mint: leg.admission.mint,
          tokenProgram: leg.admission.tokenProgram,
          weightBps: leg.weightBps,
        }
      : {
          instrumentId: leg.instrumentId,
          symbol: leg.symbol,
          companyName: leg.companyName,
          issuer: leg.issuer,
          mint: leg.mint,
          tokenProgram: leg.tokenProgram,
          weightBps: leg.weightBps,
        },
  );
}

export const MAINTENANCE_LABELS: Readonly<Record<Maintenance['suggestion'], string>> = {
  hold: 'Hold',
  rebalance_on_drift: 'Rebalance on drift',
  review_periodically: 'Review periodically',
};

export function describeMaintenance(maintenance: Maintenance): string {
  const base = MAINTENANCE_LABELS[maintenance.suggestion];
  if (maintenance.suggestion === 'rebalance_on_drift' && maintenance.driftThresholdBps !== null) {
    return `${base} beyond ${maintenance.driftThresholdBps} bps`;
  }
  if (maintenance.suggestion === 'review_periodically' && maintenance.reviewEveryDays !== null) {
    return `${base} every ${maintenance.reviewEveryDays} day${maintenance.reviewEveryDays === 1 ? '' : 's'}`;
  }
  return base;
}
