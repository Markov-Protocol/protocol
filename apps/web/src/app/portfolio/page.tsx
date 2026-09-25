import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { PortfolioView } from '@/features/portfolio/portfolio-view';

export const metadata: Metadata = { title: 'Portfolio', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <PrivateGate title="Portfolio">
      <Suspense fallback={null}>
        <PortfolioView />
      </Suspense>
    </PrivateGate>
  );
}
