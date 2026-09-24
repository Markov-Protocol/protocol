'use client';

import {
  EVIDENCE_TOPICS,
  type EvidenceTopic,
  STATEMENT_KINDS,
  type StatementKind,
  type ThesisDetail,
  type ThesisRevision,
  type ThesisStatement,
} from '@markov/contracts';
import { formatInstant, formatRelativeAge } from '@markov/formatters';
import {
  Button,
  Field,
  Notice,
  SelectInput,
  StatusBadge,
  TextArea,
  TextInput,
  ValidationSummary,
} from '@markov/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { BasketFromShortlist } from './basket-from-shortlist';
import {
  checkForm,
  type EditorForm,
  EVIDENCE_REQUIRED_TOPICS,
  type FormIssue,
  formFromRevision,
  isDirty,
  issuesFromApiDetails,
  newStatementId,
  revisionInputFromForm,
  STATEMENT_KIND_HELP,
  STATEMENT_KIND_LABELS,
  TOPIC_LABELS,
} from './editor-state';
import { PublicThesisView } from './public-thesis-view';
import { usePublicThesis, useRevisions, useSaveRevision, useUpdateThesis } from './queries';
import { RunsPanel } from './runs-panel';
import { Shortlist } from './shortlist';
import { SourcesPanel } from './sources-panel';

type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved'; readonly revisionNumber: number; readonly at: string }
  | { readonly status: 'failed'; readonly message: string };

function StatementRow({
  statement,
  index,
  sources,
  onChange,
  onRemove,
}: {
  readonly statement: ThesisStatement;
  readonly index: number;
  readonly sources: ThesisDetail['sources'];
  readonly onChange: (next: ThesisStatement) => void;
  readonly onRemove: () => void;
}) {
  const fetched = sources.filter((source) => source.status === 'fetched');
  const needsEvidence =
    (statement.kind === 'fact' || statement.kind === 'issuer_assertion') &&
    EVIDENCE_REQUIRED_TOPICS.has(statement.topic);
  return (
    <li className="space-y-3 rounded-panel border border-border/60 p-3" data-testid="statement-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Statement ${index + 1}: kind`}
            description={STATEMENT_KIND_HELP[statement.kind]}
          >
            {(control) => (
              <SelectInput
                id={control.id}
                value={statement.kind}
                disabled={statement.kind === 'model_inference'}
                onValueChange={(value) =>
                  onChange({
                    ...statement,
                    kind: value as StatementKind,
                    ...(value === 'user_opinion' ? { sourceIds: [] } : {}),
                  })
                }
                options={STATEMENT_KINDS.filter((kind) => kind !== 'model_inference').map(
                  (kind) => ({ value: kind, label: STATEMENT_KIND_LABELS[kind] }),
                )}
              />
            )}
          </Field>
          <Field
            label="Topic"
            description={
              needsEvidence
                ? 'This topic needs an issuer, legal or filing source.'
                : 'What the statement is about.'
            }
          >
            {(control) => (
              <SelectInput
                id={control.id}
                value={statement.topic}
                onValueChange={(value) => onChange({ ...statement, topic: value as EvidenceTopic })}
                options={EVIDENCE_TOPICS.map((topic) => ({
                  value: topic,
                  label: TOPIC_LABELS[topic],
                }))}
              />
            )}
          </Field>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {statement.kind === 'model_inference' ? (
        <p className="text-caption text-text-muted">
          <StatusBadge tone="attention">Model interpretation</StatusBadge> from run{' '}
          <span className="font-mono">{statement.runId?.slice(0, 8)}…</span>; labelled as such
          wherever it is shown.
        </p>
      ) : null}
      <Field label="Text" id={`statement-${index}-text`} required>
        {(control) => (
          <TextArea
            {...control}
            rows={3}
            maxLength={2000}
            value={statement.text}
            onChange={(event) => onChange({ ...statement, text: event.target.value })}
          />
        )}
      </Field>
      {statement.kind === 'user_opinion' ? null : (
        <fieldset className="space-y-1" id={`statement-${index}-sources`}>
          <legend className="text-supporting font-medium">Cites</legend>
          {fetched.length === 0 ? (
            <p className="text-caption text-text-muted">No fetched source to cite yet.</p>
          ) : (
            fetched.map((source) => (
              <label key={source.sourceId} className="flex items-start gap-2 text-supporting">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={statement.sourceIds.includes(source.sourceId)}
                  onChange={(event) =>
                    onChange({
                      ...statement,
                      sourceIds: event.target.checked
                        ? [...statement.sourceIds, source.sourceId]
                        : statement.sourceIds.filter((id) => id !== source.sourceId),
                    })
                  }
                />
                <span>
                  {source.title ?? source.finalUrl ?? source.url}{' '}
                  <span className="text-text-muted">({source.role})</span>
                </span>
              </label>
            ))
          )}
        </fieldset>
      )}
    </li>
  );
}

function PublishPanel({
  detail,
  form,
  savedForm,
  onClose,
}: {
  readonly detail: ThesisDetail;
  readonly form: EditorForm;
  readonly savedForm: EditorForm;
  readonly onClose: () => void;
}) {
  const update = useUpdateThesis(detail.thesis.thesisId);
  const [error, setError] = useState<string | null>(null);
  const unsaved = isDirty(form, savedForm);
  const revision = detail.revision;
  return (
    <section
      className="space-y-3 rounded-panel border border-border p-4"
      aria-label="What becomes public"
    >
      <h3 className="text-heading-sm font-semibold">What becomes public</h3>
      <ul className="list-disc space-y-1 pl-5 text-supporting">
        <li>
          Revision {revision.revisionNumber}: title, claim, {revision.statements.length} labelled
          statement(s), {revision.counterarguments.length} counterargument(s),{' '}
          {revision.instruments.length} shortlisted instrument(s) and {revision.subjects.length}{' '}
          research subject(s).
        </li>
        <li>{detail.sources.length} source record(s) with their status, dates and excerpts.</li>
        <li>
          Content hash <span className="break-all font-mono">{revision.contentHash}</span>.
        </li>
        <li>Not included: your private notes, your account, your wallets, budgets or holdings.</li>
      </ul>
      {unsaved ? (
        <Notice tone="attention" title="Unsaved changes">
          Publishing shows the last saved revision. Save first if the edits should be public.
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              { visibility: 'public' },
              {
                onSuccess: onClose,
                onError: (failure) =>
                  setError(failure instanceof WebApiError ? failure.message : 'Could not publish.'),
              },
            )
          }
        >
          Publish this revision
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-supporting text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function ThesisEditor({ detail }: { readonly detail: ThesisDetail }) {
  const thesisId = detail.thesis.thesisId;
  const save = useSaveRevision(thesisId);
  const update = useUpdateThesis(thesisId);
  const revisions = useRevisions(thesisId, true);
  const [form, setForm] = useState<EditorForm>(() => formFromRevision(detail.revision));
  const [savedForm, setSavedForm] = useState<EditorForm>(() => formFromRevision(detail.revision));
  const [loadedRevision, setLoadedRevision] = useState(detail.revision.revisionNumber);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dirty = isDirty(form, savedForm);
  const archived = detail.thesis.status === 'archived';
  const canEdit = !archived;
  const publicThesis = usePublicThesis(thesisId, preview && detail.thesis.visibility === 'public');

  // Leaving with unsaved edits is a choice the browser asks about, never a silent loss.
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const newerElsewhere = detail.revision.revisionNumber > loadedRevision;
  const loadRevision = (revision: ThesisRevision) => {
    const next = formFromRevision(revision);
    setForm(next);
    setSavedForm(next);
    setLoadedRevision(revision.revisionNumber);
    setIssues([]);
    setStatusMessage(
      revision.revisionNumber === detail.revision.revisionNumber
        ? `Revision ${revision.revisionNumber} loaded.`
        : `Revision ${revision.revisionNumber} loaded as unsaved changes; saving creates a new revision.`,
    );
    if (revision.revisionNumber !== detail.revision.revisionNumber) {
      setSavedForm(formFromRevision(detail.revision));
    }
  };

  const onSave = () => {
    const local = checkForm(form, detail.sources);
    if (local.length > 0) {
      setIssues(local);
      return;
    }
    let input: ReturnType<typeof revisionInputFromForm>;
    try {
      input = revisionInputFromForm(form);
    } catch {
      setIssues([
        { fieldId: 'thesis-title', message: 'Some fields are empty or longer than allowed.' },
      ]);
      return;
    }
    setIssues([]);
    setSaveState({ status: 'saving' });
    save.mutate(input, {
      onSuccess: (revision) => {
        const next = formFromRevision(revision);
        setSavedForm(next);
        setForm(next);
        setLoadedRevision(revision.revisionNumber);
        setSaveState({
          status: 'saved',
          revisionNumber: revision.revisionNumber,
          at: revision.createdAt,
        });
      },
      onError: (failure) => {
        const message =
          failure instanceof WebApiError
            ? failure.code === 'VALIDATION_FAILED'
              ? 'The API refused this revision; fix the listed rules and save again. Your edits are kept.'
              : `${failure.message} Your edits are kept here; try again.`
            : 'Saving failed. Your edits are kept here; try again.';
        setSaveState({ status: 'failed', message });
        if (failure instanceof WebApiError && failure.code === 'VALIDATION_FAILED') {
          setIssues(issuesFromApiDetails(failure.details));
        }
      },
    });
  };

  const setStatement = (index: number, next: ThesisStatement) =>
    setForm((current) => ({
      ...current,
      statements: current.statements.map((statement, at) => (at === index ? next : statement)),
    }));
  const shortlist = new Set(form.instruments.map((reference) => reference.instrumentId));
  const savedShortlistMatches = !isDirty(
    { ...form, instruments: form.instruments },
    { ...form, instruments: savedForm.instruments },
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-caption">
          <Link href="/research" className="underline underline-offset-2">
            Research
          </Link>{' '}
          <span className="text-text-muted">/ thesis</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={detail.thesis.visibility === 'public' ? 'info' : 'neutral'}>
            {detail.thesis.visibility === 'public' ? 'Public' : 'Private'}
          </StatusBadge>
          {archived ? <StatusBadge tone="attention">Archived</StatusBadge> : null}
          <span className="text-supporting text-text-muted">
            Revision {detail.revision.revisionNumber} saved{' '}
            {formatRelativeAge(detail.revision.createdAt)} · by {detail.revision.authorPrincipal}
          </span>
        </div>
        <Field label="Title" id="thesis-title" required>
          {(control) => (
            <TextInput
              {...control}
              value={form.title}
              maxLength={160}
              disabled={!canEdit}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-2" data-testid="save-bar">
          <Button
            type="button"
            onClick={onSave}
            loading={saveState.status === 'saving'}
            {...(!canEdit
              ? { disabledReason: 'An archived thesis takes no edits; restore it first.' }
              : {})}
          >
            Save revision
          </Button>
          <span
            role="status"
            aria-live="polite"
            className="text-supporting text-text-muted"
            data-testid="save-state"
          >
            {saveState.status === 'saving'
              ? 'Saving…'
              : saveState.status === 'saved'
                ? `Saved as revision ${saveState.revisionNumber} at ${formatInstant(saveState.at)}${dirty ? ' · unsaved changes since' : ''}`
                : saveState.status === 'failed'
                  ? saveState.message
                  : dirty
                    ? 'Unsaved changes'
                    : 'No unsaved changes'}
          </span>
        </div>
        {newerElsewhere ? (
          <Notice
            tone="attention"
            title={`Revision ${detail.revision.revisionNumber} was saved elsewhere`}
            actions={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => loadRevision(detail.revision)}
              >
                Load it here
              </Button>
            }
          >
            Another tab or device appended a newer revision. Your edits here are untouched; saving
            them appends another revision on top, nothing is overwritten.
          </Notice>
        ) : null}
        {statusMessage ? (
          <p role="status" className="text-caption text-text-muted">
            {statusMessage}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <ValidationSummary title="Before this can be saved" errors={issues} focusOnAppear />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {detail.thesis.visibility === 'public' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={update.isPending}
                onClick={() => update.mutate({ visibility: 'private' })}
              >
                Make private
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? 'Hide public view' : 'Show the public view'}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPublishing((value) => !value)}
              {...(archived ? { disabledReason: 'Restore the thesis before publishing.' } : {})}
            >
              Publish…
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={update.isPending}
            onClick={() => update.mutate({ status: archived ? 'draft' : 'archived' })}
          >
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
        {publishing && detail.thesis.visibility === 'private' ? (
          <PublishPanel
            detail={detail}
            form={form}
            savedForm={savedForm}
            onClose={() => setPublishing(false)}
          />
        ) : null}
        {preview && detail.thesis.visibility === 'public' ? (
          <section className="rounded-panel border border-border/60 p-4" aria-label="Public view">
            {publicThesis.data ? (
              <PublicThesisView thesis={publicThesis.data} />
            ) : publicThesis.error ? (
              <p className="text-supporting text-error">The public view could not be read.</p>
            ) : (
              <p className="text-supporting text-text-muted" aria-busy="true">
                Loading the public view…
              </p>
            )}
          </section>
        ) : null}
      </header>

      <Field
        label="Claim"
        id="thesis-claim"
        description="The proposition you are researching, in plain text."
        required
      >
        {(control) => (
          <TextArea
            {...control}
            rows={3}
            maxLength={2000}
            disabled={!canEdit}
            value={form.claim}
            onChange={(event) => setForm({ ...form, claim: event.target.value })}
          />
        )}
      </Field>

      <section className="space-y-3" aria-labelledby="statements-heading">
        <h2 id="statements-heading" className="text-heading-sm font-semibold">
          Statements
        </h2>
        <p className="text-supporting text-text-muted">
          Sourced facts and issuer assertions cite fetched sources; your opinions are yours; model
          interpretations come only from a run and stay labelled. The API refuses anything else.
        </p>
        {form.statements.length === 0 ? (
          <p className="text-supporting text-text-muted">No statements yet.</p>
        ) : (
          <ol className="space-y-3" aria-label="Statements">
            {form.statements.map((statement, index) => (
              <StatementRow
                key={statement.statementId}
                statement={statement}
                index={index}
                sources={detail.sources}
                onChange={(next) => setStatement(index, next)}
                onRemove={() =>
                  setForm((current) => ({
                    ...current,
                    statements: current.statements.filter((_, at) => at !== index),
                  }))
                }
              />
            ))}
          </ol>
        )}
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setForm((current) => ({
                ...current,
                statements: [
                  ...current.statements,
                  {
                    statementId: newStatementId(),
                    kind: 'user_opinion',
                    topic: 'general',
                    text: '',
                    sourceIds: [],
                    runId: null,
                  },
                ],
              }))
            }
          >
            Add a statement
          </Button>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="counter-heading">
        <h2 id="counter-heading" className="text-heading-sm font-semibold">
          Counterarguments
        </h2>
        {form.counterarguments.length === 0 ? (
          <p className="text-supporting text-text-muted">None recorded.</p>
        ) : (
          <ul className="space-y-2" aria-label="Counterarguments">
            {form.counterarguments.map((text, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional text entries
              <li key={index} className="flex items-start gap-2">
                <TextArea
                  aria-label={`Counterargument ${index + 1}`}
                  rows={2}
                  maxLength={1000}
                  disabled={!canEdit}
                  value={text}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      counterarguments: current.counterarguments.map((item, at) =>
                        at === index ? event.target.value : item,
                      ),
                    }))
                  }
                />
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        counterarguments: current.counterarguments.filter((_, at) => at !== index),
                      }))
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setForm((current) => ({
                ...current,
                counterarguments: [...current.counterarguments, ''],
              }))
            }
          >
            Add a counterargument
          </Button>
        ) : null}
      </section>

      <Shortlist
        instruments={form.instruments}
        subjects={form.subjects}
        canEdit={canEdit}
        onChangeInstruments={(instruments) => setForm((current) => ({ ...current, instruments }))}
        onChangeSubjects={(subjects) => setForm((current) => ({ ...current, subjects }))}
      />

      <SourcesPanel thesisId={thesisId} sources={detail.sources} canEdit={canEdit} />

      <RunsPanel
        thesisId={thesisId}
        sources={detail.sources}
        shortlist={shortlist}
        canEdit={canEdit}
        onAdopt={(statements) =>
          setForm((current) => ({
            ...current,
            statements: [
              ...current.statements,
              ...statements.filter(
                (statement) =>
                  !current.statements.some((own) => own.statementId === statement.statementId),
              ),
            ],
          }))
        }
        onAddInstrument={(instrumentId) =>
          setForm((current) =>
            current.instruments.some((reference) => reference.instrumentId === instrumentId)
              ? current
              : { ...current, instruments: [...current.instruments, { instrumentId, note: null }] },
          )
        }
        onAddSubject={(name) =>
          setForm((current) =>
            current.subjects.some((subject) => subject.name === name)
              ? current
              : { ...current, subjects: [...current.subjects, { name, note: null }] },
          )
        }
      />

      <section className="space-y-2" aria-labelledby="private-heading">
        <h2 id="private-heading" className="text-heading-sm font-semibold">
          Private notes
        </h2>
        <Notice tone="info" title="Private">
          Kept with your account only: excluded from the content hash, from the public page and from
          any basket that starts from this thesis.
        </Notice>
        <Field label="Notes" id="thesis-private-notes">
          {(control) => (
            <TextArea
              {...control}
              rows={4}
              maxLength={4000}
              disabled={!canEdit}
              value={form.privateNotes}
              onChange={(event) => setForm({ ...form, privateNotes: event.target.value })}
              data-testid="private-notes"
            />
          )}
        </Field>
      </section>

      {canEdit ? (
        savedShortlistMatches ? (
          <BasketFromShortlist
            thesisId={thesisId}
            title={savedForm.title}
            claim={savedForm.claim}
            instruments={savedForm.instruments}
          />
        ) : (
          <Notice tone="info" title="Save the shortlist before starting a basket">
            The basket draft starts from the saved revision, so the shortlist you see is the one
            that is used.
          </Notice>
        )
      ) : null}

      <section className="space-y-2" aria-labelledby="revisions-heading">
        <h2 id="revisions-heading" className="text-heading-sm font-semibold">
          Saved revisions
        </h2>
        {revisions.data ? (
          <ul className="space-y-1 text-supporting" aria-label="Saved revisions">
            {revisions.data.revisions.map((revision) => (
              <li
                key={revision.revisionId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  Revision {revision.revisionNumber} · {formatInstant(revision.createdAt)} ·{' '}
                  <span className="font-mono text-caption">
                    {revision.contentHash.slice(0, 12)}…
                  </span>
                  {revision.revisionNumber === detail.revision.revisionNumber ? ' · current' : ''}
                </span>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => loadRevision(revision)}
                  >
                    Load into editor
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : revisions.error ? (
          <p className="text-supporting text-text-muted">The revision log could not be read.</p>
        ) : (
          <p className="text-supporting text-text-muted" aria-busy="true">
            Loading…
          </p>
        )}
      </section>
    </div>
  );
}
