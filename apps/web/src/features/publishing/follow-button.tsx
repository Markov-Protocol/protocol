'use client';

import { Button } from '@markov/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { useFollow, useFollows, useUnfollow } from './queries';

/** Follow subscribes the person to new versions on their Build page; it buys nothing and pins nothing. */
export function FollowButton({ strategyId }: { readonly strategyId: string }) {
  const { state } = useSession();
  const pathname = usePathname();
  const signedIn = state.status === 'signed-in';
  const follows = useFollows(signedIn);
  const follow = useFollow();
  const unfollow = useUnfollow();
  const [error, setError] = useState<string | null>(null);
  if (!signedIn) {
    return (
      <Button asChild variant="secondary">
        <Link href={signInHref(pathname)}>Sign in to follow</Link>
      </Button>
    );
  }
  const following = follows.data?.follows.some((entry) => entry.strategyId === strategyId) ?? false;
  const pending = follow.isPending || unfollow.isPending;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={following ? 'secondary' : 'primary'}
        loading={pending}
        disabled={follows.isPending}
        aria-pressed={following}
        data-testid="follow-button"
        onClick={() => {
          setError(null);
          const action = following ? unfollow : follow;
          action.mutate(strategyId, {
            onError: (failure) =>
              setError(
                failure instanceof WebApiError ? failure.message : 'Could not change the follow.',
              ),
          });
        }}
      >
        {following ? 'Following' : 'Follow'}
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
