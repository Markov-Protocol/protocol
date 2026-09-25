'use client';

import type { Intent } from '@markov/contracts';
import { formatInstant, formatRawAmount, shortenAddress } from '@markov/formatters';
import { Button, EmptyState, ErrorBlock, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { WebApiError } from '../api/use-markov-api';
import { INTENT_STATE_LABELS } from '../review/plan-model';
import { useIntent, usePlan } from '../review/queries';
import { ExecutionPanel } from './execution-panel';

function kindLabel(intent: Intent): string {
  if (intent.strategy) {
    return `${intent.strategy.title} · version ${intent.strategy.versionNumber}`;
  }
  return intent.kind === 'single_sell' ? 'Single sell' : 'Single buy';
}

/**
 * `/activity/[intentId]`: the restorable execution status and leg timeline
 * of one intent. Everything on it is server state; a reload, another tab or
 * a closed wallet popup all come back to the same record.
 */
export function ExecutionView({ intentId }: { readonly intentId: string }) {
  const intentQuery = useIntent(intentId, true);
  const intent = intentQuery.data ?? null;
  const planQuery = usePlan(intentId, intent?.latestPlanId ?? null, intent !== null);
  if (intentQuery.error instanceof WebApiError && intentQuery.error.status === 404) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState
          title="Not found"
          description="There is no activity with this id in your account."
          action={
            <Button asChild variant="secondary">
              <Link href="/activity">Back to activity</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (intentQuery.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The activity could not be read"
          message={intentQuery.error.message}
          onRetry={() => void intentQuery.refetch()}
        />
      </div>
    );
  }
  if (intent === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <SkeletonText lines={4} />
      </div>
    );
  }
  const reading = INTENT_STATE_LABELS[intent.state];
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6" data-testid="execution-view">
      <header className="space-y-2">
        <p className="text-caption text-text-muted">
          <Link href="/activity" className="underline underline-offset-2">
            Activity
          </Link>{' '}
          · {formatInstant(intent.createdAt)} UTC
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-heading-lg font-semibold">
          {kindLabel(intent)}
          <StatusBadge tone={reading.tone}>{reading.label}</StatusBadge>
        </h1>
        <p className="text-supporting text-text-muted">
          {formatRawAmount(intent.budget.rawAmount, intent.budget.decimals)} {intent.budget.symbol}{' '}
          from {shortenAddress(intent.wallet.address)} · slippage limit {intent.slippageBps / 100}%
          {intent.continuation ? ' · reviewed completion of an earlier basket' : ''}
          {intent.continuedByIntentId ? (
            <>
              {' '}
              · continued by{' '}
              <Link
                href={`/activity/${intent.continuedByIntentId}`}
                className="underline underline-offset-2"
              >
                a later intent
              </Link>
            </>
          ) : null}
        </p>
      </header>
      {intent.latestPlanId === null ? (
        <EmptyState
          title="No plan yet"
          description="This intent has no plan; execution starts from an approved plan on the review."
          action={
            <Button asChild variant="secondary">
              <Link href={`/review/${intent.intentId}`}>Open the review</Link>
            </Button>
          }
        />
      ) : (
        <ExecutionPanel
          intent={intent}
          plan={planQuery.data ?? null}
          approvedPlanHash={planQuery.data?.review.acknowledgedHash ?? null}
          variant="activity"
        />
      )}
    </div>
  );
}
