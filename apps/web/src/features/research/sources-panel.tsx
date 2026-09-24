'use client';

import {
  SOURCE_ROLES,
  type SourceRecord,
  type SourceRole,
  sourceAttachRequestSchema,
} from '@markov/contracts';
import { formatInstant } from '@markov/formatters';
import {
  Button,
  Field,
  Notice,
  SelectInput,
  StatusBadge,
  type StatusTone,
  TextInput,
} from '@markov/ui';
import { type FormEvent, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { hostOf, safeExternalHref } from './editor-state';
import { useAttachSource } from './queries';

export const ROLE_LABELS: Readonly<Record<SourceRole, string>> = {
  issuer: 'Issuer',
  legal: 'Legal',
  filing: 'Filing',
  news: 'News',
  data: 'Data',
  other: 'Other',
};

const STATUS_TONE: Readonly<Record<SourceRecord['status'], StatusTone>> = {
  fetched: 'success',
  blocked: 'error',
  failed: 'attention',
};

const STATUS_LABEL: Readonly<Record<SourceRecord['status'], string>> = {
  fetched: 'Fetched',
  blocked: 'Refused',
  failed: 'Failed',
};

export function sourceAnchorId(sourceId: string): string {
  return `source-${sourceId}`;
}

/** Text the person can see; never HTML. Excerpts and titles come from the API already sanitised. */
export type SourceView = Omit<SourceRecord, 'thesisId'>;

export function SourceCard({
  source,
  compact = false,
}: {
  readonly source: SourceView;
  readonly compact?: boolean;
}) {
  const href = safeExternalHref(source.finalUrl ?? source.url);
  const shownUrl = source.finalUrl ?? source.url;
  return (
    <article
      id={sourceAnchorId(source.sourceId)}
      className="space-y-1.5 rounded-panel border border-border/60 p-3 text-supporting"
      data-testid="source-card"
      aria-label={`Source: ${source.title ?? hostOf(shownUrl)}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[source.status]}>{STATUS_LABEL[source.status]}</StatusBadge>
        <StatusBadge tone="neutral">{ROLE_LABELS[source.role]}</StatusBadge>
        <span className="font-medium text-text">{source.title ?? hostOf(shownUrl)}</span>
      </div>
      <p className="break-all text-caption text-text-muted">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {shownUrl}
          </a>
        ) : (
          <span>{shownUrl} (link withheld: not an https destination)</span>
        )}
        {source.redirects.length > 0 ? ` · ${source.redirects.length} validated redirect(s)` : ''}
      </p>
      <p className="text-caption text-text-muted">
        {source.publishedAt ? `Published ${formatInstant(source.publishedAt)} · ` : ''}
        {source.observedAt ? `Observed ${formatInstant(source.observedAt)} · ` : ''}
        Fetched {formatInstant(source.retrievedAt)}
        {!source.publishedAt && !source.observedAt ? ' · publication date unknown' : ''}
      </p>
      {source.status === 'fetched' ? (
        compact ? null : (
          <>
            {source.excerpt ? (
              <blockquote
                className="border-l-2 border-border pl-3 text-text"
                data-testid="source-excerpt"
              >
                {source.excerpt}
              </blockquote>
            ) : (
              <p className="text-text-muted">No readable text was extracted from this source.</p>
            )}
            <p className="break-all font-mono text-caption text-text-muted">
              {source.contentType ?? 'unknown type'}
              {source.byteLength !== null ? ` · ${source.byteLength} bytes` : ''}
              {source.contentHash ? ` · SHA-256 ${source.contentHash.slice(0, 16)}…` : ''}
            </p>
          </>
        )
      ) : (
        <p className="text-text" data-testid="source-refusal">
          {source.status === 'blocked'
            ? `Markov refused to retrieve this URL: ${source.blockedReason ?? 'policy'}. It cannot be cited.`
            : `The retrieval failed: ${source.blockedReason ?? 'unknown error'}. Attach it again later; it cannot be cited until it is fetched.`}
        </p>
      )}
    </article>
  );
}

function AttachForm({ thesisId }: { readonly thesisId: string }) {
  const attach = useAttachSource(thesisId);
  const [url, setUrl] = useState('');
  const [role, setRole] = useState<SourceRole>('other');
  const [publishedOn, setPublishedOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SourceRecord | null>(null);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setOutcome(null);
    const parsed = sourceAttachRequestSchema.safeParse({
      url: url.trim(),
      role,
      publishedAt: publishedOn === '' ? null : `${publishedOn}T00:00:00.000Z`,
      observedAt: null,
    });
    if (!parsed.success || !parsed.data.url.startsWith('https://')) {
      setError(
        'Enter a complete https:// address. Markov fetches it under its retrieval policy; the browser never does.',
      );
      return;
    }
    setError(null);
    attach.mutate(parsed.data, {
      onSuccess: (source) => {
        setOutcome(source);
        setUrl('');
        setPublishedOn('');
      },
      onError: (failure) =>
        setError(
          failure instanceof WebApiError
            ? failure.code === 'RATE_LIMITED'
              ? 'Too many sources in a minute; wait a moment.'
              : failure.message
            : 'The source could not be attached.',
        ),
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Attach a source">
      <Field
        label="Source URL"
        description="https only. Markov retrieves it, keeps a bounded plain-text excerpt and its hash, and records the fetch time; pages that resolve to private or internal addresses are refused."
        error={error}
        required
      >
        {(control) => (
          <TextInput
            {...control}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://issuer.example/terms"
            autoComplete="off"
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Role"
          description="Rights, backing, fees or redemption claims need an issuer, legal or filing source."
        >
          {(control) => (
            <SelectInput
              id={control.id}
              value={role}
              onValueChange={(value) => setRole(value as SourceRole)}
              options={SOURCE_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }))}
            />
          )}
        </Field>
        <Field
          label="Published on (if known)"
          description="Optional; the fetch date is always recorded."
        >
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={publishedOn}
              onChange={(event) => setPublishedOn(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Button type="submit" loading={attach.isPending} variant="secondary">
        Attach and fetch
      </Button>
      {outcome ? (
        <p role="status" className="text-caption text-text-muted">
          {outcome.status === 'fetched'
            ? `Fetched ${outcome.title ?? hostOf(outcome.finalUrl ?? outcome.url)}; it can now be cited.`
            : outcome.status === 'blocked'
              ? `Refused: ${outcome.blockedReason ?? 'policy'}. The record is kept so the refusal is visible; it cannot be cited.`
              : `Failed: ${outcome.blockedReason ?? 'unknown error'}. Try again later.`}
        </p>
      ) : null}
    </form>
  );
}

export function SourcesPanel({
  thesisId,
  sources,
  canEdit,
}: {
  readonly thesisId: string;
  readonly sources: readonly SourceRecord[];
  readonly canEdit: boolean;
}) {
  return (
    <section className="space-y-4" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="text-heading-sm font-semibold">
        Sources and evidence
      </h2>
      {canEdit ? <AttachForm thesisId={thesisId} /> : null}
      {sources.length === 0 ? (
        <Notice tone="info" title="No sources yet">
          Facts and issuer assertions must cite a fetched source. Attach the issuer&apos;s terms, a
          filing or an article by URL; opinions need no source and stay labelled as yours.
        </Notice>
      ) : (
        <ul className="space-y-2" aria-label="Source records">
          {sources.map((source) => (
            <li key={source.sourceId}>
              <SourceCard source={source} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
