import { z } from 'zod';
import { base58AddressSchema, idSchema } from './identity.js';
import { intentStateSchema, planSideSchema } from './planning.js';
import { ownerLimitsSchema } from './policy.js';
import { rawAmountSchema } from './price.js';
import { networkIdentitySchema, sha256HexSchema } from './registry.js';

/**
 * Accounting (B12): an append-only, balanced quantity journal in raw base
 * units with one balancing equation per asset, lots attributed to a
 * strategy instance as analytics bookkeeping, reconciliation of the
 * journal against chain balances with explicit external flows, and
 * canonical, signed receipts. Nothing here is a valuation, a performance
 * figure or a statement about lawful ownership.
 */

/** A signed integer amount in raw base units, as a decimal string. */
export const signedRawAmountSchema = z.string().regex(/^-?(0|[1-9][0-9]*)$/);

/** The asset of a journal line: a token mint, or the literal `SOL` for lamports. */
export const journalAssetSchema = z.union([z.literal('SOL'), base58AddressSchema]);
export type JournalAsset = z.infer<typeof journalAssetSchema>;

/**
 * Accounts of the quantity journal. Every entry balances per asset across
 * these accounts; `wallet` is what the chain should show for the owner.
 */
export const JOURNAL_ACCOUNTS = [
  /** The owner's own holdings of the asset. */
  'wallet',
  /** The execution counterparty: what a swap took and gave. */
  'venue',
  /** Network fees paid to validators. */
  'network_fee',
  /** Rent-exempt deposits locked in newly created token accounts (recoverable on closure). */
  'rent',
  /** Transfers in or out of the wallet that no Markov execution explains. */
  'external',
  /** Operator corrections: an entry reversed and replaced, never rewritten. */
  'correction',
] as const;
export const journalAccountSchema = z.enum(JOURNAL_ACCOUNTS);
export type JournalAccount = z.infer<typeof journalAccountSchema>;

export const JOURNAL_ENTRY_KINDS = [
  'fill',
  'network_fee',
  'rent',
  'external_inflow',
  'external_outflow',
  'correction',
  /** Corporate-action quantity adjustments (B13) reuse the journal with this kind. */
  'lifecycle_adjustment',
] as const;
export const journalEntryKindSchema = z.enum(JOURNAL_ENTRY_KINDS);
export type JournalEntryKind = z.infer<typeof journalEntryKindSchema>;

/** Where an entry came from; `ref` is its idempotency key, unique per owner. */
export const JOURNAL_SOURCE_KINDS = ['execution_fill', 'chain_reconciliation', 'operator'] as const;
export const journalSourceKindSchema = z.enum(JOURNAL_SOURCE_KINDS);

/**
 * How the entry's wallet-side quantities are attributed: to one strategy
 * instance, to the wallet only (`unassigned`), or not yet explained
 * (`needs_reconciliation`: an external flow nobody acknowledged).
 */
export const JOURNAL_ATTRIBUTIONS = ['instance', 'unassigned', 'needs_reconciliation'] as const;
export const journalAttributionSchema = z.enum(JOURNAL_ATTRIBUTIONS);
export type JournalAttribution = z.infer<typeof journalAttributionSchema>;

export const journalLineSchema = z.object({
  account: journalAccountSchema,
  asset: journalAssetSchema,
  symbol: z.string().max(32),
  decimals: z.number().int().min(0).max(18),
  /** Signed raw base units; positive increases the account's holding of the asset. */
  deltaRaw: signedRawAmountSchema,
  /** The lot this line opens or consumes, when it moves an attributed quantity. */
  lotId: idSchema.nullable(),
});
export type JournalLine = z.infer<typeof journalLineSchema>;

export const ACKNOWLEDGEMENT_KINDS = ['deposit', 'withdrawal', 'transfer', 'other'] as const;
export const externalFlowAcknowledgementSchema = z.object({
  kind: z.enum(ACKNOWLEDGEMENT_KINDS),
  note: z.string().max(200).nullable(),
  acknowledgedAt: z.iso.datetime(),
});

export const journalEntrySchema = z.object({
  entryId: idSchema,
  ownerUserId: idSchema,
  walletId: idSchema,
  /** The strategy instance the wallet-side lines are attributed to, when they are. */
  instanceId: idSchema.nullable(),
  kind: journalEntryKindSchema,
  source: z.object({
    kind: journalSourceKindSchema,
    /** Idempotency key: the same observation recorded twice is one entry. */
    ref: z.string().min(1).max(200),
  }),
  /** When the movement happened on chain (block time or observation time). */
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  /** Set on a correction: the entry this one reverses. */
  reversesEntryId: idSchema.nullable(),
  attribution: journalAttributionSchema,
  /** The owner's explanation of an external flow, when given. */
  acknowledgement: externalFlowAcknowledgementSchema.nullable(),
  memo: z.string().max(300),
  lines: z.array(journalLineSchema).min(2).max(16),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const journalListResponseSchema = z.object({
  walletId: idSchema,
  entries: z.array(journalEntrySchema).max(200),
  /** How the journal balances: one equation per asset, never across assets. */
  balancing: z.literal('per_asset'),
});
export type JournalListResponse = z.infer<typeof journalListResponseSchema>;

export const externalFlowAcknowledgementRequestSchema = z.object({
  kind: z.enum(ACKNOWLEDGEMENT_KINDS),
  note: z.string().max(200).nullable().default(null),
});
export type ExternalFlowAcknowledgementRequest = z.infer<
  typeof externalFlowAcknowledgementRequestSchema
>;

/** The one lot policy of V1: analytics bookkeeping, not jurisdiction-specific tax advice. */
export const LOT_ATTRIBUTION_POLICY = 'fifo' as const;

export const LOT_STATUSES = ['open', 'closed'] as const;
export const lotSchema = z.object({
  lotId: idSchema,
  ownerUserId: idSchema,
  walletId: idSchema,
  instanceId: idSchema.nullable(),
  intentId: idSchema.nullable(),
  asset: base58AddressSchema,
  symbol: z.string().max(32),
  decimals: z.number().int().min(0).max(18),
  openedAt: z.iso.datetime(),
  quantityRaw: rawAmountSchema,
  remainingRaw: rawAmountSchema,
  /** What the lot cost in the plan's input asset (the stablecoin for buys), raw units. */
  costAsset: base58AddressSchema,
  costRaw: rawAmountSchema,
  /** Network fees and rent the fill charged, attributed to the lot for cost accounting. */
  feeLamports: rawAmountSchema,
  sourceEntryId: idSchema,
  status: z.enum(LOT_STATUSES),
});
export type Lot = z.infer<typeof lotSchema>;

export const lotConsumptionSchema = z.object({
  consumptionId: idSchema,
  lotId: idSchema,
  entryId: idSchema,
  quantityRaw: rawAmountSchema,
  /** The cost basis attributed to the consumed quantity (FIFO, integer allocation). */
  costRaw: rawAmountSchema,
  proceedsRaw: rawAmountSchema,
  consumedAt: z.iso.datetime(),
});
export type LotConsumption = z.infer<typeof lotConsumptionSchema>;

export const HOLDING_STATUSES = [
  /** The journal and the chain agree. */
  'matched',
  /** No chain observation yet. */
  'unobserved',
  /** The last chain observation predates journal activity; reconcile again before trusting the difference. */
  'stale',
  /** The chain differs from the journal and the external flow is not acknowledged. */
  'needs_reconciliation',
  /** An asset the wallet holds that no Markov record explains (quarantine view). */
  'unassigned_asset',
] as const;
export const holdingStatusSchema = z.enum(HOLDING_STATUSES);

export const holdingSchema = z.object({
  asset: journalAssetSchema,
  symbol: z.string().max(32),
  decimals: z.number().int().min(0).max(18),
  unit: z.literal('raw'),
  /** The journal's `wallet` account balance. */
  ledgerRaw: signedRawAmountSchema,
  /** The last chain observation, or null before any. */
  chainRaw: rawAmountSchema.nullable(),
  observedAt: z.iso.datetime().nullable(),
  status: holdingStatusSchema,
  /** chain minus ledger, when both are known. */
  differenceRaw: signedRawAmountSchema.nullable(),
  /** How the ledger quantity is attributed; wallet totals stay separate from strategy totals. */
  attribution: z.array(
    z.object({
      instanceId: idSchema.nullable(),
      attribution: journalAttributionSchema,
      raw: signedRawAmountSchema,
    }),
  ),
});
export type Holding = z.infer<typeof holdingSchema>;

export const RECONCILIATION_OUTCOMES = [
  'matched',
  'external_inflow_recorded',
  'external_outflow_recorded',
  'unassigned_asset',
  'already_flagged',
] as const;

export const reconciliationCheckpointSchema = z.object({
  checkpointId: idSchema,
  walletId: idSchema,
  ownerUserId: idSchema,
  slot: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  commitment: z.enum(['confirmed', 'finalized']),
  status: z.enum(['matched', 'needs_review']),
  assets: z.array(
    z.object({
      asset: journalAssetSchema,
      symbol: z.string().max(32).nullable(),
      decimals: z.number().int().min(0).max(18).nullable(),
      ledgerBeforeRaw: signedRawAmountSchema,
      chainRaw: rawAmountSchema,
      differenceRaw: signedRawAmountSchema,
      outcome: z.enum(RECONCILIATION_OUTCOMES),
      entryId: idSchema.nullable(),
    }),
  ),
  createdAt: z.iso.datetime(),
});
export type ReconciliationCheckpoint = z.infer<typeof reconciliationCheckpointSchema>;

export const walletHoldingsResponseSchema = z.object({
  walletId: idSchema,
  address: base58AddressSchema,
  network: networkIdentitySchema,
  checkpoint: reconciliationCheckpointSchema.nullable(),
  holdings: z.array(holdingSchema).max(200),
  /** Entries a person still has to explain (external flows without an acknowledgement). */
  unexplainedEntryIds: z.array(idSchema).max(200),
  lotPolicy: z.literal(LOT_ATTRIBUTION_POLICY),
  note: z.string().max(300),
});
export type WalletHoldingsResponse = z.infer<typeof walletHoldingsResponseSchema>;

export const instanceHoldingsResponseSchema = z.object({
  instanceId: idSchema,
  walletId: idSchema,
  strategyId: idSchema,
  pinnedVersionId: idSchema,
  status: z.enum(['reconciled', 'needs_reconciliation', 'unobserved']),
  holdings: z.array(
    z.object({
      asset: base58AddressSchema,
      symbol: z.string().max(32),
      decimals: z.number().int().min(0).max(18),
      unit: z.literal('raw'),
      attributedRaw: signedRawAmountSchema,
      /** Open lots, oldest first (the FIFO order). */
      lots: z.array(lotSchema).max(100),
    }),
  ),
  /** Sum of open lots' cost in the stablecoin, raw units; a bookkeeping figure, not a valuation. */
  costBasis: z.object({ asset: base58AddressSchema.nullable(), raw: rawAmountSchema }),
  feesLamports: rawAmountSchema,
  lotPolicy: z.literal(LOT_ATTRIBUTION_POLICY),
  note: z.string().max(300),
});
export type InstanceHoldingsResponse = z.infer<typeof instanceHoldingsResponseSchema>;

export const journalProjectionReportSchema = z.object({
  /** Fills examined, entries appended, entries already present (no change). */
  fillsSeen: z.number().int().nonnegative(),
  entriesAppended: z.number().int().nonnegative(),
  entriesExisting: z.number().int().nonnegative(),
  lotsOpened: z.number().int().nonnegative(),
  lotsConsumed: z.number().int().nonnegative(),
});
export type JournalProjectionReport = z.infer<typeof journalProjectionReportSchema>;

/* ---------------------------------------------------------------- receipts */

export const RECEIPT_VERSION = '1' as const;
export const RECEIPT_DOMAIN = 'markov-receipt/v1' as const;
export const RECEIPT_KINDS = ['decision', 'execution'] as const;
export const receiptKindSchema = z.enum(RECEIPT_KINDS);
export type ReceiptKind = z.infer<typeof receiptKindSchema>;

export const receiptFillSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  side: planSideSchema,
  inputMint: base58AddressSchema,
  outputMint: base58AddressSchema,
  inputSpentRaw: rawAmountSchema,
  outputReceivedRaw: rawAmountSchema,
  feeLamports: rawAmountSchema,
  lamportsSpent: rawAmountSchema,
  withinBounds: z.boolean(),
  signature: z.string().min(80).max(90),
  slot: z.number().int().nonnegative(),
});

/**
 * What a receipt records. The signature over the canonical body proves
 * that the signer attested to this record at issue time; settlement is
 * established only by the chain evidence the record references.
 */
export const receiptBodySchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  kind: receiptKindSchema,
  receiptId: idSchema,
  issuedAt: z.iso.datetime(),
  network: networkIdentitySchema,
  /** The actor as a commitment (SHA-256 over a domain, the class and the id): never a raw identifier. */
  actor: z.object({
    class: z.enum(['user', 'agent', 'operator', 'system']),
    ref: sha256HexSchema,
  }),
  subject: z.object({
    /** SHA-256 commitment to the owner's account id; the owner's private read carries the id itself. */
    ownerRef: sha256HexSchema,
    intentId: idSchema,
    intentKind: z.enum(['basket_investment', 'single_buy', 'single_sell']),
    planId: idSchema,
    planHash: sha256HexSchema,
    strategyVersionId: idSchema.nullable(),
    manifestHash: sha256HexSchema.nullable(),
    walletAddress: base58AddressSchema,
    continuationOfIntentId: idSchema.nullable(),
  }),
  policy: z.object({
    policyVersion: z.string().nullable(),
    outcome: z.enum(['allow', 'deny']),
    decisionIds: z.array(idSchema).max(64),
    approvedLimits: ownerLimitsSchema.nullable(),
    slippageBps: z.number().int().nonnegative(),
  }),
  sources: z.object({
    venue: z.literal('jupiter'),
    mode: z.enum(['fixture', 'live']),
    quoteRefs: z.array(z.string().max(300)).max(64),
  }),
  hashes: z.object({
    planHash: sha256HexSchema,
    messageHashes: z.array(sha256HexSchema).max(32),
  }),
  approved: z.object({
    legs: z.array(
      z.object({
        legIndex: z.number().int().nonnegative(),
        maxInputRaw: rawAmountSchema,
        minimumOutputRaw: rawAmountSchema,
      }),
    ),
    totalSpendRaw: rawAmountSchema,
    networkFeeMaxLamports: rawAmountSchema,
  }),
  chain: z.object({
    signatures: z.array(z.string().min(80).max(90)).max(32),
    /** The deepest confirmation any referenced signature reached, as recorded. */
    finality: z.enum(['finalized', 'confirmed', 'processed', 'none']),
    slots: z.array(z.number().int().nonnegative()).max(32),
  }),
  fills: z.array(receiptFillSchema).max(32),
  fees: z.object({
    networkFeeLamports: rawAmountSchema,
    rentLamports: rawAmountSchema,
    protocolFeeRaw: rawAmountSchema,
  }),
  timestamps: z.object({
    intentCreatedAt: z.iso.datetime(),
    planCreatedAt: z.iso.datetime(),
    acknowledgedAt: z.iso.datetime().nullable(),
    firstSubmittedAt: z.iso.datetime().nullable(),
    settledAt: z.iso.datetime().nullable(),
  }),
  status: z.object({
    intentState: intentStateSchema,
    terminal: z.boolean(),
    failure: z.string().max(500).nullable(),
    recovery: z.string().max(500).nullable(),
  }),
  /** What the signature does and does not mean; fixed literals so no reader can misread it. */
  scope: z.object({
    attests: z.literal('record'),
    settlement: z.literal('chain_evidence'),
    ownership: z.literal('not_asserted'),
    policy: z.literal('evaluated_as_recorded'),
  }),
});
export type ReceiptBody = z.infer<typeof receiptBodySchema>;

export const receiptSignerSchema = z.object({
  keyId: z.string().min(1).max(64),
  algorithm: z.literal('ed25519'),
  publicKey: base58AddressSchema,
});

export const receiptSchema = z.object({
  /** The owner's account id for the owner and their agents; null in a public (redacted) read. */
  ownerUserId: idSchema.nullable(),
  body: receiptBodySchema,
  /** SHA-256 over the domain-separated canonical JSON of the body. */
  canonicalHash: sha256HexSchema,
  signer: receiptSignerSchema,
  /** Base64 Ed25519 signature over the canonical bytes. */
  signature: z.string().min(80).max(100),
  /** Whether the owner opted this receipt into public (redacted) reading. */
  public: z.boolean(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const receiptListResponseSchema = z.object({
  receipts: z.array(receiptSchema).max(100),
});
export type ReceiptListResponse = z.infer<typeof receiptListResponseSchema>;

export const receiptVerificationKeySchema = z.object({
  keyId: z.string().min(1).max(64),
  algorithm: z.literal('ed25519'),
  publicKey: base58AddressSchema,
  status: z.enum(['active', 'retired']),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime().nullable(),
});
export type ReceiptVerificationKey = z.infer<typeof receiptVerificationKeySchema>;

export const receiptKeysResponseSchema = z.object({
  keys: z.array(receiptVerificationKeySchema).max(32),
  domain: z.literal(RECEIPT_DOMAIN),
  note: z.string().max(300),
});
export type ReceiptKeysResponse = z.infer<typeof receiptKeysResponseSchema>;

export const RECEIPT_VERIFICATION_ISSUES = [
  'BODY_INVALID',
  'HASH_MISMATCH',
  'KEY_UNKNOWN',
  'KEY_RETIRED',
  'SIGNER_MISMATCH',
  'SIGNATURE_INVALID',
] as const;
export const receiptVerificationResultSchema = z.object({
  valid: z.boolean(),
  keyId: z.string().max(64),
  keyStatus: z.enum(['active', 'retired', 'unknown']),
  hashMatches: z.boolean(),
  signatureValid: z.boolean(),
  issues: z.array(z.enum(RECEIPT_VERIFICATION_ISSUES)),
  /** Always stated, so a verified receipt is never mistaken for settlement or ownership. */
  meaning: z.literal(
    'a valid signature proves the signer attested to this record; settlement is established by the chain evidence it references',
  ),
});
export type ReceiptVerificationResult = z.infer<typeof receiptVerificationResultSchema>;
