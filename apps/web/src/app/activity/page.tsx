import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { ActivityView } from '@/features/execution/activity-view';

export const metadata: Metadata = { title: 'Activity', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <PrivateGate title="Activity">
      <Suspense fallback={null}>
        <ActivityView />
      </Suspense>
    </PrivateGate>
  );
}
