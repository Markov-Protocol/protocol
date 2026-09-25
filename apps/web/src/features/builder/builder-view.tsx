'use client';

import {
  type StrategyDetail,
  type StrategyDraft,
  type StrategyDraftContent,
  strategyDetailSchema,
} from '@markov/contracts';
import { formatBasisPoints } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  Skeleton,
  SkeletonText,
  StatusBadge,
} from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { useInstrument } from '../markets/queries';
import { ActivateStage, type PlanInputs } from './activate-stage';
import { AssembleStage } from './assemble-stage';
import {
  contentEquals,
  diffContent,
  localIssues,
  parseStage,
  STAGES,
  type Stage,
} from './draft-state';
import {
  clearLocalBasketCopy,
  type LocalBasketCopy,
  localBasketKey,
  readLocalBasketCopy,
  writeLocalBasketCopy,
} from './local-copy';
import { useSaveDraft, useSetStrategyStatus, useStrategy } from './queries';
import { ResearchStage } from './research-stage';
import { RulesStage } from './rules-stage';
import { type SaveState, SaveStatus } from './save-status';
import { DraftSummary, StickyTotal } from './summary';

const AUTOSAVE_DELAY_MS = 1200;

function LegLabel({ instrumentId }: { readonly instrumentId: string }) {
  const instrument = useInstrument(instrumentId);
  return <>{instrument.data?.symbol ?? instrumentId.slice(0, 8)}</>;
}

function ConflictPanel({
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
}: {
  readonly mine: StrategyDraftContent;
  readonly theirs: StrategyDraft;
  readonly onKeepMine: () => void;
  readonly onTakeTheirs: () => void;
}) {
  const diff = diffContent(mine, theirs.content);
  return (
    <section
      className="space-y-3 rounded-panel border border-border p-4"
      aria-label="Draft saved elsewhere"
      data-testid="conflict-panel"
    >
      <h2 className="text-heading-sm font-semibold">
        This draft was saved elsewhere (revision {theirs.revision})
      </h2>
      <p className="text-supporting text-text-muted">
        Another tab or device saved a newer revision. Nothing was overwritten. Compare, then choose
        which edits go forward; the other set stays in the revision you do not pick.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-supporting" aria-label="Differences">
        {diff.same ? <li>Your edits and the server revision are identical.</li> : null}
        {diff.legs.added.map((leg) => (
          <li key={`a-${leg.instrumentId}`}>
            You added <LegLabel instrumentId={leg.instrumentId} /> at{' '}
            {formatBasisPoints(leg.weightBps)}.
          </li>
        ))}
        {diff.legs.removed.map((leg) => (
          <li key={`r-${leg.instrumentId}`}>
            The server revision has <LegLabel instrumentId={leg.instrumentId} /> at{' '}
            {formatBasisPoints(leg.weightBps)}; yours does not.
          </li>
        ))}
        {diff.legs.changed.map((leg) => (
          <li key={`c-${leg.instrumentId}`}>
            <LegLabel instrumentId={leg.instrumentId} />: {formatBasisPoints(leg.fromBps)} on the
            server, {formatBasisPoints(leg.toBps)} here.
          </li>
        ))}
        {diff.cash ? (
          <li>
            Cash: {formatBasisPoints(diff.cash.from)} on the server,{' '}
            {formatBasisPoints(diff.cash.to)} here.
          </li>
        ) : null}
        {diff.titleChanged ? <li>The title differs.</li> : null}
        {diff.thesisChanged ? <li>The thesis text differs.</li> : null}
        {diff.rulesChanged ? <li>The rules, references or linked thesis differ.</li> : null}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onKeepMine}>
          Keep my edits (save as revision {theirs.revision + 1})
        </Button>
        <Button type="button" variant="secondary" onClick={onTakeTheirs}>
          Take the server revision
        </Button>
      </div>
    </section>
  );
}

function Builder({ detail }: { readonly detail: StrategyDetail }) {
  const strategyId = detail.strategy.strategyId;
  const { principalKey } = useSession();
  const api = useMarkovApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const stage = parseStage(params.get('stage'));
  const save = useSaveDraft(strategyId);
  const setStatus = useSetStrategyStatus(strategyId);
  const copyKey = localBasketKey(principalKey, strategyId);

  const [content, setContent] = useState<StrategyDraftContent>(detail.draft.content);
  const [server, setServer] = useState<StrategyDraft>(detail.draft);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [conflict, setConflict] = useState<StrategyDraft | null>(null);
  const [localCopy, setLocalCopy] = useState<LocalBasketCopy | null>(null);
  const [plan, setPlan] = useState<PlanInputs>({ walletId: null, budgetRaw: null });
  const latest = useRef(content);
  latest.current = content;
  const serverRef = useRef(server);
  serverRef.current = server;
  const dirty = !contentEquals(content, server.content);
  const archived = detail.strategy.status === 'archived';
  const issues = useMemo(
    () => localIssues(content, { maxLegs: server.validation.limits.maxLegs }),
    [content, server.validation.limits.maxLegs],
  );

  // Unsaved edits kept on this device from an earlier visit (offline save).
  useEffect(() => {
    const copy = readLocalBasketCopy(copyKey);
    if (!copy) {
      return;
    }
    if (contentEquals(copy.content, detail.draft.content)) {
      clearLocalBasketCopy(copyKey);
      return;
    }
    setLocalCopy(copy);
  }, [copyKey, detail.draft.content]);

  const runSave = useCallback(() => {
    const snapshot = latest.current;
    const base = serverRef.current.revision;
    setSaveState({ status: 'saving' });
    save.mutate(
      { content: snapshot, ifRevision: base },
      {
        onSuccess: (draft) => {
          setServer(draft);
          clearLocalBasketCopy(copyKey);
          setSaveState({ status: 'saved', revision: draft.revision, at: draft.updatedAt });
        },
        onError: async (error) => {
          if (error instanceof WebApiError && error.code === 'IDEMPOTENCY_CONFLICT') {
            try {
              const current = await api.get(
                `/v1/me/strategies/${strategyId}`,
                strategyDetailSchema,
              );
              setConflict(current.draft);
            } catch {
              setConflict(null);
            }
            setSaveState({ status: 'conflict' });
            return;
          }
          if (error instanceof WebApiError && error.status === 0) {
            writeLocalBasketCopy(copyKey, { baseRevision: base, content: snapshot });
            setSaveState({
              status: 'offline',
              message: 'Markov could not be reached; retrying when you edit again.',
            });
            return;
          }
          setSaveState({
            status: 'failed',
            message: error instanceof WebApiError ? error.message : 'The draft could not be saved.',
          });
        },
      },
    );
  }, [api, copyKey, save, strategyId]);

  // Autosave: revision-checked, debounced, paused while a conflict or a failure waits for a decision.
  useEffect(() => {
    if (
      !dirty ||
      archived ||
      conflict ||
      saveState.status === 'saving' ||
      saveState.status === 'failed'
    ) {
      return;
    }
    const handle = setTimeout(runSave, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [dirty, archived, conflict, saveState.status, runSave]);

  useEffect(() => {
    if (!dirty && saveState.status !== 'offline') {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saveState.status]);

  const change = (next: (current: StrategyDraftContent) => StrategyDraftContent) => {
    if (archived) {
      return;
    }
    setContent((current) => next(current));
    if (saveState.status === 'failed') {
      setSaveState({ status: 'idle' });
    }
  };
  const goTo = (next: Stage) => router.replace(`${pathname}?stage=${next}`);
  const stageIndex = STAGES.findIndex((item) => item.key === stage);
  const nextStage = STAGES[stageIndex + 1] ?? null;
  const legLabelOf = (path: string) => {
    const index = Number.parseInt(path.slice('legs/'.length), 10);
    const leg = content.legs[index];
    return leg ? `Constituent ${index + 1}` : path;
  };
  const errorCount = dirty
    ? issues.length
    : server.validation.issues.filter((issue) => issue.severity === 'error').length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <p className="text-caption">
          <Link href="/strategies/new" className="underline underline-offset-2">
            Build
          </Link>{' '}
          <span className="text-text-muted">/ basket draft</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-heading-lg font-semibold" title={content.title}>
            {content.title || 'Untitled basket'}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={archived ? 'attention' : 'neutral'}>
              {archived ? 'Archived' : 'Draft'}
            </StatusBadge>
            {detail.versions.length > 0 ? (
              <StatusBadge tone="info">
                {detail.versions.length} frozen version{detail.versions.length === 1 ? '' : 's'}
              </StatusBadge>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate(archived ? 'active' : 'archived')}
            >
              {archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </div>
        <SaveStatus state={saveState} dirty={dirty} onRetry={runSave} />
        {archived ? (
          <Notice tone="attention" title="Archived">
            An archived draft takes no edits; restore it to continue. Nothing was deleted.
          </Notice>
        ) : null}
        {localCopy ? (
          <Notice
            tone="attention"
            title="Unsaved edits from this device"
            actions={
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setContent(localCopy.content);
                    if (localCopy.baseRevision !== server.revision) {
                      setConflict(server);
                    }
                    setLocalCopy(null);
                  }}
                >
                  Restore them
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearLocalBasketCopy(copyKey);
                    setLocalCopy(null);
                  }}
                >
                  Discard
                </Button>
              </>
            }
          >
            Edits made while Markov could not be reached were kept on this device (started from
            revision {localCopy.baseRevision}; the server holds revision {server.revision}).
          </Notice>
        ) : null}
        {conflict ? (
          <ConflictPanel
            mine={content}
            theirs={conflict}
            onKeepMine={() => {
              setServer(conflict);
              setConflict(null);
              setSaveState({ status: 'idle' });
            }}
            onTakeTheirs={() => {
              setContent(conflict.content);
              setServer(conflict);
              setConflict(null);
              clearLocalBasketCopy(copyKey);
              setSaveState({
                status: 'saved',
                revision: conflict.revision,
                at: conflict.updatedAt,
              });
            }}
          />
        ) : null}
        <nav aria-label="Stages">
          <ol className="flex flex-wrap gap-2">
            {STAGES.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => goTo(item.key)}
                  aria-current={item.key === stage ? 'step' : undefined}
                  className={`rounded-panel border px-3 py-1.5 text-supporting ${item.key === stage ? 'border-text bg-surface-raised font-medium' : 'border-border/60'}`}
                >
                  <span className="font-mono text-caption text-text-muted">{item.number}</span>{' '}
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-caption text-text-muted">{STAGES[stageIndex]?.copy}</p>
        </nav>
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
        <main className="min-w-0 space-y-6" aria-live="off">
          {stage === 'research' ? <ResearchStage content={content} onChange={change} /> : null}
          {stage === 'assemble' ? (
            <AssembleStage
              content={content}
              maxLegs={server.validation.limits.maxLegs}
              issues={
                dirty
                  ? issues
                  : server.validation.issues.filter((issue) => issue.severity === 'error')
              }
              readOnly={archived}
              onChange={change}
            />
          ) : null}
          {stage === 'rules' ? <RulesStage content={content} onChange={change} /> : null}
          {stage === 'activate' ? (
            <ActivateStage
              content={content}
              server={server}
              dirty={dirty}
              plan={plan}
              onPlanChange={setPlan}
            />
          ) : null}
        </main>
        <aside className="mt-6 space-y-3 lg:sticky lg:top-4 lg:mt-0">
          <DraftSummary
            content={content}
            server={server}
            localIssues={issues}
            dirty={dirty}
            legLabel={legLabelOf}
          />
          {nextStage ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => goTo(nextStage.key)}
            >
              Continue to {nextStage.number} {nextStage.label}
            </Button>
          ) : null}
        </aside>
      </div>
      <StickyTotal content={content} errorCount={errorCount} />
    </div>
  );
}

export function BuilderView({ strategyId }: { readonly strategyId: string }) {
  const detail = useStrategy(strategyId, true);
  if (detail.isPending) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading basket draft"
        className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6"
      >
        <Skeleton className="h-8 w-1/2" />
        <SkeletonText lines={4} />
      </section>
    );
  }
  if (detail.error) {
    const notFound = detail.error instanceof WebApiError && detail.error.status === 404;
    return (
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {notFound ? (
          <EmptyState
            title="No basket draft with that id"
            description="Only your own drafts open here. The id may be wrong, or the draft belongs to another account."
            action={
              <Button asChild variant="secondary">
                <Link href="/strategies/new">Your drafts</Link>
              </Button>
            }
          />
        ) : (
          <ErrorBlock
            title="The draft could not be read"
            message={
              detail.error instanceof WebApiError ? detail.error.message : 'Try again in a moment.'
            }
            onRetry={() => void detail.refetch()}
          />
        )}
      </section>
    );
  }
  return <Builder key={detail.data.strategy.strategyId} detail={detail.data} />;
}
