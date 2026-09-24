import {
  attempt,
  expect as expectContract,
  type MarkovApiClient,
  MarkovApiError,
  MarkovApiUnreachableError,
  MarkovContractMismatchError,
} from '@markov/api-client';
import { meResponseSchema, platformInfoResponseSchema } from '@markov/contracts';
import type { PlatformSnapshot, SessionSnapshot } from '../../features/auth/session-types';

export interface SessionResolution {
  readonly snapshot: SessionSnapshot;
  /** True when the presented cookie is invalid, expired or replayed and must be cleared. */
  readonly clearCookie: boolean;
}

/**
 * Verify a session token with the API. Only a user session backed by an
 * interactive sign-in counts as signed in; an agent or device credential
 * presented as a cookie is treated as invalid.
 */
export async function resolveSession(
  token: string | null,
  api: (bearer: string | null) => MarkovApiClient,
): Promise<SessionResolution> {
  if (token === null) {
    return { snapshot: { state: 'signed-out' }, clearCookie: false };
  }
  try {
    const me = await attempt('GET /v1/me', async () =>
      expectContract('GET /v1/me', await api(token).GET('/v1/me'), meResponseSchema),
    );
    if (me.principal.class !== 'user' || me.user === null || me.session === null) {
      return { snapshot: { state: 'signed-out' }, clearCookie: true };
    }
    return {
      snapshot: {
        state: 'signed-in',
        account: {
          userId: me.user.id,
          subject: me.user.subject,
          issuer: me.user.issuer,
          authTime: me.principal.authTime,
          stepUpFresh: me.principal.stepUpFresh,
        },
        session: { sessionId: me.session.sessionId, expiresAt: me.session.expiresAt },
      },
      clearCookie: false,
    };
  } catch (error) {
    if (error instanceof MarkovApiError && error.code === 'AUTH_REQUIRED') {
      return { snapshot: { state: 'signed-out' }, clearCookie: true };
    }
    if (error instanceof MarkovContractMismatchError) {
      return {
        snapshot: { state: 'unavailable', reason: 'contract-mismatch' },
        clearCookie: false,
      };
    }
    if (error instanceof MarkovApiUnreachableError || error instanceof MarkovApiError) {
      return { snapshot: { state: 'unavailable', reason: 'api-unreachable' }, clearCookie: false };
    }
    throw error;
  }
}

const PLATFORM_CACHE_MS = 10_000;
let platformCache: { readonly at: number; readonly value: PlatformSnapshot } | null = null;

/** Public platform facts (no principal), cached briefly so the top bar and sign-in page do not stampede the API. */
export async function resolvePlatform(
  api: (bearer: string | null) => MarkovApiClient,
  now: () => number = Date.now,
): Promise<PlatformSnapshot> {
  if (platformCache && now() - platformCache.at < PLATFORM_CACHE_MS) {
    return platformCache.value;
  }
  let value: PlatformSnapshot;
  try {
    const info = await attempt('GET /v1/platform', async () =>
      expectContract(
        'GET /v1/platform',
        await api(null).GET('/v1/platform'),
        platformInfoResponseSchema,
      ),
    );
    value = {
      state: 'connected',
      markovEnv: info.identity?.markovEnv ?? 'unbound',
      solanaCluster: info.identity?.solanaCluster ?? null,
      identityProvider: info.identityProvider,
      executionWritesEnabled: info.executionWritesEnabled,
    };
  } catch (error) {
    if (
      error instanceof MarkovApiUnreachableError ||
      error instanceof MarkovApiError ||
      error instanceof MarkovContractMismatchError
    ) {
      value = { state: 'unreachable' };
    } else {
      throw error;
    }
  }
  platformCache = { at: now(), value };
  return value;
}

/** Test seam: forget the cached platform snapshot. */
export function resetPlatformCache(): void {
  platformCache = null;
}
