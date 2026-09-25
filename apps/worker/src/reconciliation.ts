import type { MarkovConfig } from '@markov/config';
import { EXECUTION_RECONCILIATION_WORKFLOW_TYPE } from '@markov/contracts';
import type { Logger } from '@markov/observability';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

/** The one reconciliation workflow of a task queue; a second worker on the queue finds it running. */
export function reconciliationWorkflowId(taskQueue: string): string {
  return `execution-reconciliation:${taskQueue}`;
}

export interface EnsureReconciliationOptions {
  readonly config: MarkovConfig;
  readonly logger: Logger;
  readonly taskQueue: string;
  readonly identity: string;
  readonly intervalSeconds?: number;
}

/**
 * Starts the durable reconciliation workflow for the task queue unless it
 * already runs. Idempotent: the workflow id is derived from the queue, and
 * an already-started workflow is left alone. Answers the workflow id.
 */
export async function ensureReconciliationWorkflow(
  options: EnsureReconciliationOptions,
): Promise<string> {
  const workflowId = reconciliationWorkflowId(options.taskQueue);
  const connection = await Connection.connect({
    address: options.config.temporal.address,
    tls: options.config.temporal.tls ? {} : false,
    ...(options.config.temporal.apiKey ? { apiKey: options.config.temporal.apiKey } : {}),
  });
  try {
    const client = new Client({ connection, namespace: options.config.temporal.namespace });
    try {
      await client.workflow.start(EXECUTION_RECONCILIATION_WORKFLOW_TYPE, {
        taskQueue: options.taskQueue,
        workflowId,
        args: [
          {
            requestedBy: options.identity,
            rounds: null,
            intervalSeconds: options.intervalSeconds ?? 5,
            batchSize: 100,
          },
        ],
      });
      options.logger.info({ workflowId, taskQueue: options.taskQueue }, 'reconciliation started');
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error;
      }
      options.logger.info({ workflowId }, 'reconciliation workflow already running');
    }
    return workflowId;
  } finally {
    await connection.close();
  }
}
