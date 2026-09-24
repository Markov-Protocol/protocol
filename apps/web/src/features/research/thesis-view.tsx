'use client';

import { Button, EmptyState, ErrorBlock, Skeleton, SkeletonText } from '@markov/ui';
import Link from 'next/link';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { PublicThesisView } from './public-thesis-view';
import { usePublicThesis, useThesis } from './queries';
import { ThesisEditor } from './thesis-editor';

function isNotFound(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 404;
}

/**
 * One thesis by id. The owner gets the editor; everyone else gets the
 * published projection when there is one. A private or unknown thesis is
 * "not found" for both, never a hint about whose it is.
 */
export function ThesisView({ thesisId }: { readonly thesisId: string }) {
  const { state, verifying } = useSession();
  const signedIn = state.status === 'signed-in';
  const own = useThesis(thesisId, signedIn && !verifying);
  const ownMissing = signedIn && !own.isPending && own.error !== null && isNotFound(own.error);
  const publicThesis = usePublicThesis(thesisId, (!signedIn && !verifying) || ownMissing);

  if (
    (signedIn && (own.isPending || verifying)) ||
    (!signedIn && (publicThesis.isPending || verifying))
  ) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading thesis"
        className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6"
      >
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={4} />
      </section>
    );
  }
  if (signedIn && own.data) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ThesisEditor detail={own.data} />
      </section>
    );
  }
  if (signedIn && own.error && !ownMissing) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The thesis could not be read"
          message={own.error instanceof WebApiError ? own.error.message : 'Try again in a moment.'}
          onRetry={() => void own.refetch()}
        />
      </section>
    );
  }
  if (publicThesis.data) {
    return (
      <section className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/ published thesis</span>
        </p>
        <PublicThesisView thesis={publicThesis.data} />
      </section>
    );
  }
  if (publicThesis.isPending && ownMissing) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading thesis"
        className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6"
      >
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={4} />
      </section>
    );
  }
  if (publicThesis.error && !isNotFound(publicThesis.error)) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The thesis could not be read"
          message={
            publicThesis.error instanceof WebApiError
              ? publicThesis.error.message
              : 'Try again in a moment.'
          }
          onRetry={() => void publicThesis.refetch()}
        />
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <EmptyState
        title="No thesis with that id, or it is private"
        description="Only a thesis its author published has a public page. If it is yours, sign in with the account that owns it."
        action={
          <Button asChild variant="secondary">
            <Link href="/research">Your research</Link>
          </Button>
        }
      />
    </section>
  );
}
