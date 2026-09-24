import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExploreView } from '@/features/markets/explore-view';

export const metadata: Metadata = { title: 'Explore' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ExploreView />
    </Suspense>
  );
}
