import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import type { ReceiptSigner } from '@markov/accounting';
import { type CompanionModelAdapter, createFixtureCompanionAdapter } from '@markov/agent-tools';
import { createIdentityVerifier, createTestIdentityIssuer, generateCredential } from '@markov/auth';
import { loadConfig, type MarkovConfig } from '@markov/config';
import {
  encodeBase58,
  type Publication,
  type StrategyDetail,
  type StrategyDraftContent,
  type StrategyVersion,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  type Database,
  runMigrations,
  seedCapabilityReadiness,
} from '@markov/db';
import { createPrestocksFixtureSource } from '@markov/issuer-prestocks';
import { createXstocksFixtureSource } from '@markov/issuer-xstocks';
import { createFixtureEmailAdapter, type FixtureEmailAdapter } from '@markov/notifications';
import { createLogger, createSilentLogger } from '@markov/observability';
import type { VenueAdapter } from '@markov/planning';
import { FIXTURE_JURISDICTION_RULE_SET, FIXTURE_TERMS_DOCUMENT } from '@markov/policy';
import {
  base64ToBytes,
  bytesToBase64,
  type Ed25519Signer,
  type FixtureLedger,
  signerFromPrivateKey,
  signTransaction,
} from '@markov/registry';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { createFixtureVenue } from '@markov/venue-jupiter';
import { expect } from 'vitest';
import {
  buildApp,
  createAccountingService,
  createAgentService,
  createAnalyticsService,
  createCatalogService,
  createDiscoveryService,
  createExecutionService,
  createFollowService,
  createFundingService,
  createIdentityService,
  createMaintenanceService,
  createNotificationService,
  createPlanningService,
  createPolicyService,
  createProbes,
  createRegistryService,
  createResearchService,
  createRetriever,
  createStrategyService,
  type FollowService,
  type MarkovApi,
  type RegistryService,
  type WatchlistService,
} from '../../src/index.js';
import {
  createFixtureChain,
  FIXTURE_REGISTRY_PROGRAM_ID,
  FIXTURE_STABLECOIN_MINT,
  GENESIS,
  prestocksFixtureRpcFetch,
} from './fixture-rpc.js';
import { unavailable } from './unavailable.js';

export const adminUrl = testDatabaseUrl();
/** Synthetic stablecoin mint of the fixtures; not a real token. */
export const STABLECOIN = FIXTURE_STABLECOIN_MINT;
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export interface Balance {
  lamports: number;
  stablecoinRaw: bigint;
}

/** A clock the services read; tests move it to expire quotes and plans without waiting. */
export interface TestClock {
  current: Date;
  advance(ms: number): void;
}

export interface Harness {
  app: MarkovApi;
  config: MarkovConfig;
  /** The harness database, for store-level checks the API does not expose (B16 restart recovery). */
  db: Database;
  /** Every email the fixture adapter accepted or refused (B16). */
  email: FixtureEmailAdapter;
  /** The fixture chain every RPC read and write goes to: balances, mints, the fixture route program. */
  chain: FixtureLedger;
  clock: TestClock;
  /** Sets the wallet's lamports and stablecoin balance on the chain exactly. */
  fund(address: string, balance: Balance): void;
  /** Kept for the planning tests' shape: `set` funds the address on the chain. */
  balances: { set(address: string, balance: Balance): void };
  operator: (scopes: string[]) => Promise<string>;
  user: (subject?: string) => Promise<string>;
  agent: (userId: string, scopes: string[]) => Promise<string>;
  /** FXAERO, FXBIO (PreStocks) and XSFXA (xStocks) admitted; FXBIO's fixture mark is stale by design. */
  seed: (operatorToken: string) => Promise<Record<'aero' | 'bio' | 'xsa', string>>;
  linkWallet: (sessionToken: string) => Promise<{ walletId: string; signer: Ed25519Signer }>;
  /** Fixture rules and terms published, jurisdiction declared and terms acknowledged for the session. */
  makeEligible: (sessionToken: string) => Promise<void>;
  freezeVersion: (sessionToken: string, content: StrategyDraftContent) => Promise<StrategyVersion>;
  /**
   * Registers a frozen version on the fixture ledger through the public
   * flow (prepare, sign with the publisher wallet, submit, finality) and
   * answers the registered publication. Requires `registry: true`.
   */
  register: (
    sessionToken: string,
    version: StrategyVersion,
    wallet: { walletId: string; signer: Ed25519Signer },
  ) => Promise<Publication>;
}

export interface HarnessOptions {
  readonly venue: 'fixture' | 'disabled';
  /** Wraps the fixture venue (tests of malicious venue output). */
  readonly wrapVenue?: (venue: VenueAdapter) => VenueAdapter;
  /** EXECUTION_WRITES_ENABLED; submissions are policy-denied without it. */
  readonly writes?: boolean;
  /** REGISTRY_PROGRAM_ID set to the fixture program: versions can be registered and followed (B08, B14). */
  readonly registry?: boolean;
  /** Test control read by the fixture route program on every execution. */
  readonly fillShiftBps?: () => number;
  /** Test control: the most legs the fixture venue composes into one transaction (null: no limit). */
  readonly composeMaxLegs?: () => number | null;
  /** Test control: shifts every fixture quote's output by this many basis points (negative: worse). */
  readonly quoteShiftBps?: () => number;
  /** Research service with the in-memory fixture retriever (theses, sources; no model unless `researchModel`). */
  readonly research?: boolean;
  /**
   * Agent tools and companion runs (B15): the fixture companion adapter, or a test adapter, with
   * an optional daily cost cap (COMPANION_DAILY_COST_LIMIT_MICROS).
   */
  readonly companion?: {
    readonly adapter?: CompanionModelAdapter;
    readonly dailyCostLimitMicros?: number;
  };
  /** A fixture email adapter with test controls (B16); a plain recording fixture by default. */
  readonly email?: FixtureEmailAdapter;
}

export async function withHarness(
  options: HarnessOptions,
  fn: (h: Harness) => Promise<void>,
): Promise<void> {
  if (adminUrl === null) {
    throw new Error('requires MARKOV_TEST_DATABASE_URL');
  }
  await withTemporaryDatabase(adminUrl, async (url) => {
    const config = loadConfig(
      baseTestEnv({
        DATABASE_URL: url,
        FUNDING_STABLECOIN_MINT: STABLECOIN,
        ...(options.venue === 'fixture' ? { EXECUTION_VENUE_PROVIDER: 'fixture' } : {}),
        ...(options.writes ? { EXECUTION_WRITES_ENABLED: 'true' } : {}),
        ...(options.registry ? { REGISTRY_PROGRAM_ID: FIXTURE_REGISTRY_PROGRAM_ID } : {}),
        NOTIFICATIONS_EMAIL_PROVIDER: 'fixture',
        ...(options.companion
          ? {
              COMPANION_MODEL_PROVIDER: 'fixture',
              ...(options.companion.dailyCostLimitMicros !== undefined
                ? {
                    COMPANION_DAILY_COST_LIMIT_MICROS: String(
                      options.companion.dailyCostLimitMicros,
                    ),
                  }
                : {}),
            }
          : {}),
        // Receipts (B12): a throwaway Ed25519 key per harness run; never a real key.
        RECEIPT_SIGNING_PROVIDER: 'local_key',
        RECEIPT_SIGNING_KEY: generateKeyPairSync('ed25519')
          .privateKey.export({ format: 'der', type: 'pkcs8' })
          .toString('base64'),
        RECEIPT_SIGNING_KEY_ID: 'api-test-key-1',
      }),
    );
    const client = createDbClient({
      url,
      ssl: 'disable',
      poolMax: 12,
      statementTimeoutMs: 10_000,
      applicationName: 'api-test',
    });
    const clock: TestClock = {
      current: new Date(),
      advance(ms) {
        this.current = new Date(this.current.getTime() + ms);
      },
    };
    const chain = createFixtureChain({
      now: () => Math.floor(clock.current.getTime() / 1000),
      ...(options.fillShiftBps ? { fillShiftBps: options.fillShiftBps } : {}),
    });
    try {
      await runMigrations(client.db);
      await bindPlatformIdentity(
        client.db,
        { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
        'api-test',
      );
      // The baseline readiness rows `markov db migrate` writes: policy reads the venue's row at submission.
      await seedCapabilityReadiness(client.db, 'api-test');
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
        fetchImpl: prestocksFixtureRpcFetch(chain),
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
        sourceFor: (issuer, kind) =>
          issuer === 'xstocks'
            ? createXstocksFixtureSource(kind === 'products' ? 'products' : 'events')
            : createPrestocksFixtureSource('default'),
      });
      const now = () => clock.current;
      const policy = createPolicyService({ config, db: client.db, catalog, now });
      const funding = createFundingService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpcClients: [rpc],
        now,
      });
      const stablecoin = config.funding.stablecoin;
      if (stablecoin === null) {
        throw new Error('the harness configures a stablecoin');
      }
      const baseVenue =
        options.venue === 'fixture'
          ? createFixtureVenue({
              stablecoin,
              now,
              ...(options.composeMaxLegs ? { composeMaxLegs: options.composeMaxLegs } : {}),
              ...(options.quoteShiftBps ? { quoteShiftBps: options.quoteShiftBps } : {}),
            })
          : null;
      const venue =
        baseVenue !== null && options.wrapVenue ? options.wrapVenue(baseVenue) : baseVenue;
      const accounting = createAccountingService({
        config,
        db: client.db,
        policy,
        rpcClients: [rpc],
        genesisHash: GENESIS,
        signer: receiptSignerOf(config),
        now,
      });
      const analytics = createAnalyticsService({ config, db: client.db, now });
      // Research (fixture retriever, no model) and the agent service are part of every harness app:
      // the event log every journey records is served by the agent service. The companion model
      // adapter exists only when a test asks for one.
      const research = createResearchService({
        config,
        db: client.db,
        retriever: createRetriever({ fixtures: true }),
        model: null,
        now,
      });
      const strategies = createStrategyService({
        config,
        db: client.db,
        genesisHash: GENESIS,
        now,
      });
      const planning = createPlanningService({
        config,
        db: client.db,
        catalog,
        policy,
        funding,
        venue,
        rpcClients: [rpc],
        genesisHash: GENESIS,
        now,
      });
      const agents = createAgentService({
        config,
        db: client.db,
        catalog,
        research,
        strategies,
        planning,
        policy,
        funding,
        accounting,
        analytics,
        model: options.companion
          ? (options.companion.adapter ?? createFixtureCompanionAdapter())
          : null,
        now,
      });
      const email = options.email ?? createFixtureEmailAdapter();
      const notifications = createNotificationService({ config, db: client.db, email, now });
      const app = await buildApp({
        config,
        // Silent by default; MARKOV_TEST_LOG_ERRORS=1 prints unhandled errors while debugging a 500.
        logger:
          process.env['MARKOV_TEST_LOG_ERRORS'] === '1'
            ? createLogger({
                level: 'error',
                format: 'json',
                service: 'markov-api',
                version: 'test',
                markovEnv: 'test',
              })
            : createSilentLogger(),
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
        policy,
        funding,
        research,
        watchlists: unavailable<WatchlistService>('watchlist'),
        strategies,
        registry: options.registry
          ? createRegistryService({
              config,
              db: client.db,
              genesisHash: GENESIS,
              rpcClients: [rpc],
            })
          : unavailable<RegistryService>('registry'),
        follows: options.registry
          ? createFollowService({ db: client.db, now })
          : unavailable<FollowService>('follows'),
        planning,
        execution: createExecutionService({
          config,
          db: client.db,
          policy,
          venue,
          rpcClients: [rpc],
          genesisHash: GENESIS,
          now,
        }),
        accounting,
        analytics,
        discovery: createDiscoveryService({ db: client.db, analytics, now }),
        agents,
        maintenance: createMaintenanceService({
          config,
          db: client.db,
          agents,
          analytics,
          catalog,
          strategies,
          notifications,
          now,
        }),
        notifications,
        mintTestToken: (input) => issuer.mint({ subject: input.subject }),
      });
      await accounting.registerSigningKey();
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
        for (const issuer of ['prestocks', 'xstocks']) {
          const ingested = await app.inject({
            method: 'POST',
            url: '/v1/ops/catalog/ingestions',
            headers,
            payload: { issuer, source: 'fixture' },
          });
          expect(ingested.statusCode, ingested.body).toBe(201);
        }
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
        const ids = {
          aero: await idOf('FXAERO'),
          bio: await idOf('FXBIO'),
          xsa: await idOf('XSFXA'),
        };
        for (const id of [ids.aero, ids.bio, ids.xsa]) {
          await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/mint-verifications`,
            headers,
          });
          const admitted = await app.inject({
            method: 'POST',
            url: `/v1/ops/catalog/instruments/${id}/decisions`,
            headers,
            payload: { decision: 'admit', reason: 'api test', evidence: { review: 'test' } },
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
        return { walletId: (linked.json() as { walletId: string }).walletId, signer };
      };
      const makeEligible = async (sessionToken: string) => {
        const ops = await credential('operator', null, ['ops:policy:read', 'ops:policy:write']);
        for (const [url, payload] of [
          ['/v1/ops/policy/jurisdiction-rules', FIXTURE_JURISDICTION_RULE_SET],
          ['/v1/ops/policy/terms', FIXTURE_TERMS_DOCUMENT],
        ] as const) {
          const published = await app.inject({
            method: 'POST',
            url,
            headers: bearer(ops),
            payload,
          });
          expect([201, 409]).toContain(published.statusCode);
        }
        const declared = await app.inject({
          method: 'POST',
          url: '/v1/me/eligibility/declarations',
          headers: bearer(sessionToken),
          payload: { jurisdiction: 'ZZ', attestation: true },
        });
        expect(declared.statusCode, declared.body).toBe(201);
        const acknowledged = await app.inject({
          method: 'POST',
          url: '/v1/me/terms/acknowledgements',
          headers: bearer(sessionToken),
          payload: {
            termsVersion: FIXTURE_TERMS_DOCUMENT.termsVersion,
            contentHash: FIXTURE_TERMS_DOCUMENT.contentHash,
          },
        });
        expect(acknowledged.statusCode, acknowledged.body).toBe(201);
      };
      const freezeVersion = async (sessionToken: string, content: StrategyDraftContent) => {
        const created = await app.inject({
          method: 'POST',
          url: '/v1/me/strategies',
          headers: bearer(sessionToken),
          payload: { content },
        });
        expect(created.statusCode, created.body).toBe(201);
        const strategyId = (created.json() as StrategyDetail).strategy.strategyId;
        const frozen = await app.inject({
          method: 'POST',
          url: `/v1/me/strategies/${strategyId}/versions`,
          headers: bearer(sessionToken),
          payload: {},
        });
        expect(frozen.statusCode, frozen.body).toBe(201);
        return frozen.json() as StrategyVersion;
      };
      const register = async (
        sessionToken: string,
        version: StrategyVersion,
        wallet: { walletId: string; signer: Ed25519Signer },
      ): Promise<Publication> => {
        const base = `/v1/me/strategies/${version.strategyId}/versions/${version.versionId}/publication`;
        const prepared = await app.inject({
          method: 'POST',
          url: base,
          headers: bearer(sessionToken),
          payload: { walletId: wallet.walletId },
        });
        expect(prepared.statusCode, prepared.body).toBe(201);
        const publication = prepared.json() as Publication;
        const unsigned = base64ToBytes(publication.transaction?.unsignedTransaction ?? '');
        const submitted = await app.inject({
          method: 'POST',
          url: `/v1/me/publications/${publication.publicationId}/submit`,
          headers: bearer(sessionToken),
          payload: {
            signedTransaction: bytesToBase64(signTransaction(unsigned, wallet.signer).bytes),
          },
        });
        expect(submitted.statusCode, submitted.body).toBe(200);
        chain.advance(1);
        chain.finalize();
        const registered = await app.inject({
          method: 'GET',
          url: base,
          headers: bearer(sessionToken),
        });
        expect(registered.statusCode, registered.body).toBe(200);
        const result = registered.json() as Publication;
        expect(result.state, registered.body).toBe('registered');
        return result;
      };
      const fund = (address: string, balance: Balance) => {
        chain.setLamports(address, BigInt(balance.lamports));
        if (balance.stablecoinRaw > 0n) {
          chain.setTokenBalance(address, STABLECOIN, balance.stablecoinRaw);
        }
      };
      try {
        await fn({
          app,
          db: client.db,
          email,
          config,
          chain,
          clock,
          fund,
          balances: { set: fund },
          operator: (scopes) => credential('operator', null, scopes),
          user,
          agent: (userId, scopes) => credential('agent', userId, scopes),
          seed,
          linkWallet,
          makeEligible,
          freezeVersion,
          register,
        });
      } finally {
        await app.close();
      }
    } finally {
      await client.close();
    }
  });
}

/** The test receipt signer from the harness environment (an Ed25519 PKCS#8 key generated per run). */
function receiptSignerOf(config: MarkovConfig): ReceiptSigner | null {
  if (config.receipts.provider !== 'local_key' || config.receipts.signingKey === null) {
    return null;
  }
  const signer = signerFromPrivateKey(
    createPrivateKey({
      key: Buffer.from(config.receipts.signingKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    }),
  );
  return { keyId: config.receipts.keyId ?? 'test', publicKey: signer.publicKey, sign: signer.sign };
}
