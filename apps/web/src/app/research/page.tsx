import type { Metadata } from 'next';
import { PrivateGate } from '@/features/auth/private-gate';
import { WorkspaceView } from '@/features/research/workspace-view';

export const metadata: Metadata = { title: 'Research' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <PrivateGate title="Research">
      <WorkspaceView />
    </PrivateGate>
  );
}
