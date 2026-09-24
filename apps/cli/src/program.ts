import { randomUUID } from 'node:crypto';
import { describeConfig, type MarkovConfig, tryLoadConfig } from '@markov/config';
import {
  type HealthResponse,
  PLATFORM_HEALTH_WORKFLOW_TYPE,
  type PlatformHealthReport,
  platformHealthReportSchema,
  type ReadinessResponse,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createDbClient,
  type DbClient,
  getMigrationState,
  listCapabilityReadiness,
  readPlatformIdentity,
  runMigrations,
  seedCapabilityReadiness,
} from '@markov/db';
import { SolanaRpcClient, verifyNetworkIdentity } from '@markov/solana-rpc';
import { Client, Connection } from '@temporalio/client';
import { Command } from 'commander';
import { loadEnvFile } from './env.js';
import {
  CliExit,
  type CliIo,
  EXIT_CONFIG,
  EXIT_UNAVAILABLE,
  EXIT_USAGE,
  json,
  stdio,
} from './output.js';

export const CLI_VERSION = '0.1.0';

interface GlobalOptions {
  envFile?: string;
  json?: boolean;
}

function loadConfigOrExit(io: CliIo): MarkovConfig {
  const result = tryLoadConfig(process.env);
  if (!result.ok) {
    io.err('configuration is invalid:');
    for (const issue of result.issues) {
      io.err(`  - ${issue.path}: ${issue.message}`);
    }
    throw new CliExit('invalid configuration', EXIT_CONFIG);
  }
  return result.config;
}

function dbClientFor(config: MarkovConfig, applicationName: string): DbClient {
  return createDbClient({
    url: config.database.url,
    ssl: config.database.ssl,
    poolMax: 2,
    statementTimeoutMs: config.database.statementTimeoutMs,
    applicationName,
  });
}

async function withDb<T>(
  config: MarkovConfig,
  applicationName: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = dbClientFor(config, applicationName);
  try {
    const ping = await client.ping(5_000);
    if (!ping.ok) {
      throw new CliExit(`database unreachable: ${ping.detail}`, EXIT_UNAVAILABLE);
    }
    return await fn(client);
  } finally {
    await client.close();
  }
}

function rpcClients(config: MarkovConfig, urlOverride?: string): SolanaRpcClient[] {
  const urls = urlOverride
    ? [urlOverride]
    : [
        config.solana.rpc.primaryUrl,
        ...(config.solana.rpc.secondaryUrl ? [config.solana.rpc.secondaryUrl] : []),
      ];
  return urls.map(
    (url) =>
      new SolanaRpcClient({
        url,
        timeoutMs: config.solana.rpc.timeoutMs,
        maxResponseBytes: config.solana.rpc.maxResponseBytes,
      }),
  );
}

export function buildProgram(io: CliIo = stdio): Command {
  const program = new Command('markov')
    .description('Markov stock strategy backend: operator and developer commands')
    .version(CLI_VERSION)
    .option('--env-file <path>', 'load environment variables from a file before running')
    .option('--json', 'machine-readable output where supported')
    .hook('preAction', (thisCommand) => {
      const options = thisCommand.opts<GlobalOptions>();
      const loaded = loadEnvFile(options.envFile);
      if (loaded !== null) {
        io.err(`env file loaded: ${loaded}`);
      }
    });
  program.exitOverride();

  program
    .command('version')
    .description('print the CLI version')
    .action(() => io.out(CLI_VERSION));

  const config = program.command('config').description('inspect configuration');
  config
    .command('check')
    .description('validate configuration from the environment and print a secret-free summary')
    .action(() => {
      const loaded = loadConfigOrExit(io);
      io.out(json(describeConfig(loaded)));
      io.out(`configuration valid for ${loaded.markovEnv}/${loaded.solana.cluster}`);
    });

  const db = program.command('db').description('database migrations and platform identity');
  db.command('migrate')
    .description(
      'apply reviewed migrations, bind the platform identity and seed capability readiness',
    )
    .option(
      '--bound-by <actor>',
      'who is performing this binding (recorded in the database)',
      'markov-cli',
    )
    .option('--allow-production', 'required to run migrations when MARKOV_ENV=production')
    .action(async (options: { boundBy: string; allowProduction?: boolean }) => {
      const loaded = loadConfigOrExit(io);
      if (loaded.markovEnv === 'production' && !options.allowProduction) {
        throw new CliExit(
          'refusing to migrate a production database without --allow-production',
          EXIT_USAGE,
        );
      }
      await withDb(loaded, 'markov-cli-migrate', async (client) => {
        await runMigrations(client.db);
        const state = await getMigrationState(client.db);
        io.out(
          `migrations: ${state.status} (${state.applied}/${state.expected}, latest ${state.latestTag ?? 'none'})`,
        );

        let genesisHash = loaded.solana.expectedGenesisHash;
        if (genesisHash === null) {
          const identity = await verifyNetworkIdentity(rpcClients(loaded), null);
          if (identity.status !== 'verified' || identity.observedGenesisHash === null) {
            throw new CliExit(
              `localnet genesis hash is unknown and the RPC endpoint did not answer (${identity.endpoints.map((endpoint) => endpoint.detail).join('; ')}); set SOLANA_EXPECTED_GENESIS_HASH or start the validator`,
              EXIT_UNAVAILABLE,
            );
          }
          genesisHash = identity.observedGenesisHash;
          io.out(`localnet genesis observed from RPC: ${genesisHash}`);
        }
        const bound = await bindPlatformIdentity(
          client.db,
          { markovEnv: loaded.markovEnv, solanaCluster: loaded.solana.cluster, genesisHash },
          options.boundBy,
        );
        io.out(
          `platform identity ${bound.created ? 'bound' : 'already bound'}: ${bound.stored.markovEnv}/${bound.stored.solanaCluster} ${bound.stored.genesisHash} (by ${bound.stored.boundBy} at ${bound.stored.boundAt})`,
        );
        const seeded = await seedCapabilityReadiness(client.db, options.boundBy);
        io.out(`capability readiness seeded: ${seeded.length} new row(s)`);
      });
    });

  db.command('status')
    .description('show migration state, platform identity and capability readiness')
    .action(async () => {
      const loaded = loadConfigOrExit(io);
      await withDb(loaded, 'markov-cli-status', async (client) => {
        const [state, identity, capabilities] = await Promise.all([
          getMigrationState(client.db),
          readPlatformIdentity(client.db),
          listCapabilityReadiness(client.db).catch(() => []),
        ]);
        const report = { migrations: state, identity, capabilities };
        if (program.opts<GlobalOptions>().json) {
          io.out(json(report));
          return;
        }
        io.out(
          `migrations: ${state.status} (${state.applied}/${state.expected}, latest ${state.latestTag ?? 'none'})`,
        );
        io.out(
          identity === null
            ? 'platform identity: unbound'
            : `platform identity: ${identity.markovEnv}/${identity.solanaCluster} ${identity.genesisHash} (by ${identity.boundBy} at ${identity.boundAt})`,
        );
        io.out('capabilities:');
        for (const capability of capabilities) {
          io.out(
            `  ${capability.capability.padEnd(34)} ${capability.status.padEnd(20)} ${capability.summary}`,
          );
        }
      });
    });

  program
    .command('capabilities')
    .description('list capability readiness from the database')
    .action(async () => {
      const loaded = loadConfigOrExit(io);
      await withDb(loaded, 'markov-cli-capabilities', async (client) => {
        const capabilities = await listCapabilityReadiness(client.db);
        io.out(json(capabilities));
      });
    });

  program
    .command('health')
    .description('query a running API for liveness and readiness')
    .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
    .option('--timeout-ms <ms>', 'request timeout', '5000')
    .action(async (options: { url: string; timeoutMs: string }) => {
      const base = options.url.replace(/\/+$/, '');
      const timeoutMs = Number.parseInt(options.timeoutMs, 10);
      const get = async (path: string) => {
        const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: response.status, body: (await response.json()) as unknown };
      };
      let health: { status: number; body: unknown };
      let ready: { status: number; body: unknown };
      try {
        health = await get('/healthz');
        ready = await get('/readyz');
      } catch (error) {
        throw new CliExit(
          `api unreachable at ${base}: ${error instanceof Error ? error.message : String(error)}`,
          EXIT_UNAVAILABLE,
        );
      }
      const liveness = health.body as HealthResponse;
      const readiness = ready.body as ReadinessResponse;
      if (program.opts<GlobalOptions>().json) {
        io.out(json({ liveness, readiness }));
      } else {
        io.out(
          `liveness: HTTP ${health.status} ${liveness.status} (${liveness.service} ${liveness.version}, up ${liveness.uptimeSeconds}s)`,
        );
        io.out(`readiness: HTTP ${ready.status} ${readiness.status}`);
        for (const [name, check] of Object.entries(readiness.checks)) {
          io.out(`  ${name.padEnd(18)} ${check.status.padEnd(11)} ${check.detail}`);
        }
        io.out(
          `platform: ${readiness.platform.markovEnv}/${readiness.platform.solanaCluster} expected ${readiness.platform.expectedGenesisHash ?? 'unknown'} observed ${readiness.platform.observedGenesisHash ?? 'none'}`,
        );
      }
      if (ready.status !== 200) {
        throw new CliExit('api is not ready', 1);
      }
    });

  const solana = program.command('solana').description('read-only Solana RPC checks');
  solana
    .command('probe')
    .description(
      'verify RPC endpoints report the expected genesis hash (read-only; no keys, no writes)',
    )
    .option('--url <url>', 'probe this endpoint instead of the configured ones')
    .action(async (options: { url?: string }) => {
      const loaded = loadConfigOrExit(io);
      const clients = rpcClients(loaded, options.url);
      const identity = await verifyNetworkIdentity(clients, loaded.solana.expectedGenesisHash);
      const details = await Promise.all(
        clients.map(async (client) => {
          const [version, health] = await Promise.all([
            client.getVersion().catch((error: unknown) => ({
              error: error instanceof Error ? error.message : String(error),
            })),
            client.getHealth().catch((error: unknown) => ({
              error: error instanceof Error ? error.message : String(error),
            })),
          ]);
          return { host: client.host, version, health };
        }),
      );
      io.out(json({ cluster: loaded.solana.cluster, identity, endpoints: details }));
      if (identity.status === 'mismatch') {
        throw new CliExit('network identity mismatch', EXIT_CONFIG);
      }
      if (identity.status === 'unavailable') {
        throw new CliExit('no endpoint answered', EXIT_UNAVAILABLE);
      }
    });

  const worker = program.command('worker').description('durable worker checks');
  worker
    .command('ping')
    .description('run the platform health workflow through Temporal and print the worker report')
    .option('--timeout-seconds <n>', 'workflow execution timeout', '60')
    .action(async (options: { timeoutSeconds: string }) => {
      const loaded = loadConfigOrExit(io);
      let connection: Connection;
      try {
        connection = await Connection.connect({
          address: loaded.temporal.address,
          tls: loaded.temporal.tls ? {} : false,
          ...(loaded.temporal.apiKey ? { apiKey: loaded.temporal.apiKey } : {}),
        });
      } catch (error) {
        throw new CliExit(
          `temporal unreachable at ${loaded.temporal.address}: ${error instanceof Error ? error.message : String(error)}`,
          EXIT_UNAVAILABLE,
        );
      }
      try {
        const temporal = new Client({ connection, namespace: loaded.temporal.namespace });
        const workflowId = `platform-health-${randomUUID()}`;
        const raw = await temporal.workflow.execute<
          (input: { requestedBy: string }) => Promise<PlatformHealthReport>
        >(PLATFORM_HEALTH_WORKFLOW_TYPE, {
          taskQueue: loaded.temporal.taskQueues.platform,
          workflowId,
          args: [{ requestedBy: 'markov-cli' }],
          workflowExecutionTimeout: `${Number.parseInt(options.timeoutSeconds, 10)} seconds`,
        });
        const report = platformHealthReportSchema.parse(raw);
        io.out(json({ workflowId, taskQueue: loaded.temporal.taskQueues.platform, report }));
      } finally {
        await connection.close();
      }
    });

  return program;
}
