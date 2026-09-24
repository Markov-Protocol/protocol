import { isIP } from 'node:net';

/**
 * What a research source URL may look like before any network activity:
 * https only, a real hostname (never an address literal, loopback, local or
 * special-use suffix), no credentials, the default port. The same check
 * runs on every redirect hop, and the resolved addresses are classified
 * separately (`classifyResolved`).
 */
export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_URL_LENGTH = 2048;
export const RETRIEVAL_TIMEOUT_MS = 10_000;
export const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
] as const;

export type UrlVerdict =
  | { readonly ok: true; readonly url: URL; readonly host: string }
  | { readonly ok: false; readonly reason: string };

const REFUSED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.onion',
  '.test',
  '.example',
  '.invalid',
  '.localdomain',
  '.lan',
  '.intranet',
  '.corp',
];
const REFUSED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
]);

export function evaluateUrl(candidate: string): UrlVerdict {
  if (candidate.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'URL is too long' };
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'not a valid absolute URL' };
  }
  if (url.protocol !== 'https:') {
    return {
      ok: false,
      reason: `scheme ${url.protocol.replace(':', '')} is not allowed; only https`,
    };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials in the URL are not allowed' };
  }
  if (url.port !== '' && url.port !== '443') {
    return { ok: false, reason: 'only the default https port is allowed' };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') {
    return { ok: false, reason: 'empty host' };
  }
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (
    isIP(bare) !== 0 ||
    /^[0-9]+$/.test(bare) ||
    /^0x[0-9a-f]+$/i.test(bare) ||
    /^[0-9.]+$/.test(bare)
  ) {
    return { ok: false, reason: 'address literals are not allowed; use a hostname' };
  }
  if (REFUSED_HOSTS.has(host) || REFUSED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: `host ${host} is local or special-use` };
  }
  if (!host.includes('.')) {
    return { ok: false, reason: 'host must be a fully qualified name' };
  }
  if (!/^[a-z0-9.-]+$/.test(host) && !host.startsWith('xn--')) {
    return { ok: false, reason: 'host contains characters outside the DNS hostname alphabet' };
  }
  url.hash = '';
  return { ok: true, url, host };
}

export function evaluateContentType(
  header: string | null,
):
  | { readonly ok: true; readonly mediaType: string }
  | { readonly ok: false; readonly reason: string } {
  if (header === null) {
    return { ok: false, reason: 'the response declares no content type' };
  }
  const mediaType = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(mediaType)) {
    return { ok: false, reason: `content type ${mediaType || 'unknown'} is not supported` };
  }
  return { ok: true, mediaType };
}

/** A redirect target must pass the same URL policy; relative targets resolve against the current hop. */
export function evaluateRedirect(from: URL, location: string | null, hop: number): UrlVerdict {
  if (hop >= MAX_REDIRECTS) {
    return { ok: false, reason: `more than ${MAX_REDIRECTS} redirects` };
  }
  if (location === null || location.trim() === '') {
    return { ok: false, reason: 'redirect without a Location header' };
  }
  let resolved: string;
  try {
    resolved = new URL(location, from).toString();
  } catch {
    return { ok: false, reason: 'redirect target is not a valid URL' };
  }
  return evaluateUrl(resolved);
}
