import type { Metadata } from 'next';
import { PrivateGate } from '@/features/auth/private-gate';
import { ReviewsIndexView } from '@/features/review/reviews-index-view';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <PrivateGate title="Reviews">
      <ReviewsIndexView />
    </PrivateGate>
  );
}
