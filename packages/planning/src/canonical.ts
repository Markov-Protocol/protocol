import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively, arrays in order, no
 * whitespace, UTF-8. Every amount is a decimal string, so no number is ever
 * subject to float formatting.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === 'bigint') {
    throw new TypeError('bigint values must be encoded as decimal strings before hashing');
  }
  return value;
}

export function sha256Hex(...parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest('hex');
}
