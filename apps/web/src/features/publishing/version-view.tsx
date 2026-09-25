'use client';

import type { PublicVersion, SolanaCluster, StrategyVersion } from '@markov/contracts';
import { formatBasisPoints, formatInstant } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, Skeleton, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { clusterOf, ISSUER_LABELS } from '../markets/labels';
import { ReviewInvestmentLink } from '../review/review-link';
import { RegistrationEvidenceView } from './evidence-panel';
import { FollowButton } from './follow-button';
import { ForkButton } from './fork-button';
import {
  describeMaintenance,
  diffVersions,
  readRegistration,
  recipeLegsOf,
} from './publication-state';
import { PublishPanel } from './publish-panel';
import { useOwnVersion, usePublicVersion, useRegistryRecord, useRegistryStatus } from './queries';
import { RecipeTable } from './recipe-table';
import { VersionDiffView } from './version-diff';

function isNotFound(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 404;
}

function Loading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading version"
      className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6"
    >
      <Skeleton className="h-8 w-2/3" />
      <SkeletonText lines={4} />
    </section>
  );
}

function ReferenceLine({ reference }: { readonly reference: string }) {
  return reference.startsWith('https://') ? (
    <a
      href={reference}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all underline underline-offset-2"
    >
      {reference}
    </a>
  ) : (
    <span className="break-all">{reference}</span>
  );
}

/** Thesis, rules, disclosures and identity as the immutable version carries them (owner and public alike). */
function VersionFacts({ version }: { readonly version: StrategyVersion | PublicVersion }) {
  return (
    <>
      <section aria-labelledby="thesis-heading" className="space-y-2">
        <h2 id="thesis-heading" className="text-heading-sm font-semibold">
          Thesis
        </h2>
        <p className="whitespace-pre-wrap text-supporting" data-testid="version-thesis">
          {version.thesis}
        </p>
      </section>
      <section aria-labelledby="rules-heading" className="space-y-2">
        <h2 id="rules-heading" className="text-heading-sm font-semibold">
          Rules and references
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-text-muted">Kind</dt>
          <dd>Stock spot basket</dd>
          <dt className="text-text-muted">Maintenance</dt>
          <dd>{describeMaintenance(version.maintenance)}</dd>
          <dt className="text-text-muted">References</dt>
          <dd>
            {version.references.length === 0 ? (
              <span className="text-text-muted">none</span>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {version.references.map((reference) => (
                  <li key={reference}>
                    <ReferenceLine reference={reference} />
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </section>
      <section aria-labelledby="disclosures-heading" className="space-y-2">
        <h2 id="disclosures-heading" className="text-heading-sm font-semibold">
          Exposure disclosures
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-text-muted">By issuer</dt>
          <dd>
            {version.disclosures.issuers
              .map((row) => `${ISSUER_LABELS[row.issuer]} ${formatBasisPoints(row.weightBps)}`)
              .join(' · ')}
          </dd>
          <dt className="text-text-muted">By company</dt>
          <dd>
            {version.disclosures.companies
              .map((row) => `${row.companyName} ${formatBasisPoints(row.weightBps)}`)
              .join(' · ')}
          </dd>
        </dl>
        <p className="text-caption text-text-muted">
          Countries are not disclosed until issuer jurisdictions are verified (OD-17, OD-18).
        </p>
      </section>
      <section aria-labelledby="identity-heading" className="space-y-2">
        <h2 id="identity-heading" className="text-heading-sm font-semibold">
          Identity
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-text-muted">Manifest hash</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono" data-testid="manifest-hash">
              {version.manifestHash}
            </code>
            <CopyButton value={version.manifestHash} label="Copy the manifest hash" />
          </dd>
          <dt className="text-text-muted">Content digest</dt>
          <dd>
            <code className="break-all font-mono">{version.contentDigest}</code>
          </dd>
          <dt className="text-text-muted">Version id</dt>
          <dd>
            <code className="break-all font-mono">{version.versionId}</code>
          </dd>
          <dt className="text-text-muted">Frozen</dt>
          <dd>{formatInstant(version.frozenAt)} UTC</dd>
        </dl>
      </section>
    </>
  );
}

function ForkOfLine({ version }: { readonly version: StrategyVersion | PublicVersion }) {
  if (!version.forkOf) {
    return null;
  }
  return (
    <p className="text-supporting text-text-muted">
      Forked from{' '}
      <Link
        href={`/strategies/${version.forkOf.strategyId}/versions/${version.forkOf.versionId}`}
        className="underline underline-offset-2"
      >
        another strategy's version
      </Link>
      .
    </p>
  );
}

function OwnerVersion({ version }: { readonly version: StrategyVersion }) {
  const { platform } = useSession();
  const cluster: SolanaCluster | null = clusterOf(platform);
  const strategyId = version.strategyId;
  const registry = useRegistryStatus(true);
  const registered = version.publication === 'registered';
  const publicView = usePublicVersion(strategyId, version.versionId, registered);
  const parent = useOwnVersion(strategyId, version.parentVersionId, true);
  const reading = readRegistration(version.publication, null);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/strategies/new" className="underline underline-offset-2">
            Build
          </Link>{' '}
          <span className="text-text-muted">/</span>{' '}
          <Link href={`/strategies/${strategyId}`} className="underline underline-offset-2">
            strategy
          </Link>{' '}
          <span className="text-text-muted">/ version {version.versionNumber}</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-heading-lg font-semibold" title={version.title}>
            {version.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Version {version.versionNumber}</StatusBadge>
            <StatusBadge tone={reading.tone} data-testid="version-state">
              {reading.label}
            </StatusBadge>
            {version.deprecatedBy ? (
              <StatusBadge tone="attention">Superseded by a later version</StatusBadge>
            ) : null}
          </div>
        </div>
        <p className="text-caption text-text-muted">
          Frozen {formatInstant(version.frozenAt)} UTC. A version never changes; edits become a new
          version, and instances pinned to this one stay pinned until their owner accepts another.
        </p>
        <ForkOfLine version={version} />
      </header>

      <section aria-labelledby="recipe-heading" className="space-y-2">
        <h2 id="recipe-heading" className="text-heading-sm font-semibold">
          Recipe
        </h2>
        <RecipeTable
          legs={recipeLegsOf(version)}
          cashWeightBps={version.cashWeightBps}
          cluster={cluster}
        />
      </section>

      <PublishPanel
        strategyId={strategyId}
        version={version}
        registry={registry.data ?? null}
        currentStatus={publicView.data?.registration.status ?? null}
      />

      {publicView.data ? (
        <section aria-labelledby="evidence-heading" className="space-y-2">
          <h2 id="evidence-heading" className="text-heading-sm font-semibold">
            Registration evidence
          </h2>
          <RegistrationEvidenceView
            registration={publicView.data.registration}
            verification={publicView.data.verification}
            cluster={cluster}
            genesisHash={registry.data?.network.genesisHash ?? null}
            programId={registry.data?.programId ?? null}
          />
        </section>
      ) : null}

      <VersionFacts version={version} />

      <section aria-labelledby="lineage-heading" className="space-y-2">
        <h2 id="lineage-heading" className="text-heading-sm font-semibold">
          Changes from the previous version
        </h2>
        {version.parentVersionId === null ? (
          <p className="text-supporting text-text-muted">First version of this strategy.</p>
        ) : parent.data ? (
          <VersionDiffView
            diff={diffVersions(parent.data, version)}
            fromNumber={parent.data.versionNumber}
            toNumber={version.versionNumber}
          />
        ) : parent.isPending ? (
          <SkeletonText lines={2} />
        ) : (
          <p className="text-supporting text-text-muted">
            The previous version could not be read, so there is no comparison.
          </p>
        )}
      </section>

      <section aria-label="Actions" className="flex flex-wrap items-center gap-2">
        <ForkButton
          strategyId={strategyId}
          versionId={version.versionId}
          versionNumber={version.versionNumber}
        />
        <ReviewInvestmentLink strategyId={strategyId} versionId={version.versionId} />
      </section>
    </div>
  );
}

function RegistryRecordSection({ address }: { readonly address: string }) {
  const record = useRegistryRecord(address);
  return (
    <section aria-labelledby="record-heading" className="space-y-2">
      <h2 id="record-heading" className="text-heading-sm font-semibold">
        Registry record as indexed
      </h2>
      {record.data ? (
        <dl
          className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]"
          data-testid="registry-record"
        >
          <dt className="text-text-muted">Publisher</dt>
          <dd>
            <code className="break-all font-mono">{record.data.publisher}</code>
          </dd>
          <dt className="text-text-muted">Status</dt>
          <dd>{record.data.status}</dd>
          <dt className="text-text-muted">Registered</dt>
          <dd>
            slot {record.data.registeredSlot.toLocaleString('en-US')} ·{' '}
            {formatInstant(record.data.registeredAt)} UTC
          </dd>
          <dt className="text-text-muted">Status updated</dt>
          <dd>slot {record.data.statusUpdatedSlot.toLocaleString('en-US')}</dd>
          <dt className="text-text-muted">Layout / schema</dt>
          <dd>
            {record.data.layoutVersion} / {record.data.schemaVersion} · relation{' '}
            {record.data.relation}
          </dd>
          <dt className="text-text-muted">Constituents on chain</dt>
          <dd>
            {record.data.legs.length} leg{record.data.legs.length === 1 ? '' : 's'}, cash{' '}
            {formatBasisPoints(record.data.cashWeightBps)}
          </dd>
          <dt className="text-text-muted">Last observed</dt>
          <dd>
            slot {record.data.observedSlot.toLocaleString('en-US')} ·{' '}
            {formatInstant(record.data.observedAt)} UTC
          </dd>
        </dl>
      ) : record.error ? (
        <p className="text-supporting text-text-muted">
          The indexed record could not be read right now; the evidence above stands on its own.
        </p>
      ) : (
        <SkeletonText lines={3} />
      )}
    </section>
  );
}

function PublicVersionView({ version }: { readonly version: PublicVersion }) {
  const { platform } = useSession();
  const cluster: SolanaCluster | null = clusterOf(platform);
  const strategyId = version.strategyId;
  const registry = useRegistryStatus(true);
  const parent = usePublicVersion(strategyId, version.parentVersionId, true);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/</span>{' '}
          <Link href={`/strategies/${strategyId}`} className="underline underline-offset-2">
            strategy
          </Link>{' '}
          <span className="text-text-muted">/ version {version.versionNumber}</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-heading-lg font-semibold" title={version.title}>
            {version.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Version {version.versionNumber}</StatusBadge>
            <StatusBadge tone="success" data-testid="version-state">
              Registered on-chain
            </StatusBadge>
            <StatusBadge tone={version.registration.status === 'active' ? 'success' : 'attention'}>
              {version.registration.status === 'active' ? 'Active' : 'Deprecated'}
            </StatusBadge>
            {version.deprecatedBy ? (
              <StatusBadge tone="attention">Superseded by a later version</StatusBadge>
            ) : null}
          </div>
        </div>
        <p className="text-caption text-text-muted">
          Frozen {formatInstant(version.frozenAt)} UTC. Immutable: the recipe below is what the hash
          on chain commits to.
        </p>
        <ForkOfLine version={version} />
      </header>

      <section aria-label="Actions" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <FollowButton strategyId={strategyId} />
          <ForkButton
            strategyId={strategyId}
            versionId={version.versionId}
            versionNumber={version.versionNumber}
          />
          <ReviewInvestmentLink strategyId={strategyId} versionId={version.versionId} />
        </div>
        <p className="text-caption text-text-muted">
          Following subscribes you to new versions; forking copies this version into a private draft
          of your own with attribution. Neither buys anything. Reviewing an investment quotes this
          exact version for your own wallet and budget.
        </p>
      </section>

      <section aria-labelledby="evidence-heading" className="space-y-2">
        <h2 id="evidence-heading" className="text-heading-sm font-semibold">
          Registration evidence
        </h2>
        <RegistrationEvidenceView
          registration={version.registration}
          verification={version.verification}
          cluster={cluster}
          genesisHash={registry.data?.network.genesisHash ?? null}
          programId={registry.data?.programId ?? null}
        />
      </section>

      <section aria-labelledby="recipe-heading" className="space-y-2">
        <h2 id="recipe-heading" className="text-heading-sm font-semibold">
          Recipe
        </h2>
        <RecipeTable
          legs={recipeLegsOf(version)}
          cashWeightBps={version.cashWeightBps}
          cluster={cluster}
        />
      </section>

      <VersionFacts version={version} />

      <section aria-labelledby="canonical-heading" className="space-y-2">
        <h2 id="canonical-heading" className="text-heading-sm font-semibold">
          Canonical manifest
        </h2>
        <p className="text-supporting text-text-muted">
          The exact bytes the manifest hash covers, so anyone can recompute it (see the strategy
          registry documentation for the domain and encoding).
        </p>
        <details className="rounded-panel border border-border/60 p-3">
          <summary className="cursor-pointer text-supporting">Show the canonical bytes</summary>
          <pre
            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-caption"
            data-testid="canonical-manifest"
          >
            {version.canonicalManifest}
          </pre>
        </details>
      </section>

      <section aria-labelledby="lineage-heading" className="space-y-2">
        <h2 id="lineage-heading" className="text-heading-sm font-semibold">
          Changes from the previous version
        </h2>
        {version.parentVersionId === null ? (
          <p className="text-supporting text-text-muted">First version of this strategy.</p>
        ) : parent.data ? (
          <VersionDiffView
            diff={diffVersions(parent.data, version)}
            fromNumber={parent.data.versionNumber}
            toNumber={version.versionNumber}
          />
        ) : parent.isPending ? (
          <SkeletonText lines={2} />
        ) : parent.error && isNotFound(parent.error) ? (
          <p className="text-supporting text-text-muted">
            The previous version is not public, so there is no comparison to show.
          </p>
        ) : (
          <p className="text-supporting text-text-muted">
            The previous version could not be read, so there is no comparison.
          </p>
        )}
      </section>

      <RegistryRecordSection address={version.registration.recordAddress} />
    </div>
  );
}

/**
 * One frozen version by id. The owner gets the immutable version with its
 * registration panel; everyone else the registered projection with the
 * chain evidence verified on read. Anything else is "not found".
 */
export function VersionView({
  strategyId,
  versionId,
}: {
  readonly strategyId: string;
  readonly versionId: string;
}) {
  const { state, verifying } = useSession();
  const signedIn = state.status === 'signed-in';
  const own = useOwnVersion(strategyId, versionId, signedIn && !verifying);
  const ownMissing = signedIn && !own.isPending && own.error !== null && isNotFound(own.error);
  const publicView = usePublicVersion(
    strategyId,
    versionId,
    (!signedIn && !verifying) || ownMissing,
  );

  if (
    (signedIn && (own.isPending || verifying)) ||
    (!signedIn && (publicView.isPending || verifying))
  ) {
    return <Loading />;
  }
  if (signedIn && own.data) {
    return <OwnerVersion version={own.data} />;
  }
  if (signedIn && own.error && !ownMissing) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The version could not be read"
          message={own.error instanceof WebApiError ? own.error.message : 'Try again in a moment.'}
          onRetry={() => void own.refetch()}
        />
      </section>
    );
  }
  if (publicView.data) {
    return <PublicVersionView version={publicView.data} />;
  }
  if (publicView.isPending && ownMissing) {
    return <Loading />;
  }
  if (publicView.error && !isNotFound(publicView.error)) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The version could not be read"
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
        title="No public version with that id"
        description="Only a version registered on chain has a public page. If it is yours, sign in with the account that owns it."
        action={
          <Button asChild variant="secondary">
            <Link href={`/strategies/${strategyId}`}>Strategy page</Link>
          </Button>
        }
      />
    </section>
  );
}
