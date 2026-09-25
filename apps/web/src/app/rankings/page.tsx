import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RankingsView } from '@/features/discovery/rankings-view';

export const metadata: Metadata = { title: 'Rankings' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RankingsView />
    </Suspense>
  );
}
