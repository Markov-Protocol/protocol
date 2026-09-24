'use client';

import type { TermsDocument } from '@markov/contracts';
import { formatInstant } from '@markov/formatters';
import {
  Button,
  ErrorBlock,
  Field,
  Notice,
  Skeleton,
  StatusBadge,
  type StatusTone,
  TextInput,
} from '@markov/ui';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import {
  useAcknowledgeTerms,
  useCurrentTerms,
  useDeclareJurisdiction,
  useEligibility,
} from '../wallets/queries';

const outcomeTone: Record<'eligible' | 'ineligible' | 'unknown', StatusTone> = {
  eligible: 'success',
  ineligible: 'error',
  unknown: 'attention',
};

function DeclarationForm({ current }: { readonly current: string | null }) {
  const declare = useDeclareJurisdiction();
  const [code, setCode] = useState(current ?? '');
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[A-Z]{2}$/.test(code);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !attested) {
      setError(
        !valid
          ? 'Enter the two-letter ISO code of the country you live in.'
          : 'Confirm the declaration is truthful.',
      );
      return;
    }
    setError(null);
    declare.mutate(code, {
      onError: (failure) =>
        setError(
          failure instanceof WebApiError
            ? failure.message
            : 'The declaration could not be recorded.',
        ),
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Declare your jurisdiction">
      <Field
        label="Country of residence (ISO 3166-1 alpha-2)"
        description="Self-declared. Markov records it as your own statement; it is not a residency check."
        error={error}
        required
      >
        {(control) => (
          <TextInput
            {...control}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
            autoCapitalize="characters"
            className="max-w-24 uppercase"
            placeholder="ZZ"
          />
        )}
      </Field>
      <label className="flex items-start gap-2 text-supporting">
        <input
          type="checkbox"
          checked={attested}
          onChange={(event) => setAttested(event.target.checked)}
          className="mt-1"
        />
        <span>I confirm this is where I live. A false declaration can make any decision void.</span>
      </label>
      <Button type="submit" loading={declare.isPending}>
        Record declaration
      </Button>
    </form>
  );
}

function TermsRow({
  document,
  acknowledged,
}: {
  readonly document: TermsDocument;
  readonly acknowledged: boolean;
}) {
  const acknowledge = useAcknowledgeTerms();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="space-y-2 rounded-panel border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {document.title}{' '}
            <span className="text-text-muted">· version {document.termsVersion}</span>
          </p>
          <p className="text-caption text-text-muted">
            Published {formatInstant(document.publishedAt)} ·{' '}
            <a
              href={document.url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Read the full text
            </a>
          </p>
          <p className="break-all font-mono text-caption text-text-muted">
            SHA-256 {document.contentHash}
          </p>
        </div>
        {acknowledged ? (
          <StatusBadge tone="success">Acknowledged</StatusBadge>
        ) : (
          <Button
            size="sm"
            loading={acknowledge.isPending}
            onClick={() =>
              acknowledge.mutate(
                { termsVersion: document.termsVersion, contentHash: document.contentHash },
                {
                  onError: (failure) =>
                    setError(
                      failure instanceof WebApiError
                        ? failure.message
                        : 'Could not record the acknowledgement.',
                    ),
                },
              )
            }
          >
            I have read and acknowledge this version
          </Button>
        )}
      </div>
      {error ? (
        <Notice tone="error" title="Acknowledgement failed" live="assertive">
          {error}
        </Notice>
      ) : null}
    </li>
  );
}

/**
 * Eligibility and terms: what Markov currently knows, why trading is
 * available or blocked, and the exact steps left. Unknown is shown as
 * unknown; nothing here suggests switching jurisdiction to get around a
 * decision.
 */
export function EligibilityView() {
  const { state } = useSession();
  const eligibility = useEligibility(state.status === 'signed-in');
  const terms = useCurrentTerms();
  if (eligibility.isPending) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading eligibility"
        className="mx-auto max-w-3xl space-y-3 px-4 py-8"
      >
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </section>
    );
  }
  if (eligibility.isError) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-8">
        <ErrorBlock
          title="Eligibility could not be loaded"
          message={eligibility.error.message}
          onRetry={() => void eligibility.refetch()}
        />
      </section>
    );
  }
  const data = eligibility.data;
  const acknowledgedVersions = new Set(data.terms.acknowledged.map((ack) => ack.termsVersion));
  const documents = data.terms.required.length > 0 ? data.terms.required : (terms.data ?? []);
  return (
    <section className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Eligibility and terms</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={outcomeTone[data.outcome]} data-testid="eligibility-outcome">
            {data.outcome === 'eligible'
              ? 'Eligible'
              : data.outcome === 'ineligible'
                ? 'Not eligible'
                : 'Unknown'}
          </StatusBadge>
          <StatusBadge tone={data.terms.complete ? 'success' : 'attention'}>
            {data.terms.complete ? 'Terms acknowledged' : 'Terms pending'}
          </StatusBadge>
          {data.policyVersion ? (
            <StatusBadge tone="neutral">Policy {data.policyVersion}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">No policy published</StatusBadge>
          )}
        </div>
        <p className="text-body text-text-muted" data-testid="eligibility-summary">
          {data.summary}
        </p>
      </header>

      {data.decision ? (
        <dl
          className="grid gap-2 rounded-panel border border-border/60 p-3 text-supporting sm:grid-cols-2"
          aria-label="Latest decision"
        >
          <div>
            <dt className="text-text-muted">Declared jurisdiction</dt>
            <dd className="font-medium">{data.decision.jurisdiction}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Decision</dt>
            <dd className="font-medium">
              {data.decision.outcome} under policy {data.decision.policyVersion ?? 'none'}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Decided</dt>
            <dd>{formatInstant(data.decision.decidedAt)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Valid until</dt>
            <dd>
              {data.decision.revokedAt
                ? `revoked ${formatInstant(data.decision.revokedAt)}`
                : formatInstant(data.decision.expiresAt)}
            </dd>
          </div>
          {data.decision.reasons.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Reasons</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {data.decision.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {data.decision.issuers.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Covered issuers</dt>
              <dd>{data.decision.issuers.join(', ')}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section aria-labelledby="steps-heading" className="space-y-3">
        <h2 id="steps-heading" className="text-heading-sm font-semibold">
          {data.steps.length === 0 ? 'Nothing left to do here' : 'What is left'}
        </h2>
        {data.steps.length === 0 ? (
          <p className="text-supporting text-text-muted">
            Eligibility and terms are complete. Trading itself still depends on a verified wallet,
            funding and the platform's execution state.
          </p>
        ) : null}
        <ol className="space-y-4">
          {data.steps.map((step) => (
            <li key={step} className="space-y-2" data-testid={`step-${step}`}>
              {step === 'declare_jurisdiction' ? (
                <>
                  <p className="font-medium">Declare where you live</p>
                  <DeclarationForm current={data.decision?.jurisdiction ?? null} />
                </>
              ) : null}
              {step === 'await_review' ? (
                <>
                  <p className="font-medium">Waiting on Markov</p>
                  <p className="text-supporting text-text-muted">
                    {data.policyVersion === null
                      ? 'No eligibility rules have been published yet, so no decision can be made. There is nothing for you to do; Markov will not guess.'
                      : 'Your declaration needs a review or stronger evidence before a decision. Markov will not switch this to eligible on its own.'}
                  </p>
                </>
              ) : null}
              {step === 'acknowledge_terms' ? (
                <>
                  <p className="font-medium">Read and acknowledge the current terms</p>
                  {documents.length === 0 ? (
                    <p className="text-supporting text-text-muted">
                      No terms document is published yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {documents.map((document) => (
                        <TermsRow
                          key={document.termsVersion}
                          document={document}
                          acknowledged={acknowledgedVersions.has(document.termsVersion)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
              {step === 'verify_wallet' ? (
                <>
                  <p className="font-medium">Verify a wallet</p>
                  <p className="text-supporting text-text-muted">
                    Funding and signing need a wallet you have proven to own.{' '}
                    <Link href="/settings/wallets" className="underline underline-offset-2">
                      Go to Wallets
                    </Link>
                  </p>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {data.steps.includes('declare_jurisdiction') ? null : (
        <details
          className="rounded-panel border border-border/60 p-3"
          data-testid="update-declaration"
        >
          <summary className="cursor-pointer font-medium">Update your declaration</summary>
          <p className="mt-2 text-supporting text-text-muted">
            Only if where you live has changed. A new declaration records a new decision under the
            active policy; it never overrides a denial for the same jurisdiction.
          </p>
          <div className="mt-3">
            <DeclarationForm current={data.decision?.jurisdiction ?? null} />
          </div>
        </details>
      )}

      {data.outcome === 'ineligible' ? (
        <Notice tone="info" title="What this means">
          Markov applies the published rules for your declared jurisdiction as they stand. Declaring
          another country to get around this is not allowed and would make the decision void.
        </Notice>
      ) : null}
      {data.outcome === 'eligible' && data.steps.length === 0 && data.terms.complete ? (
        <section aria-labelledby="terms-heading" className="space-y-2">
          <h2 id="terms-heading" className="text-heading-sm font-semibold">
            Acknowledged terms
          </h2>
          <ul className="space-y-2">
            {data.terms.required.map((document) => (
              <TermsRow
                key={document.termsVersion}
                document={document}
                acknowledged={acknowledgedVersions.has(document.termsVersion)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
