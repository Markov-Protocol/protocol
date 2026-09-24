'use client';

import { formatRelativeAge } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  Skeleton,
  SkeletonText,
  StatusBadge,
} from '@markov/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { WebApiError } from '../api/use-markov-api';
import { useBasketDrafts } from './queries';

/**
 * The Build page until F07 delivers the editor: the person's basket drafts
 * as the backend holds them (B07). Nothing here weighs, activates or
 * orders; the draft just created from a thesis is highlighted.
 */
export function BasketDraftsView() {
  const params = useSearchParams();
  const highlighted = params.get('strategyId');
  const drafts = useBasketDrafts(true);
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Build a strategy</h1>
        <p className="text-body text-text-muted">
          Your basket drafts are saved and validated by the backend. The editor for weights, rules
          and activation arrives with frontend session F07; until then drafts start from a thesis
          shortlist or an instrument page.
        </p>
      </header>
      <Notice tone="info" title="Drafts only">
        A draft holds nothing and orders nothing. Weights are integer basis points chosen by you;
        nothing is normalised for you.
      </Notice>
      {drafts.isPending ? (
        <div aria-busy="true" className="space-y-2">
          <Skeleton className="h-6 w-1/2" />
          <SkeletonText lines={3} />
        </div>
      ) : drafts.error ? (
        <ErrorBlock
          title="Your drafts could not be read"
          message={
            drafts.error instanceof WebApiError ? drafts.error.message : 'Try again in a moment.'
          }
          onRetry={() => void drafts.refetch()}
        />
      ) : drafts.data.strategies.length === 0 ? (
        <EmptyState
          title="No basket draft yet"
          description="Start one from a thesis shortlist on /research or from an instrument's page."
          action={
            <Button asChild variant="secondary">
              <Link href="/research">Go to research</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/60" aria-label="Basket drafts">
          {drafts.data.strategies.map((strategy) => (
            <li
              key={strategy.strategyId}
              className={`space-y-1 py-3 ${strategy.strategyId === highlighted ? 'rounded-panel bg-surface-raised px-3' : ''}`}
              data-testid="basket-draft-row"
              aria-current={strategy.strategyId === highlighted ? 'true' : undefined}
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{strategy.title}</span>
                <StatusBadge tone={strategy.status === 'active' ? 'neutral' : 'attention'}>
                  {strategy.status === 'active' ? 'Draft' : 'Archived'}
                </StatusBadge>
                {strategy.currentVersion ? (
                  <StatusBadge tone="info">
                    Version {strategy.currentVersion.versionNumber} frozen
                  </StatusBadge>
                ) : null}
                {strategy.strategyId === highlighted ? (
                  <StatusBadge tone="success">Just created</StatusBadge>
                ) : null}
              </p>
              <p className="text-caption text-text-muted">
                Draft revision {strategy.draftRevision} · updated{' '}
                {formatRelativeAge(strategy.updatedAt)} ·{' '}
                <span className="font-mono">{strategy.strategyId}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
