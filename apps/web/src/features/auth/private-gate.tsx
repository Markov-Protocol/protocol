'use client';

import { Button, ErrorBlock, Skeleton, SkeletonText } from '@markov/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { signInHref } from './return-path';
import { useSession } from './session-context';

/**
 * Renders private content only for a server-verified session. Signed-out
 * and expired sessions get a sign-in link that returns here; an
 * unreachable backend is an error, never an empty private page.
 */
export function PrivateGate({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const { state, verifying, revalidate } = useSession();
  const pathname = usePathname();
  if (verifying && state.status === 'signed-in') {
    return (
      <section
        aria-busy="true"
        aria-label={`Loading ${title}`}
        className="mx-auto max-w-3xl space-y-4 px-4 py-8"
      >
        <Skeleton className="h-8 w-1/2" />
        <SkeletonText lines={3} />
      </section>
    );
  }
  if (state.status === 'signed-in') {
    return <>{children}</>;
  }
  if (state.status === 'unavailable') {
    return (
      <section className="mx-auto max-w-3xl px-4 py-8">
        <ErrorBlock
          title="Markov cannot verify your session"
          message="The backend is unreachable, so nothing private is shown. Try again shortly."
          onRetry={() => void revalidate()}
        />
      </section>
    );
  }
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 py-8">
      <h1 className="text-heading-lg font-semibold">{title}</h1>
      <p className="text-body text-text-muted">
        {state.status === 'expired'
          ? 'Your session expired. Sign in again to continue where you were.'
          : 'Sign in to see this page.'}
      </p>
      <Button asChild>
        <Link href={signInHref(pathname)}>
          {state.status === 'expired' ? 'Sign in again' : 'Sign in'}
        </Link>
      </Button>
    </section>
  );
}
