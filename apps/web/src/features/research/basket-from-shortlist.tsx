'use client';

import type { InstrumentReference, StrategyDetail } from '@markov/contracts';
import { formatBasisPoints } from '@markov/formatters';
import { Button, Notice, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { equalWeightsWithCashRemainder } from './editor-state';
import { useCreateBasketDraft, useStrategyLimits } from './queries';

/**
 * Turns a saved shortlist into a basket draft on the server (B07): equal
 * integer weights per leg with the exact remainder as cash, stated before
 * anything is created. The backend validates and reports; the builder
 * (F07) is where weights change. No order, no wallet, no budget here.
 */
export function BasketFromShortlist({
  thesisId,
  title,
  claim,
  instruments,
}: {
  readonly thesisId: string;
  readonly title: string;
  readonly claim: string;
  readonly instruments: readonly InstrumentReference[];
}) {
  const limits = useStrategyLimits();
  const create = useCreateBasketDraft();
  const [created, setCreated] = useState<StrategyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const legs = instruments.length;
  const maxLegs = limits.data?.maxLegs ?? null;
  const plan = legs > 0 ? equalWeightsWithCashRemainder(legs) : null;
  const tooMany = maxLegs !== null && legs > maxLegs;
  const start = () => {
    if (!plan) {
      return;
    }
    setError(null);
    create.mutate(
      {
        title: title.slice(0, 120),
        thesis: claim.slice(0, 4000),
        thesisId,
        kind: 'stock_spot_basket',
        legs: instruments.map((reference) => ({
          instrumentId: reference.instrumentId,
          weightBps: plan.weightBps,
          note: reference.note,
        })),
        cashWeightBps: plan.cashWeightBps,
        maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
        references: [],
      },
      {
        onSuccess: (detail) => setCreated(detail),
        onError: (failure) =>
          setError(
            failure instanceof WebApiError ? failure.message : 'The draft could not be created.',
          ),
      },
    );
  };
  if (created) {
    const validation = created.draft.validation;
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    return (
      <Notice
        tone={validation.valid ? 'success' : 'attention'}
        title={validation.valid ? 'Basket draft saved' : 'Basket draft saved with problems to fix'}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={`/strategies/new?strategyId=${created.strategy.strategyId}`}>
              Open in Build
            </Link>
          </Button>
        }
      >
        <span data-testid="basket-validation">
          Revision {created.draft.revision}: legs {formatBasisPoints(validation.totals.legsBps)},
          cash {formatBasisPoints(validation.totals.cashBps)}, total{' '}
          {formatBasisPoints(validation.totals.totalBps)}.{' '}
          {errors.length === 0
            ? 'The backend accepted the recipe.'
            : `${errors.length} rule(s) broken: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`}
          {validation.issues
            .filter((issue) => issue.severity === 'warning')
            .map((issue) => ` Warning: ${issue.message}`)
            .join('')}
        </span>
      </Notice>
    );
  }
  return (
    <section
      className="space-y-2 rounded-panel border border-border/60 p-4"
      aria-labelledby="basket-heading"
    >
      <h2 id="basket-heading" className="text-heading-sm font-semibold">
        From shortlist to basket
      </h2>
      {legs === 0 ? (
        <p className="text-supporting text-text-muted">
          Shortlist at least one admitted instrument and save the thesis first.
        </p>
      ) : (
        <>
          <p className="text-supporting">
            Starts a basket draft with {legs} constituent{legs === 1 ? '' : 's'} at{' '}
            <strong>{formatBasisPoints(plan?.weightBps ?? 0)}</strong> each
            {plan && plan.cashWeightBps > 0 ? (
              <>
                {' '}
                and <strong>{formatBasisPoints(plan.cashWeightBps)}</strong> held as cash so the
                total is exactly 100.00%
              </>
            ) : (
              ' and no cash'
            )}
            . Equal weights are a starting point you chose here; every weight is yours to change in
            the builder, and nothing is bought.
          </p>
          {tooMany ? (
            <p className="text-supporting text-error">
              This deployment allows at most {maxLegs} constituents; shorten the shortlist first.
            </p>
          ) : null}
          {limits.error ? (
            <p className="text-caption text-text-muted">
              The recipe rules could not be read; the backend still enforces them.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              loading={create.isPending}
              onClick={start}
              {...(tooMany ? { disabledReason: 'Too many constituents for this deployment.' } : {})}
            >
              Start a basket draft
            </Button>
            <StatusBadge tone="neutral">Draft only · no order</StatusBadge>
          </div>
          {error ? (
            <p role="alert" className="text-supporting text-error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
