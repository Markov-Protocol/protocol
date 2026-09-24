'use client';

import type { ResearchRun, SourceRecord, ThesisStatement } from '@markov/contracts';
import { formatInstant, formatRelativeAge } from '@markov/formatters';
import { Button, Field, Notice, StatusBadge, type StatusTone, TextArea } from '@markov/ui';
import { type FormEvent, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useInstrument } from '../markets/queries';
import { isRunFinished, useCancelRun, useCreateRun, useRun, useRuns } from './queries';

const RUN_TONE: Readonly<Record<ResearchRun['status'], StatusTone>> = {
  queued: 'pending',
  running: 'pending',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

function SuggestedInstrument({
  instrumentId,
  inShortlist,
  onAdd,
}: {
  readonly instrumentId: string;
  readonly inShortlist: boolean;
  readonly onAdd: (instrumentId: string) => void;
}) {
  const instrument = useInstrument(instrumentId);
  const label = instrument.data
    ? `${instrument.data.symbol} · ${instrument.data.companyName}`
    : instrument.error
      ? `${instrumentId} (no longer listed publicly)`
      : instrumentId;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-mono text-caption">{label}</span>
      {inShortlist ? (
        <StatusBadge tone="success">In shortlist</StatusBadge>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => onAdd(instrumentId)}>
          Add to shortlist
        </Button>
      )}
    </li>
  );
}

function RunResult({
  run,
  shortlist,
  onAdopt,
  onAddInstrument,
  onAddSubject,
  canEdit,
}: {
  readonly run: ResearchRun;
  readonly shortlist: ReadonlySet<string>;
  readonly onAdopt: (statements: readonly ThesisStatement[]) => void;
  readonly onAddInstrument: (instrumentId: string) => void;
  readonly onAddSubject: (name: string) => void;
  readonly canEdit: boolean;
}) {
  const output = run.output;
  if (run.status === 'failed') {
    return (
      <Notice tone="error" title="The run failed">
        {run.error ?? 'No reason was recorded.'} Nothing was added to the thesis.
      </Notice>
    );
  }
  if (run.status === 'cancelled') {
    return (
      <Notice tone="info" title="Cancelled">
        The run was cancelled; any partial result was dropped.
      </Notice>
    );
  }
  if (!output) {
    return null;
  }
  return (
    <div className="space-y-3" data-testid="run-output">
      <div className="space-y-2">
        <h4 className="text-supporting font-semibold">
          Draft interpretations{' '}
          <StatusBadge tone="attention">Model interpretation, not an issuer fact</StatusBadge>
        </h4>
        {output.draft.length === 0 ? (
          <p className="text-caption text-text-muted">The run produced no statements.</p>
        ) : (
          <ul className="space-y-1.5">
            {output.draft.map((statement) => (
              <li
                key={statement.statementId}
                className="rounded-panel bg-surface-raised p-2 text-supporting"
              >
                {statement.text}
                <span className="block text-caption text-text-muted">
                  Cites {statement.sourceIds.length} source(s) · bound to this run
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && output.draft.length > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => onAdopt(output.draft)}>
            Add these to the thesis as model interpretations
          </Button>
        ) : null}
      </div>
      {output.suggestedInstrumentIds.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-supporting font-semibold">Suggested admitted instruments</h4>
          <p className="text-caption text-text-muted">
            Only instruments the catalog admitted can be suggested; you confirm each one.
          </p>
          <ul className="space-y-1">
            {output.suggestedInstrumentIds.map((id) => (
              <SuggestedInstrument
                key={id}
                instrumentId={id}
                inShortlist={shortlist.has(id)}
                onAdd={canEdit ? onAddInstrument : () => undefined}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {output.unmatchedCompanies.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-supporting font-semibold">Companies the catalog does not carry</h4>
          <ul className="space-y-1">
            {output.unmatchedCompanies.map((name) => (
              <li
                key={name}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span>{name}</span>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onAddSubject(name)}
                  >
                    Add as research subject
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {output.rejected.length > 0 ? (
        <p className="text-caption text-text-muted">
          Dropped by validation: {output.rejected.join('; ')}
        </p>
      ) : null}
      {run.provenance ? (
        <p className="break-all text-caption text-text-muted" data-testid="run-provenance">
          {run.provenance.provider} / {run.provenance.model} {run.provenance.modelVersion} · prompt
          SHA-256 {run.provenance.promptHash.slice(0, 16)}… · {run.provenance.budgetUsed.statements}{' '}
          statements, {run.provenance.budgetUsed.outputChars} characters · tools:{' '}
          {run.provenance.toolCalls.length === 0 ? 'none' : run.provenance.toolCalls.length}
        </p>
      ) : null}
    </div>
  );
}

function ActiveRun({
  runId,
  thesisId,
  ...rest
}: {
  readonly runId: string;
  readonly thesisId: string;
  readonly shortlist: ReadonlySet<string>;
  readonly onAdopt: (statements: readonly ThesisStatement[]) => void;
  readonly onAddInstrument: (instrumentId: string) => void;
  readonly onAddSubject: (name: string) => void;
  readonly canEdit: boolean;
}) {
  const run = useRun(runId);
  const cancel = useCancelRun(thesisId);
  if (run.isPending) {
    return (
      <p role="status" aria-busy="true" className="text-supporting text-text-muted">
        Reading the run…
      </p>
    );
  }
  if (run.error) {
    return (
      <Notice tone="error" title="The run could not be read">
        {run.error instanceof WebApiError ? run.error.message : 'Try again.'}
      </Notice>
    );
  }
  const current = run.data;
  const finished = isRunFinished(current);
  return (
    <div className="space-y-3 rounded-panel border border-border/60 p-3" data-testid="active-run">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-supporting">
          <StatusBadge tone={RUN_TONE[current.status]}>{current.status}</StatusBadge>{' '}
          <span className="text-text-muted">
            started {formatRelativeAge(current.startedAt ?? current.createdAt)}
            {current.finishedAt ? `, finished ${formatInstant(current.finishedAt)}` : ''}
          </span>
        </p>
        {!finished ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            loading={cancel.isPending}
            onClick={() => cancel.mutate(current.runId)}
          >
            Cancel run
          </Button>
        ) : null}
      </div>
      <p className="text-supporting">
        <span className="text-text-muted">Question:</span> {current.question}
      </p>
      {!finished ? (
        <p role="status" aria-live="polite" className="text-caption text-text-muted">
          Working within a budget of {current.budget.maxStatements} statements and{' '}
          {current.budget.maxOutputChars} characters; the result is validated before you see it.
        </p>
      ) : (
        <RunResult run={current} {...rest} />
      )}
    </div>
  );
}

export function RunsPanel({
  thesisId,
  sources,
  shortlist,
  canEdit,
  onAdopt,
  onAddInstrument,
  onAddSubject,
}: {
  readonly thesisId: string;
  readonly sources: readonly SourceRecord[];
  readonly shortlist: ReadonlySet<string>;
  readonly canEdit: boolean;
  readonly onAdopt: (statements: readonly ThesisStatement[]) => void;
  readonly onAddInstrument: (instrumentId: string) => void;
  readonly onAddSubject: (name: string) => void;
}) {
  const runs = useRuns(thesisId, true);
  const create = useCreateRun(thesisId);
  const [question, setQuestion] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const fetched = sources.filter((source) => source.status === 'fetched');
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim().length < 3) {
      setError('Ask a question of at least three characters.');
      return;
    }
    setError(null);
    create.mutate(
      {
        thesisId,
        question: question.trim(),
        sourceIds: [...selected],
        budget: { maxOutputChars: 4000, maxStatements: 8 },
      },
      {
        onSuccess: (run) => setActiveRunId(run.runId),
        onError: (failure) => {
          if (failure instanceof WebApiError && failure.code === 'PROVIDER_UNAVAILABLE') {
            setUnavailable(true);
            return;
          }
          setError(
            failure instanceof WebApiError
              ? failure.code === 'RATE_LIMITED'
                ? 'Too many runs in a minute; wait a moment.'
                : failure.message
              : 'The run could not be started.',
          );
        },
      },
    );
  };
  const resultProps = { shortlist, onAdopt, onAddInstrument, onAddSubject, canEdit };
  return (
    <section className="space-y-4" aria-labelledby="runs-heading">
      <h2 id="runs-heading" className="text-heading-sm font-semibold">
        Bounded research runs
      </h2>
      <p className="text-supporting text-text-muted">
        A run reads only the fetched sources you tick, answers within a fixed budget and is
        validated before anything reaches you: its statements are labelled model interpretations, it
        can only suggest instruments the catalog admitted, and it cannot set weights, trade or
        publish. You decide what enters the thesis.
      </p>
      {unavailable ? (
        <Notice tone="attention" title="Runs are not available in this deployment">
          No model provider is configured, so bounded runs answer &quot;unavailable&quot;. Manual
          research (sources, statements, shortlist) works without one.
        </Notice>
      ) : canEdit ? (
        <form onSubmit={onSubmit} className="space-y-3" aria-label="Start a research run">
          <Field label="Question" error={error} required>
            {(control) => (
              <TextArea
                {...control}
                rows={2}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={1000}
                placeholder="What do the sources say about the rights this token carries?"
              />
            )}
          </Field>
          <fieldset className="space-y-1">
            <legend className="text-supporting font-medium">Sources the run may read</legend>
            {fetched.length === 0 ? (
              <p className="text-caption text-text-muted">
                No fetched source yet; a run without sources can only say that nothing can be
                inferred.
              </p>
            ) : (
              fetched.map((source) => (
                <label key={source.sourceId} className="flex items-start gap-2 text-supporting">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(source.sourceId)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, source.sourceId]
                          : current.filter((id) => id !== source.sourceId),
                      )
                    }
                  />
                  <span>{source.title ?? source.finalUrl ?? source.url}</span>
                </label>
              ))
            )}
          </fieldset>
          <Button type="submit" loading={create.isPending} variant="secondary">
            Start run
          </Button>
        </form>
      ) : null}
      {activeRunId ? <ActiveRun runId={activeRunId} thesisId={thesisId} {...resultProps} /> : null}
      {runs.data && runs.data.runs.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-supporting font-semibold">Previous runs</h3>
          <ul className="space-y-1" aria-label="Previous runs">
            {runs.data.runs
              .filter((run) => run.runId !== activeRunId)
              .map((run) => (
                <li
                  key={run.runId}
                  className="flex flex-wrap items-center justify-between gap-2 text-supporting"
                >
                  <span>
                    <StatusBadge tone={RUN_TONE[run.status]}>{run.status}</StatusBadge>{' '}
                    {run.question}{' '}
                    <span className="text-text-muted">· {formatRelativeAge(run.createdAt)}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveRunId(run.runId)}
                  >
                    Open
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
