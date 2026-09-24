import type { ErrorCode, ErrorResponse } from '@markov/contracts';

/** Domain error carrying a contract code; the error handler maps it to the envelope and fixed status. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ErrorCode;
  readonly details: ErrorResponse['error']['details'] | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorResponse['error']['details']) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
