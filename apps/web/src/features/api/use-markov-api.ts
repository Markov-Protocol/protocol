'use client';

import { errorResponseSchema } from '@markov/contracts';
import { useCallback, useMemo } from 'react';
import type { z } from 'zod';
import { StaleSessionError, useSession, useSessionFetch } from '../auth/session-context';

/** Base of the app-owned proxy; the browser never calls the API origin. */
export const MARKOV_PROXY_BASE = '/api/markov';

/** A Markov error envelope as the browser sees it; never a network stack trace. */
export class WebApiError extends Error {
  override readonly name = 'WebApiError';
  readonly status: number;
  readonly code: string;
  readonly details: readonly { readonly path: string; readonly message: string }[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: readonly { readonly path: string; readonly message: string }[] = [],
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function toError(response: Response): Promise<WebApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new WebApiError(
      response.status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.details ?? [],
    );
  }
  return new WebApiError(
    response.status,
    'CONTRACT_MISMATCH',
    'Markov answered in an unexpected shape.',
  );
}

export interface RequestOptions {
  /** Abort a read that is no longer wanted (a newer search replaced it). */
  readonly signal?: AbortSignal;
}

export interface MarkovApi {
  get<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  put<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  /** DELETE that answers a body validated by `schema`. */
  delete<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  del(path: string): Promise<void>;
}

/**
 * Typed calls through the session-bound proxy. Every response is validated
 * against the shared contract before a component sees it; a 401 means the
 * session ended and triggers a revalidation so the app shows expiry
 * instead of a broken screen.
 */
export function useMarkovApi(): MarkovApi {
  const sessionFetch = useSessionFetch();
  const { revalidate } = useSession();

  const run = useCallback(
    async <T>(path: string, init: RequestInit, schema: z.ZodType<T> | null): Promise<T> => {
      let response: Response;
      try {
        response = await sessionFetch(`${MARKOV_PROXY_BASE}${path}`, {
          ...init,
          headers: { accept: 'application/json', ...(init.headers ?? {}) },
        });
      } catch (error) {
        if (error instanceof StaleSessionError) {
          throw error;
        }
        throw new WebApiError(
          0,
          'NETWORK',
          'Markov could not be reached. Check your connection and try again.',
        );
      }
      if (!response.ok) {
        const failure = await toError(response);
        if (failure.status === 401 && failure.code === 'AUTH_REQUIRED') {
          void revalidate();
        }
        throw failure;
      }
      if (schema === null || response.status === 204) {
        return undefined as T;
      }
      const body: unknown = await response.json().catch(() => null);
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new WebApiError(
          response.status,
          'CONTRACT_MISMATCH',
          'Markov answered in an unexpected shape.',
        );
      }
      return parsed.data;
    },
    [sessionFetch, revalidate],
  );

  return useMemo<MarkovApi>(
    () => ({
      get: (path, schema, options) =>
        run(
          path,
          { method: 'GET', ...(options?.signal ? { signal: options.signal } : {}) },
          schema,
        ),
      post: (path, body, schema) =>
        run(
          path,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
          schema,
        ),
      put: (path, body, schema) =>
        run(
          path,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
          schema,
        ),
      delete: (path, schema) => run(path, { method: 'DELETE' }, schema),
      del: (path) => run(path, { method: 'DELETE' }, null),
    }),
    [run],
  );
}
