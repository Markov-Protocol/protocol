import type { Maintenance, VersionDiff } from '@markov/contracts';

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

/** Machine-readable difference between two versions; turnover is the one-sided sum of absolute weight moves. */
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
  const sameReferences =
    from.references.length === to.references.length &&
    [...from.references].sort().every((value, index) => value === [...to.references].sort()[index]);
  return {
    fromVersionId: from.versionId,
    toVersionId: to.versionId,
    legs: { added, removed, changed },
    cashWeightBps: { from: from.cashWeightBps, to: to.cashWeightBps },
    titleChanged: from.title !== to.title,
    thesisChanged: from.thesis !== to.thesis,
    maintenanceChanged: !sameMaintenance,
    referencesChanged: !sameReferences,
    // Every move is counted on both sides (a leg that grows is paid for by one that shrinks), so halve it.
    turnoverBps: Math.floor(moved / 2),
  };
}
