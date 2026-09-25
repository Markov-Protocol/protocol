import { z } from 'zod';

/**
 * Verification states for every externally dependent capability.
 *
 * - IMPLEMENTED: code and tests exist; no external evidence.
 * - FIXTURE_VERIFIED: exercised end to end against deterministic fixtures,
 *   meaning sanitised recorded provider responses where they exist and
 *   otherwise synthetic stand-ins of the provider contract or the in-memory
 *   fixture chain. It says nothing about the live provider.
 * - LIVE_READ_VERIFIED: verified against the real provider with read-only calls.
 * - LIVE_WRITE_VERIFIED: verified with a real, authorized, bounded write.
 * - BLOCKED: a named external dependency prevents verification.
 * - DISABLED: off by policy or release gate.
 *
 * A successful HTTP response, a configured credential, or a transaction
 * signature alone never upgrades a capability to a LIVE_* state. A local API
 * in test mode with the in-process test issuer is not a real provider, so a
 * run against it is never LIVE_* evidence.
 */
export const CAPABILITY_STATUSES = [
  'IMPLEMENTED',
  'FIXTURE_VERIFIED',
  'LIVE_READ_VERIFIED',
  'LIVE_WRITE_VERIFIED',
  'BLOCKED',
  'DISABLED',
] as const;
export const capabilityStatusSchema = z.enum(CAPABILITY_STATUSES);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

/** Stable capability identifiers. Extend by appending; never rename a shipped id. */
export const CAPABILITY_IDS = [
  'platform.api.health',
  'platform.db.migrations',
  'platform.worker.temporal',
  'solana.rpc.read',
  'solana.rpc.submit',
  'catalog.prestocks.ingest',
  'catalog.xstocks.ingest',
  'catalog.tessera.ingest',
  'identity.provider.verify',
  'policy.eligibility.rules',
  'execution.jupiter.quote',
  'execution.jupiter.build',
  'execution.spot.submit',
  'accounting.journal',
  'receipts.signing',
  'analytics.performance',
  'registry.strategy.publish',
  'research.model.generate',
  'companion.model.run',
  'notifications.email',
  'maintenance.scheduler',
  'liquidity.meteora.read',
  'liquidity.meteora.dbc-simulate',
  'automation.unattended',
] as const;
export const capabilityIdSchema = z.enum(CAPABILITY_IDS);
export type CapabilityId = z.infer<typeof capabilityIdSchema>;

export const capabilityReadinessSchema = z.object({
  capability: capabilityIdSchema,
  status: capabilityStatusSchema,
  /** Free-text, secret-free explanation of the evidence or the blocker. */
  summary: z.string().max(2000),
  /** Structured evidence references (URLs, commit hashes, dates). Never credentials. */
  evidence: z.record(z.string(), z.unknown()).default({}),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().min(1).max(200),
});
export type CapabilityReadiness = z.infer<typeof capabilityReadinessSchema>;

export const capabilityReadinessListSchema = z.object({
  capabilities: z.array(capabilityReadinessSchema),
});
export type CapabilityReadinessList = z.infer<typeof capabilityReadinessListSchema>;
