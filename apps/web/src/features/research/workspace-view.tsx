'use client';

import { formatRelativeAge } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  Skeleton,
  SkeletonText,
  StatusBadge,
  TextArea,
  TextInput,
} from '@markov/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useCreateThesis, useTheses } from './queries';

function NewThesisForm() {
  const router = useRouter();
  const create = useCreateThesis();
  const [title, setTitle] = useState('');
  const [claim, setClaim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === '' || claim.trim() === '') {
      setError('A title and a claim are needed to start.');
      return;
    }
    if (/[<>]/.test(title) || /[<>]/.test(claim)) {
      setError('Markup (< or >) is not allowed; write plain text.');
      return;
    }
    setError(null);
    create.mutate(
      {
        visibility: 'private',
        revision: {
          title: title.trim(),
          claim: claim.trim(),
          statements: [],
          counterarguments: [],
          instruments: [],
          subjects: [],
          privateNotes: null,
        },
      },
      {
        onSuccess: (detail) => router.push(`/research/${detail.thesis.thesisId}`),
        onError: (failure) =>
          setError(
            failure instanceof WebApiError ? failure.message : 'The thesis could not be created.',
          ),
      },
    );
  };
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-panel border border-border/60 p-4"
      aria-label="Start a thesis"
    >
      <h2 className="text-heading-sm font-semibold">Start a thesis</h2>
      <Field label="Title" error={error} required>
        {(control) => (
          <TextInput
            {...control}
            value={title}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Claim"
        description="What you want to establish or refute, in plain text. Private until you publish it."
        required
      >
        {(control) => (
          <TextArea
            {...control}
            rows={3}
            maxLength={2000}
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" loading={create.isPending}>
        Create private thesis
      </Button>
    </form>
  );
}

export function WorkspaceView() {
  const theses = useTheses(true);
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Research</h1>
        <p className="text-body text-text-muted">
          Sourced theses about admitted exposures: typed statements with citations, a shortlist by
          canonical id and bounded research runs. Private until you publish; never advice, never an
          order.
        </p>
      </header>
      <NewThesisForm />
      <section className="space-y-3" aria-labelledby="theses-heading">
        <h2 id="theses-heading" className="text-heading-sm font-semibold">
          Your theses
        </h2>
        {theses.isPending ? (
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <SkeletonText lines={3} />
          </div>
        ) : theses.error ? (
          <ErrorBlock
            title="Your theses could not be read"
            message={
              theses.error instanceof WebApiError ? theses.error.message : 'Try again in a moment.'
            }
            onRetry={() => void theses.refetch()}
          />
        ) : theses.data.theses.length === 0 ? (
          <EmptyState
            title="No thesis yet"
            description="Start one above, or open an instrument and start a thesis from its Research tab."
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="Theses">
            {theses.data.theses.map((thesis) => (
              <li key={thesis.thesisId} className="space-y-1 py-3" data-testid="thesis-row">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/research/${thesis.thesisId}`}
                    className="font-medium underline underline-offset-2"
                  >
                    {thesis.title}
                  </Link>
                  <StatusBadge tone={thesis.visibility === 'public' ? 'info' : 'neutral'}>
                    {thesis.visibility === 'public' ? 'Public' : 'Private'}
                  </StatusBadge>
                  {thesis.status === 'archived' ? (
                    <StatusBadge tone="attention">Archived</StatusBadge>
                  ) : null}
                </p>
                <p className="text-supporting text-text-muted">{thesis.claim}</p>
                <p className="text-caption text-text-muted">
                  Revision {thesis.currentRevisionNumber} · {thesis.instrumentIds.length}{' '}
                  instrument(s) · updated {formatRelativeAge(thesis.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
