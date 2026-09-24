import { describe, expect, it } from 'vitest';
import {
  createIdentityVerifier,
  createTestIdentityIssuer,
  IdentityTokenError,
} from '../src/index.js';

const issuerOptions = { issuer: 'https://identity.test', audience: 'markov-test' };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof IdentityTokenError ? error.kind : `unexpected:${String(error)}`;
  }
}

describe('identity token verification', () => {
  it('accepts a token from the trusted issuer and reports auth_time', async () => {
    const issuer = await createTestIdentityIssuer(issuerOptions);
    const verifier = createIdentityVerifier({
      ...issuerOptions,
      algorithms: ['ES256'],
      keys: { jwks: issuer.jwks() },
    });
    const authTime = new Date('2026-09-24T10:00:00Z');
    const token = await issuer.mint({
      subject: 'did:test:alice',
      authTime,
      issuedAt: new Date(),
      ttlSeconds: 600,
    });
    const identity = await verifier.verify(token);
    expect(identity).toMatchObject({ issuer: issuerOptions.issuer, subject: 'did:test:alice' });
    expect(identity.authTime.toISOString()).toBe(authTime.toISOString());
    expect(identity.expiresAt.getTime() - identity.issuedAt.getTime()).toBe(600_000);
  });

  it('rejects the wrong issuer, audience, an expired token, an unknown key and tampering', async () => {
    const issuer = await createTestIdentityIssuer(issuerOptions);
    const other = await createTestIdentityIssuer(issuerOptions);
    const verifier = createIdentityVerifier({
      ...issuerOptions,
      algorithms: ['ES256'],
      keys: { jwks: issuer.jwks() },
    });
    expect(
      await failure(
        verifier.verify(await issuer.mint({ subject: 'a', issuer: 'https://evil.test' })),
      ),
    ).toBe('issuer');
    expect(
      await failure(verifier.verify(await issuer.mint({ subject: 'a', audience: 'other-app' }))),
    ).toBe('audience');
    expect(
      await failure(
        verifier.verify(
          await issuer.mint({
            subject: 'a',
            issuedAt: new Date(Date.now() - 7200_000),
            ttlSeconds: 60,
          }),
        ),
      ),
    ).toBe('expired');
    expect(await failure(verifier.verify(await other.mint({ subject: 'a' })))).toBe('keys');
    const token = await issuer.mint({ subject: 'a' });
    const [header, payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload as string, 'base64url').toString()),
        sub: 'b',
      }),
    ).toString('base64url');
    expect(await failure(verifier.verify(`${header}.${tamperedPayload}.${signature}`))).toBe(
      'invalid',
    );
    expect(await failure(verifier.verify('not-a-token'))).toBe('invalid');
  });

  it('never accepts symmetric or unsigned algorithms', () => {
    expect(() =>
      createIdentityVerifier({
        ...issuerOptions,
        algorithms: ['HS256'],
        keys: { jwks: { keys: [] } },
      }),
    ).toThrow(/not allowed/);
    expect(() =>
      createIdentityVerifier({
        ...issuerOptions,
        algorithms: ['none'],
        keys: { jwks: { keys: [] } },
      }),
    ).toThrow(/not allowed/);
  });
});
