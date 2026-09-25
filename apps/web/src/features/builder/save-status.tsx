'use client';

import { formatRelativeAge } from '@markov/formatters';
import { Button, StatusBadge } from '@markov/ui';

export type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'saved'; readonly revision: number; readonly at: string }
  | { readonly status: 'offline'; readonly message: string }
  | { readonly status: 'conflict' }
  | { readonly status: 'failed'; readonly message: string };

/** Saving, Saved, Offline changes, Conflict: always visible, never hidden behind a tooltip. */
export function SaveStatus({
  state,
  dirty,
  onRetry,
}: {
  readonly state: SaveState;
  readonly dirty: boolean;
  readonly onRetry: () => void;
}) {
  const text =
    state.status === 'saving'
      ? 'Saving…'
      : state.status === 'saved'
        ? `Saved as revision ${state.revision} ${formatRelativeAge(state.at)}${dirty ? ' · unsaved edits' : ''}`
        : state.status === 'offline'
          ? `Offline changes kept on this device: ${state.message}`
          : state.status === 'conflict'
            ? 'Conflict: this draft was saved elsewhere'
            : state.status === 'failed'
              ? state.message
              : dirty
                ? 'Unsaved edits'
                : 'Saved';
  const tone =
    state.status === 'offline' || state.status === 'conflict' || state.status === 'failed'
      ? 'attention'
      : state.status === 'saving'
        ? 'pending'
        : dirty
          ? 'neutral'
          : 'success';
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 text-supporting"
      data-testid="save-status"
    >
      <StatusBadge tone={tone}>
        {state.status === 'saving'
          ? 'Saving'
          : state.status === 'offline'
            ? 'Offline changes'
            : state.status === 'conflict'
              ? 'Conflict'
              : state.status === 'failed'
                ? 'Not saved'
                : dirty
                  ? 'Editing'
                  : 'Saved'}
      </StatusBadge>
      <span className="text-text-muted">{text}</span>
      {state.status === 'offline' || state.status === 'failed' ? (
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          Retry save
        </Button>
      ) : null}
    </p>
  );
}
