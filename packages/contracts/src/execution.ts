import { z } from 'zod';
import { base58AddressSchema, idSchema } from './identity.js';
import { intentStateSchema, planSideSchema, simulationEvidenceSchema } from './planning.js';
import { rawAmountSchema } from './price.js';
import { networkIdentitySchema, sha256HexSchema } from './registry.js';

/**
 * Execution of an approved plan (B10): one validated transaction per batch,
 * signed by the owner's wallet, submitted by Markov, observed to finality
 * and reconciled from chain evidence. Every amount is raw base units. A
 * signature alone is never proof of settlement: fills come from the landed
 * transaction's own balance changes.
 */

export const TRANSACTION_VERSIONS = ['legacy', 'v0'] as const;
export const transactionVersionSchema = z.enum(TRANSACTION_VERSIONS);
export type TransactionVersion = z.infer<typeof transactionVersionSchema>;

export const ATTEMPT_STATES = [
  /** Built and validated; waiting for the owner's signature. */
  'prepared',
  /** The owner's signature was verified and the attempt persisted; broadcast not yet answered. */
  'submitting',
  /** The node accepted the transaction; it has not been observed at confirmed depth. */
  'submitted',
  'confirmed',
  'finalized',
  /** Landed with an error, or refused by the node before broadcast (the reason says which). */
  'failed',
  /** Its blockhash expired before the transaction was observed anywhere. */
  'expired',
  /** Broadcast may or may not have happened; reconciliation decides. */
  'unknown',
  /** Replaced by a later prepared transaction before any signature. */
  'superseded',
  'cancelled',
] as const;
export const attemptStateSchema = z.enum(ATTEMPT_STATES);
export type AttemptState = z.infer<typeof attemptStateSchema>;

export const decodedInstructionSchema = z.object({
  index: z.number().int().nonnegative(),
  programId: base58AddressSchema,
  /** The reviewed program's label, or `unknown`. */
  program: z.string().max(60),
  kind: z.string().max(60),
  summary: z.string().max(400),
});
export type DecodedInstruction = z.infer<typeof decodedInstructionSchema>;

/** One leg's validated swap: the exact input and the minimum output its instruction enforces. */
export const transactionLegEffectSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  side: planSideSchema,
  inputMint: base58AddressSchema,
  outputMint: base58AddressSchema,
  /** The exact input the route instruction spends; never above the leg's bound. */
  maxInputRaw: rawAmountSchema,
  /** The minimum output the route instruction enforces; never below the leg's bound. */
  minimumOutputRaw: rawAmountSchema,
  sourceTokenAccount: base58AddressSchema,
  destinationTokenAccount: base58AddressSchema,
});
export type TransactionLegEffect = z.infer<typeof transactionLegEffectSchema>;

/** What the validated transaction can do, decoded from its instructions and checked against the plan. */
export const transactionEffectsSchema = z.object({
  side: planSideSchema,
  /** The mint every leg of this transaction spends (the stablecoin for buys, the instrument for a sell). */
  inputMint: base58AddressSchema,
  /** The exact input across every leg; never above the sum of the legs' bounds. */
  maxInputRaw: rawAmountSchema,
  legs: z.array(transactionLegEffectSchema).min(1).max(10),
  /** Token accounts this transaction creates for the owner (rent paid by the owner). */
  accountsCreated: z.array(base58AddressSchema).max(10),
  computeUnitLimit: z.number().int().positive().nullable(),
  computeUnitPriceMicroLamports: rawAmountSchema,
  baseFeeLamports: rawAmountSchema,
  priorityFeeMaxLamports: rawAmountSchema,
  rentLamports: rawAmountSchema,
  /** Every lamport this transaction may cost the owner beyond the swap input. */
  totalLamportsMax: rawAmountSchema,
  signers: z.array(base58AddressSchema).min(1).max(1),
  routeProgramIds: z.array(base58AddressSchema).min(1).max(8),
});
export type TransactionEffects = z.infer<typeof transactionEffectsSchema>;

export type { SimulationEvidence } from './planning.js';
export { simulationEvidenceSchema } from './planning.js';

export const executionAttemptSchema = z.object({
  attemptId: idSchema,
  transactionId: idSchema,
  transactionIndex: z.number().int().nonnegative(),
  /** The base58 fee-payer signature once the owner signed; the transaction id on chain. */
  signature: z.string().min(80).max(90).nullable(),
  state: attemptStateSchema,
  /** How the attempt reached a terminal or waiting state, when there is a reason worth telling. */
  reason: z.string().max(500).nullable(),
  submittedAt: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable(),
  slot: z.number().int().nonnegative().nullable(),
  /** Times the same signed bytes were sent again while the blockhash was valid. */
  resendCount: z.number().int().nonnegative(),
  /** The node's error for a landed-with-error attempt, as reported. */
  chainError: z.string().max(300).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ExecutionAttempt = z.infer<typeof executionAttemptSchema>;

/** A built, validated, simulated transaction for one batch of an approved plan. */
export const preparedTransactionSchema = z.object({
  transactionId: idSchema,
  intentId: idSchema,
  planId: idSchema,
  planHash: sha256HexSchema,
  transactionIndex: z.number().int().nonnegative(),
  batch: z.number().int().nonnegative(),
  legIndexes: z.array(z.number().int().nonnegative()).min(1),
  network: networkIdentitySchema,
  version: transactionVersionSchema,
  /** Base64 of the unsigned wire transaction (zeroed signature slots in front of the message). */
  unsignedTransaction: z.string().max(4000),
  /** Hex SHA-256 over the exact message bytes; the identity the approval and the signature bind to. */
  messageHash: sha256HexSchema,
  feePayer: base58AddressSchema,
  expectedSigner: base58AddressSchema,
  recentBlockhash: z.string().min(32).max(44),
  lastValidBlockHeight: z.number().int().nonnegative(),
  /** Where the bytes came from: the fixture venue or a configured gateway, never credentials. */
  buildSource: z.string().max(200),
  instructions: z.array(decodedInstructionSchema).max(16),
  effects: transactionEffectsSchema,
  simulation: simulationEvidenceSchema,
  state: attemptStateSchema,
  attempt: executionAttemptSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type PreparedTransaction = z.infer<typeof preparedTransactionSchema>;

export const signedTransactionSubmissionSchema = z.object({
  /** Base64 of the signed wire transaction: exactly the prepared message with the owner's signature filled in. */
  signedTransaction: z.string().min(1).max(4000),
});
export type SignedTransactionSubmission = z.infer<typeof signedTransactionSubmissionSchema>;

/** Observed settlement of one leg, from the landed transaction's balance changes. */
export const executionFillSchema = z.object({
  fillId: idSchema,
  intentId: idSchema,
  planId: idSchema,
  legIndex: z.number().int().nonnegative(),
  signature: z.string().min(80).max(90),
  slot: z.number().int().nonnegative(),
  blockTime: z.iso.datetime().nullable(),
  side: planSideSchema,
  inputMint: base58AddressSchema,
  outputMint: base58AddressSchema,
  inputSpentRaw: rawAmountSchema,
  outputReceivedRaw: rawAmountSchema,
  feeLamports: rawAmountSchema,
  /** Lamports the owner's account lost in total (fees plus rent for new accounts). */
  lamportsSpent: rawAmountSchema,
  /** Whether the observed amounts respect the approved bounds; a violation freezes the intent for review. */
  withinBounds: z.boolean(),
  source: z.literal('transaction_meta'),
  observedAt: z.iso.datetime(),
});
export type ExecutionFill = z.infer<typeof executionFillSchema>;

export const NEXT_ACTIONS = ['build', 'sign', 'wait', 'reconcile', 'review', 'none'] as const;
export const nextActionSchema = z.enum(NEXT_ACTIONS);

export const BATCH_STATES = [
  /** No transaction built yet. */
  'pending',
  'prepared',
  'submitting',
  'submitted',
  'confirmed',
  'finalized',
  'failed',
  'expired',
  'cancelled',
  /** The node gave no answer after the broadcast; reconciliation decides from chain evidence. */
  'unknown',
  /** Not built: the run stopped before this batch (stale later-leg terms, a failure, an exit); a reviewed completion is needed. */
  'stale',
] as const;
export const batchStateSchema = z.enum(BATCH_STATES);
export type BatchState = z.infer<typeof batchStateSchema>;

/** One batch of the plan as execution sees it: which legs, which transaction, how far it got. */
export const executionBatchSchema = z.object({
  batch: z.number().int().nonnegative(),
  legIndexes: z.array(z.number().int().nonnegative()).min(1),
  state: batchStateSchema,
  transactionId: idSchema.nullable(),
  attemptId: idSchema.nullable(),
  signature: z.string().min(80).max(90).nullable(),
  /** Why the batch is stale, failed or expired, when there is a reason worth telling. */
  reason: z.string().max(500).nullable(),
});
export type ExecutionBatch = z.infer<typeof executionBatchSchema>;

export const executionStatusSchema = z.object({
  intentId: idSchema,
  state: intentStateSchema,
  stateReason: z.string().max(500).nullable(),
  planId: idSchema.nullable(),
  planHash: sha256HexSchema.nullable(),
  /** Every batch of the plan in order with its state; an atomic plan has one. */
  batches: z.array(executionBatchSchema).max(32),
  /** The current prepared transaction per batch (older prepared ones are superseded). */
  transactions: z.array(preparedTransactionSchema).max(32),
  attempts: z.array(executionAttemptSchema).max(64),
  fills: z.array(executionFillSchema).max(32),
  reconciliation: z.object({
    lastCheckedAt: z.iso.datetime().nullable(),
    /** Finalized block height at the last check, when the node answered. */
    blockHeight: z.number().int().nonnegative().nullable(),
    /** Short statements of the evidence the state rests on. */
    evidence: z.array(z.string().max(300)).max(12),
    /** Unknown results or bound violations freeze the intent until reconciled or reviewed. */
    frozen: z.boolean(),
  }),
  nextAction: nextActionSchema,
  updatedAt: z.iso.datetime(),
});
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** Why a transaction could not be prepared; the plan and intent keep their state. */
export const TRANSACTION_REFUSAL_CODES = [
  'PLAN_NOT_APPROVED',
  'PLAN_EXPIRED',
  'PLAN_CHANGED',
  'BUILD_UNAVAILABLE',
  'VALIDATION_FAILED',
  'SIMULATION_FAILED',
  'ATTEMPT_IN_FLIGHT',
  /** Retired with B11 (baskets execute); kept so B10 clients still parse it, never answered. */
  'STAGED_NOT_SUPPORTED',
  /** The prepared transaction's blockhash can no longer land; build it again. */
  'TRANSACTION_EXPIRED',
  /** A staged plan's next batch cannot be built before the previous one is finalized. */
  'BATCH_NOT_READY',
  /** A later leg's fresh quote cannot meet the approved bounds; the run stops as partially completed. */
  'LEG_TERMS_CHANGED',
  /** Every batch of the plan is finalized; nothing is left to build. */
  'PLAN_COMPLETED',
] as const;
export const transactionRefusalCodeSchema = z.enum(TRANSACTION_REFUSAL_CODES);

/** Outbox events written in the same transaction as the state they announce. */
export const EXECUTION_EVENT_KINDS = [
  'execution.pending',
  'execution.submitted',
  'execution.confirmed',
  'execution.finalized',
  'execution.failed',
  'execution.expired',
  'execution.unknown',
  'execution.cancelled',
  /** A staged basket stopped after at least one leg filled (a later leg failed, expired, went stale or was cancelled). */
  'execution.partial',
] as const;
export const executionEventKindSchema = z.enum(EXECUTION_EVENT_KINDS);
export type ExecutionEventKind = z.infer<typeof executionEventKindSchema>;

/** Durable reconciliation of live attempts (worker): one workflow per task queue, rounds until cancelled. */
export const EXECUTION_RECONCILIATION_WORKFLOW_TYPE = 'executionReconciliationWorkflow' as const;

export const executionReconciliationInputSchema = z.object({
  requestedBy: z.string().min(1).max(200),
  /** Rounds to run before returning; null runs until the workflow is cancelled. */
  rounds: z.number().int().positive().max(100_000).nullable().default(null),
  intervalSeconds: z.number().int().min(1).max(3600).default(5),
  /** Live attempts reconciled per round, oldest first. */
  batchSize: z.number().int().min(1).max(500).default(100),
});
export type ExecutionReconciliationInput = z.infer<typeof executionReconciliationInputSchema>;

export const executionReconciliationRoundSchema = z.object({
  checkedAt: z.iso.datetime(),
  /** Live attempts found in this round. */
  attempts: z.number().int().nonnegative(),
  outcomes: z
    .array(
      z.object({
        attemptId: idSchema,
        intentId: idSchema,
        before: z.enum(['submitting', 'submitted', 'confirmed', 'unknown']),
        next: z.enum([
          'wait',
          'resend',
          'submitted',
          'confirmed',
          'finalized',
          'failed',
          'expired',
          'unknown',
        ]),
        reason: z.string().max(500),
      }),
    )
    .max(500),
});
export type ExecutionReconciliationRound = z.infer<typeof executionReconciliationRoundSchema>;

export const executionReconciliationReportSchema = z.object({
  requestedBy: z.string(),
  rounds: z.number().int().nonnegative(),
  attemptsSeen: z.number().int().nonnegative(),
  settled: z.number().int().nonnegative(),
  lastRound: executionReconciliationRoundSchema.nullable(),
});
export type ExecutionReconciliationReport = z.infer<typeof executionReconciliationReportSchema>;
