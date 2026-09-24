'use client';

import { useSession } from '@/features/auth/session-context';
import { HomeView } from './home-view';

/** Chooses the home variant from the verified session state; never from a URL or stored role. */
export function HomeGate() {
  const { state, verifying, revalidate } = useSession();
  if (verifying && state.status === 'signed-in') {
    return <HomeView state="auth-loading" />;
  }
  switch (state.status) {
    case 'signed-in':
      return <HomeView state="signed-in" account={state.account} />;
    case 'unavailable':
      return <HomeView state="unavailable" onRetry={() => void revalidate()} />;
    default:
      return <HomeView state="anonymous" />;
  }
}
