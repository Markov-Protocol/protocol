import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose';

export interface TestIdentityIssuerOptions {
  readonly issuer: string;
  readonly audience: string;
}

export interface MintOptions {
  readonly subject: string;
  readonly ttlSeconds?: number;
  readonly authTime?: Date;
  readonly issuedAt?: Date;
  readonly audience?: string;
  readonly issuer?: string;
}

export interface TestIdentityIssuer {
  readonly issuer: string;
  readonly audience: string;
  jwks(): JSONWebKeySet;
  mint(options: MintOptions): Promise<string>;
}

/**
 * Nonproduction identity provider: an in-process ES256 issuer so the full
 * verification path runs without a provider account. Configuration refuses
 * it outside local and test modes.
 */
export async function createTestIdentityIssuer(
  options: TestIdentityIssuerOptions,
): Promise<TestIdentityIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = randomUUID();
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return {
    issuer: options.issuer,
    audience: options.audience,
    jwks: () => ({ keys: [jwk] }),
    async mint(mint) {
      const issuedAt = mint.issuedAt ?? new Date();
      const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1000);
      const ttl = mint.ttlSeconds ?? 3600;
      return new SignJWT({ auth_time: Math.floor((mint.authTime ?? issuedAt).getTime() / 1000) })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(mint.issuer ?? options.issuer)
        .setAudience(mint.audience ?? options.audience)
        .setSubject(mint.subject)
        .setIssuedAt(issuedAtSeconds)
        .setExpirationTime(issuedAtSeconds + ttl)
        .sign(privateKey);
    },
  };
}
