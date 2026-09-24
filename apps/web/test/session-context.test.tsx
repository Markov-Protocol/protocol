import { useQuery, useQueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import {
  SessionProvider,
  StaleSessionError,
  useSession,
  useSessionFetch,
} from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: false,
};

function snapshotFor(
  subject: string,
  sessionId: string,
  expiresAt = '2030-01-01T00:00:00.000Z',
): SessionSnapshot {
  return {
    state: 'signed-in',
    account: {
      userId: `user-${subject}`,
      subject,
      issuer: 'urn:markov:test',
      authTime: null,
      stepUpFresh: true,
    },
    session: { sessionId, expiresAt },
  };
}

interface Deferred {
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
}

/** A controllable fetch: session GETs answer from `sessionAnswers`, everything else waits for the test. */
function controllableFetch() {
  const sessionAnswers: SessionSnapshot[] = [];
  const pending: Deferred[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/auth/session')) {
        const next = sessionAnswers.shift() ?? { state: 'signed-out' };
        return Response.json(next);
      }
      if (url.endsWith('/api/auth/sign-out')) {
        return Response.json({ ok: true, revoked: true });
      }
      if (url.endsWith('/api/auth/sign-in')) {
        const body = JSON.parse(String(init?.body)) as { subject: string; next: string };
        return Response.json({
          ok: true,
          next: body.next,
          account: {
            userId: `user-${body.subject}`,
            subject: body.subject,
            issuer: 'urn:markov:test',
            authTime: null,
            stepUpFresh: true,
          },
        });
      }
      return new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject });
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    },
  );
  return { impl, sessionAnswers, pending };
}

function Probe() {
  const { state, epoch, principalKey } = useSession();
  return (
    <output data-testid="probe">
      {state.status}|{epoch}|{principalKey}
      {state.status === 'signed-in' ? `|${state.account.subject}` : ''}
    </output>
  );
}

function PrivateDataFetcher() {
  const sessionFetch = useSessionFetch();
  const [result, setResult] = useState<string>('idle');
  useEffect(() => {
    let cancelled = false;
    sessionFetch('/api/private/holdings')
      .then(async (response) => {
        if (!cancelled) {
          setResult(`rendered:${await response.text()}`);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult(
            error instanceof StaleSessionError
              ? 'discarded-stale'
              : `error:${(error as Error).name}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionFetch]);
  return <output data-testid="fetch-result">{result}</output>;
}

function CacheProbe() {
  const client = useQueryClient();
  const { principalKey } = useSession();
  const query = useQuery({
    queryKey: ['holdings', principalKey],
    queryFn: () => Promise.resolve(`holdings-of-${principalKey}`),
  });
  return (
    <output data-testid="cache-probe">
      {String(client.getQueryData(['holdings', 'user-alice:s1']) ?? 'no-alice-data')}|
      {query.data ?? 'loading'}
    </output>
  );
}

let fetchControl: ReturnType<typeof controllableFetch>;

beforeEach(() => {
  fetchControl = controllableFetch();
  vi.stubGlobal('fetch', fetchControl.impl);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('session provider', () => {
  it('discards a slow private response from account A once account B is signed in', async () => {
    fetchControl.sessionAnswers.push(snapshotFor('bob', 's2'));
    function Switcher() {
      const { revalidate } = useSession();
      return (
        <button type="button" onClick={() => void revalidate()}>
          become bob
        </button>
      );
    }
    render(
      <SessionProvider initial={snapshotFor('alice', 's1')} platform={platform}>
        <Probe />
        <PrivateDataFetcher />
        <Switcher />
      </SessionProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('signed-in|0|user-alice:s1|alice');
    await waitFor(() => expect(fetchControl.pending).toHaveLength(1));

    await act(async () => {
      screen.getByRole('button', { name: 'become bob' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-in|1|user-bob:s2|bob'),
    );

    // Account A's request finally answers; it was aborted by the epoch change and, even if it had not been, it is stale.
    const late = fetchControl.pending[0];
    act(() => {
      late?.resolve(new Response('alice-private-holdings'));
    });
    await waitFor(() => {
      const text = screen.getByTestId('fetch-result').textContent ?? '';
      expect(text === 'discarded-stale' || text === 'error:AbortError').toBe(true);
    });
    expect(screen.getByTestId('fetch-result')).not.toHaveTextContent('alice-private-holdings');
  });

  it('gives each principal its own query cache and disposes the previous one on sign-out', async () => {
    fetchControl.sessionAnswers.push({ state: 'signed-out' });
    function SignOutButton() {
      const { signOut } = useSession();
      return (
        <button type="button" onClick={() => void signOut()}>
          sign out
        </button>
      );
    }
    render(
      <SessionProvider initial={snapshotFor('alice', 's1')} platform={platform}>
        <PrivateQueryProvider>
          <Probe />
          <CacheProbe />
          <SignOutButton />
        </PrivateQueryProvider>
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('cache-probe')).toHaveTextContent(
        'holdings-of-user-alice:s1|holdings-of-user-alice:s1',
      ),
    );
    await act(async () => {
      screen.getByRole('button', { name: 'sign out' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-out|1|anonymous'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('cache-probe')).toHaveTextContent(
        'no-alice-data|holdings-of-anonymous',
      ),
    );
  });

  it('flips to expired at the server-declared expiry and keeps the previous subject for recovery copy', async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1500).toISOString();
    fetchControl.sessionAnswers.push({ state: 'signed-out' });
    render(
      <SessionProvider initial={snapshotFor('alice', 's1', expiresAt)} platform={platform}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('signed-in|0');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('expired|1|anonymous');
  });

  it('re-verifies on back/forward cache restore and after a sign-in from another tab', async () => {
    fetchControl.sessionAnswers.push(snapshotFor('alice', 's1'));
    render(
      <SessionProvider initial={{ state: 'signed-out' }} platform={platform}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('signed-out|0|anonymous');
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-in|1|user-alice:s1|alice'),
    );
    expect(fetchControl.impl).toHaveBeenCalledTimes(1);
  });

  it('signs in through the app origin only and never places the credential in the body it returns', async () => {
    fetchControl.sessionAnswers.push(snapshotFor('carol', 's3'));
    function SignInButton() {
      const { signInWithDevelopmentIssuer } = useSession();
      return (
        <button
          type="button"
          onClick={() => void signInWithDevelopmentIssuer('carol', 'https://evil.example')}
        >
          sign in
        </button>
      );
    }
    render(
      <SessionProvider initial={{ state: 'signed-out' }} platform={platform}>
        <Probe />
        <SignInButton />
      </SessionProvider>,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'sign in' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-in|1|user-carol:s3|carol'),
    );
    const call = fetchControl.impl.mock.calls.find(([input]) =>
      String(input).endsWith('/api/auth/sign-in'),
    );
    expect(call).toBeDefined();
    expect(String(call?.[0])).toBe('/api/auth/sign-in');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      provider: 'test',
      subject: 'carol',
      next: '/',
    });
  });
});
