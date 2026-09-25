import { randomUUID } from 'node:crypto';
import { projectFills } from '@markov/accounting';
import type { MarkovConfig } from '@markov/config';
import {
  type ExecutionReconciliationInput,
  type ExecutionReconciliationRound,
  executionReconciliationInputSchema,
  executionReconciliationRoundSchema,
  type PlatformHealthInput,
  type PlatformHealthReport,
  platformHealthInputSchema,
  platformHealthReportSchema,
} from '@markov/contracts';
import {
  createExecutionStorePort,
  createProjectionStorePort,
  type DbClient,
  listLiveAttemptContexts,
  liveAttemptRowsOf,
} from '@markov/db';
import { liveAttemptFromRows, reconcileAttempt } from '@markov/execution';
import type { Logger } from '@markov/observability';
import type { SolanaRpcClient } from '@markov/solana-rpc';

export type {
  ExecutionReconciliationInput,
  ExecutionReconciliationReport,
  ExecutionReconciliationRound,
  PlatformHealthInput,
  PlatformHealthReport,
} from '@markov/contracts';

export interface PlatformActivities {
  reportPlatformHealth(input: PlatformHealthInput): Promise<PlatformHealthReport>;
  /** One reconciliation round over every live attempt: ask the node, decide, apply. */
  reconcileLiveAttempts(
    input: Pick<ExecutionReconciliationInput, 'batchSize'>,
  ): Promise<ExecutionReconciliationRound>;
  /** Projects settled fills of every owner into the accounting journal (idempotent; B12). */
  projectJournal(input: { readonly limit: number }): Promise<{
    readonly fillsSeen: number;
    readonly entriesAppended: number;
    readonly entriesExisting: number;
  }>;
}

export interface ActivityDependencies {
  readonly config: MarkovConfig;
  readonly dbClient: DbClient;
  readonly genesisHash: string;
  readonly rpc: SolanaRpcClient;
  readonly logger: Logger;
  readonly now?: () => Date;
}

/**
 * Activities are the only place workflow code touches the outside world.
 * Every input is validated against its contract before use. Reconciliation
 * never builds or signs: it observes signatures, resends the same bytes
 * while their blockhash lives and settles attempts on chain evidence only.
 */
export function createPlatformActivities(deps: ActivityDependencies): PlatformActivities {
  const now = deps.now ?? (() => new Date());
  const store = createExecutionStorePort(deps.dbClient.db);
  const log = deps.logger.child({ component: 'execution-reconciliation' });
  return {
    async reportPlatformHealth(rawInput) {
      const input = platformHealthInputSchema.parse(rawInput);
      const database = await deps.dbClient.ping();
      return platformHealthReportSchema.parse({
        status: 'ok',
        workerVersion: deps.config.serviceVersion,
        markovEnv: deps.config.markovEnv,
        solanaCluster: deps.config.solana.cluster,
        genesisHash: deps.genesisHash,
        database: { ok: database.ok, detail: database.detail, durationMs: database.durationMs },
        checkedAt: new Date().toISOString(),
        requestedBy: input.requestedBy,
      });
    },

    async projectJournal(input) {
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 1000);
      const report = await projectFills(
        {
          store: createProjectionStorePort(deps.dbClient.db),
          newId: randomUUID,
          now,
          onShortfall: (shortfall) =>
            log.warn(shortfall, 'a sell consumed more than its attributed lots hold'),
        },
        { ownerUserId: null, limit },
      );
      if (report.entriesAppended > 0) {
        log.info(report, 'journal projection appended entries');
      }
      return {
        fillsSeen: report.fillsSeen,
        entriesAppended: report.entriesAppended,
        entriesExisting: report.entriesExisting,
      };
    },

    async reconcileLiveAttempts(rawInput) {
      const input = executionReconciliationInputSchema
        .pick({ batchSize: true })
        .parse(rawInput ?? {});
      const at = now();
      const contexts = await listLiveAttemptContexts(deps.dbClient.db, input.batchSize);
      const outcomes: ExecutionReconciliationRound['outcomes'] = [];
      for (const context of contexts) {
        const live = liveAttemptFromRows(liveAttemptRowsOf(context));
        if (live === null) {
          continue;
        }
        try {
          const outcome = await reconcileAttempt({ rpc: deps.rpc, store, now: () => at }, live);
          outcomes.push({
            attemptId: outcome.attemptId,
            intentId: live.intentId,
            before: outcome.before,
            next: outcome.next,
            reason: outcome.reason.slice(0, 500),
          });
          if (outcome.next !== 'wait') {
            log.info(
              { attemptId: outcome.attemptId, intentId: live.intentId, next: outcome.next },
              outcome.reason,
            );
          }
        } catch (error) {
          // One attempt's failure never blocks the others; it is observed again next round.
          log.warn(
            {
              attemptId: live.attemptId,
              intentId: live.intentId,
              err: error instanceof Error ? error.message : String(error),
            },
            'reconciliation round failed for an attempt',
          );
        }
      }
      return executionReconciliationRoundSchema.parse({
        checkedAt: at.toISOString(),
        attempts: contexts.length,
        outcomes,
      });
    },
  };
}
