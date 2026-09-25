import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ReceiptView } from '@/features/execution/receipt-view';

/** A receipt is private unless its owner opted it into public reading; the API decides per request. */
export const metadata: Metadata = { title: 'Receipt', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly receiptId: string }> };

export default async function Page({ params }: Params) {
  const { receiptId } = await params;
  if (!idSchema.safeParse(receiptId).success) {
    notFound();
  }
  return (
    <Suspense fallback={null}>
      <ReceiptView receiptId={receiptId} />
    </Suspense>
  );
}
