import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { ReviewView } from '@/features/review/review-view';

/** Reviews are private; the title never carries the budget, wallet or strategy. */
export const metadata: Metadata = { title: 'Review', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly intentId: string }> };

export default async function Page({ params }: Params) {
  const { intentId } = await params;
  if (!idSchema.safeParse(intentId).success) {
    notFound();
  }
  return (
    <PrivateGate title="Review">
      <Suspense fallback={null}>
        <ReviewView intentId={intentId} />
      </Suspense>
    </PrivateGate>
  );
}
