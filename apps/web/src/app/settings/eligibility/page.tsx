import type { Metadata } from 'next';
import { PrivateGate } from '@/features/auth/private-gate';
import { EligibilityView } from '@/features/eligibility/eligibility-view';

export const metadata: Metadata = { title: 'Eligibility and terms' };

export default function Page() {
  return (
    <PrivateGate title="Eligibility and terms">
      <EligibilityView />
    </PrivateGate>
  );
}
