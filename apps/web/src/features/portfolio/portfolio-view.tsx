'use client';

import {
  ACKNOWLEDGEMENT_KINDS,
  type JournalEntry,
  type PerformancePeriod,
  type PortfolioInstance,
  type WalletLink,
} from '@markov/contracts';
import {
  formatInstant,
  formatRawAmount,
  formatRelativeAge,
  shortenAddress,
} from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Notice,
  SelectInput,
  SkeletonText,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
} from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useVerifiedWallets } from '../wallets/queries';
import { PerformancePanel, PeriodControl } from './performance-panel';
import {
  describeEntry,
  formatValue,
  type HoldingRow,
  holdingRows,
  type JournalRow,
  journalRows,
  pendingFlows,
  valuedTotal,
} from './portfolio-model';
import {
  useAcknowledgeFlow,
  useInstances,
  useReconcileWallet,
  useWalletHoldings,
  useWalletJournal,
  useWalletPerformance,
} from './queries';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PERIODS = ['7d', '30d', '90d', '365d', 'all'] as const;

function periodOf(value: string | null): PerformancePeriod {
  return (PERIODS as readonly string[]).includes(value ?? '')
    ? (value as PerformancePeriod)
    : 'all';
}

/** A short, stable name for an instance without fetching its strategy: the label, else the pinned version. */
export function instanceLabel(instance: PortfolioInstance): string {
  return (
    instance.label ??
    `Strategy ${instance.strategyId.slice(0, 8)} · version ${instance.pinnedVersionNumber}`
  );
}

/**
 * `/portfolio`: one verified wallet at a time, what the journal says it
 * holds against the last chain observation, the flows the owner still has
 * to explain, the strategy instances in the wallet, the wallet's own
 * performance and its history. Every quantity is the API's; nothing is
 * valued or netted in the browser.
 */
export function PortfolioView() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const wallets = useVerifiedWallets(true);
  const requested = params.get('walletId');
  const walletId =
    requested &&
    UUID.test(requested) &&
    wallets.data?.some((wallet) => wallet.walletId === requested)
      ? requested
      : (wallets.data?.[0]?.walletId ?? null);
  const period = periodOf(params.get('period'));
  const instances = useInstances(true);
  const holdings = useWalletHoldings(walletId, true);
  const journal = useWalletJournal(walletId, true);
  const performance = useWalletPerformance(walletId, period, true);
  const reconcile = useReconcileWallet(walletId);
  const [reconcileFailure, setReconcileFailure] = useState<string | null>(null);

  function setParam(key: string, value: string | null) {
    const search = new URLSearchParams(params.toString());
    if (value === null) {
      search.delete(key);
    } else {
      search.set(key, value);
    }
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const walletInstances = useMemo(
    () => (instances.data ?? []).filter((instance) => instance.walletId === walletId),
    [instances.data, walletId],
  );
  const labels = useMemo(
    () =>
      new Map(walletInstances.map((instance) => [instance.instanceId, instanceLabel(instance)])),
    [walletInstances],
  );
  const rows = useMemo(
    () =>
      holdingRows(holdings.data?.holdings ?? [], performance.data?.series.latest ?? null, labels),
    [holdings.data, performance.data, labels],
  );
  const total = useMemo(() => valuedTotal(rows), [rows]);
  const flows = useMemo(() => pendingFlows(journal.data?.entries ?? []), [journal.data]);
  const history = useMemo(
    () => journalRows(journal.data?.entries ?? [], labels),
    [journal.data, labels],
  );

  if (wallets.error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="Your wallets could not be read"
          message={wallets.error instanceof Error ? wallets.error.message : 'unknown failure'}
          onRetry={() => void wallets.refetch()}
        />
      </div>
    );
  }
  if (wallets.data && wallets.data.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-heading-lg font-semibold">Portfolio</h1>
        <EmptyState
          title="No verified wallet yet"
          description="Holdings are read for wallets whose ownership you proved. Verify one to see what it holds."
          action={
            <Button asChild variant="secondary">
              <Link href="/settings/wallets">Verify a wallet</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const checkpoint = holdings.data?.checkpoint ?? null;
  const now = new Date();
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6" data-testid="portfolio-view">
      <header className="space-y-3">
        <h1 className="text-heading-lg font-semibold">Portfolio</h1>
        <p className="text-supporting text-text-muted">
          What the record says your wallet holds, checked against the chain. Quantities are base
          units the journal balances per asset; values are the API’s valuations with their price
          sources and freshness. A deposit is money in, never a return.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Wallet" className="min-w-64">
            {(control) => (
              <SelectInput
                {...control}
                value={walletId}
                onValueChange={(value) => setParam('walletId', value)}
                options={(wallets.data ?? []).map((wallet: WalletLink) => ({
                  value: wallet.walletId,
                  label: `${shortenAddress(wallet.address)} · verified ${formatInstant(wallet.verifiedAt)} UTC`,
                }))}
                placeholder="Choose a wallet"
                disabled={wallets.data === undefined}
              />
            )}
          </Field>
          <Button
            type="button"
            variant="secondary"
            loading={reconcile.isPending}
            {...(walletId === null ? { disabledReason: 'Choose a wallet first.' } : {})}
            data-testid="reconcile"
            onClick={() => {
              setReconcileFailure(null);
              reconcile.mutate(undefined, {
                onError: (failure) => setReconcileFailure(describeFailure(failure)),
              });
            }}
          >
            Reconcile with the chain now
          </Button>
        </div>
        {reconcileFailure ? (
          <Notice tone="error" title="Reconciliation did not complete" live="assertive">
            {reconcileFailure}
          </Notice>
        ) : null}
      </header>

      {holdings.error ? (
        <ErrorBlock
          title="Holdings could not be read"
          message={holdings.error.message}
          onRetry={() => void holdings.refetch()}
        />
      ) : holdings.data === undefined ? (
        <SkeletonText lines={5} />
      ) : (
        <>
          <section aria-labelledby="summary-heading" className="space-y-2">
            <h2 id="summary-heading" className="sr-only">
              Summary
            </h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-supporting sm:grid-cols-3">
              <div data-testid="summary-value">
                <dt className="text-caption uppercase tracking-wide text-text-muted">
                  Valued holdings
                </dt>
                <dd className="font-mono text-heading-sm tabular-nums">
                  {total.value === null
                    ? rows.length === 0
                      ? 'Nothing held'
                      : 'Incomplete'
                    : formatValue(total.value)}
                  <span className="block font-sans text-caption text-text-muted">
                    {total.unpriced.length > 0
                      ? `not valued: ${total.unpriced.join(', ')} unpriced`
                      : performance.data
                        ? `at ${formatInstant(performance.data.series.end)} UTC, ${performance.data.methodology.version}`
                        : 'valuation pending'}
                  </span>
                </dd>
              </div>
              <div data-testid="summary-checkpoint">
                <dt className="text-caption uppercase tracking-wide text-text-muted">
                  Chain observation
                </dt>
                <dd>
                  {checkpoint ? (
                    <>
                      <StatusBadge tone={checkpoint.status === 'matched' ? 'success' : 'attention'}>
                        {checkpoint.status === 'matched' ? 'Matched' : 'Needs review'}
                      </StatusBadge>{' '}
                      <span className="font-mono tabular-nums">
                        {formatRelativeAge(checkpoint.observedAt, now)}
                      </span>
                      <span className="block text-caption text-text-muted">
                        slot {checkpoint.slot}, {checkpoint.commitment},{' '}
                        {formatInstant(checkpoint.observedAt)} UTC
                      </span>
                    </>
                  ) : (
                    <>
                      <StatusBadge tone="neutral">Never observed</StatusBadge>
                      <span className="block text-caption text-text-muted">
                        reconcile to compare the journal with the chain
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div data-testid="summary-flows">
                <dt className="text-caption uppercase tracking-wide text-text-muted">To explain</dt>
                <dd>
                  {flows.length === 0 ? (
                    <StatusBadge tone="success">Nothing pending</StatusBadge>
                  ) : (
                    <StatusBadge tone="attention">
                      {flows.length} external flow{flows.length === 1 ? '' : 's'}
                    </StatusBadge>
                  )}
                  <span className="block text-caption text-text-muted">{holdings.data.note}</span>
                </dd>
              </div>
            </dl>
          </section>

          <HoldingsTable rows={rows} now={now} />

          {flows.length > 0 ? <FlowsToExplain flows={flows} walletId={walletId} /> : null}

          <section aria-labelledby="instances-heading" className="space-y-3">
            <h2 id="instances-heading" className="text-heading-sm font-semibold">
              Strategy instances in this wallet
            </h2>
            {instances.error ? (
              <ErrorBlock
                title="Instances could not be read"
                message={instances.error.message}
                onRetry={() => void instances.refetch()}
              />
            ) : instances.data === undefined ? (
              <SkeletonText lines={2} />
            ) : walletInstances.length === 0 ? (
              <p className="text-supporting text-text-muted" data-testid="no-instances">
                No strategy investment is tracked in this wallet yet. Investing in a strategy
                version from its page creates the instance its fills are attributed to.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="instance-list">
                {walletInstances.map((instance) => (
                  <li key={instance.instanceId}>
                    <Link
                      href={`/portfolio/${instance.instanceId}`}
                      className="block rounded-panel border border-border/40 p-4 hover:border-accent"
                      data-testid="instance-card"
                    >
                      <span className="font-medium">{instanceLabel(instance)}</span>
                      <span className="block text-caption text-text-muted">
                        pinned to version {instance.pinnedVersionNumber}
                        {instance.proposedVersionId
                          ? ' · a newer version awaits your acceptance'
                          : ''}
                        {' · '}
                        {instance.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="performance-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="performance-heading" className="text-heading-sm font-semibold">
                Performance of this wallet
              </h2>
              <PeriodControl
                period={period}
                onChange={(next) => setParam('period', next === 'all' ? null : next)}
                idPrefix="wallet"
              />
            </div>
            <PerformancePanel
              title="Personal, this wallet"
              testId="wallet-performance"
              period={period}
              data={performance.data}
              error={performance.error}
              loading={performance.isPending}
              onRetry={() => void performance.refetch()}
              exportSubject={walletId ? { kind: 'wallet', walletId } : null}
              exportName="wallet-performance"
              framing="Everything the wallet holds, valued at the API’s reference prices; deposits, withdrawals and transfers you explained are flows, so they never count as return."
            />
          </section>

          <HistorySection
            rows={history}
            error={journal.error}
            loading={journal.data === undefined}
            onRetry={() => void journal.refetch()}
          />
        </>
      )}
    </div>
  );
}

export function describeFailure(error: unknown): string {
  if (error instanceof WebApiError) {
    if (error.code === 'PROVIDER_UNAVAILABLE') {
      return 'The node could not be read; nothing changed. Try again shortly.';
    }
    if (error.code === 'RATE_LIMITED') {
      return 'Too many requests; wait a moment and try again.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'unknown failure';
}

function HoldingsTable({
  rows,
  now,
}: {
  readonly rows: readonly HoldingRow[];
  readonly now: Date;
}) {
  return (
    <section aria-labelledby="holdings-heading" className="space-y-2">
      <h2 id="holdings-heading" className="text-heading-sm font-semibold">
        Holdings
      </h2>
      {rows.length === 0 ? (
        <p className="text-supporting text-text-muted" data-testid="no-holdings">
          The journal has no entry for this wallet and no chain observation yet.
        </p>
      ) : (
        <Table regionLabel="Holdings" data-testid="holdings-table">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Asset</TableHeaderCell>
              <TableHeaderCell numeric>Quantity</TableHeaderCell>
              <TableHeaderCell numeric>Value</TableHeaderCell>
              <TableHeaderCell>Chain vs record</TableHeaderCell>
              <TableHeaderCell>Attributed to</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.asset} data-testid="holding-row" data-asset={row.symbol}>
                <TableCell>
                  <span className="font-medium">{row.symbol}</span>
                  <code className="block font-mono text-caption text-text-muted" title={row.asset}>
                    {row.asset === 'SOL' ? 'lamports' : shortenAddress(row.asset)}
                  </code>
                </TableCell>
                <TableCell numeric>
                  <span className="font-mono tabular-nums" data-testid="holding-quantity">
                    {row.quantity.text}
                  </span>
                  {row.quantity.note ? (
                    <span className="block text-caption text-text-muted">{row.quantity.note}</span>
                  ) : null}
                  <details className="text-caption text-text-muted">
                    <summary className="cursor-pointer">Exact</summary>
                    <span className="block font-mono">
                      {row.ledgerRaw} base units, {row.decimals} decimals
                      {row.quantity.multiplier ? `, multiplier ${row.quantity.multiplier}` : ''}
                    </span>
                  </details>
                </TableCell>
                <TableCell numeric>
                  <span className="font-mono tabular-nums" data-testid="holding-value">
                    {formatValue(row.value)}
                  </span>
                  <span className="block text-caption text-text-muted">
                    {row.price
                      ? `${row.price.value} ${row.price.unit} · ${row.price.kind.replace(/_/g, ' ')} · ${formatRelativeAge(row.price.observedAt, now)}`
                      : (row.valueNote ?? '')}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={row.tone} data-testid="holding-status">
                    {row.statusLabel}
                  </StatusBadge>
                  <span className="block text-caption text-text-muted">
                    {row.chainRaw === null
                      ? 'no chain observation'
                      : `chain ${formatRawAmount(row.chainRaw, row.decimals)} · record ${formatRawAmount(
                          row.ledgerRaw.startsWith('-') ? row.ledgerRaw.slice(1) : row.ledgerRaw,
                          row.decimals,
                        )}${row.differenceRaw && row.differenceRaw !== '0' ? ` · difference ${row.differenceRaw} base units` : ''}`}
                    {row.observedAt ? ` · ${formatRelativeAge(row.observedAt, now)}` : ''}
                  </span>
                </TableCell>
                <TableCell>
                  {row.attribution.length === 0 ? (
                    <span className="text-caption text-text-muted">no attribution</span>
                  ) : (
                    <ul className="space-y-1 text-caption">
                      {row.attribution.map((share) => (
                        <li key={`${share.attribution}:${share.instanceId ?? ''}`}>
                          {share.instanceId ? (
                            <Link
                              href={`/portfolio/${share.instanceId}`}
                              className="underline underline-offset-2"
                            >
                              {share.label}
                            </Link>
                          ) : (
                            share.label
                          )}
                          :{' '}
                          <span className="font-mono">
                            {formatRawAmount(
                              share.raw.startsWith('-') ? share.raw.slice(1) : share.raw,
                              row.decimals,
                            )}
                          </span>
                          {share.raw.startsWith('-') ? ' (negative)' : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function FlowsToExplain({
  flows,
  walletId,
}: {
  readonly flows: readonly JournalEntry[];
  readonly walletId: string | null;
}) {
  return (
    <section aria-labelledby="flows-heading" className="space-y-3">
      <h2 id="flows-heading" className="text-heading-sm font-semibold">
        Explain these movements
      </h2>
      <p className="text-supporting text-text-muted">
        The chain moved something no Markov order explains. Say what it was; the record stays at the
        wallet level and is never attributed to a strategy by guessing.
      </p>
      <ul className="space-y-3" data-testid="pending-flows">
        {flows.map((entry) => (
          <li key={entry.entryId} className="rounded-panel border border-border/40 p-4">
            <AcknowledgeForm entry={entry} walletId={walletId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const ACKNOWLEDGEMENT_LABELS: Record<(typeof ACKNOWLEDGEMENT_KINDS)[number], string> = {
  deposit: 'A deposit I made',
  withdrawal: 'A withdrawal I made',
  transfer: 'A transfer between my wallets',
  other: 'Something else (say what)',
};

function AcknowledgeForm({
  entry,
  walletId,
}: {
  readonly entry: JournalEntry;
  readonly walletId: string | null;
}) {
  const acknowledge = useAcknowledgeFlow(walletId);
  const [kind, setKind] = useState<(typeof ACKNOWLEDGEMENT_KINDS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      aria-label={`Explain ${describeEntry(entry)}`}
      data-testid="acknowledge-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (kind === null) {
          setFailure('Choose what this movement was.');
          return;
        }
        setFailure(null);
        acknowledge.mutate(
          {
            entryId: entry.entryId,
            request: { kind, note: note.trim() === '' ? null : note.trim() },
          },
          { onError: (error) => setFailure(describeFailure(error)) },
        );
      }}
    >
      <p className="font-medium">{describeEntry(entry)}</p>
      <p className="text-caption text-text-muted">
        {formatInstant(entry.occurredAt)} UTC · {entry.source.kind.replace(/_/g, ' ')} ·{' '}
        <code className="font-mono">{entry.source.ref}</code>
      </p>
      <fieldset className="space-y-1 border-0 p-0">
        <legend className="text-supporting font-medium">What was it?</legend>
        {ACKNOWLEDGEMENT_KINDS.map((value) => (
          <label key={value} className="flex items-center gap-2 text-supporting">
            <input
              type="radio"
              name={`acknowledge-${entry.entryId}`}
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            {ACKNOWLEDGEMENT_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <Field label="Note (optional)">
        {(control) => (
          <TextInput
            {...control}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" size="sm" loading={acknowledge.isPending} data-testid="acknowledge">
        Record explanation
      </Button>
      {failure ? (
        <Notice tone="error" title="Not recorded" live="assertive">
          {failure}
        </Notice>
      ) : null}
    </form>
  );
}

export function HistorySection({
  rows,
  error,
  loading,
  onRetry,
  heading = 'History',
}: {
  readonly rows: readonly JournalRow[];
  readonly error: WebApiError | null;
  readonly loading: boolean;
  readonly onRetry: () => void;
  readonly heading?: string;
}) {
  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <h2 id="history-heading" className="text-heading-sm font-semibold">
        {heading}
      </h2>
      {error ? (
        <ErrorBlock
          title="The journal could not be read"
          message={error.message}
          onRetry={onRetry}
        />
      ) : loading ? (
        <SkeletonText lines={3} />
      ) : rows.length === 0 ? (
        <p className="text-supporting text-text-muted" data-testid="no-history">
          Nothing recorded yet.
        </p>
      ) : (
        <ol className="space-y-2" data-testid="journal-list">
          {rows.map((row) => (
            <li
              key={row.entryId}
              className="rounded-panel border border-border/40 p-3"
              data-testid="journal-row"
              data-kind={row.kind}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.description}</span>
                <span className="font-mono text-caption tabular-nums text-text-muted">
                  {formatInstant(row.occurredAt)} UTC
                </span>
              </div>
              <p className="text-caption text-text-muted">
                {row.instanceId ? (
                  <Link
                    href={`/portfolio/${row.instanceId}`}
                    className="underline underline-offset-2"
                  >
                    {row.attributionLabel}
                  </Link>
                ) : (
                  row.attributionLabel
                )}
                {row.acknowledgement ? ` · explained as ${row.acknowledgement}` : ''}
                {row.needsAcknowledgement ? ' · awaiting your explanation' : ''}
                {row.memo ? ` · ${row.memo}` : ''}
              </p>
              <details className="text-caption">
                <summary className="cursor-pointer text-text-muted">
                  Lines ({row.lines.length}) · <code className="font-mono">{row.sourceRef}</code>
                </summary>
                <ul className="mt-1 font-mono">
                  {row.lines.map((line) => (
                    <li key={`${line.account}:${line.asset}:${line.deltaRaw}:${line.lotId ?? ''}`}>
                      {line.account}: {line.deltaRaw} {line.symbol} (base units)
                      {line.lotId ? ` · lot ${line.lotId.slice(0, 8)}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
