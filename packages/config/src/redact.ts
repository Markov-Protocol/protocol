const REDACTED = '***';

export interface RedactUrlOptions {
  /**
   * Keep the URL path. Database URLs carry the database name in the path;
   * RPC provider URLs frequently carry an API key in the path, so the
   * default drops it.
   */
  readonly keepPath?: boolean;
}

/**
 * Produce a log-safe form of a URL: scheme, host and port survive; the
 * password, every query value, the fragment and (by default) the path are
 * replaced. Unparseable input is replaced entirely rather than echoed.
 */
export function redactUrl(raw: string, options: RedactUrlOptions = {}): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '[unparseable-url]';
  }
  const auth = url.username ? `${url.username}${url.password ? `:${REDACTED}` : ''}@` : '';
  const path = options.keepPath
    ? url.pathname
    : url.pathname === '/' || url.pathname === ''
      ? ''
      : '/[redacted-path]';
  const params = [...url.searchParams.keys()];
  const query = params.length > 0 ? `?${params.map((key) => `${key}=${REDACTED}`).join('&')}` : '';
  return `${url.protocol}//${auth}${url.host}${path}${query}`;
}

/** Environment variable names whose values are secrets or may embed secrets. */
export const SECRET_ENV_KEYS: readonly string[] = [
  'DATABASE_URL',
  'TEMPORAL_API_KEY',
  'SOLANA_RPC_PRIMARY_URL',
  'SOLANA_RPC_SECONDARY_URL',
];
