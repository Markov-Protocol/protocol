'use client';

import type { InstrumentReference, ResearchSubject } from '@markov/contracts';
import { Button, Field, SearchInput, StatusBadge, TextInput } from '@markov/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { ISSUER_LABELS, STATUS_LABELS, statusTone } from '../markets/labels';
import { useInstrument, useInstrumentPages } from '../markets/queries';
import { useMapCompanies } from './queries';

/** One shortlisted instrument, always by its canonical id; the catalog projection is read live. */
function ShortlistRow({
  reference,
  index,
  canEdit,
  onNote,
  onRemove,
}: {
  readonly reference: InstrumentReference;
  readonly index: number;
  readonly canEdit: boolean;
  readonly onNote: (note: string) => void;
  readonly onRemove: () => void;
}) {
  const instrument = useInstrument(reference.instrumentId);
  return (
    <li
      className="space-y-2 rounded-panel border border-border/60 p-3"
      data-testid="shortlist-row"
      id={`instrument-${index}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {instrument.data ? (
          <p className="text-supporting">
            <Link
              href={`/markets/${instrument.data.instrumentId}`}
              className="font-medium underline underline-offset-2"
            >
              {instrument.data.symbol} · {instrument.data.companyName}
            </Link>{' '}
            <StatusBadge tone="info">{ISSUER_LABELS[instrument.data.issuer]}</StatusBadge>{' '}
            <StatusBadge tone={statusTone(instrument.data.status)}>
              {STATUS_LABELS[instrument.data.status]}
            </StatusBadge>
          </p>
        ) : instrument.error ? (
          <p className="text-supporting">
            <span className="font-mono">{reference.instrumentId}</span>{' '}
            <StatusBadge tone="attention">
              {instrument.error instanceof WebApiError && instrument.error.status === 404
                ? 'No longer listed publicly'
                : 'Could not be read'}
            </StatusBadge>
          </p>
        ) : (
          <p className="text-supporting text-text-muted" aria-busy="true">
            Reading {reference.instrumentId}…
          </p>
        )}
        {canEdit ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      {canEdit ? (
        <Field label="Note" className="max-w-xl">
          {(control) => (
            <TextInput
              {...control}
              value={reference.note ?? ''}
              onChange={(event) => onNote(event.target.value)}
              maxLength={300}
              placeholder="Why this exposure belongs in the thesis"
            />
          )}
        </Field>
      ) : reference.note ? (
        <p className="text-supporting text-text-muted">{reference.note}</p>
      ) : null}
    </li>
  );
}

function InstrumentPicker({
  excluded,
  onAdd,
}: {
  readonly excluded: ReadonlySet<string>;
  readonly onAdd: (instrumentId: string) => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setQ(text.trim().slice(0, 60)), 300);
    return () => clearTimeout(handle);
  }, [text]);
  const pages = useInstrumentPages({ q, issuer: null, kind: null });
  const rows = q === '' ? [] : (pages.data?.pages[0]?.instruments ?? []);
  return (
    <div className="space-y-2" data-testid="instrument-picker">
      <SearchInput
        aria-label="Search admitted instruments"
        value={text}
        onValueChange={setText}
        placeholder="Search admitted instruments by company or symbol"
      />
      {q !== '' ? (
        pages.isPending ? (
          <p className="text-caption text-text-muted" aria-busy="true">
            Searching…
          </p>
        ) : pages.error ? (
          <p className="text-caption text-error">The catalog could not be searched right now.</p>
        ) : rows.length === 0 ? (
          <p className="text-caption text-text-muted">
            No admitted instrument matches. A company the catalog does not carry can be a research
            subject; it can never be a constituent.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Search results">
            {rows.slice(0, 8).map((row) => (
              <li
                key={row.instrumentId}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span>
                  {row.symbol} · {row.companyName}{' '}
                  <StatusBadge tone="info">{ISSUER_LABELS[row.issuer]}</StatusBadge>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onAdd(row.instrumentId)}
                  {...(excluded.has(row.instrumentId)
                    ? { disabledReason: 'Already in the shortlist.' }
                    : {})}
                >
                  Add {row.symbol}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function Shortlist({
  instruments,
  subjects,
  canEdit,
  onChangeInstruments,
  onChangeSubjects,
}: {
  readonly instruments: readonly InstrumentReference[];
  readonly subjects: readonly ResearchSubject[];
  readonly canEdit: boolean;
  readonly onChangeInstruments: (next: readonly InstrumentReference[]) => void;
  readonly onChangeSubjects: (next: readonly ResearchSubject[]) => void;
}) {
  const ids = new Set(instruments.map((reference) => reference.instrumentId));
  const map = useMapCompanies();
  const [subjectName, setSubjectName] = useState('');
  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const addInstrument = (instrumentId: string) => {
    if (!ids.has(instrumentId)) {
      onChangeInstruments([...instruments, { instrumentId, note: null }]);
    }
  };
  const mapSubjects = () => {
    setMapMessage(null);
    map.mutate(
      subjects.map((subject) => subject.name),
      {
        onSuccess: (response) => {
          const matched = response.results.filter((result) => !result.unmatched);
          if (matched.length === 0) {
            setMapMessage(
              'None of these companies is in the catalog; they stay research subjects.',
            );
            return;
          }
          const additions = matched
            .flatMap((result) => result.matches)
            .filter((match) => !ids.has(match.instrumentId))
            .map((match) => ({ instrumentId: match.instrumentId, note: null }));
          onChangeInstruments([...instruments, ...additions]);
          const matchedNames = new Set(matched.map((result) => result.company));
          onChangeSubjects(subjects.filter((subject) => !matchedNames.has(subject.name)));
          setMapMessage(
            `${matched.length} compan${matched.length === 1 ? 'y' : 'ies'} matched an admitted instrument and moved to the shortlist.`,
          );
        },
        onError: (failure) =>
          setMapMessage(
            failure instanceof WebApiError
              ? failure.message
              : 'Mapping is not available right now.',
          ),
      },
    );
  };
  return (
    <div className="space-y-4">
      <section className="space-y-3" aria-labelledby="shortlist-heading">
        <h2 id="shortlist-heading" className="text-heading-sm font-semibold">
          Instrument shortlist
        </h2>
        <p className="text-supporting text-text-muted">
          Exact admitted instruments by their Markov id, never a ticker typed from memory. A
          shortlist is research; weights and orders happen elsewhere.
        </p>
        {instruments.length === 0 ? (
          <p className="text-supporting text-text-muted">Nothing shortlisted yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Shortlisted instruments">
            {instruments.map((reference, index) => (
              <ShortlistRow
                key={reference.instrumentId}
                reference={reference}
                index={index}
                canEdit={canEdit}
                onNote={(note) =>
                  onChangeInstruments(
                    instruments.map((item, at) =>
                      at === index ? { ...item, note: note === '' ? null : note } : item,
                    ),
                  )
                }
                onRemove={() => onChangeInstruments(instruments.filter((_, at) => at !== index))}
              />
            ))}
          </ul>
        )}
        {canEdit ? <InstrumentPicker excluded={ids} onAdd={addInstrument} /> : null}
      </section>
      <section className="space-y-3" aria-labelledby="subjects-heading">
        <h2 id="subjects-heading" className="text-heading-sm font-semibold">
          Research subjects
        </h2>
        <p className="text-supporting text-text-muted">
          Companies you write about that the catalog does not carry. They can be mapped to admitted
          instruments deterministically; an unmatched name never becomes a tradable asset.
        </p>
        {subjects.length === 0 ? (
          <p className="text-supporting text-text-muted">No subjects.</p>
        ) : (
          <ul className="space-y-1" aria-label="Research subjects">
            {subjects.map((subject, index) => (
              <li
                key={subject.name}
                id={`subject-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span>
                  {subject.name}
                  {subject.note ? <span className="text-text-muted"> · {subject.note}</span> : null}
                </span>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onChangeSubjects(subjects.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Company name" className="min-w-64">
              {(control) => (
                <TextInput
                  {...control}
                  value={subjectName}
                  onChange={(event) => setSubjectName(event.target.value)}
                  maxLength={120}
                  placeholder="Unknown Rocket Co"
                />
              )}
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const name = subjectName.trim();
                if (name !== '' && !subjects.some((subject) => subject.name === name)) {
                  onChangeSubjects([...subjects, { name, note: null }]);
                }
                setSubjectName('');
              }}
            >
              Add subject
            </Button>
            {subjects.length > 0 ? (
              <Button type="button" variant="ghost" loading={map.isPending} onClick={mapSubjects}>
                Map subjects to admitted instruments
              </Button>
            ) : null}
          </div>
        ) : null}
        {mapMessage ? (
          <p role="status" className="text-caption text-text-muted">
            {mapMessage}
          </p>
        ) : null}
      </section>
    </div>
  );
}
