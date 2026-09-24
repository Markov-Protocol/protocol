import { z } from 'zod';

/**
 * Machine-readable error codes. Details must be actionable without leaking
 * secrets or revealing whether another principal's resource exists.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ELIGIBILITY_UNKNOWN',
  'ASSET_NOT_ADMITTED',
  'QUOTE_EXPIRED',
  'INSUFFICIENT_FUNDS',
  'POLICY_DENIED',
  'PLAN_CHANGED',
  'SIGNATURE_MISMATCH',
  'PARTIAL_EXECUTION',
  'SUBMISSION_UNKNOWN',
  'PROVIDER_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'SERVICE_NOT_READY',
  'INTERNAL',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Default HTTP status for each error code. Handlers may not choose a different status for the same code. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  RATE_LIMITED: 429,
  ELIGIBILITY_UNKNOWN: 409,
  ASSET_NOT_ADMITTED: 409,
  QUOTE_EXPIRED: 409,
  INSUFFICIENT_FUNDS: 409,
  POLICY_DENIED: 403,
  PLAN_CHANGED: 409,
  SIGNATURE_MISMATCH: 409,
  PARTIAL_EXECUTION: 409,
  SUBMISSION_UNKNOWN: 409,
  PROVIDER_UNAVAILABLE: 503,
  IDEMPOTENCY_CONFLICT: 409,
  SERVICE_NOT_READY: 503,
  INTERNAL: 500,
};

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().max(1000),
    requestId: z.string().max(200),
    details: z
      .array(z.object({ path: z.string().max(200), message: z.string().max(500) }))
      .optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
