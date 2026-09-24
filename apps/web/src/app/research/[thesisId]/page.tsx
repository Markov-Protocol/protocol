import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ThesisView } from '@/features/research/thesis-view';

export const metadata: Metadata = { title: 'Thesis' };
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly thesisId: string }> };

/** Exact-id route: the owner edits, anyone else sees the published projection or "not found". */
export default async function Page({ params }: Params) {
  const { thesisId } = await params;
  if (!idSchema.safeParse(thesisId).success) {
    notFound();
  }
  return <ThesisView thesisId={thesisId} />;
}
