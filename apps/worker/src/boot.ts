import { describeConfig, type EnvSource, type MarkovConfig, tryLoadConfig } from '@markov/config';
import type { BoundPlatformIdentity } from '@markov/contracts';
import { createDbClient, type DbClient, getMigrationState, readPlatformIdentity } from '@markov/db';
import { createLogger, type Logger } from '@markov/observability';
import { ensureMaintenanceWorkflow } from './maintenance.js';
import { ensureReconciliationWorkflow } from './reconciliation.js';
import { createPlatformWorker, type PlatformWorker } from './worker.js';

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

export interface WorkerBootOptions {
  readonly env?: EnvSource;
  readonly logger?: Logger;
  readonly taskQueue?: string;
  /** Start (or find) the durable execution reconciliation workflow for the queue; on by default. */
  readonly reconciliation?: boolean;
  /** Start (or find) the durable maintenance loop when MAINTENANCE_API_URL/TOKEN are set; on by default. */
  readonly maintenance?: boolean;
}

export interface BootedWorker {
  readonly config: MarkovConfig;
  readonly worker: PlatformWorker;
  readonly dbClient: DbClient;
  readonly genesisHash: string;
  /** Runs until shutdown() is called; then closes the database pool. */
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

export async function bootWorker(options: WorkerBootOptions = {}): Promise<BootedWorker> {
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
      service: 'markov-worker',
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
    applicationName: 'markov-worker',
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
    logger.info({ genesisHash, cluster: config.solana.cluster }, 'platform identity verified');

    const worker = await createPlatformWorker({
      config,
      logger,
      dbClient,
      genesisHash,
      ...(options.taskQueue ? { taskQueue: options.taskQueue } : {}),
    });
    if (options.reconciliation !== false) {
      await ensureReconciliationWorkflow({
        config,
        logger,
        taskQueue: worker.taskQueue,
        identity: worker.identity,
      });
    }
    if (options.maintenance !== false) {
      if (config.maintenance.apiUrl !== null && config.maintenance.apiToken !== null) {
        await ensureMaintenanceWorkflow({
          config,
          logger,
          taskQueue: worker.taskQueue,
          identity: worker.identity,
        });
      } else {
        logger.info(
          'maintenance driver not configured (MAINTENANCE_API_URL and MAINTENANCE_API_TOKEN unset); schedules are not driven by this worker',
        );
      }
    }
    return {
      config,
      worker,
      dbClient,
      genesisHash,
      run: () => worker.run().finally(() => dbClient.close().catch(() => undefined)),
      shutdown: () => worker.shutdown(),
    };
  } catch (error) {
    await dbClient.close().catch(() => undefined);
    if (error instanceof BootError) {
      throw error;
    }
    throw new BootError(
      `worker boot failed: ${error instanceof Error ? error.message : String(error)}`,
      EXIT_UNAVAILABLE,
      { cause: error },
    );
  }
}
