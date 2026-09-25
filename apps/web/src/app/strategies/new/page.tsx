import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { NewBasketView } from '@/features/builder/new-basket-view';

export const metadata: Metadata = { title: 'Build a strategy' };
export const dynamic = 'force-dynamic';

/** Static path, never a strategy id: start a basket draft or resume one. */
export default function Page() {
  return (
    <PrivateGate title="Build a strategy">
      <Suspense fallback={null}>
        <NewBasketView />
      </Suspense>
    </PrivateGate>
  );
}
