'use client';

import { DISCOVERY_PERIODS, type DiscoveryPeriod } from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, SkeletonText } from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { clusterOf, explorerAddressUrl } from '../markets/labels';
import { useFollows } from '../publishing/queries';
import { followedStrategyIds, PERIOD_LABELS } from './discovery-model';
import { useCreator } from './queries';
import { describeDiscoveryError, StrategyRow } from './strategies-tab';

function parsePeriod(params: URLSearchParams): DiscoveryPeriod {
  const period = params.get('period');
  return (DISCOVERY_PERIODS as readonly string[]).includes(period ?? '')
    ? (period as DiscoveryPeriod)
    : '30d';
}

/**
 * A creator page: the wallet that signed registrations, what it registered
 * and when, from chain records. Markov attaches no name, badge or track
 * record; the rows are the explorer's rows for that wallet.
 */
export function CreatorView({ publisherWallet }: { readonly publisherWallet: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state, platform } = useSession();
  const period = useMemo(() => parsePeriod(new URLSearchParams(params.toString())), [params]);
  const creator = useCreator(publisherWallet, period);
  const follows = useFollows(state.status === 'signed-in');
  const followed = useMemo(() => followedStrategyIds(follows.data), [follows.data]);
  const notFound = creator.error instanceof WebApiError && creator.error.status === 404;
  const explorer = explorerAddressUrl(publisherWallet, clusterOf(platform));
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/ creator</span>
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-heading-lg font-semibold">
          <span className="font-mono" title={publisherWallet} data-testid="creator-wallet">
            {shortenAddress(publisherWallet)}
          </span>
          <CopyButton value={publisherWallet} label="Copy the creator wallet address" />
        </h1>
        <p className="text-supporting text-text-muted">
          A creator is the wallet that signed a registration on chain
          {explorer ? (
            <>
              {' '}
              (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                address on Solana Explorer
              </a>
              )
            </>
          ) : null}
          . Markov asserts no name, no verified badge and no track record beyond the registered
          versions and their model series.
        </p>
      </header>
      {notFound ? (
        <EmptyState
          title="No listed strategy was registered by this wallet"
          description="A wallet appears here once it registered the newest public version of an active strategy. Archived strategies and versions withheld by moderation do not count."
          action={
            <Button asChild variant="secondary">
              <Link href="/explore">Back to Explore</Link>
            </Button>
          }
        />
      ) : creator.error ? (
        <ErrorBlock
          title={describeDiscoveryError(creator.error).title}
          message={describeDiscoveryError(creator.error).message}
          onRetry={() => void creator.refetch()}
        />
      ) : creator.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading creator">
          <SkeletonText lines={4} />
        </div>
      ) : (
        <>
          <dl
            className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]"
            data-testid="creator-facts"
          >
            <dt className="text-text-muted">Listed strategies</dt>
            <dd className="font-mono">{creator.data.strategyCount}</dd>
            <dt className="text-text-muted">Registered versions signed</dt>
            <dd className="font-mono">{creator.data.versionCount}</dd>
            <dt className="text-text-muted">Followers across them</dt>
            <dd className="font-mono">{creator.data.followerCount}</dd>
            <dt className="text-text-muted">First registration</dt>
            <dd>{formatInstant(creator.data.firstRegisteredAt)} UTC</dd>
            <dt className="text-text-muted">Latest registration</dt>
            <dd>{formatInstant(creator.data.latestRegisteredAt)} UTC</dd>
          </dl>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Ranking period</legend>
            {DISCOVERY_PERIODS.map((candidate) => (
              <Button
                key={candidate}
                type="button"
                size="sm"
                variant={candidate === period ? 'primary' : 'secondary'}
                aria-pressed={candidate === period}
                onClick={() =>
                  router.replace(
                    candidate === '30d' ? pathname : `${pathname}?period=${candidate}`,
                    {
                      scroll: false,
                    },
                  )
                }
              >
                {PERIOD_LABELS[candidate]}
              </Button>
            ))}
          </fieldset>
          <ul className="space-y-3" aria-label="Strategies by this creator">
            {creator.data.strategies.map((row) => (
              <StrategyRow
                key={row.strategyId}
                row={row}
                minHistoryDays={30}
                following={followed.has(row.strategyId)}
              />
            ))}
          </ul>
          <p className="text-caption text-text-muted" data-testid="creator-note">
            {creator.data.note}
          </p>
        </>
      )}
    </section>
  );
}
