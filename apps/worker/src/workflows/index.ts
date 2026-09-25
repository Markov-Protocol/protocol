/**
 * Workflow definitions. This module is bundled into the Temporal workflow
 * sandbox: it may import only from `@temporalio/workflow`, pure helpers and
 * types. Never import Node APIs, databases or provider SDKs here.
 */
import {
  ActivityFailure,
  CancelledFailure,
  continueAsNew,
  isCancellation,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import type {
  ExecutionReconciliationInput,
  ExecutionReconciliationReport,
  ExecutionReconciliationRound,
  MaintenanceTickResult,
  MaintenanceWorkflowInput,
  MaintenanceWorkflowReport,
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

const maintenance = proxyActivities<PlatformActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5 seconds', backoffCoefficient: 2 },
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

/**
 * Durable maintenance loop (B16): one API pass every `intervalSeconds`,
 * `rounds` times or until cancelled, rolling the history over periodically.
 * The pass itself runs in the API under the worker credential and is
 * idempotent per occurrence, so a tick repeated after a crash prepares no
 * second proposal. A refusal or an unreachable API is counted and the loop
 * waits for the next tick; nothing here spends or decides.
 */
export async function maintenanceWorkflow(
  input: MaintenanceWorkflowInput & { readonly progress?: MaintenanceProgress },
): Promise<MaintenanceWorkflowReport> {
  const progress: MaintenanceProgress = input.progress ?? {
    rounds: 0,
    ticks: { ran: 0, refused: 0, unreachable: 0, notConfigured: 0 },
    schedules: { proposed: 0, skipped: 0, failed: 0, expired: 0 },
    notifications: { delivered: 0, dead: 0 },
    lastTick: null,
  };
  let roundsThisRun = 0;
  try {
    while (input.rounds === null || progress.rounds < input.rounds) {
      let tick: MaintenanceTickResult;
      try {
        tick = await maintenance.runMaintenanceTick({
          batchSize: input.batchSize,
          requestedBy: input.requestedBy,
        });
      } catch (error) {
        if (isCancellation(error) || !(error instanceof ActivityFailure)) {
          throw error;
        }
        const cause = error.cause instanceof Error ? error.cause.message : error.message;
        tick = { status: 'unreachable', detail: cause.slice(0, 300) };
      }
      progress.rounds += 1;
      roundsThisRun += 1;
      progress.lastTick = tick;
      switch (tick.status) {
        case 'ran':
          progress.ticks.ran += 1;
          progress.schedules.proposed += tick.report.schedules.proposed;
          progress.schedules.skipped += tick.report.schedules.skipped;
          progress.schedules.failed += tick.report.schedules.failed;
          progress.schedules.expired += tick.report.schedules.expired;
          progress.notifications.delivered += tick.report.notifications.delivered;
          progress.notifications.dead += tick.report.notifications.dead;
          break;
        case 'refused':
          progress.ticks.refused += 1;
          break;
        case 'unreachable':
          progress.ticks.unreachable += 1;
          break;
        case 'not_configured':
          progress.ticks.notConfigured += 1;
          break;
      }
      if (input.rounds !== null && progress.rounds >= input.rounds) {
        break;
      }
      if (roundsThisRun >= ROUNDS_PER_RUN) {
        await continueAsNew<typeof maintenanceWorkflow>({ ...input, progress });
      }
      await sleep(`${input.intervalSeconds} seconds`);
    }
  } catch (error) {
    if (!(error instanceof CancelledFailure) && !isCancellation(error)) {
      throw error;
    }
  }
  return {
    requestedBy: input.requestedBy,
    rounds: progress.rounds,
    ticks: progress.ticks,
    schedules: progress.schedules,
    notifications: progress.notifications,
    lastTick: progress.lastTick,
  };
}

interface MaintenanceProgress {
  rounds: number;
  ticks: { ran: number; refused: number; unreachable: number; notConfigured: number };
  schedules: { proposed: number; skipped: number; failed: number; expired: number };
  notifications: { delivered: number; dead: number };
  lastTick: MaintenanceTickResult | null;
}
