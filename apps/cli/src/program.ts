import { randomUUID } from 'node:crypto';
import { generateCredential } from '@markov/auth';
import { describeConfig, type MarkovConfig, tryLoadConfig } from '@markov/config';
import {
  executionPlanSchema,
  type HealthResponse,
  OPERATOR_SCOPES,
  PLATFORM_HEALTH_WORKFLOW_TYPE,
  type PlatformHealthReport,
  platformHealthReportSchema,
  preparedTransactionSchema,
  type ReadinessResponse,
  WORKER_SCOPES,
} from '@markov/contracts';
import {
  bindPlatformIdentity,
  createApiCredential,
  createDbClient,
  type DbClient,
  getMigrationState,
  listCapabilityReadiness,
  readPlatformIdentity,
  recordAuditEvent,
  runMigrations,
  seedCapabilityReadiness,
} from '@markov/db';
import { planHashOf, verifyPlanHash } from '@markov/planning';
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

  const auth = program.command('auth').description('accounts, sessions and wallet verification');

  const apiCall = async (
    base: string,
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ) => {
    const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new CliExit(
        `${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
        1,
      );
    }
    return parsed;
  };

  auth
    .command('test-token')
    .description('mint an identity token from the API test issuer (nonproduction only)')
    .requiredOption('--subject <subject>', 'identity subject, for example did:test:alice')
    .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
    .option(
      '--auth-time <iso>',
      'pretend the person authenticated at this time (for step-up tests)',
    )
    .action(async (options: { subject: string; url: string; authTime?: string }) => {
      const result = (await apiCall(options.url, 'POST', '/v1/auth/test-tokens', {
        subject: options.subject,
        ...(options.authTime ? { authTime: options.authTime } : {}),
      })) as { identityToken: string };
      io.out(result.identityToken);
    });

  auth
    .command('session')
    .description('exchange an identity token for a Markov session; prints the session token once')
    .requiredOption('--identity-token <token>')
    .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
    .action(async (options: { identityToken: string; url: string }) => {
      io.out(
        json(
          await apiCall(options.url, 'POST', '/v1/auth/sessions', {
            identityToken: options.identityToken,
          }),
        ),
      );
    });

  auth
    .command('whoami')
    .description('describe the principal behind a bearer token')
    .requiredOption('--token <token>')
    .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me', undefined, options.token)));
    });

  auth
    .command('demo-wallet-link')
    .description(
      'NONPRODUCTION: create an in-memory Ed25519 wallet, sign the ownership challenge and link it',
    )
    .requiredOption('--token <token>', 'user session token')
    .option('--url <url>', 'API base URL', 'http://127.0.0.1:3000')
    .option(
      '--keep-key <path>',
      'NONPRODUCTION: write the wallet private key (PKCS#8, base64, mode 0600) to this file so `intents sign` can use it; never on a mainnet cluster',
    )
    .action(async (options: { token: string; url: string; keepKey?: string }) => {
      const { generateKeyPairSync } = await import('node:crypto');
      const { encodeBase58 } = await import('@markov/contracts');
      const { signerFromPrivateKey } = await import('@markov/registry');
      const { privateKey } = generateKeyPairSync('ed25519');
      const signer = signerFromPrivateKey(privateKey);
      const challenge = (await apiCall(
        options.url,
        'POST',
        '/v1/me/wallets/challenges',
        { address: signer.publicKey },
        options.token,
      )) as {
        challengeId: string;
        message: string;
      };
      const link = await apiCall(
        options.url,
        'POST',
        '/v1/me/wallets',
        {
          challengeId: challenge.challengeId,
          address: signer.publicKey,
          signature: encodeBase58(signer.sign(new TextEncoder().encode(challenge.message))),
        },
        options.token,
      );
      if (options.keepKey) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(
          options.keepKey,
          `${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}\n`,
          { mode: 0o600 },
        );
        io.err(
          `NONPRODUCTION: the demo wallet's private key was written to ${options.keepKey}; delete it when the check is done`,
        );
      } else {
        io.err(
          'the private key of this demo wallet existed only in this process and is now discarded',
        );
      }
      io.out(json(link));
    });

  const operators = program
    .command('operators')
    .description('operator credentials (database access required)');
  operators
    .command('create')
    .description(
      'create an operator credential; the token is printed once and only its hash is stored',
    )
    .requiredOption('--label <label>')
    .option('--scopes <scopes>', 'comma-separated operator scopes', OPERATOR_SCOPES.join(','))
    .option('--expires-days <n>', 'lifetime in days', '30')
    .option('--created-by <actor>', 'who is creating it (audit)', 'markov-cli')
    .action(
      async (options: {
        label: string;
        scopes: string;
        expiresDays: string;
        createdBy: string;
      }) => {
        const loaded = loadConfigOrExit(io);
        const scopes = options.scopes.split(',').map((scope) => scope.trim());
        const invalid = scopes.filter(
          (scope) => !(OPERATOR_SCOPES as readonly string[]).includes(scope),
        );
        if (invalid.length > 0) {
          throw new CliExit(
            `unknown operator scopes: ${invalid.join(', ')} (allowed: ${OPERATOR_SCOPES.join(', ')})`,
            EXIT_USAGE,
          );
        }
        const days = Number.parseInt(options.expiresDays, 10);
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          throw new CliExit('--expires-days must be between 1 and 365', EXIT_USAGE);
        }
        await withDb(loaded, 'markov-cli-operators', async (client) => {
          const generated = generateCredential('operator', loaded.auth.credentialPepper);
          const row = await createApiCredential(client.db, {
            userId: null,
            principalClass: 'operator',
            label: options.label,
            prefix: generated.prefix,
            secretHash: generated.secretHash,
            scopes,
            expiresAt: new Date(Date.now() + days * 86_400_000),
          });
          await recordAuditEvent(client.db, {
            actorClass: 'operator',
            actorId: options.createdBy,
            action: 'operator.credential.created',
            targetType: 'api_credential',
            targetId: row.id,
            requestId: null,
            details: { scopes, label: options.label },
          });
          io.out(
            json({
              credentialId: row.id,
              prefix: row.prefix,
              scopes,
              expiresAt: row.expiresAt.toISOString(),
              token: generated.token,
            }),
          );
          io.err('store the token now; it cannot be shown again');
        });
      },
    );

  const workers = program
    .command('workers')
    .description(
      'worker credentials (database access required): what a worker presents to the API to run maintenance passes (B16)',
    );
  workers
    .command('create')
    .description(
      'create a worker credential; the token is printed once and only its hash is stored. Give it to the worker as MAINTENANCE_API_TOKEN.',
    )
    .requiredOption('--label <label>')
    .option('--scopes <scopes>', 'comma-separated worker scopes', WORKER_SCOPES.join(','))
    .option('--expires-days <n>', 'lifetime in days', '90')
    .option('--created-by <actor>', 'who is creating it (audit)', 'markov-cli')
    .action(
      async (options: {
        label: string;
        scopes: string;
        expiresDays: string;
        createdBy: string;
      }) => {
        const loaded = loadConfigOrExit(io);
        const scopes = options.scopes.split(',').map((scope) => scope.trim());
        const invalid = scopes.filter(
          (scope) => !(WORKER_SCOPES as readonly string[]).includes(scope),
        );
        if (invalid.length > 0) {
          throw new CliExit(
            `unknown worker scopes: ${invalid.join(', ')} (allowed: ${WORKER_SCOPES.join(', ')})`,
            EXIT_USAGE,
          );
        }
        const days = Number.parseInt(options.expiresDays, 10);
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          throw new CliExit('--expires-days must be between 1 and 365', EXIT_USAGE);
        }
        await withDb(loaded, 'markov-cli-workers', async (client) => {
          const generated = generateCredential('worker', loaded.auth.credentialPepper);
          const row = await createApiCredential(client.db, {
            userId: null,
            principalClass: 'worker',
            label: options.label,
            prefix: generated.prefix,
            secretHash: generated.secretHash,
            scopes,
            expiresAt: new Date(Date.now() + days * 86_400_000),
          });
          await recordAuditEvent(client.db, {
            actorClass: 'operator',
            actorId: options.createdBy,
            action: 'worker.credential.created',
            targetType: 'api_credential',
            targetId: row.id,
            requestId: null,
            details: { scopes, label: options.label },
          });
          io.out(
            json({
              credentialId: row.id,
              prefix: row.prefix,
              scopes,
              expiresAt: row.expiresAt.toISOString(),
              token: generated.token,
            }),
          );
          io.err('store the token now; it cannot be shown again');
        });
      },
    );

  const catalog = program
    .command('catalog')
    .description('instrument catalog: public reads, operator ingestion and lifecycle decisions');
  const apiUrlOption = ['--url <url>', 'API base URL', 'http://127.0.0.1:3000'] as const;
  catalog
    .command('ingest')
    .description(
      'ingest an issuer feed into quarantine through the API (operator ops:catalog:write)',
    )
    .option('--issuer <issuer>', 'issuer id', 'prestocks')
    .option('--source <source>', 'fixture (local/test only) or configured_url', 'fixture')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (options: { issuer: string; source: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/ops/catalog/ingestions',
            { issuer: options.issuer, source: options.source },
            options.token,
          ),
        ),
      );
    });
  catalog
    .command('list')
    .description('search instruments; with --token the operator route lists every status')
    .option('--q <text>', 'symbol prefix, name or company match')
    .option('--issuer <issuer>')
    .option('--kind <kind>')
    .option('--status <status>', 'operator only: quarantined|admitted|paused|rejected|delisted')
    .option('--limit <n>', 'page size', '25')
    .option('--cursor <cursor>', 'nextCursor from a previous page')
    .option('--token <token>', 'operator credential (ops:catalog:read)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        q?: string;
        issuer?: string;
        kind?: string;
        status?: string;
        limit: string;
        cursor?: string;
        token?: string;
        url: string;
      }) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries({
          q: options.q,
          issuer: options.issuer,
          kind: options.kind,
          status: options.status,
          limit: options.limit,
          cursor: options.cursor,
        })) {
          if (value !== undefined) {
            params.set(key, value);
          }
        }
        if (options.status && !options.token) {
          throw new CliExit('--status needs an operator --token', EXIT_USAGE);
        }
        const path = `${options.token ? '/v1/ops/catalog/instruments' : '/v1/catalog/instruments'}?${params.toString()}`;
        io.out(json(await apiCall(options.url, 'GET', path, undefined, options.token)));
      },
    );
  catalog
    .command('verify-mint <instrumentId>')
    .description('compare the declared mint with the chain and record the result (operator)')
    .requiredOption('--token <token>', 'operator credential (ops:catalog:write)')
    .option(...apiUrlOption)
    .action(async (instrumentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/ops/catalog/instruments/${encodeURIComponent(instrumentId)}/mint-verifications`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  catalog
    .command('decide <instrumentId>')
    .description('admit, reject, pause, resume or delist an instrument (operator)')
    .requiredOption('--decision <decision>', 'admit|reject|pause|resume|delist')
    .requiredOption('--reason <reason>', 'why, for the audit record')
    .option('--evidence <pairs...>', 'key=value references (review ids, document hashes)')
    .requiredOption('--token <token>', 'operator credential (ops:catalog:write)')
    .option(...apiUrlOption)
    .action(
      async (
        instrumentId: string,
        options: {
          decision: string;
          reason: string;
          evidence?: string[];
          token: string;
          url: string;
        },
      ) => {
        const evidence: Record<string, string> = {};
        for (const pair of options.evidence ?? []) {
          const separator = pair.indexOf('=');
          if (separator <= 0) {
            throw new CliExit(`evidence entries are key=value, got ${pair}`, EXIT_USAGE);
          }
          evidence[pair.slice(0, separator)] = pair.slice(separator + 1);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/ops/catalog/instruments/${encodeURIComponent(instrumentId)}/decisions`,
              { decision: options.decision, reason: options.reason, evidence },
              options.token,
            ),
          ),
        );
      },
    );
  catalog
    .command('snapshots')
    .description('recent issuer snapshots (operator ops:catalog:read)')
    .option('--issuer <issuer>')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (options: { issuer?: string; token: string; url: string }) => {
      const query = options.issuer ? `?issuer=${encodeURIComponent(options.issuer)}` : '';
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/ops/catalog/snapshots${query}`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const events = catalog
    .command('events')
    .description('corporate actions: ingestion, listing, application (operator)');
  events
    .command('ingest')
    .description(
      'ingest an issuer corporate-action feed as pending events (operator ops:catalog:write)',
    )
    .option('--issuer <issuer>', 'issuer id', 'xstocks')
    .option('--source <source>', 'fixture (local/test only) or configured_url', 'fixture')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (options: { issuer: string; source: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/ops/catalog/corporate-actions/ingestions',
            { issuer: options.issuer, source: options.source },
            options.token,
          ),
        ),
      );
    });
  events
    .command('list')
    .description('list corporate actions (operator)')
    .option('--issuer <issuer>')
    .option('--status <status>', 'pending|applied|rejected|superseded')
    .requiredOption('--token <token>', 'operator credential (ops:catalog:read)')
    .option(...apiUrlOption)
    .action(async (options: { issuer?: string; status?: string; token: string; url: string }) => {
      const params = new URLSearchParams();
      if (options.issuer) {
        params.set('issuer', options.issuer);
      }
      if (options.status) {
        params.set('status', options.status);
      }
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/ops/catalog/corporate-actions?${params.toString()}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  events
    .command('apply <actionId>')
    .description('apply a pending, effective corporate action (operator ops:catalog:write)')
    .requiredOption('--reason <reason>')
    .option('--evidence <pairs...>', 'key=value references')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(
      async (
        actionId: string,
        options: { reason: string; evidence?: string[]; token: string; url: string },
      ) => {
        const evidence: Record<string, string> = {};
        for (const pair of options.evidence ?? []) {
          const separator = pair.indexOf('=');
          if (separator <= 0) {
            throw new CliExit(`evidence entries are key=value, got ${pair}`, EXIT_USAGE);
          }
          evidence[pair.slice(0, separator)] = pair.slice(separator + 1);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/ops/catalog/corporate-actions/${encodeURIComponent(actionId)}/apply`,
              { reason: options.reason, evidence },
              options.token,
            ),
          ),
        );
      },
    );
  events
    .command('reject <actionId>')
    .description('reject a pending corporate action (operator ops:catalog:write)')
    .requiredOption('--reason <reason>')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (actionId: string, options: { reason: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/ops/catalog/corporate-actions/${encodeURIComponent(actionId)}/reject`,
            { reason: options.reason },
            options.token,
          ),
        ),
      );
    });
  catalog
    .command('multiplier <instrumentId>')
    .description('the multiplier in force at a time, with completeness')
    .option('--as-of <iso>', 'ISO timestamp (default: now)')
    .option(...apiUrlOption)
    .action(async (instrumentId: string, options: { asOf?: string; url: string }) => {
      const query = options.asOf ? `?asOf=${encodeURIComponent(options.asOf)}` : '';
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/catalog/instruments/${encodeURIComponent(instrumentId)}/multiplier${query}`,
          ),
        ),
      );
    });
  catalog
    .command('convert <instrumentId>')
    .description('convert raw base units to a scaled display quantity or back, exactly')
    .option('--raw <amount>', 'raw base-unit integer string')
    .option('--scaled <amount>', 'scaled decimal string')
    .option('--as-of <iso>', 'ISO timestamp (default: now)')
    .option('--rounding <mode>', 'down|up|half_up|half_even', 'down')
    .option(...apiUrlOption)
    .action(
      async (
        instrumentId: string,
        options: { raw?: string; scaled?: string; asOf?: string; rounding: string; url: string },
      ) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries({
          raw: options.raw,
          scaled: options.scaled,
          asOf: options.asOf,
          rounding: options.rounding,
        })) {
          if (value !== undefined) {
            params.set(key, value);
          }
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `/v1/catalog/instruments/${encodeURIComponent(instrumentId)}/quantities?${params.toString()}`,
            ),
          ),
        );
      },
    );

  const policy = program
    .command('policy')
    .description('eligibility, terms, limits, capability states and policy decisions');
  const readJsonFile = async (path: string): Promise<unknown> => {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  };
  const rules = policy.command('rules').description('jurisdiction rule sets (operator)');
  rules
    .command('publish')
    .description(
      'publish a jurisdiction rule set from a JSON file, or the fixture set (local/test only)',
    )
    .option('--file <path>', 'rule set JSON matching the jurisdictionRuleSet contract')
    .option('--fixture', 'publish the fixture rule set (user-assigned ISO codes only)')
    .requiredOption('--token <token>', 'operator credential (ops:policy:write)')
    .option(...apiUrlOption)
    .action(async (options: { file?: string; fixture?: boolean; token: string; url: string }) => {
      let body: unknown;
      if (options.fixture) {
        const { FIXTURE_JURISDICTION_RULE_SET } = await import('@markov/policy');
        body = FIXTURE_JURISDICTION_RULE_SET;
      } else if (options.file) {
        body = await readJsonFile(options.file);
      } else {
        throw new CliExit('provide --file <path> or --fixture', EXIT_USAGE);
      }
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/ops/policy/jurisdiction-rules',
            body,
            options.token,
          ),
        ),
      );
    });
  rules
    .command('list')
    .description('published rule sets, newest first (operator ops:policy:read)')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            '/v1/ops/policy/jurisdiction-rules',
            undefined,
            options.token,
          ),
        ),
      );
    });
  const terms = policy.command('terms').description('terms and disclosure documents');
  terms
    .command('publish')
    .description('publish a terms document from a JSON file, or the fixture document (local/test)')
    .option('--file <path>', 'document JSON matching the termsPublishRequest contract')
    .option('--fixture', 'publish the fixture terms document')
    .requiredOption('--token <token>', 'operator credential (ops:policy:write)')
    .option(...apiUrlOption)
    .action(async (options: { file?: string; fixture?: boolean; token: string; url: string }) => {
      let body: unknown;
      if (options.fixture) {
        const { FIXTURE_TERMS_DOCUMENT } = await import('@markov/policy');
        body = FIXTURE_TERMS_DOCUMENT;
      } else if (options.file) {
        body = await readJsonFile(options.file);
      } else {
        throw new CliExit('provide --file <path> or --fixture', EXIT_USAGE);
      }
      io.out(json(await apiCall(options.url, 'POST', '/v1/ops/policy/terms', body, options.token)));
    });
  terms
    .command('current')
    .description('active terms documents with their content hashes')
    .option(...apiUrlOption)
    .action(async (options: { url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/terms/current')));
    });
  terms
    .command('acknowledge')
    .description('acknowledge an active terms document by version and content hash (user session)')
    .requiredOption('--terms-version <version>')
    .requiredOption('--content-hash <sha256>', 'hash of the text you were shown')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (options: {
        termsVersion: string;
        contentHash: string;
        token: string;
        url: string;
      }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/terms/acknowledgements',
              {
                termsVersion: options.termsVersion,
                contentHash: options.contentHash,
                channel: 'cli',
              },
              options.token,
            ),
          ),
        );
      },
    );
  policy
    .command('eligibility')
    .description('eligibility, terms and next steps for the signed-in person')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(await apiCall(options.url, 'GET', '/v1/me/eligibility', undefined, options.token)),
      );
    });
  policy
    .command('declare')
    .description(
      'declare a jurisdiction (self-declared evidence) and record an eligibility decision',
    )
    .requiredOption('--jurisdiction <code>', 'ISO 3166-1 alpha-2 code')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (options: { jurisdiction: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/eligibility/declarations',
            { jurisdiction: options.jurisdiction, attestation: true },
            options.token,
          ),
        ),
      );
    });
  policy
    .command('limits')
    .description('show effective limits; with --set, tighten the owner limits (step-up required)')
    .option(
      '--set <pairs...>',
      'key=value, for example maxOrderNotionalUsdcRaw=50000000 maxSlippageBps=25',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (options: { set?: string[]; token: string; url: string }) => {
      if (!options.set || options.set.length === 0) {
        io.out(json(await apiCall(options.url, 'GET', '/v1/me/limits', undefined, options.token)));
        return;
      }
      const body: Record<string, unknown> = {};
      for (const pair of options.set) {
        const [key, value] = pair.split('=');
        if (!key || value === undefined) {
          throw new CliExit(`invalid --set pair: ${pair}`, EXIT_USAGE);
        }
        if (key === 'allowedVenues') {
          body[key] = value.split(',');
        } else if (key.endsWith('Raw')) {
          body[key] = value;
        } else {
          body[key] = Number(value);
        }
      }
      io.out(json(await apiCall(options.url, 'PUT', '/v1/me/limits', body, options.token)));
    });
  policy
    .command('availability <instrumentId>')
    .description('capability states of an instrument for the signed-in person')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (instrumentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/instruments/${encodeURIComponent(instrumentId)}/availability`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  policy
    .command('evaluate')
    .description('evaluate an intent against policy; --reserve holds the notional when allowed')
    .requiredOption('--instrument <instrumentId>')
    .requiredOption('--notional <usdcRaw>', 'raw USDC integer (6 decimals)')
    .requiredOption(
      '--intent <intentId>',
      'caller-chosen intent id (reservations are idempotent per intent)',
    )
    .option('--side <side>', 'buy|sell', 'buy')
    .option('--stage <stage>', 'quote|submit', 'quote')
    .option('--cash <usdcRaw>', 'declared cash, raw USDC (declares exposure)')
    .option('--position <pairs...>', 'instrumentId=notionalUsdcRaw declared holdings')
    .option('--slippage-bps <bps>', 'slippage tolerance', '50')
    .option('--reserve', 'hold the notional against the daily and account budgets')
    .requiredOption('--token <token>', 'user session or agent credential (proposals:create)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        instrument: string;
        notional: string;
        intent: string;
        side: string;
        stage: string;
        cash?: string;
        position?: string[];
        slippageBps: string;
        reserve?: boolean;
        token: string;
        url: string;
      }) => {
        const positions = (options.position ?? []).map((pair) => {
          const [instrumentId, notionalUsdcRaw] = pair.split('=');
          if (!instrumentId || !notionalUsdcRaw) {
            throw new CliExit(`invalid --position pair: ${pair}`, EXIT_USAGE);
          }
          return { instrumentId, notionalUsdcRaw };
        });
        const declared = options.cash !== undefined || positions.length > 0;
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/policy/evaluations',
              {
                stage: options.stage,
                side: options.side,
                instrumentId: options.instrument,
                notionalUsdcRaw: options.notional,
                intentId: options.intent,
                slippageBps: Number(options.slippageBps),
                exposure: declared
                  ? {
                      source: 'caller_declared',
                      observedAt: new Date().toISOString(),
                      positions,
                      cashUsdcRaw: options.cash ?? null,
                    }
                  : { source: 'none', observedAt: null, positions: [], cashUsdcRaw: null },
                reserve: options.reserve === true,
              },
              options.token,
            ),
          ),
        );
      },
    );
  const reservations = policy.command('reservations').description('pending-spend reservations');
  reservations
    .command('list')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(await apiCall(options.url, 'GET', '/v1/me/reservations', undefined, options.token)),
      );
    });
  reservations
    .command('release <intentId>')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'DELETE',
            `/v1/me/reservations/${encodeURIComponent(intentId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  policy
    .command('revoke <decisionId>')
    .description('revoke an eligibility decision (operator ops:policy:write)')
    .requiredOption('--reason <reason>')
    .requiredOption('--token <token>', 'operator credential')
    .option(...apiUrlOption)
    .action(async (decisionId: string, options: { reason: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/ops/policy/eligibility/${encodeURIComponent(decisionId)}/revoke`,
            { reason: options.reason },
            options.token,
          ),
        ),
      );
    });
  const participants = policy
    .command('participants')
    .description('beta participant allowlist (operator)');
  participants
    .command('add <userId>')
    .option('--note <note>', 'why this person is in the beta', '')
    .requiredOption('--token <token>', 'operator credential (ops:policy:write)')
    .option(...apiUrlOption)
    .action(async (userId: string, options: { note: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/ops/policy/participants',
            { userId, note: options.note },
            options.token,
          ),
        ),
      );
    });
  participants
    .command('list')
    .requiredOption('--token <token>', 'operator credential (ops:policy:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            '/v1/ops/policy/participants',
            undefined,
            options.token,
          ),
        ),
      );
    });

  const research = program
    .command('research')
    .description('sourced theses, safe source retrieval, company mapping and bounded model runs');
  // `--input`, not `--json`: the global `--json` flag selects the output format.
  const readRevision = async (options: { file?: string; input?: string }): Promise<unknown> => {
    if (options.file) {
      const { readFile } = await import('node:fs/promises');
      return JSON.parse(await readFile(options.file, 'utf8'));
    }
    if (options.input) {
      return JSON.parse(options.input);
    }
    throw new CliExit(
      'provide --file <path> or --input <text> with the revision input',
      EXIT_USAGE,
    );
  };
  const thesis = research.command('thesis').description('theses and their revisions');
  thesis
    .command('create')
    .description('create a thesis; the first revision comes from --file/--input or --title/--claim')
    .option('--title <text>')
    .option('--claim <text>')
    .option('--file <path>', 'JSON file with the revision input (title, claim, statements, ...)')
    .option('--input <text>', 'inline JSON revision input')
    .option('--visibility <visibility>', 'private|public', 'private')
    .requiredOption('--token <token>', 'user session or agent credential (research:write)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        title?: string;
        claim?: string;
        file?: string;
        input?: string;
        visibility: string;
        token: string;
        url: string;
      }) => {
        const revision =
          options.file || options.input
            ? await readRevision(options)
            : { title: options.title, claim: options.claim };
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/theses',
              { visibility: options.visibility, revision },
              options.token,
            ),
          ),
        );
      },
    );
  thesis
    .command('list')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me/theses', undefined, options.token)));
    });
  thesis
    .command('get <thesisId>')
    .description('a thesis with its current revision and sources')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (thesisId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/theses/${encodeURIComponent(thesisId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  thesis
    .command('revise <thesisId>')
    .description('append an immutable revision from --file or --input')
    .option('--file <path>')
    .option('--input <text>', 'inline JSON revision input')
    .requiredOption('--token <token>', 'user session or agent credential (research:write)')
    .option(...apiUrlOption)
    .action(
      async (
        thesisId: string,
        options: { file?: string; input?: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/theses/${encodeURIComponent(thesisId)}/revisions`,
              await readRevision(options),
              options.token,
            ),
          ),
        );
      },
    );
  thesis
    .command('publish <thesisId>')
    .description('set visibility (public|private) or archive; person only')
    .option('--visibility <visibility>')
    .option('--archive', 'archive the thesis')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (
        thesisId: string,
        options: { visibility?: string; archive?: boolean; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'PATCH',
              `/v1/me/theses/${encodeURIComponent(thesisId)}`,
              {
                ...(options.visibility ? { visibility: options.visibility } : {}),
                ...(options.archive ? { status: 'archived' } : {}),
              },
              options.token,
            ),
          ),
        );
      },
    );
  thesis
    .command('public <thesisId>')
    .description('the public projection of a published thesis (no credential)')
    .option(...apiUrlOption)
    .action(async (thesisId: string, options: { url: string }) => {
      io.out(
        json(
          await apiCall(options.url, 'GET', `/v1/research/theses/${encodeURIComponent(thesisId)}`),
        ),
      );
    });
  const source = research.command('source').description('source records');
  source
    .command('attach <thesisId>')
    .description('fetch a URL under the safe-retrieval policy and record it')
    .requiredOption('--source-url <url>', 'https URL of the source')
    .option('--role <role>', 'issuer|legal|filing|news|data|other', 'other')
    .option('--published-at <iso>')
    .option('--observed-at <iso>')
    .requiredOption('--token <token>', 'user session or agent credential (research:write)')
    .option(...apiUrlOption)
    .action(
      async (
        thesisId: string,
        options: {
          sourceUrl: string;
          role: string;
          publishedAt?: string;
          observedAt?: string;
          token: string;
          url: string;
        },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/theses/${encodeURIComponent(thesisId)}/sources`,
              {
                url: options.sourceUrl,
                role: options.role,
                publishedAt: options.publishedAt ?? null,
                observedAt: options.observedAt ?? null,
              },
              options.token,
            ),
          ),
        );
      },
    );
  source
    .command('list <thesisId>')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (thesisId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/theses/${encodeURIComponent(thesisId)}/sources`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  research
    .command('map')
    .description(
      'deterministic company-to-instrument mapping; unmatched names stay research subjects',
    )
    .requiredOption('--company <name...>', 'one or more company names')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (options: { company: string[]; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/research/mappings',
            { companies: options.company },
            options.token,
          ),
        ),
      );
    });
  const run = research.command('run').description('bounded model runs');
  run
    .command('create')
    .requiredOption('--thesis <thesisId>')
    .requiredOption('--question <text>')
    .option('--source <sourceId...>', 'fetched source ids the model may read')
    .option('--max-statements <n>', 'statement budget', '8')
    .option('--max-chars <n>', 'character budget', '4000')
    .requiredOption('--token <token>', 'user session or agent credential (research:write)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        thesis: string;
        question: string;
        source?: string[];
        maxStatements: string;
        maxChars: string;
        token: string;
        url: string;
      }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/research/runs',
              {
                thesisId: options.thesis,
                question: options.question,
                sourceIds: options.source ?? [],
                budget: {
                  maxStatements: Number.parseInt(options.maxStatements, 10),
                  maxOutputChars: Number.parseInt(options.maxChars, 10),
                },
              },
              options.token,
            ),
          ),
        );
      },
    );
  run
    .command('get <runId>')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (runId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/research/runs/${encodeURIComponent(runId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  run
    .command('list')
    .option('--thesis <thesisId>')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (options: { thesis?: string; token: string; url: string }) => {
      const query = options.thesis ? `?thesisId=${encodeURIComponent(options.thesis)}` : '';
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/research/runs${query}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  run
    .command('cancel <runId>')
    .requiredOption('--token <token>', 'user session or agent credential (research:write)')
    .option(...apiUrlOption)
    .action(async (runId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/research/runs/${encodeURIComponent(runId)}/cancel`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const strategy = program
    .command('strategy')
    .description('versioned recipes: drafts, immutable versions, diffs and forks');
  const readContent = async (options: { file?: string; input?: string }): Promise<unknown> => {
    if (options.file) {
      const { readFile } = await import('node:fs/promises');
      return JSON.parse(await readFile(options.file, 'utf8'));
    }
    if (options.input) {
      return JSON.parse(options.input);
    }
    throw new CliExit('provide --file <path> or --input <text> with the draft content', EXIT_USAGE);
  };
  strategy
    .command('limits')
    .description('the recipe rules this deployment enforces')
    .option(...apiUrlOption)
    .action(async (options: { url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/strategies/limits')));
    });
  strategy
    .command('create')
    .description('create a strategy from draft content (--file or --input JSON)')
    .option('--file <path>')
    .option('--input <text>')
    .requiredOption('--token <token>', 'user session or agent credential (proposals:create)')
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/strategies',
            { content: await readContent(options) },
            options.token,
          ),
        ),
      );
    });
  strategy
    .command('list')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(await apiCall(options.url, 'GET', '/v1/me/strategies', undefined, options.token)),
      );
    });
  strategy
    .command('get <strategyId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (strategyId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/strategies/${encodeURIComponent(strategyId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  strategy
    .command('draft <strategyId>')
    .description('replace the working draft; --if-revision detects edits made elsewhere')
    .option('--file <path>')
    .option('--input <text>')
    .option('--if-revision <n>')
    .requiredOption('--token <token>', 'user session or agent credential (proposals:create)')
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        options: { file?: string; input?: string; ifRevision?: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'PUT',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/draft`,
              {
                content: await readContent(options),
                ...(options.ifRevision
                  ? { ifRevision: Number.parseInt(options.ifRevision, 10) }
                  : {}),
              },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('freeze <strategyId>')
    .description('freeze the draft as the next immutable version (person only)')
    .option('--if-revision <n>')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (strategyId: string, options: { ifRevision?: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions`,
              options.ifRevision ? { ifRevision: Number.parseInt(options.ifRevision, 10) } : {},
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('versions <strategyId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (strategyId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  strategy
    .command('diff <strategyId> <versionId>')
    .description('machine-readable difference from another version')
    .requiredOption('--against <versionId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        versionId: string,
        options: { against: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(versionId)}/diff?against=${encodeURIComponent(options.against)}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('fork <strategyId>')
    .description('fork a version into a new strategy of your own (person only)')
    .requiredOption('--version-id <versionId>', 'explicit version id')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (strategyId: string, options: { versionId: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/forks`,
              { versionId: options.versionId },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('archive <strategyId>')
    .option('--restore', 'restore an archived strategy')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (strategyId: string, options: { restore?: boolean; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'PATCH',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}`,
              { status: options.restore ? 'active' : 'archived' },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('moderate <strategyId> <versionId>')
    .description(
      'operator: hide a version from discovery, rankings and public reads, or make it visible again, with a recorded reason (B14)',
    )
    .requiredOption('--status <status>', 'hidden | none')
    .requiredOption('--reason <text>', 'why, 3 to 500 characters; recorded with the decision')
    .option('--reference <url>', 'where the decision is documented')
    .requiredOption('--token <token>', 'operator credential (ops:discovery:write)')
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        versionId: string,
        options: { status: string; reason: string; reference?: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/operator/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(versionId)}/moderation`,
              {
                status: options.status,
                reason: options.reason,
                reference: options.reference ?? null,
              },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('moderation <strategyId>')
    .description(
      'operator: moderation status of every version of a strategy and the decisions behind it',
    )
    .requiredOption('--token <token>', 'operator credential (ops:discovery:read)')
    .option(...apiUrlOption)
    .action(async (strategyId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/operator/strategies/${encodeURIComponent(strategyId)}/moderation`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  const intents = program
    .command('intents')
    .description('investment intents and bounded, hashed execution plans (B09)');
  intents
    .command('create')
    .description(
      'create an intent: a basket investment in a pinned version (--version-id), a single buy (--instrument) or a single sell (--instrument --sell)',
    )
    .requiredOption('--wallet <walletId>', 'one of your verified wallets')
    .requiredOption('--budget <raw>', 'budget in raw base units of the platform stablecoin')
    .option('--version-id <versionId>', 'the pinned version to invest in')
    .option('--instrument <instrumentId>', 'the admitted instrument to buy (or sell with --sell)')
    .option(
      '--sell',
      'a single sell: the budget is raw units of the instrument to sell for the stablecoin',
    )
    .option('--mode <mode>', 'all_in_stablecoin | investable_notional', 'all_in_stablecoin')
    .option(
      '--slippage-bps <n>',
      'slippage in basis points (default: platform default within your limit)',
    )
    .option(
      '--continue-intent <intentId>',
      'a reviewed completion: buy the legs this partially completed basket left unfilled, at their original targets (same wallet and version; the budget must equal their sum)',
    )
    .option('--idempotency-key <key>', 'client key scoped to you (default: a random key)')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (options: {
        wallet: string;
        budget: string;
        versionId?: string;
        instrument?: string;
        sell?: boolean;
        mode: string;
        slippageBps?: string;
        continueIntent?: string;
        idempotencyKey?: string;
        token: string;
        url: string;
      }) => {
        if (!options.versionId && !options.instrument) {
          throw new CliExit(
            'pass --version-id for a basket investment or --instrument for a single buy or sell',
            64,
          );
        }
        if (options.sell && !options.instrument) {
          throw new CliExit('--sell needs --instrument', 64);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/intents',
              {
                kind: options.versionId
                  ? 'basket_investment'
                  : options.sell
                    ? 'single_sell'
                    : 'single_buy',
                strategyVersionId: options.versionId ?? null,
                instrumentId: options.instrument ?? null,
                walletId: options.wallet,
                budget: { rawAmount: options.budget },
                budgetMode: options.mode,
                ...(options.slippageBps ? { slippageBps: Number(options.slippageBps) } : {}),
                continuationOfIntentId: options.continueIntent ?? null,
                idempotencyKey: options.idempotencyKey ?? `cli-${randomUUID()}`,
              },
              options.token,
            ),
          ),
        );
      },
    );
  intents
    .command('list')
    .description('your intents, newest first')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me/intents', undefined, options.token)));
    });
  intents
    .command('show <intentId>')
    .description('one intent with its state and latest plan reference')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/intents/${encodeURIComponent(intentId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('plan <intentId>')
    .description(
      'build a bounded execution plan: allocation, one checked venue quote and policy decision per constituent, fees, grouping, validity and the plan hash',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/intents/${encodeURIComponent(intentId)}/plans`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('plan-show <intentId> <planId>')
    .description('a plan with its review state and current validity')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (intentId: string, planId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/intents/${encodeURIComponent(intentId)}/plans/${encodeURIComponent(planId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('acknowledge <intentId> <planId>')
    .description('acknowledge a reviewed plan by its hash (staged plans need --staged)')
    .requiredOption('--plan-hash <hash>', 'the plan hash you reviewed')
    .option(
      '--staged',
      'accept staged execution: batches land one by one and completion can be partial',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (
        intentId: string,
        planId: string,
        options: { planHash: string; staged?: boolean; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/intents/${encodeURIComponent(intentId)}/plans/${encodeURIComponent(planId)}/acknowledgements`,
              { planHash: options.planHash, stagedAcknowledged: options.staged === true },
              options.token,
            ),
          ),
        );
      },
    );
  intents
    .command('cancel <intentId>')
    .description('cancel an intent before any signature')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/intents/${encodeURIComponent(intentId)}/cancel`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('build <intentId>')
    .description(
      'build, validate and simulate the transaction of an acknowledged single-leg plan; nothing is signed or sent',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/intents/${encodeURIComponent(intentId)}/transactions`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('sign')
    .description(
      'NONPRODUCTION: sign a prepared transaction with a key file from `auth demo-wallet-link --keep-key`; prints the signed transaction (base64)',
    )
    .requiredOption('--key-file <path>', 'the PKCS#8 base64 key file of the demo wallet')
    .option('--file <path>', 'prepared transaction JSON file')
    .option('--input <json>', 'prepared transaction JSON inline')
    .option(
      '--message-hash <hex>',
      'refuse to sign unless the prepared message hash equals this value (what was reviewed)',
    )
    .action(
      async (options: { keyFile: string; file?: string; input?: string; messageHash?: string }) => {
        const { createPrivateKey } = await import('node:crypto');
        const { readFile } = await import('node:fs/promises');
        const { base64ToBytes, bytesToBase64, messageHashHex, parseTransaction } = await import(
          '@markov/registry'
        );
        const { signerFromPrivateKey, signTransaction } = await import('@markov/registry');
        const parsed = preparedTransactionSchema.safeParse(await readContent(options));
        if (!parsed.success) {
          throw new CliExit(
            `not a prepared transaction: ${parsed.error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')}`,
            65,
          );
        }
        const prepared = parsed.data;
        const unsigned = base64ToBytes(prepared.unsignedTransaction);
        const hash = messageHashHex(parseTransaction(unsigned).messageBytes);
        if (hash !== prepared.messageHash) {
          throw new CliExit(
            'the prepared bytes do not hash to the stated message hash; nothing was signed',
            65,
          );
        }
        if (options.messageHash && options.messageHash !== hash) {
          throw new CliExit(
            `the message hash ${hash} is not the reviewed ${options.messageHash}; nothing was signed`,
            65,
          );
        }
        const privateKey = createPrivateKey({
          key: Buffer.from((await readFile(options.keyFile, 'utf8')).trim(), 'base64'),
          format: 'der',
          type: 'pkcs8',
        });
        const signer = signerFromPrivateKey(privateKey);
        if (signer.publicKey !== prepared.expectedSigner) {
          throw new CliExit(
            `the key file holds ${signer.publicKey}, not the expected signer ${prepared.expectedSigner}; nothing was signed`,
            65,
          );
        }
        const signed = signTransaction(unsigned, signer);
        io.out(
          json({
            intentId: prepared.intentId,
            transactionIndex: prepared.transactionIndex,
            messageHash: hash,
            signature: signed.signature,
            signedTransaction: bytesToBase64(signed.bytes),
          }),
        );
      },
    );
  intents
    .command('submit <intentId>')
    .description(
      'submit an owner-signed transaction; the same signed bytes again answer the same attempt, never a second one',
    )
    .requiredOption('--signed <base64>', 'the signed transaction (base64)')
    .option('--transaction-index <n>', 'the prepared transaction index', '0')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (
        intentId: string,
        options: { signed: string; transactionIndex: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/intents/${encodeURIComponent(intentId)}/transactions/${encodeURIComponent(options.transactionIndex)}/submissions`,
              { signedTransaction: options.signed },
              options.token,
            ),
          ),
        );
      },
    );
  intents
    .command('execution <intentId>')
    .description(
      'execution status: prepared transactions, attempts, fills and reconciliation evidence (a live attempt is reconciled on the way)',
    )
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/intents/${encodeURIComponent(intentId)}/execution`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('reconcile <intentId>')
    .description('reconcile a live attempt from chain evidence now')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/intents/${encodeURIComponent(intentId)}/execution/reconciliations`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  intents
    .command('verify-plan')
    .description(
      'offline: recompute the hash of a plan document and check its conservation and bounds without the API',
    )
    .option('--file <path>', 'plan JSON file')
    .option('--input <json>', 'plan JSON inline')
    .action(async (options: { file?: string; input?: string }) => {
      const parsed = executionPlanSchema.safeParse(await readContent(options));
      if (!parsed.success) {
        throw new CliExit(
          `not an execution plan: ${parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
          65,
        );
      }
      const plan = parsed.data;
      const { planHash, ...rest } = plan;
      const recomputed = planHashOf(rest);
      const legsSum = plan.allocation.legs.reduce((sum, leg) => sum + BigInt(leg.targetRaw), 0n);
      const allocationSum = legsSum + BigInt(plan.allocation.cash.targetRaw);
      const spend = plan.legs.reduce((sum, leg) => sum + BigInt(leg.maxInputRaw), 0n);
      const bounded =
        spend + BigInt(plan.bounds.residualCashRaw) === BigInt(plan.input.totalSpendRaw);
      io.out(
        json({
          planId: plan.planId,
          planHash,
          recomputed,
          matches: verifyPlanHash(plan),
          conserved: allocationSum === BigInt(plan.allocation.investableRaw),
          bounded,
          mode: plan.mode,
          grouping: plan.grouping.mode,
          legs: plan.legs.length,
          expiresAt: plan.validity.expiresAt,
          status: plan.status,
        }),
      );
    });
  const registry = program
    .command('registry')
    .description('on-chain strategy registry: status, records and publications');
  registry
    .command('status')
    .description('program id, network and indexer status of the deployment')
    .option(...apiUrlOption)
    .action(async (options: { url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/registry')));
    });
  registry
    .command('record <address>')
    .description('an indexed registry record (public)')
    .option(...apiUrlOption)
    .action(async (address: string, options: { url: string }) => {
      io.out(
        json(
          await apiCall(options.url, 'GET', `/v1/registry/records/${encodeURIComponent(address)}`),
        ),
      );
    });
  registry
    .command('public-version <strategyId> <versionId>')
    .description('the public view of a registered version with chain evidence and verification')
    .option(...apiUrlOption)
    .action(async (strategyId: string, versionId: string, options: { url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(versionId)}`,
          ),
        ),
      );
    });
  registry
    .command('publication <publicationId>')
    .description('a publication of yours, re-checked against the chain')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (publicationId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/publications/${encodeURIComponent(publicationId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  registry
    .command('submit <publicationId>')
    .description('submit the wallet-signed transaction (base64) of a prepared publication')
    .requiredOption('--signed <base64>', 'the signed transaction, base64')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (publicationId: string, options: { signed: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/publications/${encodeURIComponent(publicationId)}/submit`,
              { signedTransaction: options.signed },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('publish <strategyId>')
    .description(
      'prepare the on-chain registration of a frozen version: shows what becomes public and the unsigned transaction for your wallet',
    )
    .requiredOption('--version-id <versionId>', 'the frozen version to register')
    .requiredOption(
      '--wallet <walletId>',
      'a verified wallet of yours; it signs, pays and becomes the publisher',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        options: { versionId: string; wallet: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(options.versionId)}/publication`,
              { walletId: options.wallet },
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('publication <strategyId>')
    .description('the latest registration attempt of a version, re-checked against the chain')
    .requiredOption('--version-id <versionId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(
      async (strategyId: string, options: { versionId: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(options.versionId)}/publication`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  strategy
    .command('publish-demo <strategyId>')
    .description(
      'NONPRODUCTION: link an in-memory wallet, prepare, sign in-process, submit and follow a registration to its outcome',
    )
    .requiredOption('--version-id <versionId>', 'the frozen version to register')
    .requiredOption('--token <token>', 'user session token')
    .option(
      '--status <status>',
      'after registration, also change the record status (deprecated|active)',
    )
    .option('--wait-seconds <n>', 'how long to poll for finality', '30')
    .option(
      '--fixture-control <url>',
      'NONPRODUCTION fixture RPC control endpoint (scripts/dev/fixture-rpc.mjs): funds the demo wallet and finalizes submissions',
    )
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        options: {
          versionId: string;
          token: string;
          status?: string;
          waitSeconds: string;
          fixtureControl?: string;
          url: string;
        },
      ) => {
        const fixture = async (action: Record<string, unknown>) => {
          if (!options.fixtureControl) {
            return;
          }
          const response = await fetch(options.fixtureControl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(action),
          });
          if (!response.ok) {
            throw new CliExit(
              `fixture control refused ${String(action['action'])}`,
              EXIT_UNAVAILABLE,
            );
          }
        };
        const { generateKeyPairSync } = await import('node:crypto');
        const { encodeBase58 } = await import('@markov/contracts');
        const { base64ToBytes, bytesToBase64, signerFromPrivateKey, signTransaction } =
          await import('@markov/registry');
        const signer = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
        const challenge = (await apiCall(
          options.url,
          'POST',
          '/v1/me/wallets/challenges',
          { address: signer.publicKey },
          options.token,
        )) as { challengeId: string; message: string };
        const link = (await apiCall(
          options.url,
          'POST',
          '/v1/me/wallets',
          {
            challengeId: challenge.challengeId,
            address: signer.publicKey,
            signature: encodeBase58(signer.sign(new TextEncoder().encode(challenge.message))),
          },
          options.token,
        )) as { walletId: string };
        await fixture({ action: 'fund', address: signer.publicKey, lamports: 20_000_000 });
        io.err(
          `demo wallet ${signer.publicKey} linked as ${link.walletId}${options.fixtureControl ? ' and funded on the fixture ledger' : '; it must hold rent and fees on the cluster'}`,
        );
        const versionPath = `/v1/me/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(options.versionId)}`;
        const follow = async (
          prepared: {
            publicationId: string;
            state: string;
            transaction: { unsignedTransaction: string } | null;
          },
          label: string,
        ) => {
          let publication = prepared;
          if (publication.state === 'awaiting_signature' && publication.transaction) {
            const signed = signTransaction(
              base64ToBytes(publication.transaction.unsignedTransaction),
              signer,
            );
            publication = (await apiCall(
              options.url,
              'POST',
              `/v1/me/publications/${encodeURIComponent(prepared.publicationId)}/submit`,
              { signedTransaction: bytesToBase64(signed.bytes) },
              options.token,
            )) as typeof prepared;
            io.err(`${label}: submitted ${signed.signature}`);
            await fixture({ action: 'finalize' });
          }
          const deadline = Date.now() + Number(options.waitSeconds) * 1000;
          while (
            (publication.state === 'submitted' || publication.state === 'unknown') &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            publication = (await apiCall(
              options.url,
              'GET',
              `/v1/me/publications/${encodeURIComponent(prepared.publicationId)}`,
              undefined,
              options.token,
            )) as typeof prepared;
          }
          io.err(`${label}: ${publication.state}`);
          return publication;
        };
        const prepared = (await apiCall(
          options.url,
          'POST',
          `${versionPath}/publication`,
          { walletId: link.walletId },
          options.token,
        )) as Parameters<typeof follow>[0];
        const registration = await follow(prepared, 'registration');
        let statusChange: unknown = null;
        if (options.status && registration.state === 'registered') {
          const change = (await apiCall(
            options.url,
            'POST',
            `${versionPath}/status-changes`,
            { walletId: link.walletId, status: options.status },
            options.token,
          )) as Parameters<typeof follow>[0];
          statusChange = await follow(change, `status change to ${options.status}`);
        }
        io.err(
          'the private key of this demo wallet existed only in this process and is now discarded',
        );
        io.out(json({ wallet: signer.publicKey, registration, statusChange }));
      },
    );

  const instance = program
    .command('instance')
    .description('portfolio instances: a pinned version in a verified wallet');
  instance
    .command('create')
    .requiredOption('--strategy <strategyId>')
    .requiredOption('--version-id <versionId>', 'explicit version id')
    .requiredOption('--wallet <walletId>', 'a verified wallet of the signed-in person')
    .option('--label <text>')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (options: {
        strategy: string;
        versionId: string;
        wallet: string;
        label?: string;
        token: string;
        url: string;
      }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/instances',
              {
                strategyId: options.strategy,
                versionId: options.versionId,
                walletId: options.wallet,
                label: options.label ?? null,
              },
              options.token,
            ),
          ),
        );
      },
    );
  instance
    .command('list')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me/instances', undefined, options.token)));
    });
  instance
    .command('pin <instanceId>')
    .description('accept a version for an instance; the only way a pin moves')
    .requiredOption('--version-id <versionId>', 'explicit version id')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(
      async (instanceId: string, options: { versionId: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/instances/${encodeURIComponent(instanceId)}/pin`,
              { versionId: options.versionId },
              options.token,
            ),
          ),
        );
      },
    );

  const portfolio = program
    .command('portfolio')
    .description('the quantity journal, reconciled wallet holdings and strategy attribution (B12)');
  portfolio
    .command('holdings <walletId>')
    .description(
      'wallet holdings: the journal against the last chain observation, with attribution',
    )
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (walletId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/wallets/${encodeURIComponent(walletId)}/holdings`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  portfolio
    .command('reconcile <walletId>')
    .description(
      'read the wallet from the chain now, record a checkpoint and flag any unexplained external flow',
    )
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (walletId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/wallets/${encodeURIComponent(walletId)}/reconciliations`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  portfolio
    .command('journal <walletId>')
    .description('the append-only quantity journal of a wallet, oldest first')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (walletId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/wallets/${encodeURIComponent(walletId)}/journal`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  portfolio
    .command('project')
    .description('project your settled fills into the journal now (idempotent)')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/journal/projections',
            undefined,
            options.token,
          ),
        ),
      );
    });
  portfolio
    .command('acknowledge <entryId>')
    .description('explain an external flow: deposit | withdrawal | transfer | other')
    .requiredOption('--kind <kind>', 'deposit | withdrawal | transfer | other')
    .option('--note <text>', 'a short note kept with the entry')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (
        entryId: string,
        options: { kind: string; note?: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/journal/${encodeURIComponent(entryId)}/acknowledgements`,
              { kind: options.kind, note: options.note ?? null },
              options.token,
            ),
          ),
        );
      },
    );
  portfolio
    .command('instance-holdings <instanceId>')
    .description('the open lots attributed to a strategy instance (FIFO bookkeeping)')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (instanceId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/instances/${encodeURIComponent(instanceId)}/holdings`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const receipts = program
    .command('receipts')
    .description(
      'signed receipts for reviewed decisions and executions, and their verification (B12)',
    );
  receipts
    .command('issue <intentId>')
    .description('issue (or fetch) the receipt of an intent: --kind decision | execution')
    .option('--kind <kind>', 'decision | execution', 'execution')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(async (intentId: string, options: { kind: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/intents/${encodeURIComponent(intentId)}/receipts`,
            { kind: options.kind },
            options.token,
          ),
        ),
      );
    });
  receipts
    .command('list')
    .description('your receipts, newest first')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me/receipts', undefined, options.token)));
    });
  receipts
    .command('show <receiptId>')
    .description('one receipt: complete with a token of its owner, redacted when public')
    .option('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (receiptId: string, options: { token?: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/receipts/${encodeURIComponent(receiptId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  receipts
    .command('visibility <receiptId>')
    .description('opt a receipt into (--public) or out of (--private) public reading')
    .option('--public', 'readable by anyone with the id, owner and actor redacted')
    .option('--private', 'readable by you and your read-scoped agents only')
    .requiredOption('--token <token>', 'user session token')
    .option(...apiUrlOption)
    .action(
      async (
        receiptId: string,
        options: { public?: boolean; private?: boolean; token: string; url: string },
      ) => {
        if (options.public === options.private) {
          throw new CliExit('pass exactly one of --public or --private', EXIT_USAGE);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/receipts/${encodeURIComponent(receiptId)}/visibility`,
              { public: options.public === true },
              options.token,
            ),
          ),
        );
      },
    );
  receipts
    .command('keys')
    .description('the public verification keys (no token needed)')
    .option(...apiUrlOption)
    .action(async (options: { url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/receipts/keys')));
    });
  receipts
    .command('verify')
    .description(
      'verify a receipt against the verification keys: --keys-file for an offline check, otherwise the keys are fetched from the API',
    )
    .option('--file <path>', 'receipt JSON file')
    .option('--input <json>', 'receipt JSON inline')
    .option('--keys-file <path>', 'a saved GET /v1/receipts/keys answer (offline)')
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; keysFile?: string; url: string }) => {
      const { receiptKeysResponseSchema, receiptSchema } = await import('@markov/contracts');
      const { verifyReceipt } = await import('@markov/accounting');
      const receipt = receiptSchema.safeParse(await readContent(options));
      if (!receipt.success) {
        throw new CliExit(
          `not a receipt: ${receipt.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
          65,
        );
      }
      let keysDocument: unknown;
      if (options.keysFile) {
        const { readFile } = await import('node:fs/promises');
        keysDocument = JSON.parse(await readFile(options.keysFile, 'utf8'));
      } else {
        keysDocument = await apiCall(options.url, 'GET', '/v1/receipts/keys');
      }
      const keys = receiptKeysResponseSchema.safeParse(keysDocument);
      if (!keys.success) {
        throw new CliExit('the verification keys document is not in the expected shape', 65);
      }
      const result = verifyReceipt(receipt.data, keys.data.keys);
      io.out(
        json({
          receiptId: receipt.data.body.receiptId,
          kind: receipt.data.body.kind,
          intentId: receipt.data.body.subject.intentId,
          planHash: receipt.data.body.hashes.planHash,
          canonicalHash: receipt.data.canonicalHash,
          signatures: receipt.data.body.chain.signatures,
          ...result,
        }),
      );
      if (!result.valid) {
        throw new CliExit(`receipt verification failed: ${result.issues.join(', ')}`, 1);
      }
    });

  const performance = program
    .command('performance')
    .description(
      'valuation series, cash-flow-aware returns, drawdown, turnover, completeness and model rankings (B13)',
    );
  const periodOption = ['--period <period>', '7d | 30d | 90d | 365d | all', 'all'] as const;
  performance
    .command('instance <instanceId>')
    .description('actual performance of a strategy instance (its lots and their flows)')
    .option(...periodOption)
    .option(
      '--export',
      'the complete record behind the answer (observations, multipliers, every window)',
    )
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(
      async (
        instanceId: string,
        options: { period: string; export?: boolean; token: string; url: string },
      ) => {
        const path = `/v1/me/instances/${encodeURIComponent(instanceId)}/performance`;
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              options.export
                ? `${path}/export`
                : `${path}?period=${encodeURIComponent(options.period)}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  performance
    .command('wallet <walletId>')
    .description('actual performance of a verified wallet (deposits and withdrawals as flows)')
    .option(...periodOption)
    .option('--export', 'the complete record behind the answer')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(
      async (
        walletId: string,
        options: { period: string; export?: boolean; token: string; url: string },
      ) => {
        const path = `/v1/me/wallets/${encodeURIComponent(walletId)}/performance`;
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              options.export
                ? `${path}/export`
                : `${path}?period=${encodeURIComponent(options.period)}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  performance
    .command('version <strategyId> <versionNumber>')
    .description('model performance of a version: the recipe held from its start, no costs')
    .option(...periodOption)
    .option('--export', 'the complete record behind the answer')
    .option('--token <token>', 'user session (needed for an unpublished version of your own)')
    .option(...apiUrlOption)
    .action(
      async (
        strategyId: string,
        versionNumber: string,
        options: { period: string; export?: boolean; token?: string; url: string },
      ) => {
        const path = `/v1/strategies/${encodeURIComponent(strategyId)}/versions/${encodeURIComponent(versionNumber)}/performance`;
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              options.export
                ? `${path}/export`
                : `${path}?period=${encodeURIComponent(options.period)}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  performance
    .command('rankings')
    .description(
      'model-series ranking of published versions; incomplete histories are listed unranked',
    )
    .option('--period <period>', '30d | 90d | 365d', '30d')
    .option('--limit <n>', 'at most this many entries', '50')
    .option(...apiUrlOption)
    .action(async (options: { period: string; limit: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/rankings/model?period=${encodeURIComponent(options.period)}&limit=${encodeURIComponent(options.limit)}`,
          ),
        ),
      );
    });
  performance
    .command('methodology')
    .description('the performance methodology in force')
    .option(...apiUrlOption)
    .action(async (options: { url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/performance/methodology')));
    });

  const discovery = program
    .command('discovery')
    .description(
      'the public strategy explorer with chain provenance and methodology-aware ranking entries, creator pages and follows (B14)',
    );
  discovery
    .command('explore')
    .description(
      'list public strategies: one row per active strategy with a registered, unwithheld version; unranked rows carry the reason and no return',
    )
    .option('--q <text>', 'match the title, thesis, a constituent symbol or company name')
    .option('--issuer <issuer>', 'prestocks | xstocks | tessera')
    .option('--instrument <instrumentId>', 'strategies holding this instrument')
    .option('--creator <wallet>', 'strategies whose newest public version this wallet registered')
    .option('--period <period>', '30d | 90d | 365d', '30d')
    .option('--sort <sort>', 'rank | newest | followers', 'rank')
    .option('--limit <n>', 'rows per page (at most 100)', '25')
    .option('--cursor <cursor>', 'continue from the previous page')
    .option(...apiUrlOption)
    .action(
      async (options: {
        q?: string;
        issuer?: string;
        instrument?: string;
        creator?: string;
        period: string;
        sort: string;
        limit: string;
        cursor?: string;
        url: string;
      }) => {
        const query = new URLSearchParams();
        for (const [key, value] of [
          ['q', options.q],
          ['issuer', options.issuer],
          ['instrumentId', options.instrument],
          ['creator', options.creator],
          ['period', options.period],
          ['sort', options.sort],
          ['limit', options.limit],
          ['cursor', options.cursor],
        ] as const) {
          if (value !== undefined) {
            query.set(key, value);
          }
        }
        io.out(json(await apiCall(options.url, 'GET', `/v1/strategies?${query.toString()}`)));
      },
    );
  discovery
    .command('creator <publisherWallet>')
    .description(
      'a creator page: the strategies whose newest public version this wallet registered, from chain records only',
    )
    .option('--period <period>', '30d | 90d | 365d', '30d')
    .option(...apiUrlOption)
    .action(async (publisherWallet: string, options: { period: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/creators/${encodeURIComponent(publisherWallet)}?period=${encodeURIComponent(options.period)}`,
          ),
        ),
      );
    });
  discovery
    .command('follows')
    .description('the public strategies you follow, newest follow first')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/me/follows', undefined, options.token)));
    });
  discovery
    .command('follow <strategyId>')
    .description('follow a public strategy: bookkeeping on your account, never a pin or an order')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(async (strategyId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'PUT',
            `/v1/me/follows/${encodeURIComponent(strategyId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  discovery
    .command('unfollow <strategyId>')
    .description('stop following a strategy')
    .requiredOption('--token <token>', 'user session')
    .option(...apiUrlOption)
    .action(async (strategyId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'DELETE',
            `/v1/me/follows/${encodeURIComponent(strategyId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const prices = program
    .command('prices')
    .description('recorded reference price observations: never quotes (B13)');
  prices
    .command('record')
    .description('operator: record a reference price observation with its evidence')
    .option('--instrument <instrumentId>', 'the instrument observed (omit for SOL)')
    .option('--sol', 'record a SOL observation')
    .requiredOption(
      '--kind <kind>',
      'secondary_market | issuer_mark | underlying_equity | implied_valuation',
    )
    .requiredOption('--value <decimal>', 'the observed price, decimal string')
    .option('--unit <unit>', 'the price unit', 'USD')
    .requiredOption('--observed-at <iso>', 'when the price was observed (ISO 8601)')
    .requiredOption('--source <source>', 'secret-free source name')
    .option('--evidence <key=value...>', 'evidence references')
    .requiredOption('--token <token>', 'operator credential (ops:catalog:write)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        instrument?: string;
        sol?: boolean;
        kind: string;
        value: string;
        unit: string;
        observedAt: string;
        source: string;
        evidence?: string[];
        token: string;
        url: string;
      }) => {
        const evidence: Record<string, string> = {};
        for (const item of options.evidence ?? []) {
          const separator = item.indexOf('=');
          if (separator > 0) {
            evidence[item.slice(0, separator)] = item.slice(separator + 1);
          }
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/operator/prices/observations',
              {
                ...(options.sol ? { asset: 'SOL' } : { instrumentId: options.instrument }),
                kind: options.kind,
                value: options.value,
                unit: options.unit,
                observedAt: options.observedAt,
                source: options.source,
                evidence,
              },
              options.token,
            ),
          ),
        );
      },
    );
  prices
    .command('history <instrumentId>')
    .description('recorded observations of an instrument (or "sol")')
    .option('--from <iso>')
    .option('--to <iso>')
    .option('--limit <n>', 'at most this many', '500')
    .option('--token <token>', 'operator credential to read a non-public instrument')
    .option(...apiUrlOption)
    .action(
      async (
        instrumentId: string,
        options: { from?: string; to?: string; limit: string; token?: string; url: string },
      ) => {
        const query = new URLSearchParams({ limit: options.limit });
        if (options.from) {
          query.set('from', options.from);
        }
        if (options.to) {
          query.set('to', options.to);
        }
        const path =
          instrumentId.toLowerCase() === 'sol'
            ? '/v1/prices/sol'
            : `/v1/catalog/instruments/${encodeURIComponent(instrumentId)}/prices`;
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `${path}?${query.toString()}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );

  const agent = program
    .command('agent')
    .description(
      'typed agent tools: the catalog a credential may call and one call per tool, with the caller’s own authority (B15)',
    );
  agent
    .command('tools')
    .description('the tools this credential may call, with their JSON Schemas and required scopes')
    .requiredOption('--token <token>', 'user session or agent credential')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(json(await apiCall(options.url, 'GET', '/v1/agent/tools', undefined, options.token)));
    });
  agent
    .command('call <tool>')
    .description(
      'invoke one tool, for example instruments.search or investment.propose; the input is JSON validated against the tool schema',
    )
    .option('--input <json>', 'the tool input as a JSON object', '{}')
    .requiredOption('--token <token>', 'user session or agent credential holding the tool’s scopes')
    .option(...apiUrlOption)
    .action(async (tool: string, options: { input: string; token: string; url: string }) => {
      let input: unknown;
      try {
        input = JSON.parse(options.input);
      } catch {
        throw new CliExit('--input must be a JSON object', 2);
      }
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/agent/tools/${encodeURIComponent(tool)}`,
            input,
            options.token,
          ),
        ),
      );
    });

  const companionCommand = program
    .command('companion')
    .description(
      'bounded companion runs: a model drives the caller’s tools under a budget; every call is validated and recorded (B15)',
    );
  companionCommand
    .command('ask <question>')
    .description(
      'run the companion; the answer is text to review and anything to act on is a proposal',
    )
    .option(
      '--thesis <thesisId>',
      'a thesis you own: title, claim and fetched excerpts are shown to the model',
    )
    .option(
      '--instance <instanceId>',
      'an instance you own: its label and pinned version are shown',
    )
    .option('--strategy <strategyId>', 'a strategy you own')
    .option('--instrument <instrumentId...>', 'public instruments to show (at most 6)')
    .option('--max-tool-calls <n>', 'tool-call budget (0..12)', '6')
    .option('--max-chars <n>', 'answer budget in characters (200..4000)', '1500')
    .option('--max-cost-micros <n>', 'cost budget in micros', '200000')
    .requiredOption('--token <token>', 'user session or agent credential (research:read at least)')
    .option(...apiUrlOption)
    .action(
      async (
        question: string,
        options: {
          thesis?: string;
          instance?: string;
          strategy?: string;
          instrument?: string[];
          maxToolCalls: string;
          maxChars: string;
          maxCostMicros: string;
          token: string;
          url: string;
        },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/me/companion/runs',
              {
                question,
                context: {
                  thesisId: options.thesis ?? null,
                  instanceId: options.instance ?? null,
                  strategyId: options.strategy ?? null,
                  instrumentIds: options.instrument ?? [],
                },
                budget: {
                  maxToolCalls: Number.parseInt(options.maxToolCalls, 10),
                  maxOutputChars: Number.parseInt(options.maxChars, 10),
                  maxCostMicros: Number.parseInt(options.maxCostMicros, 10),
                },
              },
              options.token,
            ),
          ),
        );
      },
    );
  companionCommand
    .command('runs')
    .description('your companion runs, newest first')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(await apiCall(options.url, 'GET', '/v1/me/companion/runs', undefined, options.token)),
      );
    });
  companionCommand
    .command('run <runId>')
    .description('status, redacted provenance and validated output of one run')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (runId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/companion/runs/${encodeURIComponent(runId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  companionCommand
    .command('cancel <runId>')
    .description('cancel a queued or running run; a finished run is unchanged')
    .requiredOption('--token <token>', 'user session or agent credential (research:read)')
    .option(...apiUrlOption)
    .action(async (runId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/companion/runs/${encodeURIComponent(runId)}/cancel`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const proposals = program
    .command('proposals')
    .description(
      'proposals created by tools or the companion; only the owner’s own session opens or dismisses one (B15)',
    );
  proposals
    .command('list')
    .option('--status <status>', 'proposed | opened | dismissed | expired')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { status?: string; token: string; url: string }) => {
      const query = options.status ? `?status=${encodeURIComponent(options.status)}` : '';
      io.out(
        json(
          await apiCall(options.url, 'GET', `/v1/me/proposals${query}`, undefined, options.token),
        ),
      );
    });
  proposals
    .command('show <proposalId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (proposalId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/proposals/${encodeURIComponent(proposalId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  proposals
    .command('open <proposalId>')
    .description(
      'open a proposal as the owner: an investment proposal becomes an ordinary intent that still needs a plan, your acknowledgement and your wallet signature',
    )
    .requiredOption('--token <token>', 'user session (agents are refused)')
    .option(...apiUrlOption)
    .action(async (proposalId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/proposals/${encodeURIComponent(proposalId)}/open`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  proposals
    .command('dismiss <proposalId>')
    .requiredOption('--token <token>', 'user session (agents are refused)')
    .option(...apiUrlOption)
    .action(async (proposalId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/proposals/${encodeURIComponent(proposalId)}/dismiss`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  program
    .command('events')
    .description(
      'the owner’s Mark I event log (proposal.created, review.required, execution.*, data.stale, device.revoked), resumable by sequence (B15)',
    )
    .option('--after <seq>', 'events after this sequence', '0')
    .option('--limit <n>', 'at most this many (100)', '50')
    .option('--kind <kind>', 'one event kind')
    .requiredOption('--token <token>', 'user session or paired device (status:read)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        after: string;
        limit: string;
        kind?: string;
        token: string;
        url: string;
      }) => {
        const query = new URLSearchParams({ after: options.after, limit: options.limit });
        if (options.kind) {
          query.set('kind', options.kind);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `/v1/me/events?${query.toString()}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );

  // --- B16: schedules, notifications, mandate dry run and maintenance passes.
  const jsonRequest = async (
    options: { file?: string; input?: string },
    what: string,
  ): Promise<unknown> => {
    if (options.file) {
      const { readFile } = await import('node:fs/promises');
      try {
        return JSON.parse(await readFile(options.file, 'utf8')) as unknown;
      } catch (error) {
        throw new CliExit(
          `${what}: could not read ${options.file} as JSON (${error instanceof Error ? error.message : String(error)})`,
          EXIT_USAGE,
        );
      }
    }
    if (options.input) {
      try {
        return JSON.parse(options.input) as unknown;
      } catch {
        throw new CliExit(`${what} must be valid JSON`, EXIT_USAGE);
      }
    }
    throw new CliExit(`provide --file <path> or --input <json> with ${what}`, EXIT_USAGE);
  };
  const ownerToken = ['--token <token>', 'user session'] as const;

  const schedules = program
    .command('schedules')
    .description(
      'recurring investment and drift-rebalance schedules: every occurrence prepares a proposal for the owner’s review and nothing is bought or sold unattended (B16)',
    );
  schedules
    .command('create')
    .description(
      'create a schedule from a JSON request: kind recurring_investment or drift_rebalance, cadence with a time zone, target and review window; the mode is always prepare_for_approval',
    )
    .option('--file <path>', 'JSON request file')
    .option('--input <json>', 'JSON request inline')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/schedules',
            await jsonRequest(options, 'the schedule request'),
            options.token,
          ),
        ),
      );
    });
  schedules
    .command('preview')
    .description(
      'preview the next occurrences of a cadence (JSON: cadence, startAt, count) with their local wall-clock times and UTC offsets',
    )
    .option('--file <path>', 'JSON request file')
    .option('--input <json>', 'JSON request inline')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/schedules/preview',
            await jsonRequest(options, 'the preview request'),
            options.token,
          ),
        ),
      );
    });
  schedules
    .command('list')
    .option('--status <status>', 'active | paused | cancelled | revoked')
    .option('--limit <n>', 'at most this many, newest first', '50')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (options: { status?: string; limit: string; token: string; url: string }) => {
      const query = new URLSearchParams({ limit: options.limit });
      if (options.status) {
        query.set('status', options.status);
      }
      const suffix = `?${query.toString()}`;
      io.out(
        json(
          await apiCall(options.url, 'GET', `/v1/me/schedules${suffix}`, undefined, options.token),
        ),
      );
    });
  schedules
    .command('show <scheduleId>')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (scheduleId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/schedules/${encodeURIComponent(scheduleId)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  schedules
    .command('update <scheduleId>')
    .description(
      'change label, cadence, window, missed-run policy or target of an active or paused schedule',
    )
    .option('--file <path>', 'JSON request file')
    .option('--input <json>', 'JSON request inline')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(
      async (
        scheduleId: string,
        options: { file?: string; input?: string; token: string; url: string },
      ) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'PATCH',
              `/v1/me/schedules/${encodeURIComponent(scheduleId)}`,
              await jsonRequest(options, 'the update request'),
              options.token,
            ),
          ),
        );
      },
    );
  for (const transition of ['pause', 'resume', 'cancel'] as const) {
    schedules
      .command(`${transition} <scheduleId>`)
      .description(
        transition === 'pause'
          ? 'pause: nothing is prepared until resumed; occurrences missed meanwhile follow the missed-run policy'
          : transition === 'resume'
            ? 'resume a paused schedule from its next occurrence'
            : 'cancel for good; open proposals stay open for their review window',
      )
      .requiredOption(...ownerToken)
      .option(...apiUrlOption)
      .action(async (scheduleId: string, options: { token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/me/schedules/${encodeURIComponent(scheduleId)}/${transition}`,
              undefined,
              options.token,
            ),
          ),
        );
      });
  }
  schedules
    .command('occurrences <scheduleId>')
    .description(
      'what each occurrence did: proposed (with its proposal), skipped, failed, expired, opened or dismissed',
    )
    .option('--limit <n>', 'at most this many, newest first', '50')
    .requiredOption('--token <token>', 'user session or agent credential (portfolio:read)')
    .option(...apiUrlOption)
    .action(async (scheduleId: string, options: { limit: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/me/schedules/${encodeURIComponent(scheduleId)}/occurrences?limit=${encodeURIComponent(options.limit)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });

  const notificationsCommand = program
    .command('notifications')
    .description(
      'the owner’s durable in-app notifications, email preferences with verification, and operator dead-letter recovery (B16)',
    );
  notificationsCommand
    .command('list')
    .option('--after <seq>', 'notifications after this sequence', '0')
    .option('--limit <n>', 'at most this many (100)', '50')
    .option('--unread', 'unread only')
    .option('--category <category>', 'proposals | execution | schedules | data | security')
    .requiredOption('--token <token>', 'user session or paired device (notifications:receive)')
    .option(...apiUrlOption)
    .action(
      async (options: {
        after: string;
        limit: string;
        unread?: boolean;
        category?: string;
        token: string;
        url: string;
      }) => {
        const query = new URLSearchParams({ after: options.after, limit: options.limit });
        if (options.unread) {
          query.set('unread', 'true');
        }
        if (options.category) {
          query.set('category', options.category);
        }
        io.out(
          json(
            await apiCall(
              options.url,
              'GET',
              `/v1/me/notifications?${query.toString()}`,
              undefined,
              options.token,
            ),
          ),
        );
      },
    );
  notificationsCommand
    .command('read <notificationId>')
    .requiredOption('--token <token>', 'user session or paired device (notifications:receive)')
    .option(...apiUrlOption)
    .action(async (notificationId: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            `/v1/me/notifications/${encodeURIComponent(notificationId)}/read`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  notificationsCommand
    .command('read-all')
    .requiredOption('--token <token>', 'user session or paired device (notifications:receive)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/notifications/read-all',
            undefined,
            options.token,
          ),
        ),
      );
    });
  notificationsCommand
    .command('preferences')
    .description(
      'show the owner’s preferences, or replace category settings from JSON ({"categories":{"proposals":{"inApp":true,"email":true}}})',
    )
    .option('--file <path>', 'JSON update file')
    .option('--input <json>', 'JSON update inline')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; token: string; url: string }) => {
      if (options.file || options.input) {
        io.out(
          json(
            await apiCall(
              options.url,
              'PUT',
              '/v1/me/notification-preferences',
              await jsonRequest(options, 'the preferences update'),
              options.token,
            ),
          ),
        );
        return;
      }
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            '/v1/me/notification-preferences',
            undefined,
            options.token,
          ),
        ),
      );
    });
  const emailCommand = notificationsCommand
    .command('email')
    .description('the address notifications may be emailed to, confirmed by a code sent to it');
  emailCommand
    .command('set <address>')
    .description('set the address; a six-digit code goes to it when a provider is configured')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (address: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/notification-preferences/email',
            { address },
            options.token,
          ),
        ),
      );
    });
  emailCommand
    .command('verify <code>')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (code: string, options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/notification-preferences/email/verify',
            { code },
            options.token,
          ),
        ),
      );
    });
  emailCommand
    .command('clear')
    .description('remove the address; every email stops at once')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'DELETE',
            '/v1/me/notification-preferences/email',
            undefined,
            options.token,
          ),
        ),
      );
    });
  notificationsCommand
    .command('dead-letter')
    .description('deliveries that exhausted their retries (operator ops:read)')
    .option('--limit <n>', 'at most this many', '50')
    .requiredOption('--token <token>', 'operator credential (ops:read)')
    .option(...apiUrlOption)
    .action(async (options: { limit: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            `/v1/ops/notifications/dead-letter?limit=${encodeURIComponent(options.limit)}`,
            undefined,
            options.token,
          ),
        ),
      );
    });
  notificationsCommand
    .command('retry <notificationId>')
    .description(
      'requeue one dead or failed delivery after the cause is fixed (operator ops:maintenance:run)',
    )
    .option('--channel <channel>', 'email | in_app', 'email')
    .requiredOption('--token <token>', 'operator credential (ops:maintenance:run)')
    .option(...apiUrlOption)
    .action(
      async (notificationId: string, options: { channel: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              `/v1/ops/notifications/${encodeURIComponent(notificationId)}/retry`,
              { channel: options.channel },
              options.token,
            ),
          ),
        );
      },
    );
  notificationsCommand
    .command('fixture-outbox')
    .description(
      'what the fixture email provider would have sent (operator ops:read; local and test only, NOT_FOUND with any other provider)',
    )
    .requiredOption('--token <token>', 'operator credential (ops:read)')
    .option(...apiUrlOption)
    .action(async (options: { token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'GET',
            '/v1/ops/notifications/fixture-outbox',
            undefined,
            options.token,
          ),
        ),
      );
    });

  const mandates = program
    .command('mandates')
    .description(
      'mandate dry run: evaluates a bounded mandate envelope against one action deterministically; unattended execution stays DISABLED (B16)',
    );
  mandates
    .command('dry-run')
    .description(
      'JSON: { mandate, action, usage? }; the answer lists every check and changes nothing',
    )
    .option('--file <path>', 'JSON request file')
    .option('--input <json>', 'JSON request inline')
    .requiredOption(...ownerToken)
    .option(...apiUrlOption)
    .action(async (options: { file?: string; input?: string; token: string; url: string }) => {
      io.out(
        json(
          await apiCall(
            options.url,
            'POST',
            '/v1/me/mandates/dry-run',
            await jsonRequest(options, 'the dry-run request'),
            options.token,
          ),
        ),
      );
    });

  const maintenanceCommand = program
    .command('maintenance')
    .description(
      'maintenance passes: the worker’s durable loop asks the API for one pass per tick; a worker or operator credential can ask for one by hand (B16)',
    );
  maintenanceCommand
    .command('run')
    .description(
      'run one pass now: due occurrences become proposals or are skipped, review windows expire, notifications are projected and delivered; idempotent per occurrence',
    )
    .option('--batch-size <n>', 'schedules per pass (1..500)', '100')
    .option('--requested-by <who>', 'recorded on the pass', 'markov-cli')
    .requiredOption(
      '--token <token>',
      'worker credential (maintenance:run) or operator credential (ops:maintenance:run)',
    )
    .option(...apiUrlOption)
    .action(
      async (options: { batchSize: string; requestedBy: string; token: string; url: string }) => {
        io.out(
          json(
            await apiCall(
              options.url,
              'POST',
              '/v1/ops/maintenance/run',
              {
                batchSize: Number.parseInt(options.batchSize, 10),
                requestedBy: options.requestedBy,
              },
              options.token,
            ),
          ),
        );
      },
    );

  return program;
}
