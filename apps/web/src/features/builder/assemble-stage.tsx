'use client';

import {
  BASIS_POINTS_TOTAL,
  type DraftIssue,
  type StrategyDraftContent,
  type StrategyLegInput,
} from '@markov/contracts';
import { formatBasisPoints } from '@markov/formatters';
import { Button, Field, Notice, PercentInput, StatusBadge, TextInput } from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { InstrumentPicker } from '../markets/instrument-picker';
import { ISSUER_LABELS, STATUS_LABELS, statusTone } from '../markets/labels';
import { useInstrument } from '../markets/queries';
import {
  addLeg,
  equalWeights,
  fillCashRemainder,
  moveLeg,
  removeLeg,
  setLegNote,
  setLegWeight,
  totalsOf,
} from './draft-state';

const STEP_BPS = 100;

function clampBps(value: number): number {
  return Math.min(BASIS_POINTS_TOTAL, Math.max(0, value));
}

function LegRow({
  leg,
  index,
  count,
  issues,
  readOnly,
  onChange,
}: {
  readonly leg: StrategyLegInput;
  readonly index: number;
  readonly count: number;
  readonly issues: readonly DraftIssue[];
  readonly readOnly: boolean;
  readonly onChange: (next: (content: StrategyDraftContent) => StrategyDraftContent) => void;
}) {
  const instrument = useInstrument(leg.instrumentId);
  const [percentError, setPercentError] = useState<string | null>(null);
  const symbol = instrument.data?.symbol ?? leg.instrumentId.slice(0, 8);
  const rowIssues = issues.filter((issue) => issue.path === `legs/${index}`);
  const unavailable =
    instrument.error instanceof WebApiError && instrument.error.status === 404
      ? 'No longer listed publicly; the backend will refuse it until you remove it.'
      : instrument.data && instrument.data.status !== 'admitted'
        ? `${STATUS_LABELS[instrument.data.status]}: only admitted instruments can be constituents.`
        : null;
  const adjust = (delta: number) =>
    onChange((content) => setLegWeight(content, leg.instrumentId, clampBps(leg.weightBps + delta)));
  return (
    <li
      className="space-y-3 rounded-panel border border-border/60 p-3"
      data-testid="leg-row"
      id={`leg-${index}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {instrument.data ? (
            <p className="flex flex-wrap items-center gap-2 text-supporting">
              <Link
                href={`/markets/${instrument.data.instrumentId}`}
                className="truncate font-medium underline underline-offset-2"
                title={instrument.data.name}
              >
                {instrument.data.symbol} · {instrument.data.companyName}
              </Link>
              <StatusBadge tone="info">{ISSUER_LABELS[instrument.data.issuer]}</StatusBadge>
              <StatusBadge tone={statusTone(instrument.data.status)}>
                {STATUS_LABELS[instrument.data.status]}
              </StatusBadge>
            </p>
          ) : instrument.error ? (
            <p className="text-supporting">
              <span className="font-mono">{leg.instrumentId}</span>{' '}
              <StatusBadge tone="attention">Could not be read</StatusBadge>
            </p>
          ) : (
            <p className="text-supporting text-text-muted" aria-busy="true">
              Reading {leg.instrumentId.slice(0, 8)}…
            </p>
          )}
          {instrument.data?.name ? (
            <p className="truncate text-caption text-text-muted" title={instrument.data.name}>
              {instrument.data.name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Move ${symbol} up`}
            onClick={() => onChange((content) => moveLeg(content, leg.instrumentId, -1))}
            {...(readOnly
              ? { disabledReason: 'Archived draft.' }
              : index === 0
                ? { disabledReason: 'Already first.' }
                : {})}
          >
            Up
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Move ${symbol} down`}
            onClick={() => onChange((content) => moveLeg(content, leg.instrumentId, 1))}
            {...(readOnly
              ? { disabledReason: 'Archived draft.' }
              : index === count - 1
                ? { disabledReason: 'Already last.' }
                : {})}
          >
            Down
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove ${symbol}`}
            onClick={() => onChange((content) => removeLeg(content, leg.instrumentId))}
            {...(readOnly ? { disabledReason: 'Archived draft.' } : {})}
          >
            Remove
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_auto_minmax(0,1fr)] sm:items-end">
        <Field
          label={`Weight of ${symbol}`}
          description="Share of the budget in percent, exact to 0.01%."
          error={percentError ?? rowIssues.map((issue) => issue.message).join(' ')}
          id={`leg-${index}-weight`}
        >
          {(control) => (
            <PercentInput
              {...control}
              disabled={readOnly}
              valueBps={leg.weightBps}
              onValueChange={(change) => {
                if (change.bps !== null) {
                  setPercentError(null);
                  onChange((content) => setLegWeight(content, leg.instrumentId, change.bps ?? 0));
                } else if (change.text.trim() === '') {
                  setPercentError(null);
                  onChange((content) => setLegWeight(content, leg.instrumentId, 0));
                } else {
                  setPercentError(
                    change.error === 'too-many-decimals'
                      ? 'At most two decimals; weights are exact basis points.'
                      : change.error === 'negative'
                        ? 'A weight cannot be negative.'
                        : change.error === 'out-of-range'
                          ? 'A weight cannot exceed 100%.'
                          : 'Enter a percentage such as 12.5.',
                  );
                }
              }}
            />
          )}
        </Field>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Decrease ${symbol} by 1%`}
            onClick={() => adjust(-STEP_BPS)}
            {...(readOnly ? { disabledReason: 'Archived draft.' } : {})}
          >
            −1%
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Increase ${symbol} by 1%`}
            onClick={() => adjust(STEP_BPS)}
            {...(readOnly ? { disabledReason: 'Archived draft.' } : {})}
          >
            +1%
          </Button>
        </div>
        <Field label="Why this constituent" id={`leg-${index}-note`}>
          {(control) => (
            <TextInput
              {...control}
              disabled={readOnly}
              value={leg.note ?? ''}
              maxLength={200}
              placeholder="Your reason, in your words"
              onChange={(event) =>
                onChange((content) =>
                  setLegNote(
                    content,
                    leg.instrumentId,
                    event.target.value === '' ? null : event.target.value,
                  ),
                )
              }
            />
          )}
        </Field>
      </div>
      {unavailable ? (
        <Notice tone="attention" title="Not available as a constituent">
          {unavailable} Nothing is swapped in for it; edit the draft yourself.
        </Notice>
      ) : null}
    </li>
  );
}

/** Stage 02: constituents and exact allocations. Every change is the person's; nothing is normalised. */
export function AssembleStage({
  content,
  maxLegs,
  issues,
  readOnly = false,
  onChange,
}: {
  readonly content: StrategyDraftContent;
  readonly maxLegs: number | null;
  readonly issues: readonly DraftIssue[];
  readonly readOnly?: boolean;
  readonly onChange: (next: (content: StrategyDraftContent) => StrategyDraftContent) => void;
}) {
  const totals = totalsOf(content);
  const [cashError, setCashError] = useState<string | null>(null);
  const ids = new Set(content.legs.map((leg) => leg.instrumentId));
  const full = maxLegs !== null && content.legs.length >= maxLegs;
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="constituents-heading">
        <h2 id="constituents-heading" className="text-heading-sm font-semibold">
          Constituents
        </h2>
        <p className="text-supporting text-text-muted">
          Exact admitted instruments by canonical id. Weights are shares of a future budget, not
          amounts; the total including cash must be exactly 100.00%. Removing one leaves the others
          as they are.
        </p>
        {content.legs.length === 0 ? (
          <p className="text-supporting text-text-muted" data-testid="no-legs">
            No constituent yet. Search below or start from a thesis shortlist.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Constituents">
            {content.legs.map((leg, index) => (
              <LegRow
                key={leg.instrumentId}
                leg={leg}
                index={index}
                count={content.legs.length}
                issues={issues}
                readOnly={readOnly}
                onChange={onChange}
              />
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange(equalWeights)}
            {...(readOnly
              ? { disabledReason: 'Archived draft.' }
              : content.legs.length === 0
                ? { disabledReason: 'Add a constituent first.' }
                : {})}
          >
            Set equal weights
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange(fillCashRemainder)}
            {...(totals.remainingBps + content.cashWeightBps < 0
              ? { disabledReason: 'The constituents alone exceed 100%.' }
              : {})}
          >
            Put the remainder in cash
          </Button>
        </div>
        <p className="text-caption text-text-muted">
          Equal weights are{' '}
          {content.legs.length > 0
            ? formatBasisPoints(Math.floor(BASIS_POINTS_TOTAL / content.legs.length))
            : '—'}{' '}
          each with the exact remainder as cash; you can change any of them afterwards.
        </p>
        {readOnly ? null : full ? (
          <Notice tone="info" title={`At most ${maxLegs} constituents in this deployment`}>
            Remove one before adding another.
          </Notice>
        ) : (
          <InstrumentPicker
            excluded={ids}
            onAdd={(instrumentId) => onChange((current) => addLeg(current, instrumentId))}
            label="Search admitted instruments to add"
            addLabel="Add"
          />
        )}
      </section>

      <section className="space-y-2" aria-labelledby="cash-heading">
        <h2 id="cash-heading" className="text-heading-sm font-semibold">
          Cash
        </h2>
        <Field
          label="Cash held as stablecoin"
          description="Optional. Counts toward the 100.00% total; it is not invested."
          error={
            cashError ??
            issues
              .filter((issue) => issue.path === 'cashWeightBps')
              .map((issue) => issue.message)
              .join(' ')
          }
          id="cash-weight"
          className="max-w-xs"
        >
          {(control) => (
            <PercentInput
              {...control}
              disabled={readOnly}
              valueBps={content.cashWeightBps}
              onValueChange={(change) => {
                if (change.bps !== null) {
                  setCashError(null);
                  onChange((current) => ({ ...current, cashWeightBps: change.bps ?? 0 }));
                } else if (change.text.trim() === '') {
                  setCashError(null);
                  onChange((current) => ({ ...current, cashWeightBps: 0 }));
                } else {
                  setCashError('Enter a percentage with at most two decimals.');
                }
              }}
            />
          )}
        </Field>
        <p className="text-supporting" data-testid="remaining-line">
          Allocated {formatBasisPoints(totals.legsBps)} to constituents and{' '}
          {formatBasisPoints(totals.cashBps)} to cash:{' '}
          {totals.remainingBps === 0
            ? 'exactly 100.00%.'
            : totals.remainingBps > 0
              ? `${formatBasisPoints(totals.remainingBps)} still unallocated.`
              : `${formatBasisPoints(-totals.remainingBps)} over 100.00%.`}
        </p>
      </section>
    </div>
  );
}
