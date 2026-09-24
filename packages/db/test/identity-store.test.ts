import { testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  consumeDevicePairing,
  consumeWalletChallenge,
  createApiCredential,
  createDbClient,
  createDevice,
  createDevicePairing,
  createSession,
  createWalletChallenge,
  type DbClient,
  findSessionByPrefix,
  linkWallet,
  listApiCredentials,
  listAuditEvents,
  listWallets,
  recordAuditEvent,
  revokeApiCredential,
  revokeDevice,
  revokeSession,
  runMigrations,
  unlinkWallet,
  upsertUserBySubject,
  WalletAlreadyLinkedError,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();

async function withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  if (adminUrl === null) {
    throw new Error('test requires MARKOV_TEST_DATABASE_URL');
  }
  return withTemporaryDatabase(adminUrl, async (url) => {
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 3,
      statementTimeoutMs: 10_000,
      applicationName: 'identity-store-test',
    });
    try {
      await runMigrations(client.db);
      return await fn(client);
    } finally {
      await client.close();
    }
  });
}

const future = () => new Date(Date.now() + 60_000);

describe.skipIf(adminUrl === null)('identity store', () => {
  it('upserts users idempotently by issuer and subject', async () => {
    await withClient(async ({ db }) => {
      const first = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const again = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const other = await upsertUserBySubject(db, { issuer: 'iss', subject: 'bob' });
      expect(again.id).toBe(first.id);
      expect(other.id).not.toBe(first.id);
    });
  });

  it('creates, finds and revokes sessions scoped to their owner', async () => {
    await withClient(async ({ db }) => {
      const alice = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const bob = await upsertUserBySubject(db, { issuer: 'iss', subject: 'bob' });
      const session = await createSession(db, {
        userId: alice.id,
        prefix: 'abc123',
        secretHash: 'h',
        authTime: new Date(),
        expiresAt: future(),
      });
      expect((await findSessionByPrefix(db, 'abc123'))?.user.id).toBe(alice.id);
      expect(await revokeSession(db, { sessionId: session.id, userId: bob.id })).toBe(false);
      expect(await revokeSession(db, { sessionId: session.id, userId: alice.id })).toBe(true);
      expect((await findSessionByPrefix(db, 'abc123'))?.revokedAt).not.toBeNull();
    });
  });

  it('consumes a wallet challenge exactly once, only for its owner and address', async () => {
    await withClient(async ({ db }) => {
      const alice = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const bob = await upsertUserBySubject(db, { issuer: 'iss', subject: 'bob' });
      const challenge = await createWalletChallenge(db, {
        userId: alice.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'ADDR',
        nonce: 'n1',
        message: 'm',
        expiresAt: future(),
      });
      const now = new Date();
      expect(
        await consumeWalletChallenge(db, {
          challengeId: challenge.id,
          userId: bob.id,
          address: 'ADDR',
          now,
        }),
      ).toBeNull();
      expect(
        await consumeWalletChallenge(db, {
          challengeId: challenge.id,
          userId: alice.id,
          address: 'OTHER',
          now,
        }),
      ).toBeNull();
      expect(
        (
          await consumeWalletChallenge(db, {
            challengeId: challenge.id,
            userId: alice.id,
            address: 'ADDR',
            now,
          })
        )?.id,
      ).toBe(challenge.id);
      expect(
        await consumeWalletChallenge(db, {
          challengeId: challenge.id,
          userId: alice.id,
          address: 'ADDR',
          now,
        }),
      ).toBeNull();
      const expired = await createWalletChallenge(db, {
        userId: alice.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'ADDR',
        nonce: 'n2',
        message: 'm',
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(
        await consumeWalletChallenge(db, {
          challengeId: expired.id,
          userId: alice.id,
          address: 'ADDR',
          now,
        }),
      ).toBeNull();
    });
  });

  it('allows one active link per wallet across accounts and relinking after unlinking', async () => {
    await withClient(async ({ db }) => {
      const alice = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const bob = await upsertUserBySubject(db, { issuer: 'iss', subject: 'bob' });
      const c1 = await createWalletChallenge(db, {
        userId: alice.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'W',
        nonce: 'a',
        message: 'm',
        expiresAt: future(),
      });
      const c2 = await createWalletChallenge(db, {
        userId: bob.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'W',
        nonce: 'b',
        message: 'm',
        expiresAt: future(),
      });
      const link = await linkWallet(db, {
        userId: alice.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'W',
        challengeId: c1.id,
      });
      await expect(
        linkWallet(db, {
          userId: bob.id,
          chain: 'solana',
          genesisHash: 'G',
          address: 'W',
          challengeId: c2.id,
        }),
      ).rejects.toBeInstanceOf(WalletAlreadyLinkedError);
      expect(await unlinkWallet(db, { walletId: link.id, userId: bob.id })).toBeNull();
      expect((await unlinkWallet(db, { walletId: link.id, userId: alice.id }))?.id).toBe(link.id);
      expect(await listWallets(db, alice.id)).toEqual([]);
      const relinked = await linkWallet(db, {
        userId: bob.id,
        chain: 'solana',
        genesisHash: 'G',
        address: 'W',
        challengeId: c2.id,
      });
      expect((await listWallets(db, bob.id)).map((row) => row.id)).toEqual([relinked.id]);
    });
  });

  it('scopes credential and device revocation to the owner and records audit events', async () => {
    await withClient(async ({ db }) => {
      const alice = await upsertUserBySubject(db, { issuer: 'iss', subject: 'alice' });
      const bob = await upsertUserBySubject(db, { issuer: 'iss', subject: 'bob' });
      const credential = await createApiCredential(db, {
        userId: alice.id,
        principalClass: 'agent',
        label: 'agent',
        prefix: 'p1',
        secretHash: 'h',
        scopes: ['portfolio:read'],
        expiresAt: future(),
      });
      expect(
        await revokeApiCredential(db, { credentialId: credential.id, userId: bob.id }),
      ).toBeNull();
      expect(
        (await revokeApiCredential(db, { credentialId: credential.id, userId: null }))?.id,
      ).toBe(credential.id);
      expect((await listApiCredentials(db, alice.id))[0]?.revokedAt).not.toBeNull();

      const pairing = await createDevicePairing(db, {
        userId: alice.id,
        codeHash: 'code',
        capabilities: ['status:read'],
        expiresAt: future(),
      });
      const now = new Date();
      expect((await consumeDevicePairing(db, { codeHash: 'code', now }))?.id).toBe(pairing.id);
      expect(await consumeDevicePairing(db, { codeHash: 'code', now })).toBeNull();
      const device = await createDevice(db, {
        userId: alice.id,
        pairingId: pairing.id,
        name: 'Mark I',
        capabilities: ['status:read'],
        prefix: 'd1',
        secretHash: 'h',
      });
      expect(await revokeDevice(db, { deviceId: device.id, userId: bob.id })).toBeNull();
      expect((await revokeDevice(db, { deviceId: device.id, userId: alice.id }))?.id).toBe(
        device.id,
      );

      await recordAuditEvent(db, {
        actorClass: 'user',
        actorId: alice.id,
        action: 'device.revoked',
        targetType: 'device',
        targetId: device.id,
        requestId: 'r1',
      });
      const events = await listAuditEvents(db, { limit: 10, targetType: 'device' });
      expect(events[0]).toMatchObject({
        actorClass: 'user',
        action: 'device.revoked',
        targetId: device.id,
        requestId: 'r1',
      });
    });
  });
});
