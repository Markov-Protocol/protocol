import { z } from 'zod';
import { capabilityReadinessSchema } from './capabilities.js';
import {
  genesisHashSchema,
  markovEnvSchema,
  platformIdentitySchema,
  solanaClusterSchema,
} from './platform.js';

/**
 * Liveness: the process is running and can answer. It says nothing about
 * dependencies. Orchestrators restart a process whose liveness fails.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * One readiness check. `unverified` means the check has not produced a
 * result yet (for example an RPC endpoint that has not answered); it is
 * reported distinctly from `fail` so operators can tell absence from
 * contradiction. Readiness is only `ready` when every required check passes.
 */
export const READINESS_CHECK_STATUSES = ['pass', 'fail', 'unverified'] as const;
export const readinessCheckStatusSchema = z.enum(READINESS_CHECK_STATUSES);
export type ReadinessCheckStatus = z.infer<typeof readinessCheckStatusSchema>;

export const readinessCheckSchema = z.object({
  status: readinessCheckStatusSchema,
  required: z.boolean(),
  /** Secret-free, operator-facing detail. Never include connection strings or keys. */
  detail: z.string().max(1000),
  observedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  service: z.string().min(1).max(100),
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), readinessCheckSchema),
  platform: z.object({
    markovEnv: markovEnvSchema,
    solanaCluster: solanaClusterSchema,
    expectedGenesisHash: genesisHashSchema.nullable(),
    observedGenesisHash: genesisHashSchema.nullable(),
    schemaVersion: z.string().max(100).nullable(),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

/** Public, secret-free description of the running platform. */
export const platformInfoResponseSchema = z.object({
  service: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  contractSchemaVersion: z.literal('1'),
  identity: platformIdentitySchema.nullable(),
  executionWritesEnabled: z.boolean(),
  capabilities: z.array(capabilityReadinessSchema),
});
export type PlatformInfoResponse = z.infer<typeof platformInfoResponseSchema>;

/** Temporal workflow type used to verify the durable execution path end to end. */
export const PLATFORM_HEALTH_WORKFLOW_TYPE = 'platformHealthWorkflow' as const;

export const platformHealthInputSchema = z.object({
  requestedBy: z.string().min(1).max(200),
});
export type PlatformHealthInput = z.infer<typeof platformHealthInputSchema>;

/** Result of the platform health workflow: what the worker observed, not a claim about any provider. */
export const platformHealthReportSchema = z.object({
  status: z.literal('ok'),
  workerVersion: z.string().min(1).max(100),
  markovEnv: markovEnvSchema,
  solanaCluster: solanaClusterSchema,
  genesisHash: genesisHashSchema,
  database: z.object({
    ok: z.boolean(),
    detail: z.string().max(1000),
    durationMs: z.number().int().nonnegative(),
  }),
  checkedAt: z.iso.datetime(),
  requestedBy: z.string().min(1).max(200),
});
export type PlatformHealthReport = z.infer<typeof platformHealthReportSchema>;
