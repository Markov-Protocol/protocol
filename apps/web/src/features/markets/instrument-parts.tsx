'use client';

import type { CatalogPrice, Instrument, SolanaCluster } from '@markov/contracts';
import {
  formatInstant,
  formatPriceValue,
  formatRelativeAge,
  priceKindLabel,
} from '@markov/formatters';
import { cn, StatusBadge } from '@markov/ui';
import {
  ISSUER_LABELS,
  KIND_LABELS,
  monogramOf,
  networkLabel,
  STATUS_LABELS,
  statusTone,
  summariseAvailability,
} from './labels';

/** Company · Issuer · Network on one line; the issuer badge keeps two exposures to one company apart. */
export function InstrumentIdentity({
  instrument,
  cluster,
  className,
}: {
  readonly instrument: Pick<Instrument, 'companyName' | 'issuer'>;
  readonly cluster: SolanaCluster | null | undefined;
  readonly className?: string;
}) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-supporting', className)}>
      <span className="text-text">{instrument.companyName}</span>
      <span aria-hidden="true" className="text-text-muted">
        ·
      </span>
      <StatusBadge tone="info">{ISSUER_LABELS[instrument.issuer]}</StatusBadge>
      <span aria-hidden="true" className="text-text-muted">
        ·
      </span>
      <span className="text-text-muted">{networkLabel(cluster)}</span>
    </p>
  );
}

/** Deterministic monogram; the catalog carries no images and the app fetches none. */
export function Monogram({
  symbol,
  className,
}: {
  readonly symbol: string;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-panel border border-border/60 bg-surface-raised font-mono text-supporting text-text-muted',
        className,
      )}
    >
      {monogramOf(symbol)}
    </span>
  );
}

/** A backend-typed reference price with its kind and age; never an executable quote, never invented. */
export function PriceLine({
  price,
  now,
  compact = false,
}: {
  readonly price: CatalogPrice | null;
  readonly now?: Date;
  readonly compact?: boolean;
}) {
  if (price === null) {
    return (
      <span className="text-text-muted" data-price-state="unpriced">
        Unpriced
      </span>
    );
  }
  const age = formatRelativeAge(price.observedAt, now ?? new Date());
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
      data-price-state={price.stale ? 'stale' : 'fresh'}
    >
      <span className="font-mono tabular-nums">{formatPriceValue(price)}</span>
      <span className="text-caption text-text-muted">
        {priceKindLabel(price.kind)}
        {compact ? '' : ` · ${price.source}`}
      </span>
      <span className="text-caption text-text-muted" title={formatInstant(price.observedAt)}>
        observed {age}
      </span>
      {price.stale ? <StatusBadge tone="attention">Stale</StatusBadge> : null}
    </span>
  );
}

export function KindLine({
  instrument,
}: {
  readonly instrument: Pick<Instrument, 'kind' | 'underlying'>;
}) {
  const underlying =
    instrument.kind === 'listed_stock' && instrument.underlying.ticker
      ? ` · ${instrument.underlying.ticker}${instrument.underlying.exchange ? ` on ${instrument.underlying.exchange}` : ''}`
      : '';
  return (
    <span className="text-supporting text-text-muted">
      {KIND_LABELS[instrument.kind]}
      {underlying}
    </span>
  );
}

/** Status plus what the public availability allows; reasons are listed, never hidden behind a colour. */
export function AvailabilityLine({
  instrument,
  showStatus = true,
}: {
  readonly instrument: Pick<Instrument, 'status' | 'availability'>;
  readonly showStatus?: boolean;
}) {
  const summary = summariseAvailability(instrument.status, instrument.availability);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {showStatus ? (
        <StatusBadge tone={statusTone(instrument.status)}>
          {STATUS_LABELS[instrument.status]}
        </StatusBadge>
      ) : null}
      <span className="text-supporting">{summary.label}</span>
      {summary.reasons.length > 0 ? (
        <span className="text-caption text-text-muted">({summary.reasons.join('; ')})</span>
      ) : null}
    </span>
  );
}

/** When the catalog last changed this instrument; the source is the issuer's feed as sanitised by Markov. */
export function SourceStamp({
  instrument,
  now,
}: {
  readonly instrument: Pick<Instrument, 'updatedAt' | 'issuer'>;
  readonly now?: Date;
}) {
  return (
    <span className="text-caption text-text-muted" title={formatInstant(instrument.updatedAt)}>
      Catalog updated {formatRelativeAge(instrument.updatedAt, now ?? new Date())} from the{' '}
      {ISSUER_LABELS[instrument.issuer]} feed
    </span>
  );
}
