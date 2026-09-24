import 'server-only';
import { createMarkovApiClient, type MarkovApiClient } from '@markov/api-client';
import { webEnv } from './web-env';

export interface ApiCallContext {
  /** Client address as seen by this server, forwarded so the API's per-client limits apply per person. */
  readonly forwardedFor?: string | null;
}

/** A Markov API client for one principal. Never reuse a bearer across users. */
export function markovApi(
  bearer: string | null = null,
  context: ApiCallContext = {},
): MarkovApiClient {
  return createMarkovApiClient({
    baseUrl: webEnv().apiOrigin,
    bearer,
    timeoutMs: 5000,
    ...(context.forwardedFor ? { headers: { 'x-forwarded-for': context.forwardedFor } } : {}),
  });
}

/** First hop of an X-Forwarded-For value, if the deployment's proxy set it. */
export function forwardedForHeader(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const first = header.split(',')[0]?.trim() ?? '';
  return /^[0-9a-fA-F.:]{3,45}$/.test(first) ? first : null;
}

export function forwardedFor(request: Request): string | null {
  return forwardedForHeader(request.headers.get('x-forwarded-for'));
}
