'use client';

import type { Intent, IntentState } from '@markov/contracts';
import { formatInstant, formatRawAmount, shortenAddress } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { INTENT_STATE_LABELS } from '../review/plan-model';
import { useIntents } from '../review/queries';
import { isLiveState, isTerminalState } from './execution-model';

/** Activity filters kept in the URL so a filtered view is a stable link. */
export const ACTIVITY_FILTERS = ['all', 'open', 'in-flight', 'attention', 'settled'] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

const ATTENTION_STATES: readonly IntentState[] = [
  'UNKNOWN_REQUIRES_RECONCILIATION',
  'PARTIALLY_COMPLETED',
  'CANCEL_REQUESTED',
  'FAILED',
];

export function activityFilterOf(value: string | null): ActivityFilter {
  return (ACTIVITY_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as ActivityFilter)
    : 'all';
}

export function matchesActivityFilter(
  intent: Pick<Intent, 'state'>,
  filter: ActivityFilter,
): boolean {
  switch (filter) {
    case 'open':
      return ['DRAFT', 'QUOTED', 'AWAITING_APPROVAL', 'AUTHORIZED'].includes(intent.state);
    case 'in-flight':
      return isLiveState(intent.state) && intent.state !== 'UNKNOWN_REQUIRES_RECONCILIATION';
    case 'attention':
      return ATTENTION_STATES.includes(intent.state);
    case 'settled':
      return isTerminalState(intent.state) && !ATTENTION_STATES.includes(intent.state);
    default:
      return true;
  }
}

const FILTER_LABELS: Record<ActivityFilter, string> = {
  all: 'All',
  open: 'Open reviews',
  'in-flight': 'In flight',
  attention: 'Needs attention',
  settled: 'Settled',
};

function kindLabel(intent: Intent): string {
  if (intent.strategy) {
    return `${intent.strategy.title} · version ${intent.strategy.versionNumber}`;
  }
  return intent.kind === 'single_sell' ? 'Single sell' : 'Single buy';
}

/** Where a row leads: the review while the plan is being reviewed, the timeline once execution started. */
export function activityHref(intent: Pick<Intent, 'intentId' | 'state' | 'latestPlanId'>): string {
  const reviewing =
    intent.state === 'DRAFT' || intent.state === 'QUOTED' || intent.state === 'AWAITING_APPROVAL';
  return reviewing || intent.latestPlanId === null
    ? `/review/${intent.intentId}`
    : `/activity/${intent.intentId}`;
}

/**
 * `/activity`: the person's orders (intents) newest first, filtered by
 * where they stand, each a stable deep link. Publication, schedule and
 * device events join this list with their sessions.
 */
export function ActivityView() {
  const intents = useIntents(true);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const filter = activityFilterOf(params.get('filter'));
  const rows =
    intents.data?.intents.filter((intent) => matchesActivityFilter(intent, filter)) ?? [];

  function setFilter(next: ActivityFilter) {
    const search = new URLSearchParams(params.toString());
    if (next === 'all') {
      search.delete('filter');
    } else {
      search.set('filter', next);
    }
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6" data-testid="activity-view">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Activity</h1>
        <p className="text-supporting text-text-muted">
          Every order from review to reconciled result. A row is what the record says now, read from
          the chain; a signature is not a result, and nothing here is a holding.
        </p>
      </header>
      <fieldset className="flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Filter activity</legend>
        {ACTIVITY_FILTERS.map((entry) => (
          <Button
            key={entry}
            type="button"
            size="sm"
            variant={entry === filter ? 'primary' : 'secondary'}
            aria-pressed={entry === filter}
            onClick={() => setFilter(entry)}
            data-testid={`filter-${entry}`}
          >
            {FILTER_LABELS[entry]}
          </Button>
        ))}
      </fieldset>
      {intents.data ? (
        rows.length === 0 ? (
          <EmptyState
            title={
              filter === 'all'
                ? 'No activity yet'
                : `Nothing ${FILTER_LABELS[filter].toLowerCase()}`
            }
            description={
              filter === 'all'
                ? 'Start a review from a strategy version (Review investment) or an instrument page (Buy).'
                : 'Change the filter to see other orders.'
            }
            action={
              <Button asChild variant="secondary">
                <Link href={filter === 'all' ? '/explore' : '/activity'}>
                  {filter === 'all' ? 'Explore instruments' : 'Show everything'}
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2" aria-label="Your activity">
            {rows.map((intent) => {
              const reading = INTENT_STATE_LABELS[intent.state];
              const href = activityHref(intent);
              return (
                <li
                  key={intent.intentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border/60 p-3"
                  data-testid="activity-row"
                  data-state={intent.state}
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={href} className="font-medium underline underline-offset-2">
                        {kindLabel(intent)}
                      </Link>
                      <StatusBadge tone={reading.tone}>{reading.label}</StatusBadge>
                    </p>
                    <p className="text-caption text-text-muted">
                      {formatRawAmount(intent.budget.rawAmount, intent.budget.decimals)}{' '}
                      {intent.budget.symbol} from {shortenAddress(intent.wallet.address)} ·{' '}
                      {formatInstant(intent.updatedAt)} UTC
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={href}>{href.startsWith('/review/') ? 'Review' : 'Timeline'}</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : intents.error ? (
        <ErrorBlock
          title="Your activity could not be read"
          message="This is a service failure, not an empty list."
          onRetry={() => void intents.refetch()}
        />
      ) : (
        <SkeletonText lines={3} />
      )}
    </div>
  );
}
