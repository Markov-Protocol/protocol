import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import type { PlatformSnapshot, SessionSnapshot } from '../../features/auth/session-types';
import { forwardedForHeader, markovApi } from '../api';
import { webEnv } from '../web-env';
import { readSessionCookie, sessionCookiePolicy } from './cookies';
import { resolvePlatform, resolveSession } from './session';

export interface InitialSession {
  readonly snapshot: SessionSnapshot;
  /** The browser holds an invalid cookie; rendering cannot clear it, so the client asks the session route to. */
  readonly staleCookie: boolean;
}

/** The verified session for this request, resolved once per render tree. */
export const currentSession = cache(async (): Promise<InitialSession> => {
  const env = webEnv();
  const policy = sessionCookiePolicy(env);
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const raw = store.get(policy.name)?.value ?? null;
  const token = raw === null ? null : readSessionCookie(`${policy.name}=${raw}`, policy.name);
  const forwardedFor = forwardedForHeader(requestHeaders.get('x-forwarded-for'));
  const resolved = await resolveSession(token, (bearer) => markovApi(bearer, { forwardedFor }));
  return {
    snapshot: resolved.snapshot,
    staleCookie: resolved.clearCookie || (raw !== null && token === null),
  };
});

/** Public platform facts for this request (connection status, identity provider kind). */
export const currentPlatform = cache(
  async (): Promise<PlatformSnapshot> => resolvePlatform((bearer) => markovApi(bearer)),
);
