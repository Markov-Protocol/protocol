import { randomUUID } from 'node:crypto';
import { createEd25519TestWallet, generateCredential } from '@markov/auth';
import { describeConfig, type MarkovConfig, tryLoadConfig } from '@markov/config';
import {
  type HealthResponse,
  OPERATOR_SCOPES,
  PLATFORM_HEALTH_WORKFLOW_TYPE,
  type PlatformHealthReport,
  platformHealthReportSchema,
  type ReadinessResponse,
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
    .action(async (options: { token: string; url: string }) => {
      const wallet = createEd25519TestWallet();
      const challenge = (await apiCall(
        options.url,
        'POST',
        '/v1/me/wallets/challenges',
        { address: wallet.address },
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
          address: wallet.address,
          signature: wallet.sign(challenge.message),
        },
        options.token,
      );
      io.err(
        'the private key of this demo wallet existed only in this process and is now discarded',
      );
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

  return program;
}
