'use client';

import { Button } from '@markov/ui';
import Link from 'next/link';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';

/**
 * "Review investment": opens the review for exactly one immutable version.
 * Signed-out people are sent to sign in and come back here; a strategy
 * without a version to invest in says so instead of pretending.
 */
export function ReviewInvestmentLink({
  strategyId,
  versionId,
  versionNumber,
  unavailableReason,
}: {
  readonly strategyId: string;
  readonly versionId: string | null;
  readonly versionNumber?: number | null;
  readonly unavailableReason?: string;
}) {
  const { state } = useSession();
  if (versionId === null) {
    return (
      <Button
        type="button"
        disabledReason={
          unavailableReason ?? 'No version to invest in yet; a review needs a frozen version.'
        }
      >
        Review investment
      </Button>
    );
  }
  const href = `/review/new?strategyId=${strategyId}&versionId=${versionId}`;
  return (
    <Button asChild data-testid="review-investment">
      <Link href={state.status === 'signed-in' ? href : signInHref(href)}>
        Review investment{versionNumber ? ` (version ${versionNumber})` : ''}
      </Link>
    </Button>
  );
}
