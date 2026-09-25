import { describeConfig, type EnvSource, type MarkovConfig, tryLoadConfig } from '@markov/config';
import type { BoundPlatformIdentity } from '@markov/contracts';
import { createDbClient, type DbClient, getMigrationState, readPlatformIdentity } from '@markov/db';
import { createLogger, type Logger } from '@markov/observability';
import { SolanaRpcClient, verifyNetworkIdentity } from '@markov/solana-rpc';
import { type IndexerPassReport, runIndexerPass } from './indexer.js';

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

export interface IndexerBootOptions {
  readonly env?: EnvSource;
  readonly logger?: Logger;
}

export interface BootedIndexer {
  readonly config: MarkovConfig;
  readonly dbClient: DbClient;
  readonly genesisHash: string;
  /** One pass over pending publications and program accounts. */
  runOnce(): Promise<IndexerPassReport | null>;
  /** Passes every `REGISTRY_INDEX_INTERVAL_SECONDS` until shutdown() is called. */
  run(): Promise<void>;
  shutdown(): void;
}

function resolveGenesis(config: MarkovConfig, stored: BoundPlatformIdentity | null): string {
  if (stored === null) {
    throw new BootError(
      'database has no platform identity; run `markov db migrate` for this environment',
      EXIT_CONFIG,
    );
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
    throw new BootError(`platform identity check failed: ${problems.join('; ')}`, EXIT_CONFIG);
  }
  return config.solana.expectedGenesisHash ?? stored.genesisHash;
}

/**
 * Boot like every other Markov process: validated configuration, current
 * schema, platform identity, live network identity. A registry program id is
 * not required to boot; without one the indexer stays idle and says so.
 */
export async function bootIndexer(options: IndexerBootOptions = {}): Promise<BootedIndexer> {
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
      service: 'markov-indexer',
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
    applicationName: 'markov-indexer',
  });
  try {
    const ping = await dbClient.ping(5_000);
    if (!ping.ok) {
      throw new BootError(`database unreachable: ${ping.detail}`, EXIT_UNAVAILABLE);
    }
    const migrationState = await getMigrationState(dbClient.db);
    if (migrationState.status !== 'current') {
      throw new BootError(
        `database schema is ${migrationState.status} (applied ${migrationState.applied} of ${migrationState.expected}); run \`markov db migrate\``,
        EXIT_CONFIG,
      );
    }
    const genesisHash = resolveGenesis(config, await readPlatformIdentity(dbClient.db));
    const rpc = new SolanaRpcClient({
      url: config.solana.rpc.primaryUrl,
      timeoutMs: config.solana.rpc.timeoutMs,
      maxResponseBytes: config.solana.rpc.maxResponseBytes,
    });
    const identity = await verifyNetworkIdentity([rpc], genesisHash);
    if (identity.status === 'mismatch') {
      throw new BootError(
        `solana network identity mismatch: ${identity.endpoints.map((endpoint) => `${endpoint.host}: ${endpoint.detail}`).join('; ')}`,
        EXIT_CONFIG,
      );
    }
    logger.info(
      { genesisHash, cluster: config.solana.cluster, programId: config.registry.programId },
      'platform identity verified',
    );

    let stopped = false;
    let wake: (() => void) | null = null;
    const deps = { config, db: dbClient.db, genesisHash, rpc, logger };
    return {
      config,
      dbClient,
      genesisHash,
      runOnce: () => runIndexerPass(deps),
      run: async () => {
        try {
          while (!stopped) {
            try {
              await runIndexerPass(deps);
            } catch (error) {
              logger.error(
                { error: error instanceof Error ? error.message : String(error) },
                'indexer pass failed',
              );
            }
            if (stopped) {
              break;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              setTimeout(resolve, config.registry.indexIntervalSeconds * 1000).unref();
            });
            wake = null;
          }
        } finally {
          await dbClient.close().catch(() => undefined);
        }
      },
      shutdown: () => {
        stopped = true;
        wake?.();
      },
    };
  } catch (error) {
    await dbClient.close().catch(() => undefined);
    if (error instanceof BootError) {
      throw error;
    }
    throw new BootError(
      `indexer boot failed: ${error instanceof Error ? error.message : String(error)}`,
      EXIT_UNAVAILABLE,
      { cause: error },
    );
  }
}
