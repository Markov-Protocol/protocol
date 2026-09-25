'use client';

import { INSTRUMENT_KINDS, type Instrument, ISSUERS, type Issuer } from '@markov/contracts';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import {
  parseStrategyFilters,
  sameStrategyFilters,
  serializeStrategyFilters,
} from '../discovery/filters';
import { StrategiesTab } from '../discovery/strategies-tab';
import {
  EMPTY_FILTERS,
  type ExploreTab,
  type InstrumentFilters,
  MAX_PAGES,
  MAX_QUERY_LENGTH,
  parseFilters,
  parseTab,
  sameFilters,
  serializeFilters,
} from './filters';
import {
  AvailabilityLine,
  InstrumentIdentity,
  KindLine,
  Monogram,
  PriceLine,
  SourceStamp,
} from './instrument-parts';
import { clusterOf, ISSUER_LABELS, KIND_LABELS, STATUS_LABELS, statusTone } from './labels';
import { useInstrumentPages, useRemoveSavedInstrument, useWatchlist } from './queries';
import { WatchlistButton } from './watchlist-button';

const SEARCH_DEBOUNCE_MS = 300;

const COLLECTIONS: readonly { readonly issuer: Issuer | null; readonly label: string }[] = [
  { issuer: null, label: 'All issuers' },
  { issuer: 'prestocks', label: 'PreStocks collection' },
  { issuer: 'xstocks', label: 'xStocks' },
];

function describeError(error: unknown): { readonly title: string; readonly message: string } {
  if (error instanceof WebApiError) {
    if (error.code === 'CONTRACT_MISMATCH') {
      return {
        title: 'Markov answered in an unexpected shape',
        message:
          'The catalog contract changed. Nothing is shown rather than guessing which fields still mean what.',
      };
    }
    if (error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'NETWORK' || error.status >= 500) {
      return {
        title: 'The catalog cannot be reached right now',
        message: 'No instruments are shown until the backend answers again. Try again in a moment.',
      };
    }
    if (error.code === 'RATE_LIMITED') {
      return { title: 'Too many searches', message: 'Wait a moment before searching again.' };
    }
    return { title: 'The catalog could not be read', message: error.message };
  }
  return { title: 'The catalog could not be read', message: 'Try again in a moment.' };
}

function InstrumentRow({
  instrument,
  now,
  returnTo,
}: {
  readonly instrument: Instrument;
  readonly now: Date;
  readonly returnTo: string;
}) {
  const { platform } = useSession();
  return (
    <li
      className="grid gap-3 rounded-panel border border-border/60 bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
      data-testid="instrument-row"
      data-instrument-id={instrument.instrumentId}
      data-issuer={instrument.issuer}
    >
      <Monogram symbol={instrument.symbol} />
      <div className="min-w-0 space-y-1.5">
        <h3 className="text-body font-semibold leading-tight">
          <Link
            href={`/markets/${instrument.instrumentId}`}
            className="underline-offset-2 hover:underline"
            aria-label={`${instrument.name} (${instrument.symbol}), ${ISSUER_LABELS[instrument.issuer]}`}
          >
            {instrument.name}
          </Link>{' '}
          <span className="font-mono text-supporting text-text-muted">{instrument.symbol}</span>
        </h3>
        <InstrumentIdentity instrument={instrument} cluster={clusterOf(platform)} />
        <KindLine instrument={instrument} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PriceLine price={instrument.referencePrice} now={now} compact />
        </div>
        <AvailabilityLine instrument={instrument} />
        <div>
          <SourceStamp instrument={instrument} now={now} />
        </div>
      </div>
      <div className="sm:pt-1">
        <WatchlistButton instrument={instrument} returnTo={returnTo} />
      </div>
    </li>
  );
}

function InstrumentsTab({
  filters,
  onFiltersChange,
  returnTo,
}: {
  readonly filters: InstrumentFilters;
  readonly onFiltersChange: (next: InstrumentFilters) => void;
  readonly returnTo: string;
}) {
  const [search, setSearch] = useState(filters.q);
  // Typing is debounced into the URL; a change from outside (back button) wins over an old draft.
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (search.trim().slice(0, MAX_QUERY_LENGTH) === filters.q) {
      return;
    }
    const timer = setTimeout(() => {
      onFiltersChange({ ...filters, q: search.trim().slice(0, MAX_QUERY_LENGTH) });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters, onFiltersChange]);

  const pages = useInstrumentPages(filters);
  const now = useMemo(() => new Date(pages.dataUpdatedAt || Date.now()), [pages.dataUpdatedAt]);
  const instruments = pages.data?.pages.flatMap((page) => page.instruments) ?? [];
  const pageCount = pages.data?.pages.length ?? 0;
  const failure = pages.error ? describeError(pages.error) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Search" description="Company, issuer name, symbol or instrument name.">
          {(control) => (
            <SearchInput
              {...control}
              value={search}
              onValueChange={setSearch}
              placeholder="Fixture Aerospace, FXAERO…"
              maxLength={MAX_QUERY_LENGTH}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="Category">
          {(control) => (
            <SelectInput
              {...control}
              value={filters.kind ?? 'all'}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  kind: (INSTRUMENT_KINDS as readonly string[]).includes(value)
                    ? (value as InstrumentFilters['kind'])
                    : null,
                })
              }
              options={[
                { value: 'all', label: 'All categories' },
                ...INSTRUMENT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
              ]}
              className="min-w-48"
            />
          )}
        </Field>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Collections</legend>
        {COLLECTIONS.map((collection) => {
          const active = filters.issuer === collection.issuer;
          return (
            <Button
              key={collection.label}
              type="button"
              size="sm"
              variant={active ? 'primary' : 'secondary'}
              aria-pressed={active}
              onClick={() => onFiltersChange({ ...filters, issuer: collection.issuer })}
            >
              {collection.label}
            </Button>
          );
        })}
        {ISSUERS.filter((issuer) => !COLLECTIONS.some((c) => c.issuer === issuer)).map((issuer) => (
          <Button
            key={issuer}
            type="button"
            size="sm"
            variant="secondary"
            disabledReason={`${ISSUER_LABELS[issuer]} instruments arrive with B17.`}
          >
            {ISSUER_LABELS[issuer]}
          </Button>
        ))}
      </fieldset>

      {failure ? (
        <ErrorBlock
          title={failure.title}
          message={failure.message}
          onRetry={() => void pages.refetch()}
        />
      ) : pages.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading instruments" className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <SkeletonText lines={2} />
        </div>
      ) : instruments.length === 0 ? (
        <EmptyState
          title="No admitted instrument matches"
          description="Only instruments Markov operators admitted after verifying the mint appear here. Try another name, issuer or category."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => onFiltersChange(EMPTY_FILTERS)}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3" aria-busy={pages.isPlaceholderData || pages.isFetching}>
          <p className="text-supporting text-text-muted" role="status">
            {instruments.length} instrument{instruments.length === 1 ? '' : 's'}
            {pages.hasNextPage ? ' shown' : ''}
            {pages.isPlaceholderData ? ' · updating…' : ''}
            {' · admitted and paused only; nothing here is an offer or a quote.'}
          </p>
          <ul className="space-y-3" aria-label="Instruments">
            {instruments.map((instrument) => (
              <InstrumentRow
                key={instrument.instrumentId}
                instrument={instrument}
                now={now}
                returnTo={returnTo}
              />
            ))}
          </ul>
          {pages.hasNextPage ? (
            pageCount >= MAX_PAGES ? (
              <p className="text-supporting text-text-muted">
                Showing the first {instruments.length}. Narrow the search to see the rest.
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
        </div>
      )}
    </div>
  );
}

function WatchlistTab({ returnTo }: { readonly returnTo: string }) {
  const { state, platform } = useSession();
  const signedIn = state.status === 'signed-in';
  const watchlist = useWatchlist(signedIn);
  const remove = useRemoveSavedInstrument();
  const now = useMemo(
    () => new Date(watchlist.dataUpdatedAt || Date.now()),
    [watchlist.dataUpdatedAt],
  );
  if (!signedIn) {
    return (
      <EmptyState
        title="Sign in to keep a watchlist"
        description="Saved instruments live with your account, not in this browser, so they follow you across devices."
        action={
          <Button asChild>
            <Link href={signInHref(returnTo)}>Sign in</Link>
          </Button>
        }
      />
    );
  }
  if (watchlist.error) {
    const failure = describeError(watchlist.error);
    return (
      <ErrorBlock
        title={failure.title}
        message={failure.message}
        onRetry={() => void watchlist.refetch()}
      />
    );
  }
  if (watchlist.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading your watchlist" className="space-y-3">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  const items = watchlist.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing saved yet"
        description="Save an instrument from the Instruments tab or its detail page."
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-supporting text-text-muted" role="status">
        {items.length} saved · list version {watchlist.data.version}
      </p>
      <ul className="space-y-3" aria-label="Watchlist">
        {items.map((item) => (
          <li
            key={item.instrumentId}
            className="grid gap-3 rounded-panel border border-border/60 bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
            data-testid="watchlist-row"
            data-instrument-id={item.instrumentId}
          >
            <Monogram symbol={item.instrument?.symbol ?? '?'} />
            <div className="min-w-0 space-y-1.5">
              {item.instrument ? (
                <>
                  <h3 className="text-body font-semibold leading-tight">
                    <Link
                      href={`/markets/${item.instrumentId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {item.instrument.name}
                    </Link>{' '}
                    <span className="font-mono text-supporting text-text-muted">
                      {item.instrument.symbol}
                    </span>{' '}
                    <StatusBadge tone={statusTone(item.instrument.status)}>
                      {STATUS_LABELS[item.instrument.status]}
                    </StatusBadge>
                  </h3>
                  <InstrumentIdentity instrument={item.instrument} cluster={clusterOf(platform)} />
                  <PriceLine price={item.instrument.referencePrice} now={now} compact />
                  <AvailabilityLine instrument={item.instrument} showStatus={false} />
                </>
              ) : (
                <p className="text-supporting text-text-muted">
                  This instrument is no longer in the catalog.
                </p>
              )}
              {item.note ? <p className="text-supporting">Note: {item.note}</p> : null}
              <p className="text-caption text-text-muted">
                Saved {formatRelative(item.addedAt, now)}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={remove.isPending && remove.variables?.instrumentId === item.instrumentId}
              onClick={() =>
                remove.mutate({
                  instrumentId: item.instrumentId,
                  ifVersion: watchlist.data.version,
                })
              }
              aria-label={`Remove ${item.instrument?.symbol ?? 'instrument'} from your watchlist`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {remove.error ? (
        <p role="alert" className="text-supporting text-error">
          {remove.error instanceof WebApiError && remove.error.code === 'IDEMPOTENCY_CONFLICT'
            ? 'Your watchlist changed on another device; it was refreshed. Try again.'
            : 'The instrument could not be removed. Try again.'}
        </p>
      ) : null}
    </div>
  );
}

function formatRelative(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)} h ago`;
  }
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/**
 * Explore: the Strategies tab lists strategies registered on chain with the
 * model ranking's own entry (F12); the Stocks tab lists real
 * backend-admitted instruments with their issuer; the Watchlist tab is the
 * person's own. Filter state lives in the URL (validated values only).
 */
export function ExploreView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const strategyFilters = useMemo(
    () => parseStrategyFilters(new URLSearchParams(params.toString())),
    [params],
  );
  const tab = useMemo(() => parseTab(new URLSearchParams(params.toString())), [params]);
  const navigate = (nextFilters: InstrumentFilters, nextTab: ExploreTab) => {
    const query = serializeFilters(nextFilters, { tab: nextTab });
    router.replace(`${pathname}${query}`, { scroll: false });
  };
  const returnTo = `${pathname}${serializeFilters(filters, { tab })}`;
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Explore</h1>
        <p className="text-supporting text-text-muted">
          Strategies their creators registered on chain, and the tokenised exposures Markov
          operators admitted, named by company, issuer and network. A token is the issuer&apos;s
          exposure, not the company&apos;s shares.
        </p>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value as ExploreTab;
          // The tabs share the URL: the search text and issuer carry over, the rest stays with its tab.
          router.replace(
            next === 'strategies'
              ? `${pathname}${serializeStrategyFilters(strategyFilters)}`
              : `${pathname}${serializeFilters(filters, { tab: next })}`,
            { scroll: false },
          );
        }}
      >
        <TabsList aria-label="Explore sections">
          <TabsTrigger value="strategies">Strategies</TabsTrigger>
          <TabsTrigger value="instruments">Stocks</TabsTrigger>
          <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
        </TabsList>
        <TabsContent value="strategies">
          <StrategiesTab
            filters={strategyFilters}
            onFiltersChange={(next) => {
              if (!sameStrategyFilters(next, strategyFilters)) {
                router.replace(`${pathname}${serializeStrategyFilters(next)}`, { scroll: false });
              }
            }}
          />
        </TabsContent>
        <TabsContent value="instruments">
          <InstrumentsTab
            filters={filters}
            onFiltersChange={(next) => {
              if (!sameFilters(next, filters)) {
                navigate(next, tab);
              }
            }}
            returnTo={returnTo}
          />
        </TabsContent>
        <TabsContent value="watchlist">
          <WatchlistTab returnTo={returnTo} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
