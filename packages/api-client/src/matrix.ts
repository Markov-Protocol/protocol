import {
  corporateActionListResponseSchema,
  errorResponseSchema,
  instrumentDetailSchema,
  instrumentListResponseSchema,
  meResponseSchema,
  platformInfoResponseSchema,
  sessionResponseSchema,
  watchlistSchema,
} from '@markov/contracts';
import type { ZodType } from 'zod';

export interface ContractMatrixEntry {
  /** Screen or server capability that depends on the operation. */
  readonly consumer: string;
  readonly method: 'get' | 'post' | 'delete' | 'put' | 'patch';
  readonly path: string;
  /** Success status the consumer relies on. */
  readonly status: number;
  /** Runtime schema the consumer validates the success body with; null for empty bodies. */
  readonly responseSchema: ZodType | null;
  /** Error codes the consumer handles distinctly; everything else is a generic failure. */
  readonly handledErrors: readonly string[];
}

/**
 * Route-to-contract matrix for the app. `test/compatibility.test.ts` proves
 * every entry exists in the frozen OpenAPI document with the same response
 * shape, so a renamed field or removed route fails the frontend build, not
 * the user.
 */
export const CONTRACT_MATRIX: readonly ContractMatrixEntry[] = [
  {
    consumer: 'Top bar connection status; sign-in provider availability',
    method: 'get',
    path: '/v1/platform',
    status: 200,
    responseSchema: platformInfoResponseSchema,
    handledErrors: [],
  },
  {
    consumer: 'Sign-in (server exchange of the identity token)',
    method: 'post',
    path: '/v1/auth/sessions',
    status: 201,
    responseSchema: sessionResponseSchema,
    handledErrors: ['AUTH_REQUIRED', 'RATE_LIMITED', 'VALIDATION_FAILED'],
  },
  {
    consumer: 'Session resolution on every request; account controls',
    method: 'get',
    path: '/v1/me',
    status: 200,
    responseSchema: meResponseSchema,
    handledErrors: ['AUTH_REQUIRED'],
  },
  {
    consumer: 'Sign out',
    method: 'delete',
    path: '/v1/auth/sessions/current',
    status: 204,
    responseSchema: null,
    handledErrors: ['AUTH_REQUIRED'],
  },
  {
    consumer: 'Explore: instruments tab (search, filters, bounded pagination)',
    method: 'get',
    path: '/v1/catalog/instruments',
    status: 200,
    responseSchema: instrumentListResponseSchema,
    handledErrors: ['VALIDATION_FAILED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE'],
  },
  {
    consumer: 'Market detail: identity, price, verification, lifecycle, availability',
    method: 'get',
    path: '/v1/catalog/instruments/{instrumentId}',
    status: 200,
    responseSchema: instrumentDetailSchema,
    handledErrors: ['NOT_FOUND'],
  },
  {
    consumer: 'Market detail: lifecycle notices',
    method: 'get',
    path: '/v1/catalog/instruments/{instrumentId}/corporate-actions',
    status: 200,
    responseSchema: corporateActionListResponseSchema,
    handledErrors: ['NOT_FOUND'],
  },
  {
    consumer: 'Explore: watchlist tab and saved toggles',
    method: 'get',
    path: '/v1/me/watchlist',
    status: 200,
    responseSchema: watchlistSchema,
    handledErrors: ['AUTH_REQUIRED'],
  },
  {
    consumer: 'Save an instrument',
    method: 'put',
    path: '/v1/me/watchlist/items/{instrumentId}',
    status: 200,
    responseSchema: watchlistSchema,
    handledErrors: ['ASSET_NOT_ADMITTED', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'AUTH_REQUIRED'],
  },
  {
    consumer: 'Remove a saved instrument',
    method: 'delete',
    path: '/v1/me/watchlist/items/{instrumentId}',
    status: 200,
    responseSchema: watchlistSchema,
    handledErrors: ['IDEMPOTENCY_CONFLICT', 'AUTH_REQUIRED'],
  },
];

export const ERROR_ENVELOPE_SCHEMA = errorResponseSchema;
