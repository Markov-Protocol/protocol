'use client';

import { idSchema } from '@markov/contracts';
import { formatRelativeAge } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Notice,
  Skeleton,
  SkeletonText,
  StatusBadge,
  TextArea,
  TextInput,
} from '@markov/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useBasketDrafts, useCreateBasketDraft } from '../research/queries';

/**
 * `/strategies/new`: a static path, never a strategy id. Starts a basket
 * draft on the server or resumes one; `?strategyId=` (older links) opens the
 * editor directly.
 */
export function NewBasketView() {
  const params = useSearchParams();
  const router = useRouter();
  const resume = params.get('strategyId');
  useEffect(() => {
    if (resume && idSchema.safeParse(resume).success) {
      router.replace(`/strategies/${resume}/edit`);
    }
  }, [resume, router]);
  const drafts = useBasketDrafts(true);
  const create = useCreateBasketDraft();
  const [title, setTitle] = useState('');
  const [thesis, setThesis] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === '' || thesis.trim() === '' || /[<>]/.test(title) || /[<>]/.test(thesis)) {
      setError('A plain-text title and thesis are needed (no < or >).');
      return;
    }
    setError(null);
    create.mutate(
      {
        title: title.trim(),
        thesis: thesis.trim(),
        thesisId: null,
        kind: 'stock_spot_basket',
        legs: [],
        cashWeightBps: 0,
        maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
        references: [],
      },
      {
        onSuccess: (detail) =>
          router.push(`/strategies/${detail.strategy.strategyId}/edit?stage=assemble`),
        onError: (failure) =>
          setError(
            failure instanceof WebApiError ? failure.message : 'The draft could not be created.',
          ),
      },
    );
  };
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Build a strategy</h1>
        <p className="text-body text-text-muted">
          A basket is an exact recipe of admitted tokenised stocks plus cash, in integer basis
          points, saved and validated by the backend as you edit. Building one buys nothing.
        </p>
      </header>
      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-panel border border-border/60 p-4"
        aria-label="Start a basket"
      >
        <h2 className="text-heading-sm font-semibold">Start a basket</h2>
        <Field label="Title" id="new-basket-title" error={error} required>
          {(control) => (
            <TextInput
              {...control}
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Thesis in your words"
          id="new-basket-thesis"
          description="You can link a researched thesis in the first stage."
          required
        >
          {(control) => (
            <TextArea
              {...control}
              rows={2}
              maxLength={4000}
              value={thesis}
              onChange={(event) => setThesis(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" loading={create.isPending}>
          Create draft
        </Button>
      </form>
      <section className="space-y-3" aria-labelledby="drafts-heading">
        <h2 id="drafts-heading" className="text-heading-sm font-semibold">
          Resume a draft
        </h2>
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
            title="No draft yet"
            description="Start one above, from a thesis shortlist, or from an instrument page."
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="Basket drafts">
            {drafts.data.strategies.map((strategy) => (
              <li
                key={strategy.strategyId}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
                data-testid="basket-draft-row"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/strategies/${strategy.strategyId}/edit`}
                      className="truncate font-medium underline underline-offset-2"
                    >
                      {strategy.title}
                    </Link>
                    <StatusBadge tone={strategy.status === 'active' ? 'neutral' : 'attention'}>
                      {strategy.status === 'active' ? 'Draft' : 'Archived'}
                    </StatusBadge>
                    {strategy.currentVersion ? (
                      <StatusBadge tone="info">
                        Version {strategy.currentVersion.versionNumber} frozen
                      </StatusBadge>
                    ) : null}
                  </p>
                  <p className="text-caption text-text-muted">
                    Draft revision {strategy.draftRevision} · updated{' '}
                    {formatRelativeAge(strategy.updatedAt)}
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/strategies/${strategy.strategyId}/edit`}>Resume</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Notice tone="info" title="Versions, publishing and forks">
        Freezing an immutable version, publishing it and forking arrive with F08; review and
        execution with F09 and F10. Until then a draft is a saved, validated recipe and nothing
        more.
      </Notice>
    </section>
  );
}
