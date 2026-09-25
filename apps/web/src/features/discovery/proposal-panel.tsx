'use client';

import type { PortfolioInstance } from '@markov/contracts';
import { Button, Notice, SkeletonText } from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import type { DiffableVersion } from '../publishing/publication-state';
import { usePublicVersion } from '../publishing/queries';
import { VersionDiffView } from '../publishing/version-diff';
import { proposalDiff } from './discovery-model';
import { usePinInstance } from './queries';

/**
 * A creator published a newer version: the follower reads the exact
 * difference against the version they hold and accepts it explicitly, or
 * keeps what they have. Accepting moves the pin and nothing else; a
 * rebalance is a separate reviewed plan.
 */
export function ProposalPanel({
  instance,
  pinned,
}: {
  readonly instance: PortfolioInstance;
  readonly pinned: DiffableVersion | null;
}) {
  const proposedId = instance.proposedVersionId;
  const proposed = usePublicVersion(instance.strategyId, proposedId, proposedId !== null);
  const pin = usePinInstance();
  const [error, setError] = useState<string | null>(null);
  if (proposedId === null || instance.status !== 'active') {
    return null;
  }
  const notPublic = proposed.error instanceof WebApiError && proposed.error.status === 404;
  return (
    <Notice tone="info" title="A newer version awaits your acceptance" data-testid="proposal-panel">
      <div className="space-y-3">
        <p>
          The creator registered a newer version. Your pin stays on version{' '}
          {instance.pinnedVersionNumber} until you accept; accepting moves the pin only. Nothing is
          bought or sold: a rebalance towards the new weights is a separate plan you review.
        </p>
        {proposed.data && pinned ? (
          <div className="space-y-1">
            <p className="font-medium">
              What version {proposed.data.versionNumber} changes against version{' '}
              {instance.pinnedVersionNumber}
            </p>
            <VersionDiffView
              diff={proposalDiff(pinned, proposed.data)}
              fromNumber={instance.pinnedVersionNumber}
              toNumber={proposed.data.versionNumber}
            />
            <p className="text-caption text-text-muted">
              <Link
                href={`/strategies/${instance.strategyId}/versions/${proposed.data.versionId}`}
                className="underline underline-offset-2"
              >
                Read version {proposed.data.versionNumber} with its chain evidence
              </Link>
              .
            </p>
          </div>
        ) : notPublic ? (
          <p className="text-supporting" data-testid="proposal-unavailable">
            The proposed version is not publicly readable right now (withheld or no longer
            registered), so nothing can be accepted from it.
          </p>
        ) : proposed.error ? (
          <p className="text-supporting text-error">
            The proposed version could not be read; try again in a moment.
          </p>
        ) : (
          <SkeletonText lines={2} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            loading={pin.isPending}
            {...(proposed.data && pinned
              ? {}
              : { disabledReason: 'Read the difference before accepting a version.' })}
            data-testid="accept-version"
            onClick={() => {
              setError(null);
              pin.mutate(
                { instanceId: instance.instanceId, versionId: proposedId },
                {
                  onError: (failure) =>
                    setError(failure.message || 'The version could not be accepted.'),
                },
              );
            }}
          >
            Accept version {proposed.data?.versionNumber ?? ''}
          </Button>
          <span className="text-caption text-text-muted">
            or keep version {instance.pinnedVersionNumber}; the offer stays until you decide.
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-supporting text-error">
            {error}
          </p>
        ) : null}
      </div>
    </Notice>
  );
}
