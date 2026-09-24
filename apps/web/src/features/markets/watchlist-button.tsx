'use client';

import type { Instrument } from '@markov/contracts';
import { Button } from '@markov/ui';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { useRemoveSavedInstrument, useSaveInstrument, useWatchlist } from './queries';

/**
 * Save or remove one instrument. Anonymous people get a sign-in link that
 * returns here; a list edited on another device is refreshed and the
 * person is told to try again rather than silently overwriting it.
 */
export function WatchlistButton({
  instrument,
  returnTo,
  size = 'sm',
}: {
  readonly instrument: Pick<Instrument, 'instrumentId' | 'symbol' | 'status'>;
  readonly returnTo: string;
  readonly size?: 'sm' | 'md';
}) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const watchlist = useWatchlist(signedIn);
  const save = useSaveInstrument();
  const remove = useRemoveSavedInstrument();
  const [message, setMessage] = useState<string | null>(null);
  if (!signedIn) {
    return (
      <Button asChild size={size} variant="secondary">
        <Link href={signInHref(returnTo)} aria-label={`Sign in to save ${instrument.symbol}`}>
          <Bookmark aria-hidden="true" className="size-4" />
          Sign in to save
        </Link>
      </Button>
    );
  }
  const saved =
    watchlist.data?.items.some((item) => item.instrumentId === instrument.instrumentId) ?? false;
  const version = watchlist.data?.version ?? null;
  const busy = save.isPending || remove.isPending;
  const saveable = instrument.status === 'admitted' || instrument.status === 'paused';
  const onError = (error: unknown) => {
    if (error instanceof WebApiError && error.code === 'IDEMPOTENCY_CONFLICT') {
      setMessage('Your watchlist changed on another device; it was refreshed. Try again.');
      return;
    }
    if (error instanceof WebApiError && error.code === 'ASSET_NOT_ADMITTED') {
      setMessage('This instrument is no longer admitted and cannot be saved.');
      return;
    }
    setMessage(
      error instanceof WebApiError ? error.message : 'The watchlist could not be updated.',
    );
  };
  const toggle = () => {
    setMessage(null);
    const input = { instrumentId: instrument.instrumentId, ifVersion: version };
    if (saved) {
      remove.mutate(input, { onError });
    } else {
      save.mutate(input, { onError });
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size={size}
        variant={saved ? 'primary' : 'secondary'}
        onClick={toggle}
        loading={busy}
        aria-pressed={saved}
        aria-label={`${saved ? 'Remove' : 'Save'} ${instrument.symbol} ${saved ? 'from' : 'to'} your watchlist`}
        {...(!saved && !saveable
          ? { disabledReason: 'Only admitted or paused instruments can be saved.' }
          : {})}
        {...(watchlist.isPending ? { disabledReason: 'Loading your watchlist…' } : {})}
      >
        {saved ? (
          <BookmarkCheck aria-hidden="true" className="size-4" />
        ) : (
          <Bookmark aria-hidden="true" className="size-4" />
        )}
        {saved ? 'Saved' : 'Save'}
      </Button>
      {message ? (
        <span role="status" className="text-caption text-error">
          {message}
        </span>
      ) : null}
    </span>
  );
}
