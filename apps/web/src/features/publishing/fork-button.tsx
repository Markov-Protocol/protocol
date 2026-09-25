'use client';

import { Button } from '@markov/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { useForkVersion } from './queries';

/** Fork copies a version into a new private draft of the person's own, with attribution; nothing is traded. */
export function ForkButton({
  strategyId,
  versionId,
  versionNumber,
  variant = 'secondary',
}: {
  readonly strategyId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly variant?: 'primary' | 'secondary';
}) {
  const { state } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const fork = useForkVersion(strategyId);
  const [error, setError] = useState<string | null>(null);
  if (state.status !== 'signed-in') {
    return (
      <Button asChild variant={variant}>
        <Link href={signInHref(pathname)}>Sign in to fork</Link>
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        loading={fork.isPending}
        data-testid="fork-button"
        onClick={() => {
          setError(null);
          fork.mutate(versionId, {
            onSuccess: (detail) =>
              router.push(`/strategies/${detail.strategy.strategyId}/edit?stage=assemble`),
            onError: (failure) =>
              setError(failure instanceof WebApiError ? failure.message : 'Could not fork.'),
          });
        }}
      >
        Fork version {versionNumber} into a new draft
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
