import type { PrincipalClass } from '@markov/contracts';

/** Scope granted implicitly to an interactive user session: every owner operation on the user's own resources. */
export const OWNER_SCOPE = 'owner:*';

export interface Principal {
  readonly class: PrincipalClass;
  /** Stable identifier of the credential holder (user id, credential id, device id, worker name). */
  readonly id: string;
  readonly userId: string | null;
  readonly scopes: readonly string[];
  /** When the person last authenticated with the identity provider; null for non-interactive principals. */
  readonly authTime: Date | null;
  readonly sessionId: string | null;
  /** Expiry of the interactive session; null for non-session principals. */
  readonly sessionExpiresAt: Date | null;
  readonly credentialId: string | null;
}

export function hasScope(principal: Principal, scope: string): boolean {
  if (principal.scopes.includes(scope)) {
    return true;
  }
  return principal.class === 'user' && principal.scopes.includes(OWNER_SCOPE);
}

/**
 * Security-sensitive changes (linking wallets, issuing or revoking
 * credentials, pairing devices) need a recent interactive authentication.
 * Non-interactive principals are never fresh.
 */
export function isStepUpFresh(
  principal: Principal,
  maxAgeSeconds: number,
  now: Date = new Date(),
): boolean {
  if (principal.class !== 'user' || principal.authTime === null) {
    return false;
  }
  return now.getTime() - principal.authTime.getTime() <= maxAgeSeconds * 1000;
}
