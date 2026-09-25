import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { BuilderView } from '@/features/builder/builder-view';

export const metadata: Metadata = { title: 'Basket draft' };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly strategyId: string }> };

/** Exact-id route for the owner's draft; `/strategies/new` is a static path and never lands here. */
export default async function Page({ params }: Params) {
  const { strategyId } = await params;
  if (!idSchema.safeParse(strategyId).success) {
    notFound();
  }
  return (
    <PrivateGate title="Basket draft">
      <Suspense fallback={null}>
        <BuilderView strategyId={strategyId} />
      </Suspense>
    </PrivateGate>
  );
}
