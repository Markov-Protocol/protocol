'use client';

import type { PublicStrategy, StrategyDetail, VersionSummary } from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, Skeleton, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { useStrategy } from '../builder/queries';
import { StrategyProvenance } from '../discovery/strategy-provenance';
import { ReviewInvestmentLink } from '../review/review-link';
import { FollowButton } from './follow-button';
import { ForkButton } from './fork-button';
import { readRegistration } from './publication-state';
import { useFreezeVersion, usePublicStrategy } from './queries';

function isNotFound(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 404;
}

function Loading({ label }: { readonly label: string }) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6"
    >
      <Skeleton className="h-8 w-2/3" />
      <SkeletonText lines={4} />
    </section>
  );
}

function OwnerVersionRow({
  strategyId,
  version,
}: {
  readonly strategyId: string;
  readonly version: VersionSummary;
}) {
  const reading = readRegistration(version.publication, null);
  const href = `/strategies/${strategyId}/versions/${version.versionId}`;
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border/60 p-3"
      data-testid="version-row"
    >
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={href} className="font-medium underline underline-offset-2">
            Version {version.versionNumber} · {version.title}
          </Link>
          <StatusBadge tone={reading.tone}>{reading.label}</StatusBadge>
          {version.deprecatedBy ? (
            <StatusBadge tone="attention">Superseded by a later version</StatusBadge>
          ) : null}
        </p>
        <p className="text-caption text-text-muted">
          Frozen {formatInstant(version.frozenAt)} UTC · manifest hash{' '}
          <code className="font-mono" title={version.manifestHash}>
            {shortenAddress(version.manifestHash, { head: 8, tail: 8 })}
          </code>
        </p>
      </div>
      <Button asChild size="sm" variant={reading.phase === 'registered' ? 'secondary' : 'primary'}>
        <Link href={href}>{reading.phase === 'registered' ? 'Open' : 'Publish'}</Link>
      </Button>
    </li>
  );
}

/** The owner's view: the working draft, every frozen version with its chain-derived state, and what the public sees. */
function OwnerStrategy({ detail }: { readonly detail: StrategyDetail }) {
  const strategy = detail.strategy;
  const strategyId = strategy.strategyId;
  const router = useRouter();
  const freeze = useFreezeVersion(strategyId);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const versions = [...detail.versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const registeredCount = versions.filter((version) => version.publication === 'registered').length;
  const publicView = usePublicStrategy(strategyId, registeredCount > 0);
  const title = detail.draft.content.title || strategy.currentVersion?.title || 'Untitled basket';
  const archived = strategy.status === 'archived';
  const draftValid = detail.draft.validation.valid;
  const nextNumber = (versions[0]?.versionNumber ?? 0) + 1;
  const freezeReason = archived
    ? 'An archived strategy takes no new versions; restore it in the editor first.'
    : !draftValid
      ? 'Fix the rule violations in the editor before freezing.'
      : null;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/strategies/new" className="underline underline-offset-2">
            Build
          </Link>{' '}
          <span className="text-text-muted">/ strategy</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-heading-lg font-semibold" title={title}>
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={archived ? 'attention' : 'neutral'}>
              {archived ? 'Archived' : `Draft revision ${strategy.draftRevision}`}
            </StatusBadge>
            <StatusBadge tone="info">
              {versions.length} frozen version{versions.length === 1 ? '' : 's'}
            </StatusBadge>
            {registeredCount > 0 ? (
              <StatusBadge tone="success">{registeredCount} registered on-chain</StatusBadge>
            ) : null}
          </div>
        </div>
        {strategy.forkOf ? (
          <p className="text-supporting text-text-muted">
            Forked from{' '}
            <Link
              href={`/strategies/${strategy.forkOf.strategyId}/versions/${strategy.forkOf.versionId}`}
              className="underline underline-offset-2"
            >
              another strategy's version
            </Link>
            ; the attribution stays with every version you freeze.
          </p>
        ) : null}
      </header>

      <section
        aria-labelledby="draft-heading"
        className="space-y-3 rounded-panel border border-border p-4"
      >
        <h2 id="draft-heading" className="text-heading-sm font-semibold">
          Working draft
        </h2>
        <p className="text-supporting text-text-muted">
          Edits live in the draft. Nothing public changes until you freeze a version and register
          it; instances pinned to an older version stay pinned until their owner accepts a newer
          one.{' '}
          {draftValid
            ? 'The draft passes every rule.'
            : 'The draft has rule violations; the editor lists them.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="secondary">
            <Link href={`/strategies/${strategyId}/edit`}>Edit draft</Link>
          </Button>
          <Button
            type="button"
            loading={freeze.isPending}
            {...(freezeReason ? { disabledReason: freezeReason } : {})}
            onClick={() => {
              setFreezeError(null);
              freeze.mutate(strategy.draftRevision, {
                onSuccess: (version) =>
                  router.push(`/strategies/${strategyId}/versions/${version.versionId}`),
                onError: (error) =>
                  setFreezeError(
                    error instanceof WebApiError ? error.message : 'Could not freeze the draft.',
                  ),
              });
            }}
            data-testid="freeze-button"
          >
            Freeze as version {nextNumber}
          </Button>
        </div>
        {freezeError ? (
          <p role="alert" className="text-supporting text-error">
            {freezeError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="versions-heading" className="space-y-3">
        <h2 id="versions-heading" className="text-heading-sm font-semibold">
          Versions
        </h2>
        {versions.length === 0 ? (
          <EmptyState
            title="No frozen version yet"
            description="Freeze the draft when the recipe is ready. Each version is immutable, carries its manifest hash, and can be registered on chain from its own page."
          />
        ) : (
          <ul className="space-y-2">
            {versions.map((version) => (
              <OwnerVersionRow key={version.versionId} strategyId={strategyId} version={version} />
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="public-heading"
        className="space-y-2 rounded-panel border border-border/60 p-4"
        data-testid="public-summary"
      >
        <h2 id="public-heading" className="text-heading-sm font-semibold">
          What others see
        </h2>
        {registeredCount === 0 ? (
          <p className="text-supporting text-text-muted">
            Nothing yet. Others see this strategy only once a version is registered on chain; your
            draft stays private either way.
          </p>
        ) : publicView.data ? (
          <p className="text-supporting text-text-muted">
            {publicView.data.versions.length} registered version
            {publicView.data.versions.length === 1 ? '' : 's'} and {publicView.data.followerCount}{' '}
            follower{publicView.data.followerCount === 1 ? '' : 's'}. Your draft, your account and
            your wallets' balances are never part of it.
          </p>
        ) : publicView.error ? (
          <p className="text-supporting text-text-muted">
            The public projection could not be read right now.
          </p>
        ) : (
          <SkeletonText lines={1} />
        )}
      </section>
    </div>
  );
}

/** The registered projection anyone can open: registered versions, follow, fork; nothing trades. */
function PublicStrategyView({ strategy }: { readonly strategy: PublicStrategy }) {
  const versions = [...strategy.versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const newest = versions[0];
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/ public strategy</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-heading-lg font-semibold" title={strategy.title}>
            {strategy.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Registered on-chain</StatusBadge>
            <StatusBadge tone="info">
              {versions.length} version{versions.length === 1 ? '' : 's'}
            </StatusBadge>
            <StatusBadge tone="neutral" data-testid="follower-count">
              {strategy.followerCount} follower{strategy.followerCount === 1 ? '' : 's'}
            </StatusBadge>
          </div>
        </div>
        {strategy.forkOf ? (
          <p className="text-supporting text-text-muted">
            Forked from{' '}
            <Link
              href={`/strategies/${strategy.forkOf.strategyId}/versions/${strategy.forkOf.versionId}`}
              className="underline underline-offset-2"
            >
              another strategy's version
            </Link>
            .
          </p>
        ) : null}
        <StrategyProvenance strategy={strategy} />
      </header>

      <section aria-label="Actions" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <FollowButton strategyId={strategy.strategyId} />
          {newest ? (
            <ForkButton
              strategyId={strategy.strategyId}
              versionId={newest.versionId}
              versionNumber={newest.versionNumber}
            />
          ) : null}
          <ReviewInvestmentLink
            strategyId={strategy.strategyId}
            versionId={newest?.versionId ?? null}
            versionNumber={newest?.versionNumber ?? null}
            unavailableReason="No registered version to invest in."
          />
        </div>
        <p className="text-caption text-text-muted">
          Following lists this strategy under Following on Explore and nothing more. Forking copies
          a version into a private draft of your own, with attribution to this strategy. Neither
          buys anything or moves a pin. Reviewing an investment quotes the newest registered version
          for your own wallet and budget; nothing is bought until you approve and sign.
        </p>
      </section>

      <section aria-labelledby="public-versions-heading" className="space-y-3">
        <h2 id="public-versions-heading" className="text-heading-sm font-semibold">
          Registered versions
        </h2>
        <ul className="space-y-2">
          {versions.map((version) => (
            <li
              key={version.versionId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border/60 p-3"
              data-testid="public-version-row"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/strategies/${strategy.strategyId}/versions/${version.versionId}`}
                    className="font-medium underline underline-offset-2"
                  >
                    Version {version.versionNumber} · {version.title}
                  </Link>
                  <StatusBadge tone={version.status === 'active' ? 'success' : 'attention'}>
                    {version.status === 'active' ? 'Active' : 'Deprecated'}
                  </StatusBadge>
                </p>
                <p className="text-caption text-text-muted">
                  Registered {formatInstant(version.registeredAt)} UTC · record{' '}
                  <code className="font-mono" title={version.recordAddress}>
                    {shortenAddress(version.recordAddress)}
                  </code>{' '}
                  · manifest hash{' '}
                  <code className="font-mono" title={version.manifestHash}>
                    {shortenAddress(version.manifestHash, { head: 8, tail: 8 })}
                  </code>
                </p>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/strategies/${strategy.strategyId}/versions/${version.versionId}`}>
                  Open
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * One strategy by id. The owner gets the draft and every version; everyone
 * else the registered projection when there is one. A private or unknown
 * strategy is "not found" for both, never a hint about whose it is.
 */
export function StrategyView({ strategyId }: { readonly strategyId: string }) {
  const { state, verifying } = useSession();
  const signedIn = state.status === 'signed-in';
  const own = useStrategy(strategyId, signedIn && !verifying);
  const ownMissing = signedIn && !own.isPending && own.error !== null && isNotFound(own.error);
  const publicView = usePublicStrategy(strategyId, (!signedIn && !verifying) || ownMissing);

  if (
    (signedIn && (own.isPending || verifying)) ||
    (!signedIn && (publicView.isPending || verifying))
  ) {
    return <Loading label="Loading strategy" />;
  }
  if (signedIn && own.data) {
    return <OwnerStrategy detail={own.data} />;
  }
  if (signedIn && own.error && !ownMissing) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The strategy could not be read"
          message={own.error instanceof WebApiError ? own.error.message : 'Try again in a moment.'}
          onRetry={() => void own.refetch()}
        />
      </section>
    );
  }
  if (publicView.data) {
    return <PublicStrategyView strategy={publicView.data} />;
  }
  if (publicView.isPending && ownMissing) {
    return <Loading label="Loading strategy" />;
  }
  if (publicView.error && !isNotFound(publicView.error)) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The strategy could not be read"
          message={
            publicView.error instanceof WebApiError
              ? publicView.error.message
              : 'Try again in a moment.'
          }
          onRetry={() => void publicView.refetch()}
        />
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <EmptyState
        title="No public strategy with that id"
        description="Only a strategy with a version registered on chain has a public page. If it is yours, sign in with the account that owns it."
        action={
          <Button asChild variant="secondary">
            <Link href="/strategies/new">Your baskets</Link>
          </Button>
        }
      />
    </section>
  );
}
