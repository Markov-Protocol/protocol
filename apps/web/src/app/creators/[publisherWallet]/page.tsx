import { base58AddressSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CreatorView } from '@/features/discovery/creator-view';

export const metadata: Metadata = { title: 'Creator' };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly publisherWallet: string }> };

/** Exact-address route: a creator is the wallet that registered versions on chain; anything else is not found. */
export default async function Page({ params }: Params) {
  const { publisherWallet } = await params;
  if (!base58AddressSchema.safeParse(publisherWallet).success) {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <CreatorView publisherWallet={publisherWallet} />
    </Suspense>
  );
}
