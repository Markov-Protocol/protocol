import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { BasketDraftsView } from '@/features/research/basket-drafts-view';

export const metadata: Metadata = { title: 'Build a strategy' };
export const dynamic = 'force-dynamic';

/** Static path, never a strategy id. Lists the person's basket drafts until the F07 editor arrives. */
export default function Page() {
  return (
    <PrivateGate title="Build a strategy">
      <Suspense fallback={null}>
        <BasketDraftsView />
      </Suspense>
    </PrivateGate>
  );
}
