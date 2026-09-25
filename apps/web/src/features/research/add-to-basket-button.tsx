'use client';

import type { InstrumentDetail, StrategyDetail } from '@markov/contracts';
import { Button } from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useCreateBasketDraft } from './queries';

/**
 * "Add to basket" from an instrument page: starts a basket draft on the
 * server with this one constituent at 100.00% and no cash, stated up
 * front. Weights change in the builder; nothing is bought.
 */
export function AddToBasketButton({ instrument }: { readonly instrument: InstrumentDetail }) {
  const create = useCreateBasketDraft();
  const [created, setCreated] = useState<StrategyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (created) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-caption">
        <span role="status">Basket draft saved (revision {created.draft.revision}).</span>
        <Link
          href={`/strategies/${created.strategy.strategyId}/edit`}
          className="underline underline-offset-2"
        >
          Open in Build
        </Link>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={create.isPending}
        onClick={() => {
          setError(null);
          create.mutate(
            {
              title: `${instrument.symbol} basket`,
              thesis: `Started from the ${instrument.symbol} page: ${instrument.companyName} exposure.`,
              thesisId: null,
              kind: 'stock_spot_basket',
              legs: [{ instrumentId: instrument.instrumentId, weightBps: 10_000, note: null }],
              cashWeightBps: 0,
              maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
              references: [],
            },
            {
              onSuccess: (detail) => setCreated(detail),
              onError: (failure) =>
                setError(
                  failure instanceof WebApiError
                    ? failure.message
                    : 'The draft could not be created.',
                ),
            },
          );
        }}
      >
        Add to a new basket draft
      </Button>
      <span className="text-caption text-text-muted">
        Starts a draft with {instrument.symbol} at 100.00%; you set the weights in Build.
      </span>
      {error ? (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
