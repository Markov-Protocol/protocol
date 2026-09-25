'use client';

import {
  DISCOVERY_PERIODS,
  DISCOVERY_SORTS,
  type DiscoveryPeriod,
  type DiscoveryResponse,
  type DiscoverySort,
  type DiscoveryStrategy,
  ISSUERS,
  type Issuer,
} from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  SearchInput,
  SelectInput,
  Skeleton,
  SkeletonText,
  StatusBadge,
} from '@markov/ui';
import { ArrowRight, ClipboardCheck, ShieldCheck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { Monogram } from '../markets/instrument-parts';
import { ISSUER_LABELS } from '../markets/labels';
import { useFollows } from '../publishing/queries';
import {
  allocationText,
  followedStrategyIds,
  issuerMixText,
  listingSourceLine,
  PERIOD_LABELS,
  SORT_LABELS,
  summarizePerformance,
  universeText,
} from './discovery-model';
import {
  EMPTY_STRATEGY_FILTERS,
  STRATEGY_MAX_PAGES,
  STRATEGY_QUERY_MAX,
  type StrategyFilters,
} from './filters';
import { useStrategyPages } from './queries';

const SEARCH_DEBOUNCE_MS = 300;

export function describeDiscoveryError(error: unknown): {
  readonly title: string;
  readonly message: string;
} {
  if (error instanceof WebApiError) {
    if (error.code === 'CONTRACT_MISMATCH') {
      return {
        title: 'Markov answered in an unexpected shape',
        message:
          'The discovery contract changed. Nothing is shown rather than guessing which fields still mean what.',
      };
    }
    if (error.code === 'RATE_LIMITED') {
      return { title: 'Too many reads', message: 'Wait a moment before exploring again.' };
    }
    if (error.code === 'VALIDATION_FAILED') {
      return {
        title: 'This page is no longer valid',
        message: 'The list changed since the page was taken. Start again from the first page.',
      };
    }
    if (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'NETWORK' || error.status >= 500) {
      return {
        title: 'Public strategies cannot be read right now',
        message: 'Nothing is shown until the backend answers again. Try again in a moment.',
      };
    }
    return { title: 'Public strategies could not be read', message: error.message };
  }
  return { title: 'Public strategies could not be read', message: 'Try again in a moment.' };
}

/** One row: what the reference calls STRATEGY, UNIVERSE, ALLOCATION and ACTION, plus the honest performance column. */
export function StrategyRow({
  row,
  minHistoryDays,
  following,
}: {
  readonly row: DiscoveryStrategy;
  readonly minHistoryDays: number;
  readonly following: boolean;
}) {
  const performance = summarizePerformance(row.performance, minHistoryDays);
  const href = `/strategies/${row.strategyId}`;
  return (
    <li
      className="grid gap-3 rounded-panel border border-border/60 bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
      data-testid="strategy-row"
      data-strategy-id={row.strategyId}
      data-ranked={performance.kind === 'ranked'}
    >
      <Monogram symbol={row.title.slice(0, 2).toUpperCase()} />
      <div className="min-w-0 space-y-1.5">
        <h3 className="flex flex-wrap items-center gap-2 text-body font-semibold leading-tight">
          <Link href={href} className="underline-offset-2 hover:underline">
            {row.title}
          </Link>
          <span className="font-mono text-caption text-text-muted">
            v{row.latestVersion.versionNumber}
          </span>
          {row.latestVersion.status === 'deprecated' ? (
            <StatusBadge tone="attention">Deprecated by its creator</StatusBadge>
          ) : null}
          {following ? (
            <StatusBadge tone="info" data-testid="strategy-following">
              Following
            </StatusBadge>
          ) : null}
        </h3>
        {row.thesisExcerpt ? (
          <p className="text-supporting text-text-muted" data-testid="strategy-thesis">
            {row.thesisExcerpt}
          </p>
        ) : null}
        <p className="font-mono text-caption uppercase tracking-wide text-text-muted">
          {universeText(row.issuers)} · {issuerMixText(row.issuers)} ·{' '}
          {allocationText(row.latestVersion)}
        </p>
        <p className="text-caption" data-testid="strategy-performance">
          {performance.kind === 'ranked' ? (
            <>
              <span className="font-mono">#{performance.rank}</span>{' '}
              <span className="font-mono">{performance.returnText}</span> model series ·{' '}
              {performance.drawdownText} · {performance.historyText}
            </>
          ) : (
            <>
              <span className="text-text-muted">Unranked</span> · {performance.reasonText} ·{' '}
              {performance.historyText}
            </>
          )}
        </p>
        <p className="text-caption text-text-muted">
          <span data-testid="strategy-followers">
            {row.followerCount} follower{row.followerCount === 1 ? '' : 's'}
          </span>
          {' · creator '}
          <Link
            href={`/creators/${row.creator.publisherWallet}`}
            className="font-mono underline underline-offset-2"
            title={row.creator.publisherWallet}
          >
            {shortenAddress(row.creator.publisherWallet)}
          </Link>
          {row.forkOf ? ' · a fork' : ''}
        </p>
      </div>
      <div className="sm:pt-1">
        <Button asChild size="sm">
          <Link href={href} aria-label={`View thesis: ${row.title}`}>
            View thesis <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

function ActiveChip({ label, onClear }: { readonly label: string; readonly onClear: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={onClear}
      aria-label={`Clear filter ${label}`}
    >
      {label} ×
    </Button>
  );
}

/** The right rail of the reference: the three promises and the way to build one. */
export function StrategiesRail() {
  const promises = [
    {
      icon: ShieldCheck,
      title: 'Verified instruments only',
      text: 'Every constituent is a token Markov operators admitted after verifying its mint.',
    },
    {
      icon: Wallet,
      title: 'Assets stay in your wallet',
      text: 'Following costs nothing and moves nothing; investing buys into your own wallet.',
    },
    {
      icon: ClipboardCheck,
      title: 'Review before execution',
      text: 'Every order is a plan you read, approve and sign; nothing trades on its own.',
    },
  ] as const;
  return (
    <aside
      aria-labelledby="rail-heading"
      className="space-y-4 rounded-panel border border-border/60 p-4"
      data-testid="strategies-rail"
    >
      <h2 id="rail-heading" className="text-heading-sm font-semibold">
        Your rules travel with the strategy.
      </h2>
      <ul className="space-y-3">
        {promises.map((promise) => (
          <li key={promise.title} className="flex gap-3">
            <promise.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <div>
              <p className="font-medium">{promise.title}</p>
              <p className="text-caption text-text-muted">{promise.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <Button asChild>
        <Link href="/strategies/new">
          Create strategy <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </Button>
    </aside>
  );
}

/**
 * Explore, Strategies tab: real rows from the public explorer, each with
 * chain provenance and the model ranking's own entry. Followed state comes
 * from the person's private list and is composed here, never cached with
 * the public rows.
 */
export function StrategiesTab({
  filters,
  onFiltersChange,
}: {
  readonly filters: StrategyFilters;
  readonly onFiltersChange: (next: StrategyFilters) => void;
}) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (search.trim().slice(0, STRATEGY_QUERY_MAX) === filters.q) {
      return;
    }
    const timer = setTimeout(() => {
      onFiltersChange({ ...filters, q: search.trim().slice(0, STRATEGY_QUERY_MAX) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters, onFiltersChange]);

  const pages = useStrategyPages(filters);
  const follows = useFollows(signedIn);
  const followed = useMemo(() => followedStrategyIds(follows.data), [follows.data]);
  const rows = pages.data?.pages.flatMap((page) => page.strategies) ?? [];
  const first: DiscoveryResponse | undefined = pages.data?.pages[0];
  const pageCount = pages.data?.pages.length ?? 0;
  const failure = pages.error ? describeDiscoveryError(pages.error) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
      <div className="space-y-4">
        {signedIn && follows.data && follows.data.follows.length > 0 ? (
          <section
            aria-labelledby="following-heading"
            className="space-y-2 rounded-panel border border-border/60 p-3"
            data-testid="following-section"
          >
            <h2 id="following-heading" className="text-heading-sm font-semibold">
              Following
            </h2>
            <ul className="space-y-1 text-supporting">
              {follows.data.follows.map((entry) => (
                <li
                  key={entry.strategyId}
                  className="flex flex-wrap items-center justify-between gap-2"
                  data-testid="following-row"
                >
                  <Link
                    href={`/strategies/${entry.strategyId}`}
                    className="underline underline-offset-2"
                  >
                    {entry.latestVersion
                      ? `${entry.latestVersion.title} · version ${entry.latestVersion.versionNumber}`
                      : 'A strategy with no public version any more'}
                  </Link>
                  <span className="text-caption text-text-muted">
                    {entry.latestVersion
                      ? `${entry.latestVersion.status === 'active' ? 'Active' : 'Deprecated'} · registered ${formatInstant(entry.latestVersion.registeredAt)} UTC`
                      : 'withheld or unregistered'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-caption text-text-muted">
              Following is a list on your account: it moves no pin and places no order. Your
              instances of these strategies live under Portfolio.
            </p>
          </section>
        ) : null}
        <div className="space-y-1">
          <h2 className="text-heading-md font-semibold">Find a thesis worth building.</h2>
          <p className="text-supporting text-text-muted">
            Strategies registered on chain by their creators. Each row is the newest public version;
            ranks come from the model series alone, never from an account.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <Field label="Search" description="Title, thesis, symbol or company.">
            {(control) => (
              <SearchInput
                {...control}
                value={search}
                onValueChange={setSearch}
                placeholder="Search a company, theme or strategy"
                maxLength={STRATEGY_QUERY_MAX}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="Issuer">
            {(control) => (
              <SelectInput
                {...control}
                value={filters.issuer ?? 'all'}
                onValueChange={(value) =>
                  onFiltersChange({
                    ...filters,
                    issuer: (ISSUERS as readonly string[]).includes(value)
                      ? (value as Issuer)
                      : null,
                  })
                }
                options={[
                  { value: 'all', label: 'All issuers' },
                  ...ISSUERS.map((issuer) => ({ value: issuer, label: ISSUER_LABELS[issuer] })),
                ]}
                className="min-w-40"
              />
            )}
          </Field>
          <Field label="Period" description="The ranking cohort.">
            {(control) => (
              <SelectInput
                {...control}
                value={filters.period}
                onValueChange={(value) =>
                  onFiltersChange({ ...filters, period: value as DiscoveryPeriod })
                }
                options={DISCOVERY_PERIODS.map((period) => ({
                  value: period,
                  label: PERIOD_LABELS[period],
                }))}
                className="min-w-40"
              />
            )}
          </Field>
          <Field label="Sort">
            {(control) => (
              <SelectInput
                {...control}
                value={filters.sort}
                onValueChange={(value) =>
                  onFiltersChange({ ...filters, sort: value as DiscoverySort })
                }
                options={DISCOVERY_SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }))}
                className="min-w-44"
              />
            )}
          </Field>
        </div>
        {filters.instrumentId || filters.creator ? (
          <div className="flex flex-wrap gap-2" data-testid="active-filters">
            {filters.instrumentId ? (
              <ActiveChip
                label="Holding one instrument"
                onClear={() => onFiltersChange({ ...filters, instrumentId: null })}
              />
            ) : null}
            {filters.creator ? (
              <ActiveChip
                label={`Creator ${shortenAddress(filters.creator)}`}
                onClear={() => onFiltersChange({ ...filters, creator: null })}
              />
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <ErrorBlock
            title={failure.title}
            message={failure.message}
            onRetry={() => void pages.refetch()}
          />
        ) : pages.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading strategies" className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <SkeletonText lines={2} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No public strategy matches"
            description="Only strategies with a version registered on chain, and not withheld by moderation, are listed. Try another word, issuer or period, or build your own."
            action={
              <Button
                type="button"
                variant="secondary"
                onClick={() => onFiltersChange(EMPTY_STRATEGY_FILTERS)}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="space-y-3" aria-busy={pages.isPlaceholderData || pages.isFetching}>
            <p className="text-supporting text-text-muted" role="status">
              {first?.matched ?? rows.length} strateg
              {(first?.matched ?? rows.length) === 1 ? 'y' : 'ies'}
              {pages.hasNextPage ? `, ${rows.length} shown` : ''}
              {pages.isPlaceholderData ? ' · updating…' : ''}
              {' · sorted by '}
              {SORT_LABELS[filters.sort].toLowerCase()}
              {' · '}
              {PERIOD_LABELS[filters.period].toLowerCase()}
            </p>
            <ul className="space-y-3" aria-label="Public strategies">
              {rows.map((row) => (
                <StrategyRow
                  key={row.strategyId}
                  row={row}
                  minHistoryDays={first?.minHistoryDays ?? 30}
                  following={followed.has(row.strategyId)}
                />
              ))}
              <li
                className="grid gap-3 rounded-panel border border-dashed border-border/60 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                data-testid="build-your-own"
              >
                <Monogram symbol="+" />
                <div>
                  <p className="text-body font-semibold">Build your own</p>
                  <p className="text-caption text-text-muted">
                    Your weights, your rules; publish it when it is ready, or keep it private.
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/strategies/new">
                    Start a draft <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </Button>
              </li>
            </ul>
            {pages.hasNextPage ? (
              pageCount >= STRATEGY_MAX_PAGES ? (
                <p className="text-supporting text-text-muted">
                  Showing the first {rows.length}. Narrow the search to see the rest.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  loading={pages.isFetchingNextPage}
                  onClick={() => void pages.fetchNextPage()}
                >
                  Load more
                </Button>
              )
            ) : null}
            {first ? (
              <p className="text-caption text-text-muted" data-testid="strategies-source">
                {listingSourceLine(first)} · Availability depends on issuer, jurisdiction and
                liquidity.
              </p>
            ) : null}
          </div>
        )}
      </div>
      <StrategiesRail />
    </div>
  );
}
