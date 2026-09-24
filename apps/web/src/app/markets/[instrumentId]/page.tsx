import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketDetailView } from '@/features/markets/market-detail-view';

export const metadata: Metadata = { title: 'Market' };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly instrumentId: string }> };

/** Exact-id route: a canonical Markov instrument id, never a ticker. */
export default async function Page({ params }: Params) {
  const { instrumentId } = await params;
  if (!idSchema.safeParse(instrumentId).success) {
    notFound();
  }
  return <MarketDetailView instrumentId={instrumentId} />;
}
