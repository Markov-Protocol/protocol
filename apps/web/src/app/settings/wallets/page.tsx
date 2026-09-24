import type { Metadata } from 'next';
import { PrivateGate } from '@/features/auth/private-gate';
import { WalletsView } from '@/features/wallets/wallets-view';

export const metadata: Metadata = { title: 'Wallets' };

export default function Page() {
  return (
    <PrivateGate title="Wallets">
      <WalletsView />
    </PrivateGate>
  );
}
