import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { StartReviewView } from '@/features/review/start-review-view';

export const metadata: Metadata = { title: 'Review an investment' };
export const dynamic = 'force-dynamic';

/** Static path: the target comes from the query string, validated on the client and again by the API. */
export default function Page() {
  return (
    <PrivateGate title="Review an investment">
      <Suspense fallback={null}>
        <StartReviewView />
      </Suspense>
    </PrivateGate>
  );
}
