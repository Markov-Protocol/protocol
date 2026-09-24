import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { encodeBase58 } from '@markov/contracts';

export type CredentialKind = 'session' | 'agent' | 'operator' | 'device';

const KIND_PREFIX: Record<CredentialKind, string> = {
  session: 'mkv_ss',
  agent: 'mkv_ag',
  operator: 'mkv_op',
  device: 'mkv_dv',
};
const PREFIX_KIND = new Map(
  Object.entries(KIND_PREFIX).map(([kind, prefix]) => [prefix, kind as CredentialKind]),
);

export interface GeneratedCredential {
  /** Full bearer token: `<kind>_<prefix>_<secret>`. Returned to the caller exactly once. */
  readonly token: string;
  /** Non-secret identifier stored in clear for lookup and display. */
  readonly prefix: string;
  /** HMAC-SHA256 of the secret under the server pepper; the only thing stored. */
  readonly secretHash: string;
}

export function hashCredentialSecret(secret: string, pepper: string): string {
  return createHmac('sha256', pepper).update(secret).digest('hex');
}

export function generateCredential(kind: CredentialKind, pepper: string): GeneratedCredential {
  const prefix = encodeBase58(randomBytes(8)).slice(0, 10);
  const secret = randomBytes(32).toString('base64url');
  return {
    token: `${KIND_PREFIX[kind]}_${prefix}_${secret}`,
    prefix,
    secretHash: hashCredentialSecret(secret, pepper),
  };
}

export interface ParsedCredentialToken {
  readonly kind: CredentialKind;
  readonly prefix: string;
  readonly secret: string;
}

/** Split a bearer token into its parts without validating the secret. */
export function parseCredentialToken(token: string): ParsedCredentialToken | null {
  const match = /^(mkv_[a-z]{2})_([1-9A-HJ-NP-Za-km-z]{6,12})_([A-Za-z0-9_-]{40,50})$/.exec(token);
  if (!match) {
    return null;
  }
  const kind = PREFIX_KIND.get(match[1] as string);
  if (!kind) {
    return null;
  }
  return { kind, prefix: match[2] as string, secret: match[3] as string };
}

/** Constant-time comparison of two hex digests. */
export function secretHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
