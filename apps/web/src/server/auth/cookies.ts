import type { WebEnv } from '../../config/web-env';

/**
 * The Markov session cookie. Host-only (`__Host-` prefix: Secure, Path=/,
 * no Domain) wherever the browser can honour it; the plain name is used only
 * for local development over http, where the prefix would be refused.
 */
export const SESSION_COOKIE_HOST = '__Host-markov_session';
export const SESSION_COOKIE_LOCAL = 'markov_session';
const SESSION_TOKEN_PATTERN = /^mkv_ss_[1-9A-HJ-NP-Za-km-z]{6,12}_[A-Za-z0-9_-]{40,50}$/;

export interface SessionCookiePolicy {
  readonly name: string;
  readonly secure: boolean;
}

export function sessionCookiePolicy(
  env: Pick<WebEnv, 'markovEnv' | 'appOrigin'>,
): SessionCookiePolicy {
  const secure = env.markovEnv !== 'local' || (env.appOrigin?.startsWith('https://') ?? false);
  return { name: secure ? SESSION_COOKIE_HOST : SESSION_COOKIE_LOCAL, secure };
}

/** Read the session token from a Cookie header; malformed values count as absent. */
export function readSessionCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }
    const value = trimmed.slice(name.length + 1);
    return SESSION_TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function sessionCookieSet(
  policy: SessionCookiePolicy,
  token: string,
  expiresAt: Date,
): string {
  const attributes = [
    `${policy.name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (policy.secure) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

export function sessionCookieClear(policy: SessionCookiePolicy): string {
  const attributes = [`${policy.name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (policy.secure) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}
