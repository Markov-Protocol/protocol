'use client';

import type { PerformancePeriod, PublicVersion, StrategyVersion } from '@markov/contracts';
import { formatInstant, formatRawAmount, shortenAddress } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  SkeletonText,
  StatusBadge,
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
import { WebApiError } from '../api/use-markov-api';
import { useOwnVersion, usePublicVersion } from '../publishing/queries';
import { useVerifiedWallets } from '../wallets/queries';
import { downloadJson } from './download';
import { PerformancePanel, PeriodControl } from './performance-panel';
import {
  type AllocationLeg,
  allocationSummary,
  formatBps,
  formatValue,
  journalRows,
  quantityDisplay,
} from './portfolio-model';
import { HistorySection, instanceLabel } from './portfolio-view';
import {
  useInstance,
  useInstanceHoldings,
  useInstancePerformance,
  useVersionPerformance,
  useWalletJournal,
} from './queries';

const PERIODS = ['7d', '30d', '90d', '365d', 'all'] as const;

function periodOf(value: string | null): PerformancePeriod {
  return (PERIODS as readonly string[]).includes(value ?? '')
    ? (value as PerformancePeriod)
    : 'all';
}

interface RecipeSummary {
  readonly title: string;
  readonly versionNumber: number;
  readonly legs: readonly AllocationLeg[];
  readonly cashWeightBps: number;
  readonly source: 'own' | 'public';
}

function recipeOf(
  own: StrategyVersion | undefined,
  pub: PublicVersion | undefined,
): RecipeSummary | null {
  if (own) {
    return {
      title: own.title,
      versionNumber: own.versionNumber,
      legs: own.legs.map((leg) => ({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        mint: leg.admission.mint,
        weightBps: leg.weightBps,
      })),
      cashWeightBps: own.cashWeightBps,
      source: 'own',
    };
  }
  if (pub) {
    return {
      title: pub.title,
      versionNumber: pub.versionNumber,
      legs: pub.legs.map((leg) => ({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        mint: leg.mint,
        weightBps: leg.weightBps,
      })),
      cashWeightBps: pub.cashWeightBps,
      source: 'public',
    };
  }
  return null;
}

/**
 * `/portfolio/[instanceId]`: one tracked implementation of a pinned
 * version. Target against actual allocation, the lots behind each
 * constituent with their cost, the fees, personal performance next to the
 * version's model series over the same window, and the instance's
 * history. The recipe's cash share stays in the wallet and is said so.
 */
export function InstanceView({ instanceId }: { readonly instanceId: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const period = periodOf(params.get('period'));
  const instance = useInstance(instanceId, true);
  const strategyId = instance.data?.strategyId ?? '';
  const versionId = instance.data?.pinnedVersionId ?? null;
  const own = useOwnVersion(strategyId, versionId, instance.data !== undefined);
  const ownMissing = own.error instanceof WebApiError && own.error.status === 404;
  const pub = usePublicVersion(strategyId, versionId, ownMissing);
  const recipe = useMemo(() => recipeOf(own.data, pub.data), [own.data, pub.data]);
  const holdings = useInstanceHoldings(instanceId, instance.data !== undefined);
  const personal = useInstancePerformance(instanceId, period, instance.data !== undefined);
  const model = useVersionPerformance(
    strategyId,
    recipe?.versionNumber ?? null,
    period,
    instance.data !== undefined,
  );
  const journal = useWalletJournal(instance.data?.walletId ?? null, instance.data !== undefined);
  const wallets = useVerifiedWallets(instance.data !== undefined);
  const allocation = useMemo(
    () =>
      recipe && holdings.data
        ? allocationSummary({
            legs: recipe.legs,
            cashWeightBps: recipe.cashWeightBps,
            holdings: holdings.data.holdings,
            positions: personal.data?.series.latest ?? null,
          })
        : null,
    [recipe, holdings.data, personal.data],
  );
  const history = useMemo(() => {
    const labels = new Map(
      instance.data ? [[instance.data.instanceId, instanceLabel(instance.data)]] : [],
    );
    return journalRows(
      (journal.data?.entries ?? []).filter((entry) => entry.instanceId === instanceId),
      labels,
    );
  }, [journal.data, instance.data, instanceId]);

  function setPeriod(next: PerformancePeriod) {
    const search = new URLSearchParams(params.toString());
    if (next === 'all') {
      search.delete('period');
    } else {
      search.set('period', next);
    }
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  if (instance.error instanceof WebApiError && instance.error.status === 404) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <EmptyState
          title="Not found"
          description="There is no strategy instance with this id in your account."
          action={
            <Button asChild variant="secondary">
              <Link href="/portfolio">Back to the portfolio</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (instance.error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The instance could not be read"
          message={instance.error.message}
          onRetry={() => void instance.refetch()}
        />
      </div>
    );
  }
  if (instance.data === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <SkeletonText lines={5} />
      </div>
    );
  }
  const wallet = wallets.data?.find((entry) => entry.walletId === instance.data.walletId) ?? null;
  const recipeError = ownMissing ? pub.error : own.error;
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6" data-testid="instance-view">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/portfolio" className="underline underline-offset-2">
            Portfolio
          </Link>{' '}
          <span className="text-text-muted">/ instance</span>
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-heading-lg font-semibold">
          {recipe?.title ?? instanceLabel(instance.data)}
          <StatusBadge tone={instance.data.status === 'active' ? 'success' : 'neutral'}>
            {instance.data.status}
          </StatusBadge>
        </h1>
        <p className="text-supporting text-text-muted">
          Pinned to version {instance.data.pinnedVersionNumber}
          {recipe ? (
            <>
              {' '}
              (
              <Link
                href={`/strategies/${strategyId}/versions/${instance.data.pinnedVersionId}`}
                className="underline underline-offset-2"
              >
                recipe
              </Link>
              )
            </>
          ) : null}
          {' · wallet '}
          {wallet ? (
            <Link
              href={`/portfolio?walletId=${wallet.walletId}`}
              className="font-mono underline underline-offset-2"
            >
              {shortenAddress(wallet.address)}
            </Link>
          ) : (
            <code className="font-mono">{instance.data.walletId.slice(0, 8)}</code>
          )}
          {' · tracked since '}
          {formatInstant(instance.data.createdAt)} UTC
        </p>
        {instance.data.proposedVersionId ? (
          <Notice tone="info" title="A newer version awaits your acceptance">
            The creator published a newer version. Your pin does not move until you accept it, and
            accepting never trades by itself.
          </Notice>
        ) : null}
      </header>

      <section aria-labelledby="allocation-heading" className="space-y-3">
        <h2 id="allocation-heading" className="text-heading-sm font-semibold">
          Target and actual allocation
        </h2>
        {recipeError ? (
          <ErrorBlock
            title="The recipe could not be read"
            message={recipeError.message}
            onRetry={() => void (ownMissing ? pub.refetch() : own.refetch())}
          />
        ) : holdings.error ? (
          <ErrorBlock
            title="Holdings could not be read"
            message={holdings.error.message}
            onRetry={() => void holdings.refetch()}
          />
        ) : allocation === null ? (
          <SkeletonText lines={4} />
        ) : (
          <>
            <p className="text-supporting text-text-muted">
              The recipe keeps {formatBps(allocation.cashBps)} as cash; that share stays in your
              wallet and is not attributed to this instance, so drift compares the invested
              constituents with each other.{' '}
              {allocation.complete ? (
                <>
                  Valued at {formatValue(allocation.totalValue)}
                  {allocation.largestDriftBps !== null
                    ? `; largest drift ${formatBps(allocation.largestDriftBps)}`
                    : ''}
                  .
                </>
              ) : (
                <span data-testid="allocation-incomplete">
                  Actual weights are not reported: {allocation.reasons.join('; ')}.
                </span>
              )}
            </p>
            <Table regionLabel="Target and actual allocation" data-testid="allocation-table">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Constituent</TableHeaderCell>
                  <TableHeaderCell numeric>Target</TableHeaderCell>
                  <TableHeaderCell numeric>Target of invested</TableHeaderCell>
                  <TableHeaderCell numeric>Held</TableHeaderCell>
                  <TableHeaderCell numeric>Value</TableHeaderCell>
                  <TableHeaderCell numeric>Actual</TableHeaderCell>
                  <TableHeaderCell numeric>Drift</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allocation.rows.map((row) => (
                  <TableRow key={row.mint} data-testid="allocation-row" data-symbol={row.symbol}>
                    <TableCell>
                      <span className="font-medium">{row.symbol}</span>
                      <code
                        className="block font-mono text-caption text-text-muted"
                        title={row.mint}
                      >
                        {shortenAddress(row.mint)}
                      </code>
                      {row.note ? (
                        <span className="block text-caption text-text-muted">{row.note}</span>
                      ) : null}
                    </TableCell>
                    <TableCell numeric>{formatBps(row.targetBps)}</TableCell>
                    <TableCell numeric>{formatBps(row.investedTargetBps)}</TableCell>
                    <TableCell numeric>
                      <span className="font-mono tabular-nums">{row.quantity.text}</span>
                      {row.quantity.note ? (
                        <span className="block text-caption text-text-muted">
                          {row.quantity.note}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell numeric>
                      <span className="font-mono tabular-nums" data-testid="allocation-value">
                        {formatValue(row.value)}
                      </span>
                    </TableCell>
                    <TableCell numeric data-testid="allocation-actual">
                      {row.actualBps === null ? 'Not reported' : formatBps(row.actualBps)}
                    </TableCell>
                    <TableCell numeric data-testid="allocation-drift">
                      {row.driftBps === null ? 'Not reported' : formatBps(row.driftBps)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow data-testid="allocation-row" data-symbol="cash">
                  <TableCell>
                    <span className="font-medium">Cash</span>
                    <span className="block text-caption text-text-muted">
                      held in the wallet, not attributed
                    </span>
                  </TableCell>
                  <TableCell numeric>{formatBps(allocation.cashBps)}</TableCell>
                  <TableCell numeric>—</TableCell>
                  <TableCell numeric>—</TableCell>
                  <TableCell numeric>—</TableCell>
                  <TableCell numeric>—</TableCell>
                  <TableCell numeric>—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}
      </section>

      <section aria-labelledby="lots-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="lots-heading" className="text-heading-sm font-semibold">
            Lots, cost and fees
          </h2>
          {holdings.data ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="export-holdings"
              onClick={() =>
                downloadJson(`instance-holdings-${instanceId.slice(0, 8)}.json`, holdings.data)
              }
            >
              Download holdings (JSON)
            </Button>
          ) : null}
        </div>
        {holdings.data ? (
          <>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-supporting sm:grid-cols-3">
              <div data-testid="cost-basis">
                <dt className="text-caption uppercase tracking-wide text-text-muted">
                  Cost of open lots
                </dt>
                <dd className="font-mono tabular-nums">
                  {holdings.data.costBasis.asset === null
                    ? 'Unknown'
                    : `${formatRawAmount(holdings.data.costBasis.raw, 6)} (base units ${holdings.data.costBasis.raw})`}
                  <span className="block font-sans text-caption text-text-muted">
                    {holdings.data.costBasis.asset === null
                      ? 'no lot records a cost asset'
                      : `in ${shortenAddress(holdings.data.costBasis.asset)}; ${holdings.data.lotPolicy.toUpperCase()} bookkeeping, not a valuation`}
                  </span>
                </dd>
              </div>
              <div data-testid="fees">
                <dt className="text-caption uppercase tracking-wide text-text-muted">
                  Network fees and rent
                </dt>
                <dd className="font-mono tabular-nums">
                  {formatRawAmount(holdings.data.feesLamports, 9)} SOL
                </dd>
              </div>
              <div data-testid="instance-status">
                <dt className="text-caption uppercase tracking-wide text-text-muted">
                  Reconciliation
                </dt>
                <dd>
                  <StatusBadge
                    tone={holdings.data.status === 'reconciled' ? 'success' : 'attention'}
                  >
                    {holdings.data.status.replace(/_/g, ' ')}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
            <p className="text-caption text-text-muted">{holdings.data.note}</p>
            {holdings.data.holdings.length === 0 ? (
              <p className="text-supporting text-text-muted" data-testid="no-lots">
                No lot is attributed to this instance yet.
              </p>
            ) : (
              holdings.data.holdings.map((holding) => (
                <div
                  key={holding.asset}
                  className="space-y-1"
                  data-testid="lot-group"
                  data-symbol={holding.symbol}
                >
                  <h3 className="text-supporting font-medium">
                    {holding.symbol} ·{' '}
                    <span className="font-mono">
                      {
                        quantityDisplay(
                          holding.attributedRaw,
                          holding.decimals,
                          personal.data?.series.latest.find(
                            (position) => position.asset === holding.asset,
                          ) ?? null,
                        ).text
                      }
                    </span>{' '}
                    <span className="text-caption text-text-muted">
                      ({holding.attributedRaw} base units)
                    </span>
                  </h3>
                  <Table regionLabel={`Lots of ${holding.symbol}`}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Opened</TableHeaderCell>
                        <TableHeaderCell numeric>Quantity</TableHeaderCell>
                        <TableHeaderCell numeric>Remaining</TableHeaderCell>
                        <TableHeaderCell numeric>Cost</TableHeaderCell>
                        <TableHeaderCell numeric>Fees</TableHeaderCell>
                        <TableHeaderCell>Order</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {holding.lots.map((lot) => (
                        <TableRow key={lot.lotId} data-testid="lot-row">
                          <TableCell>{formatInstant(lot.openedAt)} UTC</TableCell>
                          <TableCell numeric>
                            <span className="font-mono">
                              {formatRawAmount(lot.quantityRaw, lot.decimals)}
                            </span>
                          </TableCell>
                          <TableCell numeric>
                            <span className="font-mono">
                              {formatRawAmount(lot.remainingRaw, lot.decimals)}
                            </span>
                          </TableCell>
                          <TableCell numeric>
                            <span className="font-mono">{formatRawAmount(lot.costRaw, 6)}</span>
                          </TableCell>
                          <TableCell numeric>
                            <span className="font-mono">
                              {formatRawAmount(lot.feeLamports, 9)} SOL
                            </span>
                          </TableCell>
                          <TableCell>
                            {lot.intentId ? (
                              <Link
                                href={`/activity/${lot.intentId}`}
                                className="underline underline-offset-2"
                              >
                                {lot.intentId.slice(0, 8)}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </>
        ) : holdings.error ? null : (
          <SkeletonText lines={3} />
        )}
      </section>

      <section aria-labelledby="perf-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="perf-heading" className="text-heading-sm font-semibold">
            Performance: personal against the model
          </h2>
          <PeriodControl period={period} onChange={setPeriod} idPrefix="instance" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PerformancePanel
            title="Personal (actual)"
            testId="personal-performance"
            period={period}
            data={personal.data}
            error={personal.error}
            loading={personal.isPending}
            onRetry={() => void personal.refetch()}
            exportSubject={{ kind: 'instance', instanceId }}
            exportName="instance-performance"
            framing="Your lots at the API’s reference prices; purchases count as contributions and sales as withdrawals, so execution cost against the reference price shows as return."
          />
          <PerformancePanel
            title="Model (buy and hold)"
            testId="model-performance"
            period={period}
            data={model.data}
            error={model.error}
            loading={model.isPending && recipe !== null}
            onRetry={() => void model.refetch()}
            exportSubject={
              recipe ? { kind: 'version', strategyId, versionNumber: recipe.versionNumber } : null
            }
            exportName="model-performance"
            framing="The recipe bought once at the first priced point after it was frozen and never rebalanced, without fees or slippage. It is not your account and not a forecast."
          />
        </div>
      </section>

      <HistorySection
        rows={history}
        error={journal.error}
        loading={journal.data === undefined}
        onRetry={() => void journal.refetch()}
        heading="History of this instance"
      />
    </div>
  );
}
