import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { ZodType } from 'zod';
import {
  issuesOf,
  MarkovApiUnreachableError,
  MarkovContractMismatchError,
  toApiError,
} from './errors';
import type { paths } from './generated/openapi';

export type MarkovApiClient = Client<paths>;

export interface MarkovApiClientOptions {
  /** Origin of the Markov API, for example `https://api.markov.pet`. Server-side only; the browser talks to its own origin. */
  readonly baseUrl: string;
  /** Bearer credential (session, agent, operator or device token). Set per principal; never shared between users. */
  readonly bearer?: string | null;
  /** Injected for tests and for runtimes that wrap fetch. */
  readonly fetch?: (request: Request) => Promise<Response>;
  /** Upper bound per request so a slow API never hangs a server render. */
  readonly timeoutMs?: number;
  /** Extra headers for every call, for example the forwarded client address. Never a credential. */
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Typed client over the frozen OpenAPI document. Every path, parameter and
 * body is checked against `src/generated/openapi.ts`; responses the app
 * relies on are additionally validated at runtime with `expect()`.
 */
export function createMarkovApiClient(options: MarkovApiClientOptions): MarkovApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const bearer = options.bearer ?? null;
  const middleware: Middleware = {
    onRequest({ request }) {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
      const next = new Request(request, { signal });
      if (bearer) {
        next.headers.set('authorization', `Bearer ${bearer}`);
      }
      return next;
    },
  };
  client.use(middleware);
  return client;
}

export interface FetchOutcome<T> {
  readonly data?: T;
  readonly error?: unknown;
  readonly response: Response;
}

/**
 * Resolve an openapi-fetch outcome into contract-validated data or a typed
 * error. `operation` names the call for diagnostics ("GET /v1/me").
 */
export function expect<T>(
  operation: string,
  outcome: FetchOutcome<unknown>,
  schema: ZodType<T>,
): T {
  if (outcome.error !== undefined || !outcome.response.ok) {
    throw toApiError(operation, outcome.response.status, outcome.error);
  }
  const parsed = schema.safeParse(outcome.data);
  if (!parsed.success) {
    throw new MarkovContractMismatchError(
      operation,
      outcome.response.status,
      issuesOf(parsed.error),
    );
  }
  return parsed.data;
}

/** Run one call and convert transport failures into `MarkovApiUnreachableError`. */
export async function attempt<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (
      error instanceof MarkovContractMismatchError ||
      (error instanceof Error && error.name === 'MarkovApiError')
    ) {
      throw error;
    }
    throw new MarkovApiUnreachableError(operation, error);
  }
}
