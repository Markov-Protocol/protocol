import { generateKeyPairSync } from 'node:crypto';
import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig } from '@markov/config';
import {
  encodeBase58,
  type FollowListResponse,
  type Publication,
  type PublicStrategy,
  type PublicVersion,
  type RegistryRecord,
  type StrategyDetail,
  type StrategyDraftContent,
  type StrategyVersion,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createSilentLogger } from '@markov/observability';
import {
  BLOCKHASH_VALIDITY,
  base64ToBytes,
  bytesToBase64,
  compileLegacyMessage,
  type Ed25519Signer,
  FixtureLedger,
  hexToBytes,
  parseTransaction,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  registryErrorCode,
  serializeTransaction,
  signerFromPrivateKey,
  signTransaction,
  unsignedTransaction,
} from '@markov/registry';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  type AccountingService,
  type AnalyticsService,
  buildApp,
  createCatalogService,
  createFollowService,
  createIdentityService,
  createPolicyService,
  createProbes,
  createRegistryService,
  createStrategyService,
  type DiscoveryService,
  type ExecutionService,
  type FundingService,
  type MarkovApi,
  type PlanningService,
  type ResearchService,
  type WatchlistService,
} from '../src/index.js';
import { GENESIS, prestocksFixtureRpcFetch } from './support/fixture-rpc.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const BOGUS = '99999999-9999-4999-8999-999999999999';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

interface Harness {
  app: MarkovApi;
  ledger: FixtureLedger;
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  seed: (operatorToken: string) => Promise<Record<'aero' | 'bio', string>>;
  /** Links a fresh Ed25519 wallet, funds it on the ledger and answers its id and signer. */
  linkWallet: (sessionToken: string) => Promise<{ walletId: string; signer: Ed25519Signer }>;
}

async function withHarness(
  options: { programId: string | null },
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(
      baseTestEnv({
        DATABASE_URL: url,
        ...(options.programId ? { REGISTRY_PROGRAM_ID: options.programId } : {}),
      }),
    );
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'registry-test',
    });
    const ledger = new FixtureLedger({ programId: PROGRAM_ID, genesisHash: GENESIS });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'registry-test',
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
      const rpc = new SolanaRpcClient({
        url: 'http://rpc.test',
        timeoutMs: 2000,
        maxResponseBytes: 1_000_000,
        fetchImpl: prestocksFixtureRpcFetch(ledger),
      });
      const identity = createIdentityService({
        config,
        db: client.db,
        verifier,
        genesisHash: GENESIS,
      });
      const catalog = createCatalogService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [rpc],
        sourceFor: () => createPrestocksFixtureSource('default'),
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
        catalog,
        policy: createPolicyService({ config, db: client.db, catalog }),
        funding: unavailable<FundingService>('funding'),
        research: unavailable<ResearchService>('research'),
        watchlists: unavailable<WatchlistService>('watchlist'),
        strategies: createStrategyService({ config, db: client.db, genesisHash: GENESIS }),
        registry: createRegistryService({
          config,
          db: client.db,
          genesisHash: GENESIS,
          rpcClients: [rpc],
        }),
        follows: createFollowService({ db: client.db }),
        planning: unavailable<PlanningService>('planning'),
        execution: unavailable<ExecutionService>('execution'),
        accounting: unavailable<AccountingService>('accounting'),
        analytics: unavailable<AnalyticsService>('analytics'),
        discovery: unavailable<DiscoveryService>('discovery'),
        mintTestToken: (input) => issuer.mint({ subject: input.subject }),
      });
      await app.ready();
      const credential = async (
        principalClass: 'operator' | 'agent',
        userId: string | null,
        scopes: string[],
      ) => {
        const generated = generateCredential(principalClass, config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId,
          principalClass,
          label: principalClass,
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      const user = async (subject = 'did:test:alice') => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: { identityToken: await issuer.mint({ subject }) },
        });
        return response.json().sessionToken as string;
      };
      const seed = async (operatorToken: string) => {
        const headers = bearer(operatorToken);
        await app.inject({
          method: 'POST',
          url: '/v1/ops/catalog/ingestions',
          headers,
          payload: { issuer: 'prestocks', source: 'fixture' },
        });
        const idOf = async (symbol: string) => {
          const list = await app.inject({
            method: 'GET',
            url: `/v1/ops/catalog/instruments?q=${symbol}&status=quarantined`,
            headers,
          });
          const found = (
            list.json().instruments as { instrumentId: string; symbol: string }[]
          ).find((row) => row.symbol === symbol);
          if (!found) {
            throw new Error(`fixture ${symbol} missing`);
          }
          return found.instrumentId;
        };
        const ids = { aero: await idOf('FXAERO'), bio: await idOf('FXBIO') };
        for (const id of [ids.aero, ids.bio]) {
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/mint-verifications`,
            headers,
          });
          const admitted = await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/decisions`,
            headers,
            payload: { decision: 'admit', reason: 'registry test', evidence: { review: 'test' } },
          });
          expect(admitted.statusCode, admitted.body).toBe(201);
        }
        return ids;
      };
      const linkWallet = async (sessionToken: string) => {
        const signer = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
        const challenge = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets/challenges',
          headers: bearer(sessionToken),
          payload: { address: signer.publicKey },
        });
        expect(challenge.statusCode, challenge.body).toBe(201);
        const { challengeId, message } = challenge.json() as {
          challengeId: string;
          message: string;
        };
        const linked = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets',
          headers: bearer(sessionToken),
          payload: {
            challengeId,
            address: signer.publicKey,
            signature: encodeBase58(signer.sign(new TextEncoder().encode(message))),
          },
        });
        expect(linked.statusCode, linked.body).toBe(201);
        ledger.fund(signer.publicKey, 1_000_000_000n);
        return { walletId: (linked.json() as { walletId: string }).walletId, signer };
      };
      try {
        await fn({
          app,
          ledger,
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          seed,
          linkWallet,
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

function content(
  ids: Record<string, string>,
  aeroBps = 6000,
  cashBps = 1000,
): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: aeroBps, note: null },
      { instrumentId: ids['bio'] as string, weightBps: 10_000 - aeroBps - cashBps, note: null },
    ],
    cashWeightBps: cashBps,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}

/**
 * Sign the prepared transaction of a publication: normally with the publisher,
 * optionally with a bit flipped in the message, or by a stranger over the
 * exact message (a signature the fee-payer slot cannot carry).
 */
function sign(
  publication: Publication,
  signer: Ed25519Signer,
  options: { tamper?: boolean; stranger?: boolean } = {},
): string {
  const unsigned = base64ToBytes(publication.transaction?.unsignedTransaction ?? '');
  if (!options.tamper && !options.stranger) {
    return bytesToBase64(signTransaction(unsigned, signer).bytes);
  }
  const parsed = parseTransaction(unsigned);
  const message = Uint8Array.from(parsed.messageBytes);
  if (options.tamper) {
    message[message.length - 1] = (message[message.length - 1] as number) ^ 1; // flip a bit in the instruction data
  }
  return bytesToBase64(serializeTransaction([signer.sign(message)], message));
}

describe.skipIf(adminUrl === null)('registry API', () => {
  it('prepares, verifies, submits and registers a version, then reads it back with chain evidence', async () => {
    await withHarness({ programId: PROGRAM_ID }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const bob = await h.user('did:test:bob');
      const aliceWallet = await h.linkWallet(alice);
      const bobWallet = await h.linkWallet(bob);
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as {
        user: { id: string };
      };

      const status = await h.app.inject({ method: 'GET', url: '/v1/registry' });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({
        publicationEnabled: true,
        disabledReason: null,
        programId: PROGRAM_ID,
        network: { cluster: 'devnet', genesisHash: GENESIS },
        recordSpace: 832,
        maxLegs: 10,
        indexer: { lastRunAt: null, recordsIndexed: 0 },
      });

      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/strategies',
        headers: bearer(alice),
        payload: { content: content(ids) },
      });
      expect(created.statusCode, created.body).toBe(201);
      const strategyId = (created.json() as StrategyDetail).strategy.strategyId;
      const frozen = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions`,
        headers: bearer(alice),
        payload: {},
      });
      expect(frozen.statusCode, frozen.body).toBe(201);
      const v1 = frozen.json() as StrategyVersion;
      expect(v1.publication).toBe('unpublished');
      const base = `/v1/me/strategies/${strategyId}/versions/${v1.versionId}`;

      // Nothing prepared yet; foreign wallets and foreign owners are not found.
      expect(
        (await h.app.inject({ method: 'GET', url: `${base}/publication`, headers: bearer(alice) }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/publication`,
            headers: bearer(alice),
            payload: { walletId: BOGUS },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/publication`,
            headers: bearer(alice),
            payload: { walletId: bobWallet.walletId },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/publication`,
            headers: bearer(bob),
            payload: { walletId: bobWallet.walletId },
          })
        ).statusCode,
      ).toBe(404);
      const agent = await h.agent(me.user.id, ['portfolio:read', 'proposals:create']);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/publication`,
            headers: bearer(agent),
            payload: { walletId: aliceWallet.walletId },
          })
        ).statusCode,
      ).toBe(403);

      // Prepare: what becomes public, the record address, the unsigned transaction.
      const prepared = await h.app.inject({
        method: 'POST',
        url: `${base}/publication`,
        headers: bearer(alice),
        payload: { walletId: aliceWallet.walletId },
      });
      expect(prepared.statusCode, prepared.body).toBe(201);
      const publication = prepared.json() as Publication;
      const expectedAddress = recordAddress(PROGRAM_ID, hexToBytes(v1.manifestHash)).address;
      expect(publication).toMatchObject({
        operation: 'register',
        state: 'awaiting_signature',
        programId: PROGRAM_ID,
        recordAddress: expectedAddress,
        publisher: { walletId: aliceWallet.walletId, address: aliceWallet.signer.publicKey },
        manifestHash: v1.manifestHash,
        contentDigest: v1.contentDigest,
        signature: null,
        evidence: null,
        failure: null,
      });
      expect(publication.transaction).toMatchObject({
        feePayer: aliceWallet.signer.publicKey,
        estimatedCostLamports: 6_681_600 + 5_000,
      });
      expect(publication.preview.manifest).toMatchObject({
        strategyId,
        versionNumber: 1,
        title: 'Aerospace tilt',
        manifestHash: v1.manifestHash,
      });
      // Legs are sorted by instrument id (random per run), so compare the set of symbols.
      expect(publication.preview.manifest.legs.map((leg) => leg.symbol).sort()).toEqual([
        'FXAERO',
        'FXBIO',
      ]);
      expect(publication.preview.onChain).toMatchObject({
        recordAddress: expectedAddress,
        publisher: aliceWallet.signer.publicKey,
        relation: 'none',
        parentManifestHash: null,
        cashWeightBps: 1000,
      });
      expect(publication.preview.onChain.legs).toHaveLength(2);
      expect(publication.preview.neverPublished.join(' ')).toContain('email');
      expect(publication.preview.permanence).toContain('never be edited or deleted');
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: base, headers: bearer(alice) })
            .then((r) => r.json() as StrategyVersion)
        ).publication,
      ).toBe('awaiting_signature');

      // A second prepare answers the in-flight publication; nothing else is built.
      const again = await h.app.inject({
        method: 'POST',
        url: `${base}/publication`,
        headers: bearer(alice),
        payload: { walletId: aliceWallet.walletId },
      });
      expect(again.statusCode).toBe(200);
      expect((again.json() as Publication).publicationId).toBe(publication.publicationId);
      const byVersion = await h.app.inject({
        method: 'GET',
        url: `${base}/publication`,
        headers: bearer(alice),
      });
      expect((byVersion.json() as Publication).publicationId).toBe(publication.publicationId);
      const byAgent = await h.app.inject({
        method: 'GET',
        url: `/v1/me/publications/${publication.publicationId}`,
        headers: bearer(agent),
      });
      expect(byAgent.statusCode).toBe(200);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/publications/${publication.publicationId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);

      // Submissions that are not the prepared message, or not the publisher's signature, never reach the node.
      const submitUrl = `/v1/me/publications/${publication.publicationId}/submit`;
      const tampered = await h.app.inject({
        method: 'POST',
        url: submitUrl,
        headers: bearer(alice),
        payload: { signedTransaction: sign(publication, aliceWallet.signer, { tamper: true }) },
      });
      expect(tampered.statusCode).toBe(409);
      expect(tampered.json().error.code).toBe('SIGNATURE_MISMATCH');
      const stranger = await h.app.inject({
        method: 'POST',
        url: submitUrl,
        headers: bearer(alice),
        payload: { signedTransaction: sign(publication, bobWallet.signer, { stranger: true }) },
      });
      expect(stranger.statusCode).toBe(409);
      const garbage = await h.app.inject({
        method: 'POST',
        url: submitUrl,
        headers: bearer(alice),
        payload: { signedTransaction: 'AQID' },
      });
      expect(garbage.statusCode).toBe(400);
      expect(h.ledger.programAccounts()).toHaveLength(0);
      expect(
        (
          await h.app
            .inject({
              method: 'GET',
              url: `/v1/me/publications/${publication.publicationId}`,
              headers: bearer(alice),
            })
            .then((r) => r.json() as Publication)
        ).state,
      ).toBe('awaiting_signature');

      // The real signature is accepted by the node; the state follows the chain, not the database.
      const submitted = await h.app.inject({
        method: 'POST',
        url: submitUrl,
        headers: bearer(alice),
        payload: { signedTransaction: sign(publication, aliceWallet.signer) },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      expect(submitted.json()).toMatchObject({
        state: 'submitted',
        transaction: null,
        evidence: null,
      });
      const signature = (submitted.json() as Publication).signature as string;
      expect(h.ledger.programAccounts()).toHaveLength(1);
      expect(
        await h.app
          .inject({ method: 'GET', url: `${base}/publication`, headers: bearer(alice) })
          .then((r) => r.json() as Publication),
      ).toMatchObject({
        state: 'submitted',
        confirmationStatus: 'processed',
      });
      // Public views do not exist before finality.
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/strategies/${strategyId}/versions/${v1.versionId}`,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await h.app.inject({ method: 'GET', url: `/v1/registry/records/${expectedAddress}` }))
          .statusCode,
      ).toBe(404);
      h.ledger.advance(1);
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `${base}/publication`, headers: bearer(alice) })
            .then((r) => r.json() as Publication)
        ).confirmationStatus,
      ).toBe('confirmed');
      h.ledger.finalize();
      const registered = await h.app.inject({
        method: 'GET',
        url: `${base}/publication`,
        headers: bearer(alice),
      });
      expect(registered.json()).toMatchObject({
        state: 'registered',
        confirmationStatus: 'finalized',
        signature,
        evidence: {
          signature,
          slot: 4242,
          recordAddress: expectedAddress,
          publisher: aliceWallet.signer.publicKey,
          status: 'active',
          transactionUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
          recordUrl: `https://explorer.solana.com/address/${expectedAddress}?cluster=devnet`,
        },
      });
      const versionAfter = (
        await h.app.inject({ method: 'GET', url: base, headers: bearer(alice) })
      ).json() as StrategyVersion;
      expect(versionAfter).toMatchObject({
        publication: 'registered',
        publisherWallet: aliceWallet.signer.publicKey,
      });

      // Public views: manifest, hash and chain evidence, verified on read.
      const publicVersion = await h.app.inject({
        method: 'GET',
        url: `/v1/strategies/${strategyId}/versions/${v1.versionId}`,
      });
      expect(publicVersion.statusCode, publicVersion.body).toBe(200);
      const pv = publicVersion.json() as PublicVersion;
      expect(pv).toMatchObject({
        versionNumber: 1,
        manifestHash: v1.manifestHash,
        registration: { signature, recordAddress: expectedAddress, status: 'active' },
        verification: {
          manifestHashMatches: true,
          contentMatches: true,
          recomputedManifestHash: v1.manifestHash,
          mismatches: [],
        },
      });
      expect(pv.canonicalManifest).toContain('"strategyId"');
      expect(JSON.stringify(pv)).not.toContain(me.user.id);
      expect(JSON.stringify(pv)).not.toContain('authorPrincipal');
      const record = await h.app.inject({
        method: 'GET',
        url: `/v1/registry/records/${expectedAddress}`,
      });
      expect(record.statusCode, record.body).toBe(200);
      expect(record.json() as RegistryRecord).toMatchObject({
        address: expectedAddress,
        publisher: aliceWallet.signer.publicKey,
        status: 'active',
        manifestHash: v1.manifestHash,
        relation: 'none',
        version: { strategyId, versionId: v1.versionId, versionNumber: 1 },
      });
      const publicStrategy = await h.app.inject({
        method: 'GET',
        url: `/v1/strategies/${strategyId}`,
      });
      expect(publicStrategy.statusCode).toBe(200);
      expect(publicStrategy.json().versions).toEqual([
        expect.objectContaining({
          versionId: v1.versionId,
          status: 'active',
          recordAddress: expectedAddress,
        }),
      ]);
      expect((publicStrategy.json() as PublicStrategy).followerCount).toBe(0);

      // Follow (F08): bookkeeping on the follower's account; the owner cannot follow their own.
      const followUrl = `/v1/me/follows/${strategyId}`;
      expect(
        (await h.app.inject({ method: 'PUT', url: followUrl, headers: bearer(alice) })).statusCode,
      ).toBe(400);
      expect(
        (
          await h.app.inject({
            method: 'PUT',
            url: `/v1/me/follows/${BOGUS}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
      const followed = await h.app.inject({ method: 'PUT', url: followUrl, headers: bearer(bob) });
      expect(followed.statusCode, followed.body).toBe(201);
      expect((followed.json() as FollowListResponse).follows).toEqual([
        {
          strategyId,
          followedAt: expect.any(String),
          latestVersion: {
            versionId: v1.versionId,
            versionNumber: 1,
            title: 'Aerospace tilt',
            status: 'active',
            registeredAt: expect.any(String),
          },
        },
      ]);
      expect(
        (await h.app.inject({ method: 'PUT', url: followUrl, headers: bearer(bob) })).statusCode,
      ).toBe(200);
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `/v1/strategies/${strategyId}` })
            .then((r) => r.json() as PublicStrategy)
        ).followerCount,
      ).toBe(1);
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: '/v1/me/follows', headers: bearer(alice) })
            .then((r) => r.json() as FollowListResponse)
        ).follows,
      ).toEqual([]);
      expect(JSON.stringify(followed.json())).not.toContain(me.user.id);
      const unfollowed = await h.app.inject({
        method: 'DELETE',
        url: followUrl,
        headers: bearer(bob),
      });
      expect(unfollowed.statusCode).toBe(200);
      expect((unfollowed.json() as FollowListResponse).follows).toEqual([]);
      expect(
        (await h.app.inject({ method: 'DELETE', url: followUrl, headers: bearer(bob) })).statusCode,
      ).toBe(200);
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `/v1/strategies/${strategyId}` })
            .then((r) => r.json() as PublicStrategy)
        ).followerCount,
      ).toBe(0);
      // Follow again so the deprecation below shows up on the follower's list.
      await h.app.inject({ method: 'PUT', url: followUrl, headers: bearer(bob) });

      // Fork (F08): a stranger forks the registered version into a draft of their own with attribution.
      const forked = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/forks`,
        headers: bearer(bob),
        payload: { versionId: v1.versionId },
      });
      expect(forked.statusCode, forked.body).toBe(201);
      const fork = forked.json() as StrategyDetail;
      expect(fork.strategy.forkOf).toEqual({ strategyId, versionId: v1.versionId });
      expect(fork.draft.content.title).toBe('Aerospace tilt (fork)');
      expect(fork.draft.content.legs.map((leg) => leg.weightBps).sort()).toEqual([3000, 6000]);
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/strategies/${strategyId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);

      // Registered is terminal and idempotent.
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/publication`,
            headers: bearer(alice),
            payload: { walletId: bobWallet.walletId },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await h.app
            .inject({
              method: 'POST',
              url: submitUrl,
              headers: bearer(alice),
              payload: { signedTransaction: sign(publication, aliceWallet.signer) },
            })
            .then((r) => r.json() as Publication)
        ).state,
      ).toBe('registered');

      // Deprecation: only the publisher wallet, only the status byte.
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `${base}/status-changes`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(404);
      const otherWallet = await h.linkWallet(alice);
      const wrongWallet = await h.app.inject({
        method: 'POST',
        url: `${base}/status-changes`,
        headers: bearer(alice),
        payload: { walletId: otherWallet.walletId, status: 'deprecated' },
      });
      expect(wrongWallet.statusCode).toBe(400);
      const deprecation = await h.app.inject({
        method: 'POST',
        url: `${base}/status-changes`,
        headers: bearer(alice),
        payload: { walletId: aliceWallet.walletId, status: 'deprecated' },
      });
      expect(deprecation.statusCode, deprecation.body).toBe(201);
      const dep = deprecation.json() as Publication;
      expect(dep).toMatchObject({
        operation: 'deprecate',
        state: 'awaiting_signature',
        recordAddress: expectedAddress,
      });
      // The registration read stays the registration; the status change has its own read.
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `${base}/publication`, headers: bearer(alice) })
            .then((r) => r.json() as Publication)
        ).publicationId,
      ).toBe(publication.publicationId);
      const latestChange = await h.app.inject({
        method: 'GET',
        url: `${base}/status-changes`,
        headers: bearer(alice),
      });
      expect(latestChange.statusCode).toBe(200);
      expect((latestChange.json() as Publication).publicationId).toBe(dep.publicationId);
      expect(
        (await h.app.inject({ method: 'GET', url: `${base}/status-changes`, headers: bearer(bob) }))
          .statusCode,
      ).toBe(404);
      const depSubmitted = await h.app.inject({
        method: 'POST',
        url: `/v1/me/publications/${dep.publicationId}/submit`,
        headers: bearer(alice),
        payload: { signedTransaction: sign(dep, aliceWallet.signer) },
      });
      expect(depSubmitted.statusCode, depSubmitted.body).toBe(200);
      h.ledger.finalize();
      const depDone = await h.app.inject({
        method: 'GET',
        url: `/v1/me/publications/${dep.publicationId}`,
        headers: bearer(alice),
      });
      expect(depDone.json()).toMatchObject({
        state: 'registered',
        evidence: { status: 'deprecated' },
      });
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `/v1/strategies/${strategyId}/versions/${v1.versionId}` })
            .then((r) => r.json() as PublicVersion)
        ).registration.status,
      ).toBe('deprecated');
      // The follower's list reflects the chain-derived status, never a database flag.
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: '/v1/me/follows', headers: bearer(bob) })
            .then((r) => r.json() as FollowListResponse)
        ).follows[0]?.latestVersion,
      ).toMatchObject({ versionId: v1.versionId, status: 'deprecated' });
      expect(
        (
          await h.app
            .inject({ method: 'GET', url: `/v1/registry/records/${expectedAddress}` })
            .then((r) => r.json() as RegistryRecord)
        ).manifestHash,
      ).toBe(v1.manifestHash);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `${base}/status-changes`,
            headers: bearer(alice),
            payload: { walletId: aliceWallet.walletId, status: 'deprecated' },
          })
        ).statusCode,
      ).toBe(400);

      // A later version references its registered parent on chain.
      await h.app.inject({
        method: 'PUT',
        url: `/v1/me/strategies/${strategyId}/draft`,
        headers: bearer(alice),
        payload: { content: content(ids, 5000, 2000) },
      });
      const v2 = (
        await h.app.inject({
          method: 'POST',
          url: `/v1/me/strategies/${strategyId}/versions`,
          headers: bearer(alice),
          payload: {},
        })
      ).json() as StrategyVersion;
      const base2 = `/v1/me/strategies/${strategyId}/versions/${v2.versionId}`;
      const prepared2 = (
        await h.app.inject({
          method: 'POST',
          url: `${base2}/publication`,
          headers: bearer(alice),
          payload: { walletId: aliceWallet.walletId },
        })
      ).json() as Publication;
      expect(prepared2.preview.onChain).toMatchObject({
        relation: 'revision',
        parentManifestHash: v1.manifestHash,
        parentRecordAddress: expectedAddress,
      });
      await h.app.inject({
        method: 'POST',
        url: `/v1/me/publications/${prepared2.publicationId}/submit`,
        headers: bearer(alice),
        payload: { signedTransaction: sign(prepared2, aliceWallet.signer) },
      });
      h.ledger.finalize();
      const v2Done = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/publications/${prepared2.publicationId}`,
          headers: bearer(alice),
        })
      ).json() as Publication;
      expect(v2Done.state).toBe('registered');
      const v2Record = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/registry/records/${prepared2.recordAddress}`,
        })
      ).json() as RegistryRecord;
      expect(v2Record).toMatchObject({ relation: 'revision', parentManifestHash: v1.manifestHash });
      expect(
        (
          (await h.app.inject({ method: 'GET', url: `/v1/strategies/${strategyId}` })).json()
            .versions as unknown[]
        ).length,
      ).toBe(2);
    });
  });

  it('reports dropped, failed, expired and unknown publications truthfully and lets the owner try again', async () => {
    await withHarness({ programId: PROGRAM_ID }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const wallet = await h.linkWallet(alice);
      const strategyId = (
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/strategies',
            headers: bearer(alice),
            payload: { content: content(ids) },
          })
        ).json() as StrategyDetail
      ).strategy.strategyId;
      const freeze = async (aeroBps: number) => {
        await h.app.inject({
          method: 'PUT',
          url: `/v1/me/strategies/${strategyId}/draft`,
          headers: bearer(alice),
          payload: { content: content(ids, aeroBps) },
        });
        const version = (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/strategies/${strategyId}/versions`,
            headers: bearer(alice),
            payload: {},
          })
        ).json() as StrategyVersion;
        return { version, base: `/v1/me/strategies/${strategyId}/versions/${version.versionId}` };
      };
      const prepare = async (base: string) => {
        const response = await h.app.inject({
          method: 'POST',
          url: `${base}/publication`,
          headers: bearer(alice),
          payload: { walletId: wallet.walletId },
        });
        expect(response.statusCode, response.body).toBe(201);
        return response.json() as Publication;
      };
      const submit = async (publication: Publication) =>
        h.app.inject({
          method: 'POST',
          url: `/v1/me/publications/${publication.publicationId}/submit`,
          headers: bearer(alice),
          payload: { signedTransaction: sign(publication, wallet.signer) },
        });
      const read = async (publication: Publication) =>
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/publications/${publication.publicationId}`,
            headers: bearer(alice),
          })
        ).json() as Publication;

      // Accepted by the node but never landed: pending until the blockhash expires, then expired.
      const dropped = await freeze(6000);
      const p1 = await prepare(dropped.base);
      h.ledger.dropNext = true;
      expect((await submit(p1)).json()).toMatchObject({ state: 'submitted' });
      expect((await read(p1)).state).toBe('submitted');
      h.ledger.advance(BLOCKHASH_VALIDITY + 1);
      const expired = await read(p1);
      expect(expired).toMatchObject({ state: 'expired', failure: { code: 'blockhash_expired' } });
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: dropped.base, headers: bearer(alice) })
          ).json() as StrategyVersion
        ).publication,
      ).toBe('expired');
      // The owner prepares again; the old one cannot be resubmitted.
      expect((await submit(p1)).statusCode).toBe(400);
      const p1b = await prepare(dropped.base);
      expect(p1b.publicationId).not.toBe(p1.publicationId);
      expect((await submit(p1b)).json()).toMatchObject({ state: 'submitted' });
      h.ledger.finalize();
      expect((await read(p1b)).state).toBe('registered');

      // Landed with an error: failed, with the program's own code.
      const failing = await freeze(5500);
      const p2 = await prepare(failing.base);
      h.ledger.landNextWithError = registryErrorCode('WeightTotal');
      expect((await submit(p2)).json()).toMatchObject({ state: 'submitted' });
      h.ledger.finalize();
      expect(await read(p2)).toMatchObject({
        state: 'failed',
        failure: { code: 'program_error', programErrorCode: 6008, programError: 'WeightTotal' },
      });

      // Rejected in preflight because the record already exists on chain: failed without a landed transaction.
      const taken = await freeze(5000);
      const p3 = await prepare(taken.base);
      const squatter = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
      h.ledger.fund(squatter.publicKey, 1_000_000_000n);
      const args = registrationArgs({
        manifestHash: taken.version.manifestHash,
        contentDigest: taken.version.contentDigest,
        legs: taken.version.legs.map((leg) => ({
          mint: leg.admission.mint,
          tokenProgram: leg.admission.tokenProgram as 'spl-token' | 'token-2022',
          weightBps: leg.weightBps,
        })),
        cashWeightBps: taken.version.cashWeightBps,
        relation: 'none',
      });
      const message = compileLegacyMessage({
        feePayer: squatter.publicKey,
        instructions: [
          registerVersionInstruction({
            programId: PROGRAM_ID,
            publisher: squatter.publicKey,
            args,
          }),
        ],
        recentBlockhash: h.ledger.latestBlockhash().blockhash,
      });
      h.ledger.send(bytesToBase64(signTransaction(unsignedTransaction(message), squatter).bytes));
      const rejected = await submit(p3);
      expect(rejected.statusCode, rejected.body).toBe(200);
      expect(rejected.json()).toMatchObject({
        state: 'failed',
        failure: { code: 'program_error', programErrorCode: 0 },
      });
      // The squatter's record is indexed as a record, but it is not this version's registration.
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: taken.base, headers: bearer(alice) })
          ).json() as StrategyVersion
        ).publication,
      ).toBe('failed');
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/strategies/${strategyId}/versions/${taken.version.versionId}`,
          })
        ).statusCode,
      ).toBe(404);

      // Expired before signing: the submit is refused and the state says why.
      const late = await freeze(4500);
      const p4 = await prepare(late.base);
      h.ledger.advance(BLOCKHASH_VALIDITY + 1);
      const tooLate = await submit(p4);
      expect(tooLate.statusCode).toBe(409);
      expect(tooLate.json().error.code).toBe('PUBLICATION_EXPIRED');
      expect((await read(p4)).state).toBe('expired');

      // Outage after submission: unknown, never failed or registered, until the node answers again.
      const dark = await freeze(4000);
      const p5 = await prepare(dark.base);
      expect((await submit(p5)).json()).toMatchObject({ state: 'submitted' });
      h.ledger.outage = true;
      expect(await read(p5)).toMatchObject({ state: 'unknown' });
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: dark.base, headers: bearer(alice) })
          ).json() as StrategyVersion
        ).publication,
      ).toBe('unknown');
      h.ledger.outage = false;
      h.ledger.finalize();
      expect((await read(p5)).state).toBe('registered');

      // A node that declines to serve leaves the prepared transaction valid; the owner submits again.
      const declined = await freeze(3500);
      const p6 = await prepare(declined.base);
      h.ledger.outage = true;
      const refused = await submit(p6);
      expect(refused.statusCode, refused.body).toBe(503);
      expect(refused.json().error.code).toBe('PROVIDER_UNAVAILABLE');
      h.ledger.outage = false;
      expect((await read(p6)).state).toBe('awaiting_signature');
      // A response lost in transit after the node took the transaction is unknown, then resolves.
      h.ledger.loseNextResponse = true;
      const lost = await submit(p6);
      expect(lost.statusCode, lost.body).toBe(200);
      expect(lost.json()).toMatchObject({ state: 'unknown' });
      expect((await read(p6)).state).toBe('submitted');
      h.ledger.finalize();
      expect((await read(p6)).state).toBe('registered');
    });
  });

  it('keeps publication disabled without a configured program and says so', async () => {
    await withHarness({ programId: null }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const wallet = await h.linkWallet(alice);
      const status = await h.app.inject({ method: 'GET', url: '/v1/registry' });
      expect(status.json()).toMatchObject({ publicationEnabled: false, programId: null });
      expect((status.json() as { disabledReason: string }).disabledReason).toContain(
        'REGISTRY_PROGRAM_ID',
      );
      const strategyId = (
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/strategies',
            headers: bearer(alice),
            payload: { content: content(ids) },
          })
        ).json() as StrategyDetail
      ).strategy.strategyId;
      const v1 = (
        await h.app.inject({
          method: 'POST',
          url: `/v1/me/strategies/${strategyId}/versions`,
          headers: bearer(alice),
          payload: {},
        })
      ).json() as StrategyVersion;
      const prepared = await h.app.inject({
        method: 'POST',
        url: `/v1/me/strategies/${strategyId}/versions/${v1.versionId}/publication`,
        headers: bearer(alice),
        payload: { walletId: wallet.walletId },
      });
      expect(prepared.statusCode).toBe(503);
      expect(prepared.json().error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/strategies/${strategyId}/versions/${v1.versionId}`,
          })
        ).statusCode,
      ).toBe(503);
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: `/v1/me/strategies/${strategyId}/versions/${v1.versionId}`,
              headers: bearer(alice),
            })
          ).json() as StrategyVersion
        ).publication,
      ).toBe('unpublished');
    });
  });
});
