'use client';

import type { DraftIssue, StrategyDraft, StrategyDraftContent } from '@markov/contracts';
import { formatBasisPoints } from '@markov/formatters';
import { StatusBadge } from '@markov/ui';
import { ISSUE_LABELS, totalsOf } from './draft-state';

function issueText(issue: DraftIssue, legLabel: (path: string) => string): string {
  const where = issue.path.startsWith('legs/') ? `${legLabel(issue.path)}: ` : '';
  return `${where}${ISSUE_LABELS[issue.code]} — ${issue.message}`;
}

/**
 * The persistent draft summary: exact totals, the backend's verdict on the
 * saved revision and what is still pending. Never a rounded percentage.
 */
export function DraftSummary({
  content,
  server,
  localIssues,
  dirty,
  legLabel,
}: {
  readonly content: StrategyDraftContent;
  readonly server: StrategyDraft;
  readonly localIssues: readonly DraftIssue[];
  readonly dirty: boolean;
  readonly legLabel: (path: string) => string;
}) {
  const totals = totalsOf(content);
  const serverErrors = server.validation.issues.filter((issue) => issue.severity === 'error');
  const serverWarnings = server.validation.issues.filter((issue) => issue.severity === 'warning');
  return (
    <section
      className="space-y-3 rounded-panel border border-border/60 bg-surface p-4"
      aria-labelledby="summary-heading"
      data-testid="draft-summary"
    >
      <h2 id="summary-heading" className="text-heading-sm font-semibold">
        Draft summary
      </h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-supporting">
        <dt className="text-text-muted">Constituents</dt>
        <dd>{content.legs.length}</dd>
        <dt className="text-text-muted">Allocated</dt>
        <dd data-testid="summary-legs">{formatBasisPoints(totals.legsBps)}</dd>
        <dt className="text-text-muted">Cash</dt>
        <dd data-testid="summary-cash">{formatBasisPoints(totals.cashBps)}</dd>
        <dt className="text-text-muted">Total</dt>
        <dd data-testid="summary-total" className="font-medium">
          {formatBasisPoints(totals.totalBps)}
        </dd>
        <dt className="text-text-muted">Remaining</dt>
        <dd data-testid="summary-remaining">
          {totals.remainingBps === 0
            ? 'Nothing unallocated'
            : totals.remainingBps > 0
              ? `${formatBasisPoints(totals.remainingBps)} unallocated`
              : `${formatBasisPoints(-totals.remainingBps)} over`}
        </dd>
        <dt className="text-text-muted">Revision</dt>
        <dd>{server.revision}</dd>
      </dl>
      <div className="space-y-1" data-testid="validation-summary">
        <p className="flex flex-wrap items-center gap-2 text-supporting">
          {dirty ? (
            <StatusBadge tone="neutral">Backend check pending save</StatusBadge>
          ) : server.validation.valid ? (
            <StatusBadge tone="success">Backend: valid recipe</StatusBadge>
          ) : (
            <StatusBadge tone="error">
              Backend: {serverErrors.length} rule{serverErrors.length === 1 ? '' : 's'} broken
            </StatusBadge>
          )}
        </p>
        {(dirty ? localIssues : serverErrors).length > 0 ? (
          <ul
            className="list-disc space-y-0.5 pl-5 text-caption text-error"
            aria-label="Rules to fix"
          >
            {(dirty ? localIssues : serverErrors).map((issue) => (
              <li key={`${issue.code}-${issue.path}`}>{issueText(issue, legLabel)}</li>
            ))}
          </ul>
        ) : null}
        {!dirty && serverWarnings.length > 0 ? (
          <ul
            className="list-disc space-y-0.5 pl-5 text-caption text-text-muted"
            aria-label="Advisories"
          >
            {serverWarnings.map((issue) => (
              <li key={`${issue.code}-${issue.path}`}>{issueText(issue, legLabel)}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-caption text-text-muted">
          Limits of this deployment: at most {server.validation.limits.maxLegs} constituents; issuer
          ceiling {formatBasisPoints(server.validation.limits.maxIssuerConcentrationBps)}, company
          ceiling {formatBasisPoints(server.validation.limits.maxCompanyConcentrationBps)} (advisory
          here, binding at execution).
        </p>
      </div>
    </section>
  );
}

/** Phone footer: the total and the error count, never hiding the errors themselves. */
export function StickyTotal({
  content,
  errorCount,
}: {
  readonly content: StrategyDraftContent;
  readonly errorCount: number;
}) {
  const totals = totalsOf(content);
  return (
    <div
      className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border/60 bg-surface px-4 py-2 text-supporting lg:hidden"
      data-testid="sticky-total"
    >
      <span>
        Total <strong>{formatBasisPoints(totals.totalBps)}</strong>
      </span>
      <span className={errorCount > 0 ? 'text-error' : 'text-text-muted'}>
        {errorCount === 0
          ? 'No rule broken'
          : `${errorCount} rule${errorCount === 1 ? '' : 's'} to fix`}
      </span>
    </div>
  );
}
