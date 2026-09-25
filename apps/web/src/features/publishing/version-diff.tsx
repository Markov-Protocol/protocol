'use client';

import type { VersionDiff } from '@markov/contracts';
import { formatBasisPoints } from '@markov/formatters';
import { diffIsEmpty } from './publication-state';

/** Readable difference between two versions, computed from the two immutable payloads. */
export function VersionDiffView({
  diff,
  fromNumber,
  toNumber,
}: {
  readonly diff: VersionDiff;
  readonly fromNumber: number;
  readonly toNumber: number;
}) {
  if (diffIsEmpty(diff)) {
    return (
      <p className="text-supporting text-text-muted" data-testid="version-diff">
        Version {toNumber} carries the same recipe, title, thesis and rules as version {fromNumber}.
      </p>
    );
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-supporting" data-testid="version-diff">
      {diff.legs.added.map((leg) => (
        <li key={`a-${leg.instrumentId}`}>
          Added {leg.symbol} at {formatBasisPoints(leg.weightBps)}.
        </li>
      ))}
      {diff.legs.removed.map((leg) => (
        <li key={`r-${leg.instrumentId}`}>
          Removed {leg.symbol} (was {formatBasisPoints(leg.weightBps)}).
        </li>
      ))}
      {diff.legs.changed.map((leg) => (
        <li key={`c-${leg.instrumentId}`}>
          {leg.symbol}: {formatBasisPoints(leg.fromBps)} → {formatBasisPoints(leg.toBps)}.
        </li>
      ))}
      {diff.cashWeightBps.from !== diff.cashWeightBps.to ? (
        <li>
          Cash: {formatBasisPoints(diff.cashWeightBps.from)} →{' '}
          {formatBasisPoints(diff.cashWeightBps.to)}.
        </li>
      ) : null}
      {diff.titleChanged ? <li>The title changed.</li> : null}
      {diff.thesisChanged ? <li>The thesis text changed.</li> : null}
      {diff.maintenanceChanged ? <li>The maintenance suggestion changed.</li> : null}
      {diff.referencesChanged ? <li>The references changed.</li> : null}
      <li className="text-text-muted">
        Turnover to move from version {fromNumber} to {toNumber}:{' '}
        {formatBasisPoints(diff.turnoverBps)} of the portfolio, one-sided.
      </li>
    </ul>
  );
}
