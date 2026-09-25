import {
  createIdentityVerifier,
  createTestIdentityIssuer,
  type IdentityVerifier,
} from '@markov/auth';
import { describeConfig, type EnvSource, type MarkovConfig, tryLoadConfig } from '@markov/config';
import type { BoundPlatformIdentity } from '@markov/contracts';
import {
  createDbClient,
  type DbClient,
  getMigrationState,
  listCapabilityReadiness,
  readPlatformIdentity,
} from '@markov/db';
import { createLogger, type Logger } from '@markov/observability';
import { createFixtureModelAdapter } from '@markov/research';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { createConfiguredUrlVenue, createFixtureVenue } from '@markov/venue-jupiter';
import { type ApiProbes, buildApp, type MarkovApi } from './app.js';
import { createIdentityService } from './auth/service.js';
import { createCatalogService } from './catalog/service.js';
import { createExecutionService } from './execution/service.js';
import { createFollowService } from './follows/service.js';
import { createFundingService } from './funding/service.js';
import { createNetworkIdentityMonitor } from './network-monitor.js';
import { createPlanningService } from './planning/service.js';
import { createPolicyService } from './policy/service.js';
import { createRegistryService } from './registry/service.js';
import { createRetriever } from './research/retrieval.js';
import { createResearchService } from './research/service.js';
import { createStrategyService } from './strategies/service.js';
import { createWatchlistService } from './watchlists/service.js';

/** sysexits(3) codes so orchestrators can distinguish configuration from availability failures. */
export const EXIT_CONFIG = 78;
export const EXIT_UNAVAILABLE = 69;
export const EXIT_SOFTWARE = 70;

export class BootError extends Error {
  override readonly name = 'BootError';
  readonly exitCode: number;

  constructor(message: string, exitCode: number, options?: { cause?: unknown }) {
    super(message, options);
    this.exitCode = exitCode;
  }
}

export interface BootOptions {
  readonly env?: EnvSource;
  /** Test hook: use this logger instead of building one from configuration. */
  readonly logger?: Logger;
  /** Test hook: override the listening host/port (port 0 picks a free port). */
  readonly listen?: { readonly host?: string; readonly port?: number };
  /** Interval between background network identity checks. */
  readonly networkCheckIntervalMs?: number;
}

export interface BootedApi {
  readonly app: MarkovApi;
  readonly config: MarkovConfig;
  readonly address: string;
  readonly expectedGenesisHash: string;
  shutdown(): Promise<void>;
}

export interface IdentityCheck {
  readonly ok: boolean;
  readonly detail: string;
  readonly expectedGenesisHash: string | null;
}

/**
 * Compare configuration with the identity stored in the database. The
 * database is authoritative for a localnet genesis hash the configuration
 * does not pin; for every public cluster both must agree exactly.
 */
export function compareIdentity(
  config: MarkovConfig,
  stored: BoundPlatformIdentity | null,
): IdentityCheck {
  if (stored === null) {
    return {
      ok: false,
      detail: 'database has no platform identity; run `markov db migrate` for this environment',
      expectedGenesisHash: config.solana.expectedGenesisHash,
    };
  }
  const problems: string[] = [];
  if (stored.markovEnv !== config.markovEnv) {
    problems.push(
      `MARKOV_ENV=${config.markovEnv} but the database is bound to ${stored.markovEnv}`,
    );
  }
  if (stored.solanaCluster !== config.solana.cluster) {
    problems.push(
      `SOLANA_CLUSTER=${config.solana.cluster} but the database is bound to ${stored.solanaCluster}`,
    );
  }
  if (
    config.solana.expectedGenesisHash !== null &&
    stored.genesisHash !== config.solana.expectedGenesisHash
  ) {
    problems.push(
      `expected genesis ${config.solana.expectedGenesisHash} but the database is bound to ${stored.genesisHash}`,
    );
  }
  if (problems.length > 0) {
    return {
      ok: false,
      detail: problems.join('; '),
      expectedGenesisHash: config.solana.expectedGenesisHash,
    };
  }
  return {
    ok: true,
    detail: `bound to ${stored.markovEnv}/${stored.solanaCluster} (${stored.genesisHash}) by ${stored.boundBy} at ${stored.boundAt}`,
    expectedGenesisHash: config.solana.expectedGenesisHash ?? stored.genesisHash,
  };
}

export function createProbes(config: MarkovConfig, dbClient: DbClient): ApiProbes {
  return {
    database: () => dbClient.ping(),
    async schema() {
      const started = Date.now();
      const state = await getMigrationState(dbClient.db);
      return {
        ok: state.status === 'current',
        detail:
          state.status === 'current'
            ? `schema current at ${state.latestTag ?? 'none'}`
            : `schema ${state.status}: applied ${state.applied} of ${state.expected} migrations`,
        durationMs: Date.now() - started,
        latestTag: state.latestTag,
      };
    },
    async platformIdentity() {
      const started = Date.now();
      const stored = await readPlatformIdentity(dbClient.db);
      const comparison = compareIdentity(config, stored);
      return {
        ok: comparison.ok,
        detail: comparison.detail,
        durationMs: Date.now() - started,
        identity: stored,
      };
    },
    capabilities: () => listCapabilityReadiness(dbClient.db),
  };
}

export async function bootApi(options: BootOptions = {}): Promise<BootedApi> {
  const loaded = tryLoadConfig(options.env ?? process.env);
  if (!loaded.ok) {
    throw new BootError(
      `invalid configuration:\n${loaded.issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')}`,
      EXIT_CONFIG,
    );
  }
  const config = loaded.config;
  const logger =
    options.logger ??
    createLogger({
      service: 'markov-api',
      version: config.serviceVersion,
      markovEnv: config.markovEnv,
      level: config.log.level,
      format: config.log.format,
    });
  logger.info({ config: describeConfig(config) }, 'configuration loaded');

  const dbClient = createDbClient({
    url: config.database.url,
    ssl: config.database.ssl,
    poolMax: config.database.poolMax,
    statementTimeoutMs: config.database.statementTimeoutMs,
    applicationName: 'markov-api',
  });

  const fail = async (error: BootError): Promise<never> => {
    await dbClient.close().catch(() => undefined);
    throw error;
  };

  const ping = await dbClient.ping(5_000);
  if (!ping.ok) {
    return fail(new BootError(`database unreachable: ${ping.detail}`, EXIT_UNAVAILABLE));
  }

  const migrationState = await getMigrationState(dbClient.db);
  if (migrationState.status !== 'current') {
    return fail(
      new BootError(
        `database schema is ${migrationState.status} (applied ${migrationState.applied} of ${migrationState.expected}); run \`markov db migrate\``,
        EXIT_CONFIG,
      ),
    );
  }

  const identity = compareIdentity(config, await readPlatformIdentity(dbClient.db));
  if (!identity.ok || identity.expectedGenesisHash === null) {
    return fail(new BootError(`platform identity check failed: ${identity.detail}`, EXIT_CONFIG));
  }
  const expectedGenesisHash = identity.expectedGenesisHash;
  logger.info({ identity: identity.detail }, 'platform identity verified');

  const rpcUrls = [
    config.solana.rpc.primaryUrl,
    ...(config.solana.rpc.secondaryUrl ? [config.solana.rpc.secondaryUrl] : []),
  ];
  const clients = rpcUrls.map(
    (url) =>
      new SolanaRpcClient({
        url,
        timeoutMs: config.solana.rpc.timeoutMs,
        maxResponseBytes: config.solana.rpc.maxResponseBytes,
      }),
  );
  const monitor = createNetworkIdentityMonitor({
    clients,
    expectedGenesisHash,
    intervalMs: options.networkCheckIntervalMs ?? 15_000,
    logger,
  });
  const initial = await monitor.verifyNow();
  if (initial.status === 'mismatch') {
    return fail(
      new BootError(
        `solana network identity mismatch: ${initial.endpoints.map((endpoint) => `${endpoint.host}: ${endpoint.detail}`).join('; ')}`,
        EXIT_CONFIG,
      ),
    );
  }
  if (initial.status === 'unavailable') {
    logger.warn(
      { endpoints: initial.endpoints },
      'solana rpc did not answer at boot; serving as not ready until the network identity is verified',
    );
  }
  monitor.start();

  let verifier: IdentityVerifier;
  let mintTestToken: ((input: { subject: string; authTime?: string }) => Promise<string>) | null =
    null;
  if (config.identity.provider === 'test') {
    const issuer = await createTestIdentityIssuer({
      issuer: config.identity.issuer,
      audience: config.identity.audience,
    });
    verifier = createIdentityVerifier({
      issuer: issuer.issuer,
      audience: issuer.audience,
      algorithms: ['ES256'],
      keys: { jwks: issuer.jwks() },
    });
    mintTestToken = (input) =>
      issuer.mint(
        input.authTime
          ? { subject: input.subject, authTime: new Date(input.authTime) }
          : { subject: input.subject },
      );
    logger.warn(
      'identity provider is the in-process test issuer; never use this outside local or test',
    );
  } else {
    verifier = createIdentityVerifier({
      issuer: config.identity.issuer,
      audience: config.identity.audience,
      algorithms: config.identity.algorithms,
      keys: { jwksUrl: config.identity.jwksUrl ?? '' },
    });
  }
  const identityService = createIdentityService({
    config,
    db: dbClient.db,
    verifier,
    genesisHash: expectedGenesisHash,
  });

  const catalogService = createCatalogService({
    config,

    db: dbClient.db,

    genesisHash: expectedGenesisHash,

    rpcClients: clients,
  });
  const policyService = createPolicyService({ config, db: dbClient.db, catalog: catalogService });
  const fundingService = createFundingService({
    config,
    db: dbClient.db,
    genesisHash: expectedGenesisHash,
    rpcClients: clients,
  });

  const nonproduction = config.markovEnv === 'local' || config.markovEnv === 'test';
  // Execution venue (B09): fixture quotes in local/test, or an operator-configured gateway; else no plans.
  const venueConfig = config.execution.venue;
  const venue =
    venueConfig.provider === null || config.funding.stablecoin === null
      ? null
      : venueConfig.provider === 'fixture'
        ? createFixtureVenue({
            stablecoin: config.funding.stablecoin,
            composeMaxLegs: () => venueConfig.fixtureComposeMaxLegs,
          })
        : createConfiguredUrlVenue({
            url: venueConfig.quoteUrl as string,
            apiKey: venueConfig.apiKey,
            allowInsecure: nonproduction,
            buildUrl: venueConfig.buildUrl,
          });
  if (venue === null) {
    logger.warn(
      'no execution venue is configured; plans cannot be built (EXECUTION_VENUE_PROVIDER)',
    );
  } else {
    logger.info(
      {
        venue: venue.venue,
        mode: venue.mode,
        sourceRef: venue.sourceRef,
        builds: venue.build !== null,
      },
      venue.build === null
        ? 'execution venue configured for quotes only; transactions cannot be built (EXECUTION_VENUE_BUILD_URL)'
        : 'execution venue configured',
    );
  }
  const researchService = createResearchService({
    config,
    db: dbClient.db,
    retriever: createRetriever({ fixtures: nonproduction }),
    model: config.research.modelProvider === 'fixture' ? createFixtureModelAdapter() : null,
  });
  if (config.research.modelProvider === null) {
    logger.info('no research model provider is configured; research runs answer 503');
  }

  const app = await buildApp({
    config,
    logger,
    service: { name: 'markov-api', version: config.serviceVersion, startedAt: Date.now() },
    probes: createProbes(config, dbClient),
    network: monitor,
    expectedGenesisHash,
    identity: identityService,
    catalog: catalogService,
    policy: policyService,
    funding: fundingService,
    research: researchService,
    watchlists: createWatchlistService({ db: dbClient.db, catalog: catalogService }),
    strategies: createStrategyService({
      config,
      db: dbClient.db,
      genesisHash: expectedGenesisHash,
    }),
    registry: createRegistryService({
      config,
      db: dbClient.db,
      genesisHash: expectedGenesisHash,
      rpcClients: clients,
    }),
    follows: createFollowService({ db: dbClient.db }),
    planning: createPlanningService({
      config,
      db: dbClient.db,
      catalog: catalogService,
      policy: policyService,
      funding: fundingService,
      venue,
      rpcClients: clients,
      genesisHash: expectedGenesisHash,
    }),
    execution: createExecutionService({
      config,
      db: dbClient.db,
      policy: policyService,
      venue,
      rpcClients: clients,
      genesisHash: expectedGenesisHash,
    }),
    mintTestToken,
  });

  let address: string;
  try {
    address = await app.listen({
      host: options.listen?.host ?? config.api.host,
      port: options.listen?.port ?? config.api.port,
    });
  } catch (error) {
    monitor.stop();
    await app.close().catch(() => undefined);
    return fail(
      new BootError(
        `could not listen: ${error instanceof Error ? error.message : 'unknown error'}`,
        EXIT_UNAVAILABLE,
        {
          cause: error,
        },
      ),
    );
  }
  logger.info(
    { address, markovEnv: config.markovEnv, cluster: config.solana.cluster },
    'markov-api listening',
  );

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise === null) {
      shutdownPromise = (async () => {
        logger.info('shutting down');
        monitor.stop();
        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            logger.warn(
              { timeoutMs: config.shutdownTimeoutMs },
              'shutdown timeout reached; forcing close',
            );
            resolve();
          }, config.shutdownTimeoutMs);
        });
        await Promise.race([app.close(), deadline]);
        clearTimeout(timer);
        await dbClient.close().catch((error: unknown) => {
          logger.warn({ err: error }, 'database pool did not close cleanly');
        });
        logger.info('shutdown complete');
      })();
    }
    return shutdownPromise;
  };

  return { app, config, address, expectedGenesisHash, shutdown };
}
