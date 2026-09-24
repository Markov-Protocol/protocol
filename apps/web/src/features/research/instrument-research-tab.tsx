'use client';

import type { InstrumentDetail } from '@markov/contracts';
import { formatRelativeAge } from '@markov/formatters';
import { Button, ErrorBlock, Field, Notice, StatusBadge, TextArea, TextInput } from '@markov/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { ISSUER_LABELS } from '../markets/labels';
import { useCreateThesis, useTheses } from './queries';

function StartThesis({ instrument }: { readonly instrument: InstrumentDetail }) {
  const router = useRouter();
  const create = useCreateThesis();
  const [title, setTitle] = useState(
    `${instrument.companyName} through ${ISSUER_LABELS[instrument.issuer]}`,
  );
  const [claim, setClaim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === '' || claim.trim() === '' || /[<>]/.test(title) || /[<>]/.test(claim)) {
      setError('A plain-text title and claim are needed (no < or >).');
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
          instruments: [{ instrumentId: instrument.instrumentId, note: null }],
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
      aria-label={`Start a thesis about ${instrument.companyName}`}
    >
      <h3 className="text-heading-sm font-semibold">
        Start a thesis with {instrument.symbol} shortlisted
      </h3>
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
        description="Your proposition about this exposure, in your words; it stays private until you publish."
        required
      >
        {(control) => (
          <TextArea
            {...control}
            rows={2}
            maxLength={2000}
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
          />
        )}
      </Field>
      <Button type="submit" loading={create.isPending} variant="secondary">
        Create private thesis
      </Button>
    </form>
  );
}

/**
 * Research tab of an instrument: the person's theses that reference this
 * exact instrument, a way to start one, and the evidence rules. Nothing is
 * generated here.
 */
export function InstrumentResearchTab({
  instrument,
  returnTo,
}: {
  readonly instrument: InstrumentDetail;
  readonly returnTo: string;
}) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const theses = useTheses(signedIn, instrument.instrumentId);
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className="text-heading-sm font-semibold">
          Evidence rules for {instrument.symbol}
        </h2>
        <p className="text-supporting">
          The catalog carries the issuer&apos;s sanitised description and the on-chain facts, not
          the issuer&apos;s terms. Claims about backing, rights, fees or redemption must cite the
          issuer&apos;s own terms, a legal document or a filing attached as a source; opinions stay
          labelled as yours and model output as a model interpretation. Research never places an
          order.
        </p>
      </section>
      {signedIn ? (
        <>
          <section className="space-y-2" aria-labelledby="own-theses-heading">
            <h2 id="own-theses-heading" className="text-heading-sm font-semibold">
              Your theses mentioning {instrument.symbol}
            </h2>
            {theses.isPending ? (
              <p className="text-supporting text-text-muted" aria-busy="true">
                Loading…
              </p>
            ) : theses.error ? (
              <ErrorBlock
                title="Your theses could not be read"
                message={
                  theses.error instanceof WebApiError
                    ? theses.error.message
                    : 'Try again in a moment.'
                }
                onRetry={() => void theses.refetch()}
              />
            ) : theses.data.theses.length === 0 ? (
              <p className="text-supporting text-text-muted">None yet.</p>
            ) : (
              <ul
                className="divide-y divide-border/60"
                aria-label={`Theses mentioning ${instrument.symbol}`}
              >
                {theses.data.theses.map((thesis) => (
                  <li key={thesis.thesisId} className="py-2" data-testid="instrument-thesis-row">
                    <Link
                      href={`/research/${thesis.thesisId}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {thesis.title}
                    </Link>{' '}
                    <StatusBadge tone={thesis.visibility === 'public' ? 'info' : 'neutral'}>
                      {thesis.visibility === 'public' ? 'Public' : 'Private'}
                    </StatusBadge>
                    <span className="block text-caption text-text-muted">
                      Revision {thesis.currentRevisionNumber} · updated{' '}
                      {formatRelativeAge(thesis.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {instrument.availability.research ? (
            <StartThesis instrument={instrument} />
          ) : (
            <Notice tone="attention" title="Research is not available for this instrument">
              {instrument.statusReason ?? 'Its status does not allow new research references.'}
            </Notice>
          )}
        </>
      ) : (
        <Notice
          tone="info"
          title="Sign in to research this exposure"
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link href={signInHref(returnTo)}>Sign in</Link>
            </Button>
          }
        >
          Theses, sources and runs belong to your account and stay private until you publish them.
        </Notice>
      )}
    </div>
  );
}
