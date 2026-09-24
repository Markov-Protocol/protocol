'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useSession } from './session-context';

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * One private cache per principal and session epoch. When the account
 * changes, expires or signs out, the previous client is cancelled, cleared
 * and unmounted; nothing from it is ever shown under the next account.
 * The `key` below remounts the subtree so no component keeps a stale
 * reference either.
 */
export function PrivateQueryProvider({ children }: { readonly children: ReactNode }) {
  const { principalKey, epoch } = useSession();
  const scope = `${principalKey}#${epoch}`;
  const [clients] = useState(() => new Map<string, QueryClient>());
  let client = clients.get(scope);
  if (!client) {
    client = createClient();
    clients.set(scope, client);
  }
  useEffect(() => {
    for (const [otherScope, other] of clients) {
      if (otherScope !== scope) {
        void other.cancelQueries();
        other.clear();
        other.unmount();
        clients.delete(otherScope);
      }
    }
    return undefined;
  }, [scope, clients]);
  return (
    <QueryClientProvider key={scope} client={client}>
      {children}
    </QueryClientProvider>
  );
}
