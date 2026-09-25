import type { MarkovConfig } from '@markov/config';
import { MAINTENANCE_WORKFLOW_TYPE } from '@markov/contracts';
import type { Logger } from '@markov/observability';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

/** The one maintenance workflow of a task queue; a second worker on the queue finds it running. */
export function maintenanceWorkflowId(taskQueue: string): string {
  return `maintenance:${taskQueue}`;
}

export interface EnsureMaintenanceOptions {
  readonly config: MarkovConfig;
  readonly logger: Logger;
  readonly taskQueue: string;
  readonly identity: string;
  readonly batchSize?: number;
}

/**
 * Starts the durable maintenance loop for the task queue unless it already
 * runs (B16). Idempotent: the workflow id is derived from the queue and an
 * already-started workflow is left alone. The loop only asks the API for
 * passes with the worker credential; it holds no authority of its own.
 */
export async function ensureMaintenanceWorkflow(
  options: EnsureMaintenanceOptions,
): Promise<string> {
  const workflowId = maintenanceWorkflowId(options.taskQueue);
  const connection = await Connection.connect({
    address: options.config.temporal.address,
    tls: options.config.temporal.tls ? {} : false,
    ...(options.config.temporal.apiKey ? { apiKey: options.config.temporal.apiKey } : {}),
  });
  try {
    const client = new Client({ connection, namespace: options.config.temporal.namespace });
    try {
      await client.workflow.start(MAINTENANCE_WORKFLOW_TYPE, {
        taskQueue: options.taskQueue,
        workflowId,
        args: [
          {
            requestedBy: options.identity,
            rounds: null,
            intervalSeconds: options.config.maintenance.tickSeconds,
            batchSize: options.batchSize ?? 100,
          },
        ],
      });
      options.logger.info(
        {
          workflowId,
          taskQueue: options.taskQueue,
          tickSeconds: options.config.maintenance.tickSeconds,
        },
        'maintenance loop started',
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error;
      }
      options.logger.info({ workflowId }, 'maintenance workflow already running');
    }
    return workflowId;
  } finally {
    await connection.close();
  }
}
