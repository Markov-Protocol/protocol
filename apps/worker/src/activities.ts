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
import { createExecutionStorePort, type DbClient, listLiveAttemptContexts } from '@markov/db';
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

    async reconcileLiveAttempts(rawInput) {
      const input = executionReconciliationInputSchema
        .pick({ batchSize: true })
        .parse(rawInput ?? {});
      const at = now();
      const contexts = await listLiveAttemptContexts(deps.dbClient.db, input.batchSize);
      const outcomes: ExecutionReconciliationRound['outcomes'] = [];
      for (const context of contexts) {
        const live = liveAttemptFromRows(context);
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
