import { idSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PrivateGate } from '@/features/auth/private-gate';
import { InstanceView } from '@/features/portfolio/instance-view';

export const metadata: Metadata = {
  title: 'Strategy instance',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

type Params = { readonly params: Promise<{ readonly instanceId: string }> };

export default async function Page({ params }: Params) {
  const { instanceId } = await params;
  if (!idSchema.safeParse(instanceId).success) {
    notFound();
  }
  return (
    <PrivateGate title="Strategy instance">
      <Suspense fallback={null}>
        <InstanceView instanceId={instanceId} />
      </Suspense>
    </PrivateGate>
  );
}
