import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { MarkovConfig } from '@markov/config';
import type { DbClient } from '@markov/db';
import type { Logger } from '@markov/observability';
import {
  DefaultLogger,
  type LogEntry,
  NativeConnection,
  Runtime,
  Worker,
} from '@temporalio/worker';
import { createPlatformActivities } from './activities.js';

export interface PlatformWorkerOptions {
  readonly config: MarkovConfig;
  readonly logger: Logger;
  readonly dbClient: DbClient;
  readonly genesisHash: string;
  /** Override the task queue (tests use a unique queue per run). */
  readonly taskQueue?: string;
  readonly connectAttempts?: number;
}

export interface PlatformWorker {
  readonly taskQueue: string;
  readonly identity: string;
  /** Resolves when the worker has drained after shutdown(). */
  run(): Promise<void>;
  shutdown(): void;
}

let runtimeInstalled = false;

/**
 * Workflows are bundled from the compiled module next to this file. When the
 * worker runs from TypeScript sources (tests, `pnpm dev:worker`) the bundler
 * consumes the .ts module directly.
 */
export function workflowsPath(): string {
  const compiled = fileURLToPath(new URL('./workflows/index.js', import.meta.url));
  return existsSync(compiled)
    ? compiled
    : fileURLToPath(new URL('./workflows/index.ts', import.meta.url));
}

/**
 * Route Temporal SDK core logs through the process logger. Must run before
 * the first connection or worker is created; idempotent.
 */
export function installTemporalRuntime(logger: Logger): void {
  if (runtimeInstalled) {
    return;
  }
  runtimeInstalled = true;
  const sdkLogger = logger.child({ component: 'temporal-sdk' });
  const emit = (entry: LogEntry) => {
    const meta = entry.meta ?? {};
    switch (entry.level) {
      case 'ERROR':
        sdkLogger.error(meta, entry.message);
        break;
      case 'WARN':
        sdkLogger.warn(meta, entry.message);
        break;
      case 'INFO':
        sdkLogger.info(meta, entry.message);
        break;
      case 'DEBUG':
        sdkLogger.debug(meta, entry.message);
        break;
      default:
        sdkLogger.trace(meta, entry.message);
    }
  };
  Runtime.install({ logger: new DefaultLogger('INFO', emit) });
}

async function connectWithRetry(options: PlatformWorkerOptions): Promise<NativeConnection> {
  const attempts = options.connectAttempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await NativeConnection.connect({
        address: options.config.temporal.address,
        tls: options.config.temporal.tls ? {} : false,
        ...(options.config.temporal.apiKey ? { apiKey: options.config.temporal.apiKey } : {}),
      });
    } catch (error) {
      lastError = error;
      const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 10_000);
      options.logger.warn(
        { attempt, attempts, delayMs, address: options.config.temporal.address },
        'temporal connection failed; retrying',
      );
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(
    `could not connect to temporal at ${options.config.temporal.address} after ${attempts} attempts`,
    {
      cause: lastError,
    },
  );
}

export async function createPlatformWorker(
  options: PlatformWorkerOptions,
): Promise<PlatformWorker> {
  installTemporalRuntime(options.logger);
  const taskQueue = options.taskQueue ?? options.config.temporal.taskQueues.platform;
  const identity = `markov-worker@${hostname()}#${process.pid}`;
  const connection = await connectWithRetry(options);
  const worker = await Worker.create({
    connection,
    namespace: options.config.temporal.namespace,
    taskQueue,
    identity,
    workflowsPath: workflowsPath(),
    activities: createPlatformActivities({
      config: options.config,
      dbClient: options.dbClient,
      genesisHash: options.genesisHash,
    }),
    shutdownGraceTime: `${options.config.shutdownTimeoutMs} ms`,
  });
  options.logger.info(
    { taskQueue, namespace: options.config.temporal.namespace, identity },
    'temporal worker created',
  );
  return {
    taskQueue,
    identity,
    run: () => worker.run().finally(() => connection.close().catch(() => undefined)),
    shutdown: () => worker.shutdown(),
  };
}
