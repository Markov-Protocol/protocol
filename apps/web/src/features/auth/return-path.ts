/**
 * Validated local return paths. A sign-in return target is always a path on
 * this origin: never a scheme, a protocol-relative URL, a backslash trick or
 * an auth route that would loop. Anything else falls back to home.
 */
export const DEFAULT_RETURN_PATH = '/';
const MAX_LENGTH = 2048;
const LOOPING_PREFIXES = ['/sign-in', '/auth/'];

/** Control characters, whitespace and backslashes never belong in a local path. */
function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || character === '\\' || /\s/.test(character)) {
      return true;
    }
  }
  return false;
}

export function safeReturnPath(input: unknown, fallback: string = DEFAULT_RETURN_PATH): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_LENGTH) {
    return fallback;
  }
  if (!input.startsWith('/') || input.startsWith('//') || input.startsWith('/\\')) {
    return fallback;
  }
  if (hasForbiddenCharacter(input)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(input, 'https://markov.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://markov.invalid' || url.username || url.password) {
    return fallback;
  }
  const normalized = `${url.pathname}${url.search}${url.hash}`;
  if (
    LOOPING_PREFIXES.some(
      (prefix) => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix),
    )
  ) {
    return fallback;
  }
  return normalized;
}

/** Build the sign-in link that returns to `path` afterwards. */
export function signInHref(returnTo: string | null | undefined): string {
  const next = safeReturnPath(returnTo);
  return next === DEFAULT_RETURN_PATH ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
}
