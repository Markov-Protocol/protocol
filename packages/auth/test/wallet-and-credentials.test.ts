import { describe, expect, it } from 'vitest';
import {
  buildWalletChallengeMessage,
  createEd25519TestWallet,
  generateChallengeNonce,
  generateCredential,
  hashCredentialSecret,
  hasScope,
  isStepUpFresh,
  OWNER_SCOPE,
  type Principal,
  parseCredentialToken,
  secretHashesMatch,
  verifyWalletSignature,
} from '../src/index.js';

const params = {
  domain: 'markov.pet',
  address: '',
  chain: 'solana' as const,
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  userId: '0f0c8f7a-2b1d-4c62-9f3a-3d2c1b0a9e8d',
  nonce: 'nonce123',
  issuedAt: '2026-09-24T10:00:00.000Z',
  expiresAt: '2026-09-24T10:05:00.000Z',
};

describe('wallet ownership challenge', () => {
  it('produces a deterministic message that binds domain, chain, account, nonce and time', () => {
    const message = buildWalletChallengeMessage({
      ...params,
      address: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    });
    expect(message).toContain('markov.pet wants you to prove');
    expect(message).toContain('Chain: solana:EtWT');
    expect(message).toContain(`Account: ${params.userId}`);
    expect(message).toContain('Nonce: nonce123');
    expect(message).toContain('Expiration Time: 2026-09-24T10:05:00.000Z');
    expect(message).toContain('approves no transaction');
  });

  it('verifies a signature from the owning key and rejects everything else', () => {
    const wallet = createEd25519TestWallet();
    const stranger = createEd25519TestWallet();
    const message = buildWalletChallengeMessage({ ...params, address: wallet.address });
    const signature = wallet.sign(message);
    expect(verifyWalletSignature({ address: wallet.address, message, signature })).toBe(true);
    expect(verifyWalletSignature({ address: stranger.address, message, signature })).toBe(false);
    expect(
      verifyWalletSignature({ address: wallet.address, message: `${message}x`, signature }),
    ).toBe(false);
    expect(
      verifyWalletSignature({
        address: wallet.address,
        message,
        signature: stranger.sign(message),
      }),
    ).toBe(false);
    expect(verifyWalletSignature({ address: 'not-base58-0OIl', message, signature })).toBe(false);
    expect(verifyWalletSignature({ address: wallet.address, message, signature: 'abc' })).toBe(
      false,
    );
  });

  it('generates distinct nonces', () => {
    expect(generateChallengeNonce()).not.toBe(generateChallengeNonce());
    expect(generateChallengeNonce().length).toBeGreaterThanOrEqual(20);
  });
});

describe('credentials', () => {
  it('generates prefixed tokens whose secrets are only stored hashed', () => {
    const credential = generateCredential('agent', 'pepper-value-at-least-32-characters-long');
    expect(credential.token.startsWith('mkv_ag_')).toBe(true);
    expect(credential.token).toContain(credential.prefix);
    expect(credential.token).not.toContain(credential.secretHash);
    const parsed = parseCredentialToken(credential.token);
    expect(parsed?.kind).toBe('agent');
    expect(parsed?.prefix).toBe(credential.prefix);
    expect(
      secretHashesMatch(
        hashCredentialSecret(parsed?.secret ?? '', 'pepper-value-at-least-32-characters-long'),
        credential.secretHash,
      ),
    ).toBe(true);
    expect(
      secretHashesMatch(
        hashCredentialSecret(parsed?.secret ?? '', 'other-pepper-value-at-least-32-chars'),
        credential.secretHash,
      ),
    ).toBe(false);
  });

  it('parses only well-formed tokens', () => {
    expect(parseCredentialToken('mkv_xx_abcdefgh_' + 'a'.repeat(43))).toBeNull();
    expect(parseCredentialToken('Bearer mkv_ag_abcdefgh_' + 'a'.repeat(43))).toBeNull();
    expect(parseCredentialToken('')).toBeNull();
    expect(parseCredentialToken(generateCredential('device', 'p'.repeat(32)).token)?.kind).toBe(
      'device',
    );
  });
});

describe('principals', () => {
  const user: Principal = {
    class: 'user',
    id: 'u1',
    userId: 'u1',
    scopes: [OWNER_SCOPE],
    authTime: new Date('2026-09-24T10:00:00Z'),
    sessionId: 's1',
    credentialId: null,
  };
  const agent: Principal = {
    class: 'agent',
    id: 'c1',
    userId: 'u1',
    scopes: ['portfolio:read'],
    authTime: null,
    sessionId: null,
    credentialId: 'c1',
  };

  it('grants owners every owner operation and agents only their scopes', () => {
    expect(hasScope(user, 'portfolio:read')).toBe(true);
    expect(hasScope(user, 'anything:else')).toBe(true);
    expect(hasScope(agent, 'portfolio:read')).toBe(true);
    expect(hasScope(agent, 'proposals:create')).toBe(false);
  });

  it('treats only recent interactive authentication as step-up fresh', () => {
    expect(isStepUpFresh(user, 600, new Date('2026-09-24T10:05:00Z'))).toBe(true);
    expect(isStepUpFresh(user, 600, new Date('2026-09-24T10:11:00Z'))).toBe(false);
    expect(isStepUpFresh(agent, 600)).toBe(false);
  });
});
