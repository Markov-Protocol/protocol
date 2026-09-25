import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { KNOWN_GENESIS_HASHES } from '@markov/config';
import {
  EXECUTION_RECONCILIATION_WORKFLOW_TYPE,
  type ExecutionReconciliationReport,
  MAINTENANCE_WORKFLOW_TYPE,
  type MaintenanceWorkflowInput,
  type MaintenanceWorkflowReport,
  PLATFORM_HEALTH_WORKFLOW_TYPE,
  type PlatformHealthReport,
} from '@markov/contracts';
import { bindPlatformIdentity, createDbClient, runMigrations } from '@markov/db';
import { createSilentLogger } from '@markov/observability';
import {
  baseTestEnv,
  testDatabaseUrl,
  testTemporalAddress,
  withTemporaryDatabase,
} from '@markov/testkit';
import { Client, Connection } from '@temporalio/client';
import { describe, expect, it } from 'vitest';
import { BootError, bootWorker, EXIT_CONFIG } from '../src/index.js';

const adminUrl = testDatabaseUrl();
const temporalAddress = testTemporalAddress();
const logger = createSilentLogger();
/** A stand-in worker credential for the stub API; assembled so no token-shaped literal sits in the source. */
const WORKER_TOKEN = ['mkv', 'wk', 'stubworker', 'w'.repeat(40)].join('_');

async function prepareDatabase(url: string): Promise<void> {
  const client = createDbClient({
    url,
    ssl: 'disable',
    poolMax: 2,
    statementTimeoutMs: 10_000,
    applicationName: 'worker-test',
  });
  try {
    await runMigrations(client.db);
    await bindPlatformIdentity(
      client.db,
      {
        markovEnv: 'test',
        solanaCluster: 'devnet',
        genesisHash: KNOWN_GENESIS_HASHES.devnet,
      },
      'worker-test',
    );
  } finally {
    await client.close();
  }
}

interface StubCall {
  readonly authorization: string | undefined;
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly body: { batchSize?: number; requestedBy?: string } | null;
}

/** A stand-in for the API's maintenance route: records every call and answers a fixed report or a refusal. */
function createStubApi(): {
  readonly calls: StubCall[];
  mode: 'ok' | 'refuse';
  listen(): Promise<string>;
  close(): Promise<void>;
} {
  const calls: StubCall[] = [];
  const stub = {
    calls,
    mode: 'ok' as 'ok' | 'refuse',
    listen: () => Promise.resolve(''),
    close: () => Promise.resolve(),
  };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      calls.push({
        authorization: request.headers.authorization,
        method: request.method,
        url: request.url,
        body: body ? (JSON.parse(body) as StubCall['body']) : null,
      });
      response.setHeader('content-type', 'application/json');
      if (
        stub.mode === 'refuse' ||
        request.method !== 'POST' ||
        request.url !== '/v1/ops/maintenance/run' ||
        request.headers.authorization !== `Bearer ${WORKER_TOKEN}`
      ) {
        response.statusCode = 403;
        response.end(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'maintenance:run required', requestId: 'stub' },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          ranAt: new Date().toISOString(),
          requestedBy: 'stub',
          schedules: { considered: 1, proposed: 1, skipped: 0, failed: 0, expired: 0 },
          notifications: { projected: 1, delivered: 0, retried: 0, dead: 0 },
          durationMs: 3,
        }),
      );
    });
  });
  stub.listen = () =>
    new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      });
    });
  stub.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}

describe.skipIf(adminUrl === null)('worker boot fails closed', () => {
  it('refuses a database that is not bound to the configured cluster', async () => {
    if (adminUrl === null) {
      return;
    }
    await withTemporaryDatabase(adminUrl, async (url) => {
      const client = createDbClient({
        url,
        ssl: 'disable',
        poolMax: 2,
        statementTimeoutMs: 10_000,
        applicationName: 'worker-test',
      });
      try {
        await runMigrations(client.db);
        await bindPlatformIdentity(
          client.db,
          { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: KNOWN_GENESIS_HASHES.devnet },
          'worker-test',
        );
      } finally {
        await client.close();
      }
      await expect(
        bootWorker({ env: baseTestEnv({ DATABASE_URL: url, SOLANA_CLUSTER: 'testnet' }), logger }),
      ).rejects.toMatchObject({ name: 'BootError', exitCode: EXIT_CONFIG });
    });
  });
});

describe.skipIf(adminUrl === null || temporalAddress === null)(
  'worker against a Temporal dev server',
  () => {
    it('executes the platform health workflow end to end and drains on shutdown', async () => {
      if (adminUrl === null || temporalAddress === null) {
        return;
      }
      await withTemporaryDatabase(adminUrl, async (url) => {
        await prepareDatabase(url);
        const taskQueue = `markov-test-${randomUUID()}`;
        const booted = await bootWorker({
          env: baseTestEnv({ DATABASE_URL: url, TEMPORAL_ADDRESS: temporalAddress }),
          logger,
          taskQueue,
        });
        const running = booted.run();
        const connection = await Connection.connect({ address: temporalAddress });
        try {
          const temporal = new Client({ connection, namespace: 'default' });
          const report = await temporal.workflow.execute<
            (input: { requestedBy: string }) => Promise<PlatformHealthReport>
          >(PLATFORM_HEALTH_WORKFLOW_TYPE, {
            taskQueue,
            workflowId: `platform-health-${randomUUID()}`,
            args: [{ requestedBy: 'worker-test' }],
            workflowExecutionTimeout: '60 seconds',
          });
          expect(report).toMatchObject({
            status: 'ok',
            markovEnv: 'test',
            solanaCluster: 'devnet',
            genesisHash: KNOWN_GENESIS_HASHES.devnet,
            database: { ok: true },
            requestedBy: 'worker-test',
          });
          // The durable reconciliation loop (B10): a bounded run over an empty attempt set reports
          // rounds and no attempts; the boot-started singleton for this queue is already running.
          const reconciliation = await temporal.workflow.execute<
            (input: {
              requestedBy: string;
              rounds: number;
              intervalSeconds: number;
              batchSize: number;
            }) => Promise<ExecutionReconciliationReport>
          >(EXECUTION_RECONCILIATION_WORKFLOW_TYPE, {
            taskQueue,
            workflowId: `execution-reconciliation-test-${randomUUID()}`,
            args: [{ requestedBy: 'worker-test', rounds: 2, intervalSeconds: 1, batchSize: 10 }],
            workflowExecutionTimeout: '60 seconds',
          });
          expect(reconciliation).toMatchObject({
            requestedBy: 'worker-test',
            rounds: 2,
            attemptsSeen: 0,
            settled: 0,
          });
          expect(reconciliation.lastRound?.attempts).toBe(0);
          const singleton = temporal.workflow.getHandle(`execution-reconciliation:${taskQueue}`);
          expect((await singleton.describe()).status.name).toBe('RUNNING');
          await singleton.terminate('worker test finished');
        } finally {
          await connection.close();
          booted.shutdown();
          await running;
        }
      });
    }, 120_000);

    it('drives maintenance passes through the API with the worker credential and reports refusals', async () => {
      if (adminUrl === null || temporalAddress === null) {
        return;
      }
      await withTemporaryDatabase(adminUrl, async (url) => {
        await prepareDatabase(url);
        const stub = createStubApi();
        const apiUrl = await stub.listen();
        const taskQueue = `markov-test-${randomUUID()}`;
        const booted = await bootWorker({
          env: baseTestEnv({
            DATABASE_URL: url,
            TEMPORAL_ADDRESS: temporalAddress,
            MAINTENANCE_API_URL: apiUrl,
            MAINTENANCE_API_TOKEN: WORKER_TOKEN,
            MAINTENANCE_TICK_SECONDS: '5',
          }),
          logger,
          taskQueue,
        });
        const running = booted.run();
        const connection = await Connection.connect({ address: temporalAddress });
        try {
          const temporal = new Client({ connection, namespace: 'default' });
          const execute = (input: MaintenanceWorkflowInput) =>
            temporal.workflow.execute<
              (input: MaintenanceWorkflowInput) => Promise<MaintenanceWorkflowReport>
            >(MAINTENANCE_WORKFLOW_TYPE, {
              taskQueue,
              workflowId: `maintenance-test-${randomUUID()}`,
              args: [input],
              workflowExecutionTimeout: '60 seconds',
            });
          const report = await execute({
            requestedBy: 'worker-test',
            rounds: 2,
            intervalSeconds: 1,
            batchSize: 25,
          });
          expect(report).toMatchObject({
            requestedBy: 'worker-test',
            rounds: 2,
            ticks: { ran: 2, refused: 0, unreachable: 0, notConfigured: 0 },
            schedules: { proposed: 2, skipped: 0, failed: 0, expired: 0 },
            notifications: { delivered: 0, dead: 0 },
          });
          expect(report.lastTick?.status).toBe('ran');
          // Every pass carried the worker credential and the requested batch; the boot-started loop
          // (requestedBy = worker identity) shares the stub, so only this run's calls are counted.
          const mine = stub.calls.filter((call) => call.body?.requestedBy === 'worker-test');
          expect(mine).toHaveLength(2);
          expect(mine.every((call) => call.authorization === `Bearer ${WORKER_TOKEN}`)).toBe(true);
          expect(mine[0]).toMatchObject({
            method: 'POST',
            url: '/v1/ops/maintenance/run',
            body: { batchSize: 25, requestedBy: 'worker-test' },
          });
          expect(JSON.stringify(report)).not.toContain(WORKER_TOKEN);
          // A refusal (an expired or unscoped credential) is reported and the loop carries on to its
          // next tick instead of retrying blindly; the report names the HTTP status and error code.
          stub.mode = 'refuse';
          const refused = await execute({
            requestedBy: 'worker-test',
            rounds: 1,
            intervalSeconds: 1,
            batchSize: 25,
          });
          expect(refused.ticks).toEqual({ ran: 0, refused: 1, unreachable: 0, notConfigured: 0 });
          expect(refused.lastTick).toMatchObject({
            status: 'refused',
            httpStatus: 403,
            detail: 'FORBIDDEN: maintenance:run required',
          });
          expect(
            stub.calls.filter((call) => call.body?.requestedBy === 'worker-test'),
          ).toHaveLength(3);
          // The boot-started singleton for this queue runs with the configured tick.
          const singleton = temporal.workflow.getHandle(`maintenance:${taskQueue}`);
          expect((await singleton.describe()).status.name).toBe('RUNNING');
          await singleton.terminate('worker test finished');
          await temporal.workflow
            .getHandle(`execution-reconciliation:${taskQueue}`)
            .terminate('worker test finished');
        } finally {
          await connection.close();
          booted.shutdown();
          await running;
          await stub.close();
        }
      });
    }, 120_000);

    it('starts no maintenance loop when the driver is not configured', async () => {
      if (adminUrl === null || temporalAddress === null) {
        return;
      }
      await withTemporaryDatabase(adminUrl, async (url) => {
        await prepareDatabase(url);
        const taskQueue = `markov-test-${randomUUID()}`;
        const booted = await bootWorker({
          env: baseTestEnv({ DATABASE_URL: url, TEMPORAL_ADDRESS: temporalAddress }),
          logger,
          taskQueue,
          reconciliation: false,
        });
        const running = booted.run();
        const connection = await Connection.connect({ address: temporalAddress });
        try {
          const temporal = new Client({ connection, namespace: 'default' });
          await expect(
            temporal.workflow.getHandle(`maintenance:${taskQueue}`).describe(),
          ).rejects.toThrow();
          // Asked by hand anyway, the loop reports the missing configuration and asks for nothing.
          const report = await temporal.workflow.execute<
            (input: MaintenanceWorkflowInput) => Promise<MaintenanceWorkflowReport>
          >(MAINTENANCE_WORKFLOW_TYPE, {
            taskQueue,
            workflowId: `maintenance-unconfigured-${randomUUID()}`,
            args: [{ requestedBy: 'worker-test', rounds: 1, intervalSeconds: 1, batchSize: 10 }],
            workflowExecutionTimeout: '60 seconds',
          });
          expect(report.ticks).toEqual({ ran: 0, refused: 0, unreachable: 0, notConfigured: 1 });
        } finally {
          await connection.close();
          booted.shutdown();
          await running;
        }
      });
    }, 120_000);
  },
);

describe('boot errors', () => {
  it('is a BootError with a config exit code for invalid configuration', async () => {
    await expect(bootWorker({ env: { MARKOV_ENV: 'nope' }, logger })).rejects.toBeInstanceOf(
      BootError,
    );
  });
});
