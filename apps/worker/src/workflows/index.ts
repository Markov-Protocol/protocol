/**
 * Workflow definitions. This module is bundled into the Temporal workflow
 * sandbox: it may import only from `@temporalio/workflow`, pure helpers and
 * types. Never import Node APIs, databases or provider SDKs here.
 */
import { proxyActivities } from '@temporalio/workflow';
import type {
  PlatformActivities,
  PlatformHealthInput,
  PlatformHealthReport,
} from '../activities.js';

const activities = proxyActivities<PlatformActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

/**
 * End-to-end check of the durable execution path: client -> server ->
 * worker -> activity -> database. It has no economic side effects.
 */
export async function platformHealthWorkflow(
  input: PlatformHealthInput,
): Promise<PlatformHealthReport> {
  return activities.reportPlatformHealth(input);
}
