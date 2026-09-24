'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { safeReturnPath } from './return-path';
import type {
  PlatformSnapshot,
  SessionAccount,
  SessionInfo,
  SessionSnapshot,
  SignInResponse,
  SignOutResponse,
} from './session-types';

/**
 * Explicit session states. Nothing is inferred from a single boolean: a
 * session that was signed in and is no longer verified reads as expired
 * (with recovery), a backend outage reads as unavailable, and a
 * revalidation in progress hides private views until it completes.
 */
export type SessionState =
  | { readonly status: 'signed-out' }
  | {
      readonly status: 'signed-in';
      readonly account: SessionAccount;
      readonly session: SessionInfo;
    }
  | { readonly status: 'expired'; readonly previous: SessionAccount | null }
  | { readonly status: 'unavailable'; readonly reason: 'api-unreachable' | 'contract-mismatch' };

export interface SessionContextValue {
  readonly state: SessionState;
  /** Increments whenever the principal changes or ends; callbacks from an older epoch are discarded. */
  readonly epoch: number;
  /** Stable key of the current principal for cache scoping ("anonymous" when signed out). */
  readonly principalKey: string;
  /** Abort signal of the current epoch; aborted when the principal changes. */
  readonly signal: AbortSignal;
  /** True while the server is re-verifying the session (page restore, tab focus); private views wait. */
  readonly verifying: boolean;
  readonly platform: PlatformSnapshot;
  readonly revalidate: () => Promise<void>;
  readonly signInWithDevelopmentIssuer: (subject: string, next: string) => Promise<SignInResponse>;
  readonly signOut: () => Promise<SignOutResponse | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** The app's own origin only; never the API. */
const SESSION_URL = '/api/auth/session';
const SIGN_IN_URL = '/api/auth/sign-in';
const SIGN_OUT_URL = '/api/auth/sign-out';
const CHANNEL = 'markov-session';
const REVALIDATE_AFTER_HIDDEN_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;

export class StaleSessionError extends Error {
  override readonly name = 'StaleSessionError';
  constructor() {
    super('the session changed while this request was in flight');
  }
}

function principalKeyOf(state: SessionState): string {
  return state.status === 'signed-in'
    ? `${state.account.userId}:${state.session.sessionId}`
    : 'anonymous';
}

function fromSnapshot(snapshot: SessionSnapshot, previous: SessionState | null): SessionState {
  switch (snapshot.state) {
    case 'signed-in':
      return { status: 'signed-in', account: snapshot.account, session: snapshot.session };
    case 'unavailable':
      return { status: 'unavailable', reason: snapshot.reason };
    case 'signed-out':
      return previous?.status === 'signed-in'
        ? { status: 'expired', previous: previous.account }
        : previous?.status === 'expired'
          ? previous
          : { status: 'signed-out' };
  }
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    return false;
  }
  const state = (value as { state: unknown }).state;
  return state === 'signed-out' || state === 'signed-in' || state === 'unavailable';
}

export interface SessionProviderProps {
  readonly initial: SessionSnapshot;
  /** When true the server saw an invalid cookie; one session call clears it. */
  readonly staleCookie?: boolean;
  readonly platform: PlatformSnapshot;
  readonly children: ReactNode;
}

export function SessionProvider({
  initial,
  staleCookie = false,
  platform,
  children,
}: SessionProviderProps) {
  const [state, setState] = useState<SessionState>(() => fromSnapshot(initial, null));
  const [epoch, setEpoch] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const epochRef = useRef(0);
  const controllerRef = useRef<AbortController>(new AbortController());
  const hiddenSinceRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  /** Apply a verified snapshot; bump the epoch when the principal changes or ends. */
  const apply = useCallback((snapshot: SessionSnapshot) => {
    const previous = stateRef.current;
    const next = fromSnapshot(snapshot, previous);
    const changed =
      principalKeyOf(previous) !== principalKeyOf(next) ||
      (previous.status === 'signed-in' && next.status !== 'signed-in');
    if (changed) {
      controllerRef.current.abort();
      controllerRef.current = new AbortController();
      epochRef.current += 1;
      setEpoch(epochRef.current);
    }
    stateRef.current = next;
    setState(next);
  }, []);

  const revalidate = useCallback(async () => {
    const startedIn = epochRef.current;
    setVerifying(true);
    try {
      const response = await fetch(SESSION_URL, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const body: unknown = await response.json();
      if (startedIn !== epochRef.current) {
        return;
      }
      apply(isSessionSnapshot(body) ? body : { state: 'unavailable', reason: 'contract-mismatch' });
    } catch {
      if (startedIn === epochRef.current) {
        apply({ state: 'unavailable', reason: 'api-unreachable' });
      }
    } finally {
      setVerifying(false);
    }
  }, [apply]);

  const notifyOtherTabs = useCallback(() => {
    channelRef.current?.postMessage({ type: 'changed' });
  }, []);

  const signInWithDevelopmentIssuer = useCallback(
    async (subject: string, next: string): Promise<SignInResponse> => {
      let response: Response;
      try {
        response = await fetch(SIGN_IN_URL, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ provider: 'test', subject, next: safeReturnPath(next) }),
        });
      } catch {
        return {
          ok: false,
          code: 'NETWORK',
          message: 'Markov could not be reached. Check your connection and try again.',
        };
      }
      const body = (await response.json().catch(() => null)) as SignInResponse | null;
      if (!body || typeof body !== 'object' || !('ok' in body)) {
        return {
          ok: false,
          code: 'CONTRACT_MISMATCH',
          message: 'Sign-in answered in an unexpected shape.',
        };
      }
      if (body.ok) {
        await revalidate();
        notifyOtherTabs();
      }
      return body;
    },
    [revalidate, notifyOtherTabs],
  );

  const signOut = useCallback(async (): Promise<SignOutResponse | null> => {
    let result: SignOutResponse | null = null;
    try {
      const response = await fetch(SIGN_OUT_URL, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      result = (await response.json().catch(() => null)) as SignOutResponse | null;
    } catch {
      result = null;
    }
    // Local state ends now regardless of the server answer: the cookie is
    // gone or being cleared, and no private data may survive the sign-out.
    const previous = stateRef.current;
    controllerRef.current.abort();
    controllerRef.current = new AbortController();
    epochRef.current += 1;
    setEpoch(epochRef.current);
    stateRef.current = { status: 'signed-out' };
    setState({ status: 'signed-out' });
    void previous;
    notifyOtherTabs();
    return result;
  }, [notifyOtherTabs]);

  // A stale cookie is cleared by the session route on first load.
  useEffect(() => {
    if (staleCookie) {
      void revalidate();
    }
  }, [staleCookie, revalidate]);

  // Expiry: flip to "expired" at the server-declared time so a private view
  // never keeps rendering after the session ended.
  useEffect(() => {
    if (state.status !== 'signed-in') {
      return;
    }
    const delay = Math.min(
      Math.max(new Date(state.session.expiresAt).getTime() - Date.now(), 0),
      MAX_TIMER_MS,
    );
    const timer = setTimeout(() => {
      void revalidate();
    }, delay);
    return () => clearTimeout(timer);
  }, [state, revalidate]);

  // Back/forward cache restores and long-hidden tabs re-verify before
  // revealing anything private; other tabs are told about changes without
  // any credential or payload crossing the channel.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void revalidate();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (
        stateRef.current.status === 'signed-in' &&
        hiddenSince !== null &&
        Date.now() - hiddenSince >= REVALIDATE_AFTER_HIDDEN_MS
      ) {
        void revalidate();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (
          typeof data === 'object' &&
          data !== null &&
          (data as { type?: unknown }).type === 'changed'
        ) {
          void revalidate();
        }
      };
      channelRef.current = channel;
    }
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
      channel?.close();
      channelRef.current = null;
    };
  }, [revalidate]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      epoch,
      principalKey: principalKeyOf(state),
      signal: controllerRef.current.signal,
      verifying,
      platform,
      revalidate,
      signInWithDevelopmentIssuer,
      signOut,
    }),
    [state, epoch, verifying, platform, revalidate, signInWithDevelopmentIssuer, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}

/**
 * A fetch bound to the current session epoch: the request is aborted when
 * the principal changes, and a response that arrives after a change is
 * rejected with StaleSessionError instead of being rendered under the new
 * account.
 */
export function useSessionFetch(): (input: string, init?: RequestInit) => Promise<Response> {
  const { epoch, signal } = useSession();
  const epochRef = useRef(epoch);
  epochRef.current = epoch;
  return useCallback(
    async (input: string, init?: RequestInit) => {
      const startedIn = epochRef.current;
      const response = await fetch(input, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      });
      if (startedIn !== epochRef.current) {
        throw new StaleSessionError();
      }
      return response;
    },
    [signal],
  );
}
