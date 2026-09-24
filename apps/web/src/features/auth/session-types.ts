/**
 * The session as the app sees it. Everything here comes from the server's
 * verification of the HttpOnly session cookie against the Markov API; the
 * browser never holds the credential or decides its own role.
 */
export interface SessionAccount {
  readonly userId: string;
  /** Identity-provider subject; shown shortened, never used as a role. */
  readonly subject: string;
  readonly issuer: string;
  readonly authTime: string | null;
  /** Whether a security-sensitive change may proceed without signing in again. */
  readonly stepUpFresh: boolean;
}

export interface SessionInfo {
  readonly sessionId: string;
  readonly expiresAt: string;
}

export type SessionSnapshot =
  | { readonly state: 'signed-out' }
  | { readonly state: 'signed-in'; readonly account: SessionAccount; readonly session: SessionInfo }
  | {
      /** A session cookie exists but the backend could not confirm it right now. Nothing private renders. */
      readonly state: 'unavailable';
      readonly reason: 'api-unreachable' | 'contract-mismatch';
    };

export type IdentityProviderKind = 'test' | 'oidc';

export type PlatformSnapshot =
  | {
      readonly state: 'connected';
      readonly markovEnv: string;
      readonly solanaCluster: string | null;
      readonly identityProvider: IdentityProviderKind;
      readonly executionWritesEnabled: boolean;
    }
  | { readonly state: 'unreachable' };

/** Body of `POST /api/auth/sign-in` for the nonproduction development issuer. */
export interface DevelopmentSignInRequest {
  readonly provider: 'test';
  readonly subject: string;
  readonly next?: string;
}

export type SignInResponse =
  | { readonly ok: true; readonly next: string; readonly account: SessionAccount }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface SignOutResponse {
  readonly ok: true;
  /** False when the server session could not be revoked (API unreachable); the cookie is cleared regardless. */
  readonly revoked: boolean;
}
