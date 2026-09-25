'use client';

import {
  PERFORMANCE_PERIODS,
  type PerformancePeriod,
  type PerformanceResponse,
  type ValuationPosition,
} from '@markov/contracts';
import { formatInstant, formatRelativeAge, shortenAddress } from '@markov/formatters';
import {
  Button,
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
import { useId, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { downloadJson } from './download';
import {
  chartSummary,
  formatValue,
  metricLines,
  PERIOD_LABELS,
  quantityDisplay,
  seriesLabel,
  sparkline,
} from './portfolio-model';
import { type ExportSubject, useExportPerformance } from './queries';

/** Period buttons shared by every performance panel on a page, so two series are always compared over the same window. */
export function PeriodControl({
  period,
  onChange,
  idPrefix,
}: {
  readonly period: PerformancePeriod;
  readonly onChange: (period: PerformancePeriod) => void;
  readonly idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-wrap gap-2 border-0 p-0" data-testid={`${idPrefix}-periods`}>
      <legend className="sr-only">Period</legend>
      {PERFORMANCE_PERIODS.map((entry) => (
        <Button
          key={entry}
          type="button"
          size="sm"
          variant={entry === period ? 'primary' : 'secondary'}
          aria-pressed={entry === period}
          onClick={() => onChange(entry)}
          data-testid={`${idPrefix}-period-${entry}`}
        >
          {PERIOD_LABELS[entry]}
        </Button>
      ))}
    </fieldset>
  );
}

export interface PerformancePanelProps {
  readonly title: string;
  readonly testId: string;
  readonly period: PerformancePeriod;
  readonly data: PerformanceResponse | undefined;
  readonly error: WebApiError | null;
  readonly loading: boolean;
  readonly onRetry: () => void;
  readonly exportSubject: ExportSubject | null;
  readonly exportName: string;
  /** What the panel is about, in one sentence (the model is not anyone's account, and so on). */
  readonly framing: string;
}

/**
 * One performance series with its window metrics, labelled with the
 * methodology, the currency and whether it is personal (actual) or a model.
 * Every unknown is shown with its reason; the drawing has a text summary
 * and every displayed figure has its exact string behind a disclosure.
 */
export function PerformancePanel({
  title,
  testId,
  period,
  data,
  error,
  loading,
  onRetry,
  exportSubject,
  exportName,
  framing,
}: PerformancePanelProps) {
  const headingId = useId();
  const [exportFailure, setExportFailure] = useState<string | null>(null);
  const exporter = useExportPerformance();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-panel border border-border/40 p-4"
      data-testid={testId}
    >
      <header className="space-y-1">
        <h3 id={headingId} className="text-heading-sm font-semibold">
          {title}
        </h3>
        <p className="text-caption text-text-muted">{framing}</p>
        {data ? (
          <p className="text-caption" data-testid={`${testId}-label`}>
            <StatusBadge tone={data.series.kind === 'model' ? 'info' : 'success'}>
              {seriesLabel(data.series)}
            </StatusBadge>{' '}
            <span className="text-text-muted">
              window {PERIOD_LABELS[period]}
              {data.metrics.start ? ` from ${formatInstant(data.metrics.start)} UTC` : ''} to{' '}
              {formatInstant(data.metrics.end)} UTC
            </span>
          </p>
        ) : null}
      </header>
      {error instanceof WebApiError && error.status === 404 ? (
        <Notice tone="info" title="No series">
          There is nothing to measure for this subject, or it is not readable by you.
        </Notice>
      ) : error ? (
        <ErrorBlock
          title="The performance could not be read"
          message={error.message}
          onRetry={onRetry}
        />
      ) : loading || data === undefined ? (
        <SkeletonText lines={4} />
      ) : (
        <PanelBody data={data} testId={testId} />
      )}
      {exportSubject && data ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={exporter.isPending}
            data-testid={`${testId}-export`}
            onClick={() => {
              setExportFailure(null);
              exporter.mutate(
                { subject: exportSubject, period },
                {
                  onSuccess: (record) => {
                    if (!downloadJson(`${exportName}-${period}.json`, record)) {
                      setExportFailure(
                        'This browser cannot save files; copy the JSON from the API instead.',
                      );
                    }
                  },
                  onError: (failure) => setExportFailure(failure.message),
                },
              );
            }}
          >
            Download the complete record (JSON)
          </Button>
          <span className="text-caption text-text-muted">
            observations, multipliers and every window, for checking offline
          </span>
        </div>
      ) : null}
      {exportFailure ? (
        <Notice tone="error" title="The export did not complete" live="assertive">
          {exportFailure}
        </Notice>
      ) : null}
    </section>
  );
}

function PanelBody({
  data,
  testId,
}: {
  readonly data: PerformanceResponse;
  readonly testId: string;
}) {
  const lines = metricLines(data.metrics, data.series.currency);
  const summary = chartSummary(data.series, data.series.currency);
  const drawing = sparkline(data.series.points, 320, 80);
  const now = new Date();
  return (
    <div className="space-y-4">
      {!data.metrics.available ? (
        <Notice
          tone="attention"
          title="No return for this window"
          data-testid={`${testId}-unavailable`}
        >
          {lines.find((line) => line.key === 'twr')?.note ?? 'not reported'}. Nothing is estimated
          in its place.
        </Notice>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-supporting sm:grid-cols-2">
        {lines.map((line) => (
          <div key={line.key} data-testid={`${testId}-${line.key}`}>
            <dt className="text-caption uppercase tracking-wide text-text-muted">{line.label}</dt>
            <dd className="font-mono tabular-nums">
              {line.value}
              {line.note ? (
                <span className="block font-sans text-caption text-text-muted">{line.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <figure className="space-y-2">
        {drawing.path ? (
          <svg
            viewBox="0 0 320 80"
            className="h-20 w-full max-w-md text-accent"
            aria-hidden="true"
            focusable="false"
            data-testid={`${testId}-chart`}
          >
            <title>Valuation over the window</title>
            <path d={drawing.path} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        ) : null}
        <figcaption
          className="text-caption text-text-muted"
          data-testid={`${testId}-chart-summary`}
        >
          {summary.text}
          {drawing.gaps > 0
            ? ` The line breaks where a point could not be valued (${drawing.gaps} gap${drawing.gaps === 1 ? '' : 's'}).`
            : ''}
        </figcaption>
      </figure>
      <details className="text-caption">
        <summary className="cursor-pointer text-text-muted">
          Exact figures behind the latest point ({data.series.latest.length} position
          {data.series.latest.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2 space-y-2">
          <PositionsTable positions={data.series.latest} now={now} testId={testId} />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {lines
              .filter((line) => line.exact !== null)
              .map((line) => (
                <div key={line.key}>
                  <dt className="text-text-muted">{line.label}</dt>
                  <dd className="break-all font-mono">{line.exact}</dd>
                </div>
              ))}
          </dl>
        </div>
      </details>
      <p className="text-caption text-text-muted">{data.note}</p>
    </div>
  );
}

function PositionsTable({
  positions,
  now,
  testId,
}: {
  readonly positions: readonly ValuationPosition[];
  readonly now: Date;
  readonly testId: string;
}) {
  if (positions.length === 0) {
    return <p className="text-text-muted">No positions at the latest point.</p>;
  }
  return (
    <Table regionLabel="Positions behind the latest point" data-testid={`${testId}-positions`}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Asset</TableHeaderCell>
          <TableHeaderCell numeric>Base units</TableHeaderCell>
          <TableHeaderCell numeric>Multiplier</TableHeaderCell>
          <TableHeaderCell numeric>Quantity</TableHeaderCell>
          <TableHeaderCell>Price</TableHeaderCell>
          <TableHeaderCell numeric>Value</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {positions.map((position) => {
          const quantity = quantityDisplay(position.raw, position.decimals, position);
          return (
            <TableRow key={position.asset} data-testid={`${testId}-position`}>
              <TableCell>
                <span className="font-medium">{position.symbol}</span>
                <code className="block font-mono text-text-muted" title={position.asset}>
                  {position.asset === 'SOL' ? 'SOL' : shortenAddress(position.asset)}
                </code>
              </TableCell>
              <TableCell numeric>
                <code className="font-mono">{position.raw}</code>
              </TableCell>
              <TableCell numeric>
                <code className="font-mono">{position.multiplier ?? 'unknown'}</code>
              </TableCell>
              <TableCell numeric>
                <code className="font-mono">{position.scaledQuantity ?? quantity.text}</code>
              </TableCell>
              <TableCell>
                {position.price ? (
                  <>
                    <code className="font-mono">
                      {position.price.value} {position.price.unit}
                    </code>
                    <span className="block text-text-muted">
                      {position.price.kind.replace(/_/g, ' ')} · {position.price.source} ·{' '}
                      {formatRelativeAge(position.price.observedAt, now)}
                    </span>
                  </>
                ) : (
                  <span className="text-text-muted">
                    {position.issues[0]?.detail ?? 'unpriced'}
                  </span>
                )}
                {position.caveats.length > 0 ? (
                  <span className="block text-text-muted">
                    caveats:{' '}
                    {position.caveats.map((caveat) => caveat.replace(/_/g, ' ')).join(', ')}
                  </span>
                ) : null}
              </TableCell>
              <TableCell numeric>
                <code className="font-mono">{position.value ?? '—'}</code>
                <span className="block text-text-muted">{formatValue(position.value)}</span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
