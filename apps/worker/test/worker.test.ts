import { randomUUID } from 'node:crypto';
import { KNOWN_GENESIS_HASHES } from '@markov/config';
import { PLATFORM_HEALTH_WORKFLOW_TYPE, type PlatformHealthReport } from '@markov/contracts';
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
