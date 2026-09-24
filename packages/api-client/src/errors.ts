import { type ErrorCode, type ErrorResponse, errorResponseSchema } from '@markov/contracts';
import type { ZodError } from 'zod';

/**
 * A response the API answered with its error envelope. `code` is the
 * machine-readable contract code; `requestId` is safe to show for support.
 */
export class MarkovApiError extends Error {
  override readonly name = 'MarkovApiError';
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;
  readonly details: readonly { readonly path: string; readonly message: string }[];

  constructor(status: number, envelope: ErrorResponse['error']) {
    super(envelope.message);
    this.status = status;
    this.code = envelope.code;
    this.requestId = envelope.requestId;
    this.details = envelope.details ?? [];
  }
}

/** The API could not be reached, timed out or closed the connection. Not a contract error. */
export class MarkovApiUnreachableError extends Error {
  override readonly name = 'MarkovApiUnreachableError';
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`Markov API unreachable during ${operation}`, { cause });
    this.operation = operation;
  }
}

/**
 * The API answered, but not in the shape the frozen contract promises
 * (renamed field, unknown enum value, missing data, or a non-envelope
 * error). The caller must show a failure, never guess.
 */
export class MarkovContractMismatchError extends Error {
  override readonly name = 'MarkovContractMismatchError';
  readonly operation: string;
  readonly status: number;
  readonly issues: readonly string[];

  constructor(operation: string, status: number, issues: readonly string[]) {
    super(`Markov API response for ${operation} does not match the contract: ${issues.join('; ')}`);
    this.operation = operation;
    this.status = status;
    this.issues = issues;
  }
}

export function issuesOf(error: ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

/** Turn a non-2xx body into the typed error, or a contract mismatch when the envelope itself is malformed. */
export function toApiError(operation: string, status: number, body: unknown): Error {
  const parsed = errorResponseSchema.safeParse(body);
  if (parsed.success) {
    return new MarkovApiError(status, parsed.data.error);
  }
  return new MarkovContractMismatchError(operation, status, [
    'error envelope malformed',
    ...issuesOf(parsed.error),
  ]);
}
