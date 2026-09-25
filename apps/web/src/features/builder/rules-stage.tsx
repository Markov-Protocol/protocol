'use client';

import { MAINTENANCE_SUGGESTIONS, type StrategyDraftContent } from '@markov/contracts';

type MaintenanceSuggestion = (typeof MAINTENANCE_SUGGESTIONS)[number];

import { formatBasisPoints, formatRawAmount } from '@markov/formatters';
import { Button, Field, Notice, PercentInput, SelectInput, TextArea, TextInput } from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useEffectiveLimits } from './queries';

const SUGGESTION_LABELS: Readonly<Record<MaintenanceSuggestion, string>> = {
  hold: 'Hold: no rebalancing suggested',
  rebalance_on_drift: 'Suggest a rebalance when drift exceeds a threshold',
  review_periodically: 'Suggest a periodic review',
};

const USDC_DECIMALS = 6;

/** Stage 03: the recipe's rules, and the limits and approval preference that bind the person (read from the policy). */
export function RulesStage({
  content,
  onChange,
}: {
  readonly content: StrategyDraftContent;
  readonly onChange: (next: (content: StrategyDraftContent) => StrategyDraftContent) => void;
}) {
  const limits = useEffectiveLimits(true);
  const [reference, setReference] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [driftError, setDriftError] = useState<string | null>(null);
  const addReference = () => {
    const value = reference.trim();
    if (!/^https:\/\/\S+$/.test(value)) {
      setReferenceError('Enter a complete https:// address.');
      return;
    }
    if (content.references.length >= 10) {
      setReferenceError('At most ten references.');
      return;
    }
    setReferenceError(null);
    onChange((current) => ({ ...current, references: [...current.references, value] }));
    setReference('');
  };
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="about-basket-heading">
        <h2 id="about-basket-heading" className="text-heading-sm font-semibold">
          About this basket
        </h2>
        <Field label="Title" id="basket-title" required>
          {(control) => (
            <TextInput
              {...control}
              value={content.title}
              maxLength={120}
              onChange={(event) =>
                onChange((current) => ({ ...current, title: event.target.value }))
              }
            />
          )}
        </Field>
        <Field
          label="Thesis in your words"
          id="basket-thesis"
          description="Why these exposures, in plain text. Linked research stays in the Research stage."
          required
        >
          {(control) => (
            <TextArea
              {...control}
              rows={3}
              maxLength={4000}
              value={content.thesis}
              onChange={(event) =>
                onChange((current) => ({ ...current, thesis: event.target.value }))
              }
            />
          )}
        </Field>
      </section>

      <section className="space-y-3" aria-labelledby="maintenance-heading">
        <h2 id="maintenance-heading" className="text-heading-sm font-semibold">
          Maintenance suggestion
        </h2>
        <p className="text-supporting text-text-muted">
          A suggestion recorded with the recipe, never an instruction: no rebalance happens without
          a separately reviewed plan you approve (F13).
        </p>
        <Field label="Suggestion" id="maintenance-suggestion">
          {(control) => (
            <SelectInput
              id={control.id}
              value={content.maintenance.suggestion}
              onValueChange={(value) =>
                onChange((current) => ({
                  ...current,
                  maintenance: {
                    ...current.maintenance,
                    suggestion: value as MaintenanceSuggestion,
                  },
                }))
              }
              options={MAINTENANCE_SUGGESTIONS.map((value) => ({
                value,
                label: SUGGESTION_LABELS[value],
              }))}
            />
          )}
        </Field>
        {content.maintenance.suggestion === 'rebalance_on_drift' ? (
          <Field
            label="Drift threshold"
            id="drift-threshold"
            description="How far a constituent may drift from its weight before a rebalance is suggested."
            error={driftError}
            className="max-w-xs"
          >
            {(control) => (
              <PercentInput
                {...control}
                valueBps={content.maintenance.driftThresholdBps}
                onValueChange={(change) => {
                  if (change.bps !== null || change.text.trim() === '') {
                    setDriftError(null);
                    onChange((current) => ({
                      ...current,
                      maintenance: { ...current.maintenance, driftThresholdBps: change.bps },
                    }));
                  } else {
                    setDriftError('Enter a percentage with at most two decimals.');
                  }
                }}
              />
            )}
          </Field>
        ) : null}
        {content.maintenance.suggestion === 'review_periodically' ? (
          <Field label="Review every (days)" id="review-days" className="max-w-xs">
            {(control) => (
              <TextInput
                {...control}
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={content.maintenance.reviewEveryDays ?? ''}
                onChange={(event) => {
                  const days = Number.parseInt(event.target.value, 10);
                  onChange((current) => ({
                    ...current,
                    maintenance: {
                      ...current.maintenance,
                      reviewEveryDays:
                        Number.isInteger(days) && days >= 1 && days <= 365 ? days : null,
                    },
                  }));
                }}
              />
            )}
          </Field>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="references-heading">
        <h2 id="references-heading" className="text-heading-sm font-semibold">
          References
        </h2>
        {content.references.length === 0 ? (
          <p className="text-supporting text-text-muted">
            None yet. Stored as text; never fetched from here.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="References">
            {content.references.map((url) => (
              <li
                key={url}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span className="break-all">{url}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      references: current.references.filter((item) => item !== url),
                    }))
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Add a reference (https)"
            id="reference-url"
            error={referenceError}
            className="min-w-64 flex-1"
          >
            {(control) => (
              <TextInput
                {...control}
                type="url"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </Field>
          <Button type="button" variant="secondary" onClick={addReference}>
            Add reference
          </Button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="text-heading-sm font-semibold">
          Your limits and approvals
        </h2>
        <p className="text-supporting text-text-muted">
          Read from the policy that applies to you now: the tightest of the platform defaults, the
          beta caps and anything you tightened. They bind at review and execution, not in this
          recipe.
        </p>
        {limits.data ? (
          <dl
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-supporting"
            data-testid="effective-limits"
          >
            <dt className="text-text-muted">Per order</dt>
            <dd>
              {formatRawAmount(limits.data.effective.maxOrderNotionalUsdcRaw, USDC_DECIMALS)} USDC
            </dd>
            <dt className="text-text-muted">Per day</dt>
            <dd>
              {formatRawAmount(limits.data.effective.maxDailyNotionalUsdcRaw, USDC_DECIMALS)} USDC
            </dd>
            <dt className="text-text-muted">Per account</dt>
            <dd>
              {formatRawAmount(limits.data.effective.maxAccountNotionalUsdcRaw, USDC_DECIMALS)} USDC
            </dd>
            <dt className="text-text-muted">Slippage cap</dt>
            <dd>{formatBasisPoints(limits.data.effective.maxSlippageBps)}</dd>
            <dt className="text-text-muted">Quote age</dt>
            <dd>{limits.data.effective.maxQuoteAgeSeconds} s</dd>
            <dt className="text-text-muted">Cash reserve</dt>
            <dd>{formatBasisPoints(limits.data.effective.cashReserveBps)}</dd>
            <dt className="text-text-muted">Concentration</dt>
            <dd>
              issuer {formatBasisPoints(limits.data.effective.maxIssuerConcentrationBps)} · company{' '}
              {formatBasisPoints(limits.data.effective.maxCompanyConcentrationBps)}
            </dd>
            <dt className="text-text-muted">Venues</dt>
            <dd>{limits.data.effective.allowedVenues.join(', ')}</dd>
            <dt className="text-text-muted">Ceiling from</dt>
            <dd>{limits.data.ceilingSource === 'beta_caps' ? 'beta caps' : 'policy defaults'}</dd>
          </dl>
        ) : limits.error ? (
          <p className="text-supporting text-text-muted">
            Your limits could not be read; the backend still enforces them.
          </p>
        ) : (
          <p className="text-supporting text-text-muted" aria-busy="true">
            Reading your limits…
          </p>
        )}
        <Notice tone="info" title="Approval preference">
          You approve every transaction in your own wallet. No agent, schedule or assistant can
          spend for you; tightening these limits is a settings action with a fresh sign-in (arrives
          with the settings session).{' '}
          <Link href="/settings/eligibility" className="underline underline-offset-2">
            Eligibility and terms
          </Link>
        </Notice>
      </section>
    </div>
  );
}
