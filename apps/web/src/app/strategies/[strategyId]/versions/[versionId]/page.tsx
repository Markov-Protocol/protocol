import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { VersionView } from '@/features/publishing/version-view';
import { publicVersionMetadata } from '@/server/public-metadata';

export const dynamic = 'force-dynamic';

type Params = {
  readonly params: Promise<{ readonly strategyId: string; readonly versionId: string }>;
};

/** Title from the registered projection only (anonymous read); a private or unknown version gets the generic title. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { strategyId, versionId } = await params;
  if (!idSchema.safeParse(strategyId).success || !idSchema.safeParse(versionId).success) {
    return { title: 'Strategy version' };
  }
  return publicVersionMetadata(strategyId, versionId);
}

/** Exact-id route for one immutable version: the owner's registration panel, or the public projection with chain evidence. */
export default async function Page({ params }: Params) {
  const { strategyId, versionId } = await params;
  if (!idSchema.safeParse(strategyId).success || !idSchema.safeParse(versionId).success) {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <VersionView strategyId={strategyId} versionId={versionId} />
    </Suspense>
  );
}
