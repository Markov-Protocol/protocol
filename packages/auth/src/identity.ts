import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTPayload,
  jwtVerify,
} from 'jose';

export type IdentityTokenFailure =
  | 'invalid'
  | 'expired'
  | 'issuer'
  | 'audience'
  | 'algorithm'
  | 'claims'
  | 'keys';

export class IdentityTokenError extends Error {
  override readonly name = 'IdentityTokenError';
  readonly kind: IdentityTokenFailure;

  constructor(kind: IdentityTokenFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
  }
}

export interface VerifiedIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** `auth_time` claim when present, otherwise `iat`. Drives step-up freshness. */
  readonly authTime: Date;
}

export interface IdentityVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  /** Allowed JWS algorithms; asymmetric only. `none` and HMAC are never accepted. */
  readonly algorithms: readonly string[];
  readonly keys: { readonly jwksUrl: string } | { readonly jwks: JSONWebKeySet };
  readonly clockToleranceSeconds?: number;
}

export interface IdentityVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

const FORBIDDEN_ALGORITHMS = new Set(['none', 'HS256', 'HS384', 'HS512']);

function classify(error: unknown): IdentityTokenError {
  if (error instanceof errors.JWTExpired) {
    return new IdentityTokenError('expired', 'identity token has expired', { cause: error });
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') {
      return new IdentityTokenError('issuer', 'identity token issuer is not trusted', {
        cause: error,
      });
    }
    if (error.claim === 'aud') {
      return new IdentityTokenError('audience', 'identity token audience does not match', {
        cause: error,
      });
    }
    return new IdentityTokenError('claims', `identity token claim ${error.claim} is invalid`, {
      cause: error,
    });
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return new IdentityTokenError('algorithm', 'identity token algorithm is not allowed', {
      cause: error,
    });
  }
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid
  ) {
    return new IdentityTokenError('keys', 'no verification key matched the identity token', {
      cause: error,
    });
  }
  return new IdentityTokenError('invalid', 'identity token could not be verified', {
    cause: error,
  });
}

function toDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

/**
 * Verify an identity-provider token. Issuer, audience, expiry, algorithm
 * allowlist and key rotation (remote JWKS with caching) are enforced by
 * jose; the result carries only the claims Markov needs.
 */
export function createIdentityVerifier(options: IdentityVerifierOptions): IdentityVerifier {
  for (const algorithm of options.algorithms) {
    if (FORBIDDEN_ALGORITHMS.has(algorithm)) {
      throw new Error(`identity verifier algorithm ${algorithm} is not allowed`);
    }
  }
  const getKey =
    'jwksUrl' in options.keys
      ? createRemoteJWKSet(new URL(options.keys.jwksUrl), {
          timeoutDuration: 5_000,
          cooldownDuration: 30_000,
          cacheMaxAge: 10 * 60_000,
        })
      : createLocalJWKSet(options.keys.jwks);

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, getKey, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: [...options.algorithms],
          clockTolerance: options.clockToleranceSeconds ?? 30,
          requiredClaims: ['sub', 'iat', 'exp'],
        });
        payload = result.payload;
      } catch (error) {
        throw classify(error);
      }
      const { sub, iat, exp, iss } = payload;
      if (
        typeof sub !== 'string' ||
        sub.length === 0 ||
        typeof iat !== 'number' ||
        typeof exp !== 'number' ||
        typeof iss !== 'string'
      ) {
        throw new IdentityTokenError('claims', 'identity token is missing required claims');
      }
      const authTimeClaim = payload['auth_time'];
      const authTime = typeof authTimeClaim === 'number' ? authTimeClaim : iat;
      return {
        issuer: iss,
        subject: sub,
        issuedAt: toDate(iat),
        expiresAt: toDate(exp),
        authTime: toDate(authTime),
      };
    },
  };
}
