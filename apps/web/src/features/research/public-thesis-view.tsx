'use client';

import type { PublicThesis, ThesisStatement } from '@markov/contracts';
import { formatInstant } from '@markov/formatters';
import { StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { useInstrument } from '../markets/queries';
import { STATEMENT_KIND_LABELS, TOPIC_LABELS } from './editor-state';
import { SourceCard, sourceAnchorId } from './sources-panel';

function InstrumentLine({
  instrumentId,
  note,
}: {
  readonly instrumentId: string;
  readonly note: string | null;
}) {
  const instrument = useInstrument(instrumentId);
  return (
    <li className="text-supporting">
      {instrument.data ? (
        <Link href={`/markets/${instrumentId}`} className="underline underline-offset-2">
          {instrument.data.symbol} · {instrument.data.companyName}
        </Link>
      ) : (
        <span className="font-mono">{instrumentId}</span>
      )}
      {note ? <span className="text-text-muted"> · {note}</span> : null}
    </li>
  );
}

function Statement({
  statement,
  sourceIndex,
}: {
  readonly statement: ThesisStatement;
  readonly sourceIndex: ReadonlyMap<string, number>;
}) {
  const citations = statement.sourceIds
    .map((id) => ({ id, n: sourceIndex.get(id) }))
    .filter((item): item is { id: string; n: number } => item.n !== undefined);
  return (
    <li
      className="space-y-1 rounded-panel border border-border/60 p-3"
      data-testid="public-statement"
    >
      <p className="flex flex-wrap items-center gap-2 text-caption">
        <StatusBadge
          tone={
            statement.kind === 'model_inference'
              ? 'attention'
              : statement.kind === 'user_opinion'
                ? 'neutral'
                : 'info'
          }
        >
          {STATEMENT_KIND_LABELS[statement.kind]}
        </StatusBadge>
        <span className="text-text-muted">{TOPIC_LABELS[statement.topic]}</span>
      </p>
      <p className="text-body">{statement.text}</p>
      {citations.length > 0 ? (
        <p className="text-caption">
          Sources:{' '}
          {citations.map((citation) => (
            <a
              key={citation.id}
              href={`#${sourceAnchorId(citation.id)}`}
              className="mr-1 underline underline-offset-2"
            >
              [{citation.n}]
            </a>
          ))}
        </p>
      ) : statement.kind === 'user_opinion' ? (
        <p className="text-caption text-text-muted">
          The author&apos;s own view; not a sourced fact.
        </p>
      ) : null}
    </li>
  );
}

/** The published projection exactly as the API serves it: no private notes, no owner identity. */
export function PublicThesisView({ thesis }: { readonly thesis: PublicThesis }) {
  const sourceIndex = new Map(thesis.sources.map((source, index) => [source.sourceId, index + 1]));
  return (
    <article className="space-y-6" data-testid="public-thesis">
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-caption">
          <StatusBadge tone="info">Published projection</StatusBadge>
          <span className="text-text-muted">
            Revision {thesis.revisionNumber} · published {formatInstant(thesis.publishedAt)}
          </span>
        </p>
        <h1 className="text-heading-lg font-semibold">{thesis.title}</h1>
        <p className="text-body">{thesis.claim}</p>
        <p className="break-all font-mono text-caption text-text-muted">
          SHA-256 {thesis.contentHash}
        </p>
      </header>
      <section className="space-y-2" aria-labelledby="public-statements">
        <h2 id="public-statements" className="text-heading-sm font-semibold">
          Statements
        </h2>
        {thesis.statements.length === 0 ? (
          <p className="text-supporting text-text-muted">No statements were published.</p>
        ) : (
          <ol className="space-y-2">
            {thesis.statements.map((statement) => (
              <Statement
                key={statement.statementId}
                statement={statement}
                sourceIndex={sourceIndex}
              />
            ))}
          </ol>
        )}
      </section>
      {thesis.counterarguments.length > 0 ? (
        <section className="space-y-2" aria-labelledby="public-counter">
          <h2 id="public-counter" className="text-heading-sm font-semibold">
            Counterarguments
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-supporting">
            {thesis.counterarguments.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="space-y-2" aria-labelledby="public-instruments">
        <h2 id="public-instruments" className="text-heading-sm font-semibold">
          Instruments and subjects
        </h2>
        {thesis.instruments.length === 0 && thesis.subjects.length === 0 ? (
          <p className="text-supporting text-text-muted">No instrument is referenced.</p>
        ) : (
          <ul className="space-y-1">
            {thesis.instruments.map((reference) => (
              <InstrumentLine
                key={reference.instrumentId}
                instrumentId={reference.instrumentId}
                note={reference.note}
              />
            ))}
            {thesis.subjects.map((subject) => (
              <li key={subject.name} className="text-supporting">
                {subject.name}{' '}
                <StatusBadge tone="neutral">Research subject, not tradable</StatusBadge>
                {subject.note ? <span className="text-text-muted"> · {subject.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2" aria-labelledby="public-sources">
        <h2 id="public-sources" className="text-heading-sm font-semibold">
          Sources
        </h2>
        {thesis.sources.length === 0 ? (
          <p className="text-supporting text-text-muted">No sources were attached.</p>
        ) : (
          <ol className="space-y-2">
            {thesis.sources.map((source, index) => (
              <li key={source.sourceId} className="flex gap-2">
                <span className="text-caption text-text-muted">[{index + 1}]</span>
                <div className="min-w-0 flex-1">
                  <SourceCard source={source} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-caption text-text-muted">
        Research, not advice. Naming a company implies no relationship between Markov and that
        company; a statement labelled as a model interpretation is not an issuer fact.
      </p>
    </article>
  );
}
