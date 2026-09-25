/**
 * Workflow definitions. This module is bundled into the Temporal workflow
 * sandbox: it may import only from `@temporalio/workflow`, pure helpers and
 * types. Never import Node APIs, databases or provider SDKs here.
 */
import { CancelledFailure, continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import type {
  ExecutionReconciliationInput,
  ExecutionReconciliationReport,
  ExecutionReconciliationRound,
  PlatformActivities,
  PlatformHealthInput,
  PlatformHealthReport,
} from '../activities.js';

const activities = proxyActivities<PlatformActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

const reconciliation = proxyActivities<PlatformActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '2 seconds', backoffCoefficient: 2 },
});

/** Rounds per workflow run before the history is rolled over with continue-as-new. */
const ROUNDS_PER_RUN = 500;
const SETTLING: ReadonlySet<ExecutionReconciliationRound['outcomes'][number]['next']> = new Set([
  'finalized',
  'failed',
  'expired',
]);

/**
 * End-to-end check of the durable execution path: client -> server ->
 * worker -> activity -> database. It has no economic side effects.
 */
export async function platformHealthWorkflow(
  input: PlatformHealthInput,
): Promise<PlatformHealthReport> {
  return activities.reportPlatformHealth(input);
}

/**
 * Durable reconciliation of live execution attempts (B10): one round every
 * `intervalSeconds`, `rounds` times or until cancelled, rolling the history
 * over periodically. Every round is an activity that observes signatures,
 * resends the same bytes while their blockhash lives and settles attempts on
 * evidence; nothing here builds, signs or spends.
 */
export async function executionReconciliationWorkflow(
  input: ExecutionReconciliationInput & { readonly progress?: ReconciliationProgress },
): Promise<ExecutionReconciliationReport> {
  const progress: ReconciliationProgress = input.progress ?? {
    rounds: 0,
    attemptsSeen: 0,
    settled: 0,
    lastRound: null,
  };
  let roundsThisRun = 0;
  try {
    while (input.rounds === null || progress.rounds < input.rounds) {
      const round = await reconciliation.reconcileLiveAttempts({ batchSize: input.batchSize });
      // Settled fills reach the accounting journal in the same round (idempotent; B12).
      await reconciliation.projectJournal({ limit: input.batchSize * 4 });
      progress.rounds += 1;
      roundsThisRun += 1;
      progress.attemptsSeen += round.attempts;
      progress.settled += round.outcomes.filter((outcome) => SETTLING.has(outcome.next)).length;
      progress.lastRound = round;
      if (input.rounds !== null && progress.rounds >= input.rounds) {
        break;
      }
      if (roundsThisRun >= ROUNDS_PER_RUN) {
        await continueAsNew<typeof executionReconciliationWorkflow>({ ...input, progress });
      }
      await sleep(`${input.intervalSeconds} seconds`);
    }
  } catch (error) {
    if (!(error instanceof CancelledFailure)) {
      throw error;
    }
  }
  return {
    requestedBy: input.requestedBy,
    rounds: progress.rounds,
    attemptsSeen: progress.attemptsSeen,
    settled: progress.settled,
    lastRound: progress.lastRound,
  };
}

interface ReconciliationProgress {
  rounds: number;
  attemptsSeen: number;
  settled: number;
  lastRound: ExecutionReconciliationRound | null;
}
