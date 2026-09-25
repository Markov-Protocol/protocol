import {
  createEd25519TestWallet,
  createIdentityVerifier,
  createTestIdentityIssuer,
  generateCredential,
} from '@markov/auth';
import { loadConfig, MAINNET_USDC_MINT } from '@markov/config';
import type { WalletFundingResponse } from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  runMigrations,
} from '@markov/db';
import { createSilentLogger } from '@markov/observability';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import {
  BASE_FEE_LAMPORTS_PER_SIGNATURE,
  buildApp,
  type CatalogService,
  createFundingService,
  createIdentityService,
  createProbes,
  type FollowService,
  type MarkovApi,
  type PolicyService,
  type RegistryService,
  type ResearchService,
  type StrategyService,
  tokenAccountAmount,
  type WatchlistService,
} from '../src/index.js';
import { GENESIS } from './support/fixture-rpc.js';
import { unavailable } from './support/unavailable.js';

const adminUrl = testDatabaseUrl();
const RENT_EXEMPT = 2_039_280;
const FIXTURE_MINT = '6Bm7T2pYmqDcx8pbY36oHXqPBwbibPydE9v1yLRHRr7m';

interface FundingFixture {
  lamports: number;
  stablecoinRaw: bigint;
  tokenAccounts: number;
  /** When set the RPC answers this JSON-RPC error for balance reads. */
  failWith?: { code: number; message: string };
}

function tokenAccount(amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(new Uint8Array(32).fill(7), 0);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1;
  return Buffer.from(data).toString('base64');
}

/** JSON-RPC stand-in that serves balances from a mutable table keyed by address. */
function fundingRpcFetch(table: Map<string, FundingFixture>): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const address = String(body.params[0]);
    const entry = table.get(address);
    if (
      entry?.failWith &&
      (body.method === 'getBalance' || body.method === 'getTokenAccountsByOwner')
    ) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: entry.failWith }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    let result: unknown;
    switch (body.method) {
      case 'getGenesisHash':
        result = GENESIS;
        break;
      case 'getHealth':
        result = 'ok';
        break;
      case 'getBalance':
        result = { context: { slot: 100 }, value: entry?.lamports ?? 0 };
        break;
      case 'getTokenAccountsByOwner': {
        const accounts = entry && entry.stablecoinRaw > 0n ? entry.tokenAccounts : 0;
        const each = entry && accounts > 0 ? entry.stablecoinRaw / BigInt(accounts) : 0n;
        result = {
          context: { slot: 101 },
          value: Array.from({ length: accounts }, (_, index) => ({
            pubkey: `Acct${index}`.padEnd(32, '1'),
            account: {
              data: [tokenAccount(each), 'base64'],
              executable: false,
              lamports: RENT_EXEMPT,
              owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            },
          })),
        };
        break;
      }
      case 'getMinimumBalanceForRentExemption':
        result = RENT_EXEMPT;
        break;
      default:
        result = null;
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const unavailableCatalog = new Proxy({} as CatalogService, {
  get: () => () => {
    throw new Error('catalog service is not part of this test');
  },
});
const unavailablePolicy = new Proxy({} as PolicyService, {
  get: () => () => {
    throw new Error('policy service is not part of this test');
  },
});
const unavailableResearch = new Proxy({} as ResearchService, {
  get: () => () => {
    throw new Error('research service is not part of this test');
  },
});
const unavailableWatchlists = new Proxy({} as WatchlistService, {
  get: () => () => {
    throw new Error('watchlist service is not part of this test');
  },
});
const unavailableStrategies = new Proxy({} as StrategyService, {
  get: () => () => {
    throw new Error('strategy service is not part of this test');
  },
});

interface Harness {
  app: MarkovApi;
  table: Map<string, FundingFixture>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** Links a fresh in-memory wallet to the session and returns its id and address. */
  linkWallet: (token: string) => Promise<{ walletId: string; address: string }>;
}

async function withHarness(
  env: Record<string, string>,
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(baseTestEnv({ DATABASE_URL: url, ...env }));
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 4,
      statementTimeoutMs: 10_000,
      applicationName: 'funding-test',
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'funding-test',
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
      const table = new Map<string, FundingFixture>();
      const funding = createFundingService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [
          new SolanaRpcClient({
            url: 'http://rpc.test',
            timeoutMs: 2000,
            maxResponseBytes: 1_000_000,
            fetchImpl: fundingRpcFetch(table),
          }),
        ],
        now: () => new Date('2026-09-24T12:00:00Z'),
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
        funding,
        research: unavailableResearch,
        watchlists: unavailableWatchlists,
        registry: unavailable<RegistryService>('registry'),
        follows: unavailable<FollowService>('follows'),
        strategies: unavailableStrategies,
        mintTestToken: (input) => issuer.mint({ subject: input.subject }),
      });
      await app.ready();
      const user = async (subject = 'did:test:alice') => {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/sessions',
          payload: { identityToken: await issuer.mint({ subject }) },
        });
        return response.json().sessionToken as string;
      };
      const agent = async (userId: string, scopes: string[]) => {
        const generated = generateCredential('agent', config.auth.credentialPepper);
        await createApiCredential(client.db, {
          userId,
          principalClass: 'agent',
          label: 'agent',
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return generated.token;
      };
      const linkWallet = async (token: string) => {
        const wallet = createEd25519TestWallet();
        const headers = { authorization: `Bearer ${token}` };
        const challenge = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets/challenges',
          headers,
          payload: { address: wallet.address },
        });
        expect(challenge.statusCode).toBe(201);
        const { challengeId, message } = challenge.json() as {
          challengeId: string;
          message: string;
        };
        const linked = await app.inject({
          method: 'POST',
          url: '/v1/me/wallets',
          headers,
          payload: { challengeId, address: wallet.address, signature: wallet.sign(message) },
        });
        expect(linked.statusCode).toBe(201);
        return { walletId: linked.json().walletId as string, address: wallet.address };
      };
      try {
        await fn({ app, table, user, agent, linkWallet });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('token account parsing', () => {
  it('reads the u64 amount at byte 64 and refuses short data', () => {
    const data = new Uint8Array(165);
    new DataView(data.buffer).setBigUint64(64, 123_456_789_012n, true);
    expect(tokenAccountAmount(data)).toBe(123_456_789_012n);
    expect(() => tokenAccountAmount(new Uint8Array(82))).toThrow(/165/);
  });
});

describe.skipIf(adminUrl === null)('funding API', () => {
  it('observes balances of the caller’s own verified wallet and explains the fee requirements', async () => {
    await withHarness(
      { FUNDING_STABLECOIN_MINT: FIXTURE_MINT },
      async ({ app, table, user, agent, linkWallet }) => {
        const alice = await user();
        const { walletId, address } = await linkWallet(alice);

        // Nothing observed yet: unfunded, and a first token account still has to be opened.
        const empty = await app.inject({
          method: 'GET',
          url: `/v1/me/wallets/${walletId}/funding`,
          headers: bearer(alice),
        });
        expect(empty.statusCode).toBe(200);
        const unfunded = empty.json() as WalletFundingResponse;
        expect(unfunded).toMatchObject({
          walletId,
          address,
          cluster: 'devnet',
          genesisHash: GENESIS,
          source: 'rpc',
          commitment: 'confirmed',
          sol: { lamports: '0', sufficientForFees: false },
          stablecoin: {
            symbol: 'USDC',
            mint: FIXTURE_MINT,
            decimals: 6,
            raw: '0',
            tokenAccounts: 0,
          },
          stablecoinUnavailableReason: null,
          readiness: 'unfunded',
        });
        expect(unfunded.requirements).toMatchObject({
          rentExemptTokenAccountLamports: String(RENT_EXEMPT),
          baseFeeLamportsPerSignature: BASE_FEE_LAMPORTS_PER_SIGNATURE.toString(),
          assumedSignatures: 2,
          requiredLamports: String(RENT_EXEMPT + 10_000),
        });
        expect(unfunded.requirements.explanation).toContain('open a USDC account');

        // Stablecoin across two token accounts but not enough SOL: needs_sol; the rent is no longer required.
        table.set(address, { lamports: 9_000, stablecoinRaw: 250_000_000n, tokenAccounts: 2 });
        const needsSol = (
          await app.inject({
            method: 'GET',
            url: `/v1/me/wallets/${walletId}/funding`,
            headers: bearer(alice),
          })
        ).json() as WalletFundingResponse;
        expect(needsSol).toMatchObject({
          readiness: 'needs_sol',
          sol: { lamports: '9000', sufficientForFees: false },
        });
        expect(needsSol.stablecoin).toMatchObject({ raw: '250000000', tokenAccounts: 2 });
        expect(needsSol.requirements.requiredLamports).toBe('10000');
        expect(needsSol.slot).toBe(101);

        table.set(address, { lamports: 10_000, stablecoinRaw: 250_000_000n, tokenAccounts: 2 });
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/me/wallets/${walletId}/funding`,
              headers: bearer(alice),
            })
          ).json().readiness,
        ).toBe('funded');
        table.set(address, { lamports: 5_000_000_000, stablecoinRaw: 0n, tokenAccounts: 0 });
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/me/wallets/${walletId}/funding`,
              headers: bearer(alice),
            })
          ).json().readiness,
        ).toBe('needs_stablecoin');

        // An unreadable endpoint is unknown, never zero.
        table.set(address, {
          lamports: 1,
          stablecoinRaw: 0n,
          tokenAccounts: 0,
          failWith: { code: -32005, message: 'node is behind' },
        });
        const down = await app.inject({
          method: 'GET',
          url: `/v1/me/wallets/${walletId}/funding`,
          headers: bearer(alice),
        });
        expect(down.statusCode).toBe(503);
        expect(down.json().error.code).toBe('PROVIDER_UNAVAILABLE');

        // Owner scoping: another person and an unknown id answer 404; agents read only with portfolio:read.
        const bob = await user('did:test:bob');
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/me/wallets/${walletId}/funding`,
              headers: bearer(bob),
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/v1/me/wallets/00000000-0000-4000-8000-000000000000/funding',
              headers: bearer(alice),
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await app.inject({ method: 'GET', url: `/v1/me/wallets/${walletId}/funding` }))
            .statusCode,
        ).toBe(401);
        const me = (
          await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
        ).json() as { user: { id: string } };
        table.set(address, { lamports: 10_000, stablecoinRaw: 1n, tokenAccounts: 1 });
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/me/wallets/${walletId}/funding`,
              headers: bearer(await agent(me.user.id, ['portfolio:read'])),
            })
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/v1/me/wallets/${walletId}/funding`,
              headers: bearer(await agent(me.user.id, ['research:read'])),
            })
          ).statusCode,
        ).toBe(403);
      },
    );
  });

  it('reports SOL only when the cluster has no configured stablecoin mint', async () => {
    await withHarness({}, async ({ app, table, user, linkWallet }) => {
      const alice = await user();
      const { walletId, address } = await linkWallet(alice);
      table.set(address, { lamports: 3_000_000, stablecoinRaw: 0n, tokenAccounts: 0 });
      const response = (
        await app.inject({
          method: 'GET',
          url: `/v1/me/wallets/${walletId}/funding`,
          headers: bearer(alice),
        })
      ).json() as WalletFundingResponse;
      expect(response.stablecoin).toBeNull();
      expect(response.stablecoinUnavailableReason).toContain('devnet');
      expect(response.readiness).toBe('needs_stablecoin');
      expect(MAINNET_USDC_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });
  });
});
