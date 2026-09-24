import type { Metadata } from 'next';
import { PrivateGate } from '@/features/auth/private-gate';
import { SettingsView } from '@/features/settings/settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <PrivateGate title="Settings">
      <SettingsView />
    </PrivateGate>
  );
}
