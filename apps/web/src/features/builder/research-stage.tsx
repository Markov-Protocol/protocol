'use client';

import type { StrategyDraftContent } from '@markov/contracts';
import { Button, Field, Notice, SelectInput, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { useTheses, useThesis } from '../research/queries';
import { addLeg } from './draft-state';

/** Stage 01: the thesis behind the basket and its shortlist, added only on the person's explicit action. */
export function ResearchStage({
  content,
  onChange,
}: {
  readonly content: StrategyDraftContent;
  readonly onChange: (next: (content: StrategyDraftContent) => StrategyDraftContent) => void;
}) {
  const theses = useTheses(true);
  const linked = useThesis(content.thesisId ?? '', content.thesisId !== null);
  const shortlist = linked.data?.revision.instruments ?? [];
  const missing = shortlist.filter(
    (reference) => !content.legs.some((leg) => leg.instrumentId === reference.instrumentId),
  );
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="thesis-link-heading">
        <h2 id="thesis-link-heading" className="text-heading-sm font-semibold">
          Thesis behind this basket
        </h2>
        <p className="text-supporting text-text-muted">
          Link one of your theses so the basket can be explained from its sources. The thesis itself
          is not copied; the link is part of the recipe.
        </p>
        <Field label="Linked thesis" id="linked-thesis" className="max-w-lg">
          {(control) => (
            <SelectInput
              id={control.id}
              value={content.thesisId ?? 'none'}
              onValueChange={(value) =>
                onChange((current) => ({ ...current, thesisId: value === 'none' ? null : value }))
              }
              options={[
                { value: 'none', label: 'No linked thesis' },
                ...(theses.data?.theses ?? []).map((thesis) => ({
                  value: thesis.thesisId,
                  label: `${thesis.title} (revision ${thesis.currentRevisionNumber})`,
                })),
              ]}
            />
          )}
        </Field>
        {theses.error ? (
          <p className="text-supporting text-text-muted">
            Your theses could not be read right now.
          </p>
        ) : null}
        {content.thesisId ? (
          linked.data ? (
            <div
              className="space-y-2 rounded-panel border border-border/60 p-3"
              data-testid="linked-thesis"
            >
              <p className="text-supporting">
                <Link
                  href={`/research/${content.thesisId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {linked.data.revision.title}
                </Link>{' '}
                <StatusBadge tone={linked.data.thesis.visibility === 'public' ? 'info' : 'neutral'}>
                  {linked.data.thesis.visibility === 'public' ? 'Public' : 'Private'}
                </StatusBadge>
                <span className="text-text-muted"> · {linked.data.sources.length} source(s)</span>
              </p>
              <p className="text-supporting text-text-muted">{linked.data.revision.claim}</p>
              <p className="text-caption text-text-muted">
                Shortlist: {shortlist.length} instrument(s), {missing.length} not yet in the basket.
              </p>
              {missing.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onChange((current) =>
                      missing.reduce(
                        (next, reference) => addLeg(next, reference.instrumentId),
                        current,
                      ),
                    )
                  }
                >
                  Add the shortlist as constituents at 0.00%
                </Button>
              ) : null}
            </div>
          ) : linked.error ? (
            <Notice tone="attention" title="The linked thesis could not be read">
              It may have been archived or belong to another account; the link stays until you
              change it.
            </Notice>
          ) : (
            <p className="text-supporting text-text-muted" aria-busy="true">
              Reading the thesis…
            </p>
          )
        ) : null}
      </section>
      <Notice
        tone="info"
        title="Research happens in the workspace"
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/research">Open research</Link>
          </Button>
        }
      >
        Sources, statements and bounded runs live with the thesis; a basket only references the
        exact instruments you chose.
      </Notice>
    </div>
  );
}
