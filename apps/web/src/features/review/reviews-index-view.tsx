'use client';

import { formatInstant, formatRawAmount, shortenAddress } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { INTENT_STATE_LABELS } from './plan-model';
import { useIntents } from './queries';

/** The person's reviews, newest first, exactly as the API lists them; a failed read is a failure, never an empty list. */
export function ReviewsIndexView() {
  const intents = useIntents(true);
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Reviews</h1>
        <p className="text-supporting text-text-muted">
          Every investment starts as a review: real quotes for an exact budget, every term shown,
          your approval bound to the plan's hash. Nothing here is a fill or a holding.
        </p>
      </header>
      {intents.data ? (
        intents.data.intents.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description="Start one from a strategy version (Review investment) or an instrument page (Buy)."
            action={
              <Button asChild variant="secondary">
                <Link href="/explore">Explore instruments</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2" aria-label="Your reviews">
            {intents.data.intents.map((intent) => {
              const reading = INTENT_STATE_LABELS[intent.state];
              return (
                <li
                  key={intent.intentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border/60 p-3"
                  data-testid="review-row"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/review/${intent.intentId}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {intent.strategy
                          ? `${intent.strategy.title} · version ${intent.strategy.versionNumber}`
                          : 'Single buy'}
                      </Link>
                      <StatusBadge tone={reading.tone}>{reading.label}</StatusBadge>
                    </p>
                    <p className="text-caption text-text-muted">
                      {formatRawAmount(intent.budget.rawAmount, intent.budget.decimals)}{' '}
                      {intent.budget.symbol} from {shortenAddress(intent.wallet.address)} · started{' '}
                      {formatInstant(intent.createdAt)} UTC
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/review/${intent.intentId}`}>Open</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )
      ) : intents.error ? (
        <ErrorBlock
          title="Your reviews could not be read"
          message="This is a service failure, not an empty list."
          onRetry={() => void intents.refetch()}
        />
      ) : (
        <SkeletonText lines={3} />
      )}
    </div>
  );
}
