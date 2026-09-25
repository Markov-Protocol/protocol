'use client';

import {
  DISCOVERY_PERIODS,
  type DiscoveryPeriod,
  type MethodologySummary,
  type RankingEntry,
} from '@markov/contracts';
import { formatInstant } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useMethodology } from '../portfolio/queries';
import { completenessText, PERIOD_LABELS, summarizeEntry } from './discovery-model';
import { useRankings } from './queries';
import { describeDiscoveryError } from './strategies-tab';

function parsePeriod(params: URLSearchParams): DiscoveryPeriod {
  const period = params.get('period');
  return (DISCOVERY_PERIODS as readonly string[]).includes(period ?? '')
    ? (period as DiscoveryPeriod)
    : '30d';
}

/** The methodology's own words, so the cohort's rules are next to the numbers. */
function MethodologyPanel({ methodology }: { readonly methodology: MethodologySummary }) {
  return (
    <aside
      aria-labelledby="methodology-heading"
      className="space-y-2 rounded-panel border border-border/60 p-4 text-supporting"
      data-testid="methodology-panel"
    >
      <h2 id="methodology-heading" className="text-heading-sm font-semibold">
        Methodology {methodology.version}
      </h2>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-text-muted">Cohort</dt>
        <dd>Model series of registered versions, one period at a time; no account is ranked.</dd>
        <dt className="text-text-muted">Currency</dt>
        <dd className="font-mono">{methodology.currency}</dd>
        <dt className="text-text-muted">Rank needs</dt>
        <dd>
          {methodology.rankingMinHistoryDays} days of complete history, a complete window and a
          price no older than {Math.round(methodology.priceMaxAgeMs / 3_600_000)} hours.
        </dd>
        <dt className="text-text-muted">Costs</dt>
        <dd>{methodology.modelAssumptions}</dd>
        <dt className="text-text-muted">Pricing</dt>
        <dd>{methodology.pricing}</dd>
      </dl>
      <p className="text-caption text-text-muted">
        Personal outcomes live on your portfolio pages under their own label; they never enter a
        ranking.
      </p>
    </aside>
  );
}

function EntryRow({
  entry,
  minHistoryDays,
}: {
  readonly entry: RankingEntry;
  readonly minHistoryDays: number;
}) {
  const summary = summarizeEntry(entry, minHistoryDays);
  return (
    <TableRow data-testid="ranking-row" data-ranked={summary.kind === 'ranked'}>
      <TableCell numeric>
        <span className="font-mono">{summary.kind === 'ranked' ? `#${summary.rank}` : '—'}</span>
      </TableCell>
      <TableCell>
        <Link
          href={`/strategies/${entry.strategyId}/versions/${entry.versionId}`}
          className="font-medium underline underline-offset-2"
        >
          {entry.title}
        </Link>
        <span className="block font-mono text-caption text-text-muted">
          version {entry.versionNumber}
        </span>
      </TableCell>
      <TableCell numeric>
        {summary.kind === 'ranked' ? (
          <span className="font-mono" data-testid="ranking-return">
            {summary.returnText}
          </span>
        ) : (
          <span className="text-text-muted" data-testid="ranking-unranked">
            Unranked: {summary.reasonText}
          </span>
        )}
      </TableCell>
      <TableCell numeric>
        <span className="font-mono">{summary.kind === 'ranked' ? summary.drawdownText : '—'}</span>
      </TableCell>
      <TableCell numeric>
        <span className="font-mono">{entry.historyDays}</span>
        <span className="block text-caption text-text-muted">
          {completenessText(entry.completeness)}
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * Rankings: one cohort (period, methodology version) of model series, every
 * entry the API lists with the reason when it is unranked. Fees are stated
 * as excluded by the model, valuation completeness is shown per entry, and
 * nothing here is anyone's account.
 */
export function RankingsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = useMemo(() => parsePeriod(new URLSearchParams(params.toString())), [params]);
  const rankings = useRankings(period);
  const data = rankings.data;
  const methodology = useMethodology(true);
  const failure = rankings.error ? describeDiscoveryError(rankings.error) : null;
  const setPeriod = (next: DiscoveryPeriod) => {
    router.replace(next === '30d' ? pathname : `${pathname}?period=${next}`, { scroll: false });
  };
  return (
    <section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/ rankings</span>
        </p>
        <h1 className="text-heading-lg font-semibold">Rankings</h1>
        <p className="text-supporting text-text-muted">
          Registered strategy versions compared as model series: bought once at the first priced
          point after the freeze, held without costs or rebalancing. A recipe without enough
          complete history is listed without a rank and without a return.
        </p>
      </header>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Ranking period</legend>
        {DISCOVERY_PERIODS.map((candidate) => (
          <Button
            key={candidate}
            type="button"
            size="sm"
            variant={candidate === period ? 'primary' : 'secondary'}
            aria-pressed={candidate === period}
            onClick={() => setPeriod(candidate)}
            data-testid={`rankings-period-${candidate}`}
          >
            {PERIOD_LABELS[candidate]}
          </Button>
        ))}
      </fieldset>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="space-y-3">
          {failure ? (
            <ErrorBlock
              title={failure.title}
              message={failure.message}
              onRetry={() => void rankings.refetch()}
            />
          ) : data === undefined ? (
            <div role="status" aria-busy="true" aria-label="Loading rankings">
              <SkeletonText lines={4} />
            </div>
          ) : data.entries.length === 0 ? (
            <EmptyState
              title="No registered version to compare yet"
              description="Rankings need at least one strategy version registered on chain and not withheld by moderation. Nothing is simulated here."
            />
          ) : (
            <>
              <p
                className="text-supporting text-text-muted"
                role="status"
                data-testid="rankings-summary"
              >
                {data.entries.filter((entry) => entry.rank !== null).length} ranked,{' '}
                {data.entries.filter((entry) => entry.rank === null).length} listed without a rank ·{' '}
                {PERIOD_LABELS[period].toLowerCase()} · {data.methodologyVersion}
              </p>
              <Table regionLabel="Model ranking" data-testid="rankings-table">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell numeric>Rank</TableHeaderCell>
                    <TableHeaderCell>Strategy version</TableHeaderCell>
                    <TableHeaderCell numeric>Time-weighted return</TableHeaderCell>
                    <TableHeaderCell numeric>Drawdown</TableHeaderCell>
                    <TableHeaderCell numeric>History (days)</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.entries.map((entry) => (
                    <EntryRow
                      key={entry.versionId}
                      entry={entry}
                      minHistoryDays={data.minHistoryDays}
                    />
                  ))}
                </TableBody>
              </Table>
              <p className="text-caption text-text-muted" data-testid="rankings-note">
                {data.note} Read {formatInstant(data.asOf)} UTC.
              </p>
            </>
          )}
        </div>
        <div className="space-y-4">
          {methodology.data ? (
            <MethodologyPanel methodology={methodology.data} />
          ) : methodology.error ? (
            <Notice tone="attention" title="The methodology could not be read">
              The figures stay labelled with their version; the rules are on the methodology route.
            </Notice>
          ) : (
            <SkeletonText lines={3} />
          )}
        </div>
      </div>
    </section>
  );
}
