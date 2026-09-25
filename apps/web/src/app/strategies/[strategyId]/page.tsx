import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { StrategyView } from '@/features/publishing/strategy-view';
import { publicStrategyMetadata } from '@/server/public-metadata';

export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly strategyId: string }> };

/** Title from the registered projection only (anonymous read); a private or unknown strategy gets the generic title. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { strategyId } = await params;
  if (!idSchema.safeParse(strategyId).success) {
    return { title: 'Strategy' };
  }
  return publicStrategyMetadata(strategyId);
}

/** Exact-id route: the owner sees the draft and versions, anyone else the registered projection or "not found". `/strategies/new` is static and never lands here. */
export default async function Page({ params }: Params) {
  const { strategyId } = await params;
  if (!idSchema.safeParse(strategyId).success) {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <StrategyView strategyId={strategyId} />
    </Suspense>
  );
}
