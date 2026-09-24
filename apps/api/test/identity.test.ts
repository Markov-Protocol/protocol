import {
  createEd25519TestWallet,
  createIdentityVerifier,
  createTestIdentityIssuer,
  generateCredential,
} from '@markov/auth';
import { KNOWN_GENESIS_HASHES, loadConfig } from '@markov/config';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  type DbClient,
  runMigrations,
} from '@markov/db';
import { createSilentLogger } from '@markov/observability';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  buildApp,
  type CatalogService,
  createIdentityService,
  createProbes,
  type MarkovApi,
  type PolicyService,
} from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = KNOWN_GENESIS_HASHES.devnet;

interface Harness {
  app: MarkovApi;
  client: DbClient;
  mint: (subject: string, authTime?: Date) => Promise<string>;
  session: (subject: string, authTime?: Date) => Promise<string>;
  operatorToken: (scopes: string[]) => Promise<string>;
}

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 4,
      statementTimeoutMs: 10_000,
      applicationName: 'identity-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'identity-test',
      );
      const issuer = await createTestIdentityIssuer({
        issuer: config.identity.issuer,
        audience: config.identity.audience,
      });
      const verifier = createIdentityVerifier({
        issuer: issuer.issuer,
        audience: issuer.audience,
        algorithms: ['ES256'],
        keys: { jwks: issuer.jwks() },
      });
      const identity = createIdentityService({
        config,
        db: client.db,
        verifier,
        genesisHash: GENESIS,
      });
      const app = await buildApp({
        config,
        logger: createSilentLogger(),
        service: { name: 'markov-api', version: 'test', startedAt: Date.now() },
        probes: createProbes(config, client),
        network: {
          snapshot: () => ({
            status: 'verified',
            observedGenesisHash: GENESIS,
            detail: 'stub',
            checkedAt: new Date().toISOString(),
            durationMs: 1,
          }),
        },
        expectedGenesisHash: GENESIS,
        identity,
        catalog: unavailableCatalog,
        policy: unavailablePolicy,
        mintTestToken: (input) =>
          issuer.mint(
            input.authTime
              ? { subject: input.subject, authTime: new Date(input.authTime) }
              : { subject: input.subject },
          ),
      });
      await app.ready();
      const mint = (subject: string, authTime?: Date) =>
        issuer.mint(authTime ? { subject, authTime } : { subject });
      const session = async (subject: string, authTime?: Date) => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: { identityToken: await mint(subject, authTime) },
        });
        expect(response.statusCode).toBe(201);
        return response.json().sessionToken as string;
      };
      const operatorToken = async (scopes: string[]) => {
        const generated = generateCredential('operator', config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId: null,
          principalClass: 'operator',
          label: 'ops',
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      try {
        await fn({ app, client, mint, session, operatorToken });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

const unavailablePolicy = new Proxy({} as PolicyService, {
  get: () => () => {
    throw new Error('policy service is not part of this test');
  },
});
const unavailableCatalog = new Proxy({} as CatalogService, {
  get: () => () => {
    throw new Error('catalog service is unavailable in this test');
  },
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe.skipIf(adminUrl === null)('identity API', () => {
  it('exchanges a verified identity token for a session and rejects bad tokens', async () => {
    await withHarness(async ({ app, session }) => {
      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/auth/sessions',
        payload: { identityToken: 'eyJ.not.valid-token-value-here' },
      });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json().error.code).toBe('AUTH_REQUIRED');

      const token = await session('did:test:alice');
      expect(token.startsWith('mkv_ss_')).toBe(true);
      const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        principal: { class: 'user', scopes: ['owner:*'], stepUpFresh: true },
        user: { subject: 'did:test:alice' },
      });

      const garbage = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: bearer(`mkv_ss_abcdefgh_${'x'.repeat(43)}`),
      });
      expect(garbage.statusCode).toBe(401);
      const malformed = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: 'Token abc' },
      });
      expect(malformed.statusCode).toBe(401);
      const anonymous = await app.inject({ method: 'GET', url: '/v1/me' });
      expect(anonymous.statusCode).toBe(401);

      const logout = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/sessions/current',
        headers: bearer(token),
      });
      expect(logout.statusCode).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) })).statusCode,
      ).toBe(401);
    });
  });

  it('links a wallet through a signed challenge and refuses replay, bad signatures, other accounts and stale sign-in', async () => {
    await withHarness(async ({ app, session }) => {
      const alice = await session('did:test:alice');
      const bob = await session('did:test:bob');
      const wallet = createEd25519TestWallet();

      const challenge = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(alice),
        payload: { address: wallet.address },
      });
      expect(challenge.statusCode).toBe(201);
      const { challengeId, message } = challenge.json();
      expect(message).toContain(`Address: ${wallet.address}`);
      expect(message).toContain(`Chain: solana:${GENESIS}`);
      expect(message).toContain('localhost wants you to prove');

      const badSignature = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets',
        headers: bearer(alice),
        payload: {
          challengeId,
          address: wallet.address,
          signature: createEd25519TestWallet().sign(message),
        },
      });
      expect(badSignature.statusCode).toBe(409);
      expect(badSignature.json().error.code).toBe('SIGNATURE_MISMATCH');

      // The challenge was consumed by the failed attempt: a correct signature can no longer reuse it.
      const replay = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets',
        headers: bearer(alice),
        payload: { challengeId, address: wallet.address, signature: wallet.sign(message) },
      });
      expect(replay.statusCode).toBe(409);
      expect(replay.json().error.code).toBe('CHALLENGE_INVALID');

      const second = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(alice),
        payload: { address: wallet.address },
      });
      const linked = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets',
        headers: bearer(alice),
        payload: {
          challengeId: second.json().challengeId,
          address: wallet.address,
          signature: wallet.sign(second.json().message),
        },
      });
      expect(linked.statusCode).toBe(201);
      expect(linked.json()).toMatchObject({
        chain: 'solana',
        genesisHash: GENESIS,
        address: wallet.address,
      });
      const walletId = linked.json().walletId as string;

      const bobChallenge = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(bob),
        payload: { address: wallet.address },
      });
      const bobLink = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets',
        headers: bearer(bob),
        payload: {
          challengeId: bobChallenge.json().challengeId,
          address: wallet.address,
          signature: wallet.sign(bobChallenge.json().message),
        },
      });
      expect(bobLink.statusCode).toBe(409);
      expect(bobLink.json().error.code).toBe('WALLET_ALREADY_LINKED');

      // Bob cannot use Alice's challenge, nor see or unlink her wallet.
      const stolen = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(alice),
        payload: { address: wallet.address },
      });
      const crossAccount = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets',
        headers: bearer(bob),
        payload: {
          challengeId: stolen.json().challengeId,
          address: wallet.address,
          signature: wallet.sign(stolen.json().message),
        },
      });
      expect(crossAccount.json().error.code).toBe('CHALLENGE_INVALID');
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/wallets', headers: bearer(bob) })).json()
          .wallets,
      ).toEqual([]);
      const bobUnlink = await app.inject({
        method: 'DELETE',
        url: `/v1/me/wallets/${walletId}`,
        headers: bearer(bob),
      });
      expect(bobUnlink.statusCode).toBe(404);

      const list = await app.inject({
        method: 'GET',
        url: '/v1/me/wallets',
        headers: bearer(alice),
      });
      expect(list.json().wallets.map((entry: { walletId: string }) => entry.walletId)).toEqual([
        walletId,
      ]);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/me/wallets/${walletId}`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/wallets', headers: bearer(alice) })).json()
          .wallets,
      ).toEqual([]);

      const stale = await session('did:test:carol', new Date(Date.now() - 20 * 60_000));
      const staleChallenge = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(stale),
        payload: { address: wallet.address },
      });
      expect(staleChallenge.statusCode).toBe(401);
      expect(staleChallenge.json().error.code).toBe('STEP_UP_REQUIRED');
    });
  });

  it('issues scoped agent credentials that cannot escalate, and revokes them', async () => {
    await withHarness(async ({ app, session }) => {
      const alice = await session('did:test:alice');
      const created = await app.inject({
        method: 'POST',
        url: '/v1/me/api-credentials',
        headers: bearer(alice),
        payload: { label: 'research bot', scopes: ['portfolio:read'], expiresInSeconds: 3600 },
      });
      expect(created.statusCode).toBe(201);
      const agentToken = created.json().token as string;
      expect(agentToken.startsWith('mkv_ag_')).toBe(true);
      const credentialId = created.json().credentialId as string;

      const listed = await app.inject({
        method: 'GET',
        url: '/v1/me/api-credentials',
        headers: bearer(alice),
      });
      expect(JSON.stringify(listed.json())).not.toContain(agentToken.split('_')[3]);

      const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(agentToken) });
      expect(me.json().principal).toMatchObject({
        class: 'agent',
        scopes: ['portfolio:read'],
        stepUpFresh: false,
      });
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/wallets', headers: bearer(agentToken) }))
          .statusCode,
      ).toBe(200);
      const escalate = await app.inject({
        method: 'POST',
        url: '/v1/me/wallets/challenges',
        headers: bearer(agentToken),
        payload: { address: createEd25519TestWallet().address },
      });
      expect(escalate.statusCode).toBe(403);
      const selfIssue = await app.inject({
        method: 'POST',
        url: '/v1/me/api-credentials',
        headers: bearer(agentToken),
        payload: { label: 'x', scopes: ['proposals:create'], expiresInSeconds: 3600 },
      });
      expect(selfIssue.statusCode).toBe(403);
      const noScope = await app.inject({
        method: 'POST',
        url: '/v1/me/api-credentials',
        headers: bearer(alice),
        payload: { label: 'r', scopes: ['research:read'], expiresInSeconds: 3600 },
      });
      const researchOnly = noScope.json().token as string;
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/wallets', headers: bearer(researchOnly) }))
          .statusCode,
      ).toBe(403);

      const bob = await session('did:test:bob');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/me/api-credentials/${credentialId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/me/api-credentials/${credentialId}`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(agentToken) }))
          .statusCode,
      ).toBe(401);
    });
  });

  it('keeps operators separate from users and records audit events', async () => {
    await withHarness(async ({ app, session, operatorToken }) => {
      const alice = await session('did:test:alice');
      const aliceId = (
        await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json().user.id as string;
      const reader = await operatorToken(['ops:read']);
      const revoker = await operatorToken(['ops:read', 'ops:credentials:revoke']);

      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/v1/ops/users/${aliceId}`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(403);
      const summary = await app.inject({
        method: 'GET',
        url: `/v1/ops/users/${aliceId}`,
        headers: bearer(reader),
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().user.subject).toBe('did:test:alice');
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(reader) })).statusCode,
      ).toBe(403);

      const created = await app.inject({
        method: 'POST',
        url: '/v1/me/api-credentials',
        headers: bearer(alice),
        payload: { label: 'bot', scopes: ['portfolio:read'], expiresInSeconds: 3600 },
      });
      const credentialId = created.json().credentialId as string;
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/ops/api-credentials/${credentialId}`,
            headers: bearer(reader),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/ops/api-credentials/${credentialId}`,
            headers: bearer(revoker),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/v1/me',
            headers: bearer(created.json().token as string),
          })
        ).statusCode,
      ).toBe(401);

      const audit = await app.inject({
        method: 'GET',
        url: '/v1/ops/audit?limit=10',
        headers: bearer(reader),
      });
      expect(audit.statusCode).toBe(200);
      const actions = audit.json().events.map((event: { action: string }) => event.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'session.created',
          'credential.created',
          'credential.revoked.by-operator',
        ]),
      );
      expect(JSON.stringify(audit.json())).not.toContain('mkv_');
    });
  });

  it('pairs devices with a single-use code and revokes their credential', async () => {
    await withHarness(async ({ app, session }) => {
      const alice = await session('did:test:alice');
      const pairing = await app.inject({
        method: 'POST',
        url: '/v1/me/devices/pairings',
        headers: bearer(alice),
        payload: { capabilities: ['status:read'] },
      });
      expect(pairing.statusCode).toBe(201);
      const code = pairing.json().code as string;

      const paired = await app.inject({
        method: 'POST',
        url: '/v1/devices/pair',
        payload: { code, deviceName: 'Mark I on the desk' },
      });
      expect(paired.statusCode).toBe(201);
      const deviceToken = paired.json().deviceToken as string;
      expect(deviceToken.startsWith('mkv_dv_')).toBe(true);
      const reuse = await app.inject({
        method: 'POST',
        url: '/v1/devices/pair',
        payload: { code, deviceName: 'Impostor' },
      });
      expect(reuse.statusCode).toBe(409);
      expect(reuse.json().error.code).toBe('CHALLENGE_INVALID');

      // A device credential is not a user: it cannot read the account or create anything.
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(deviceToken) }))
          .statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/devices', headers: bearer(deviceToken) }))
          .statusCode,
      ).toBe(403);

      const devices = await app.inject({
        method: 'GET',
        url: '/v1/me/devices',
        headers: bearer(alice),
      });
      expect(devices.json().devices).toHaveLength(1);
      const deviceId = devices.json().devices[0].deviceId as string;
      const bob = await session('did:test:bob');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/me/devices/${deviceId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/v1/me/devices/${deviceId}`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/me/wallets', headers: bearer(deviceToken) }))
          .statusCode,
      ).toBe(401);
    });
  });
});
