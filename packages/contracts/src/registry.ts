import { z } from 'zod';
import { issuerSchema, tokenProgramSchema } from './catalog.js';
import { base58AddressSchema, idSchema } from './identity.js';
import { genesisHashSchema, solanaClusterSchema } from './platform.js';
import { basisPointsSchema } from './price.js';
import {
  disclosuresSchema,
  forkOfSchema,
  maintenanceSchema,
  STRATEGY_SCHEMA_VERSION,
  strategyKindSchema,
} from './strategy.js';

/**
 * On-chain strategy registration (B08). A publication is the owner's
 * decision to register one frozen version in the registry program with one
 * of their verified wallets. It moves through `validated` →
 * `awaiting_signature` → `submitted` → `registered`, with `failed`,
 * `expired` and `unknown` branches, and every state is derived from what
 * the chain reports: a database row, a built transaction or an accepted
 * submission is never registration. Public registration is permanent
 * public metadata; nothing here promises deletion of an on-chain record.
 */
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** A base64 wire transaction (at most 1,232 bytes → 1,644 characters). */
export const transactionBase64Schema = z
  .string()
  .min(4)
  .max(1_644)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64');
/** A base58 transaction signature (64 bytes). */
export const transactionSignatureSchema = z
  .string()
  .min(64)
  .max(88)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be base58');

export const PUBLICATION_OPERATIONS = ['register', 'deprecate', 'reactivate'] as const;
export const publicationOperationSchema = z.enum(PUBLICATION_OPERATIONS);
export type PublicationOperation = z.infer<typeof publicationOperationSchema>;

/** Lifecycle of one publication attempt; `unpublished` belongs to a version, never to a publication. */
export const PUBLICATION_LIFECYCLE = [
  'validated',
  'awaiting_signature',
  'submitted',
  'registered',
  'failed',
  'expired',
  'unknown',
] as const;
export const publicationLifecycleSchema = z.enum(PUBLICATION_LIFECYCLE);
export type PublicationLifecycle = z.infer<typeof publicationLifecycleSchema>;

export const REGISTRY_RECORD_STATUSES = ['active', 'deprecated'] as const;
export const registryRecordStatusSchema = z.enum(REGISTRY_RECORD_STATUSES);
export const REGISTRY_RELATIONS = ['none', 'revision', 'fork'] as const;
export const registryRelationSchema = z.enum(REGISTRY_RELATIONS);

export const networkIdentitySchema = z.object({
  cluster: solanaClusterSchema,
  genesisHash: genesisHashSchema,
});

export const registryStatusSchema = z.object({
  /** Whether this deployment can build and submit registrations. */
  publicationEnabled: z.boolean(),
  /** Why publication is disabled, when it is. */
  disabledReason: z.string().nullable(),
  programId: base58AddressSchema.nullable(),
  network: networkIdentitySchema,
  schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
  recordSpace: z.number().int().positive(),
  maxLegs: z.number().int().positive(),
  indexer: z.object({
    lastRunAt: z.iso.datetime().nullable(),
    lastObservedSlot: z.number().int().nonnegative().nullable(),
    recordsIndexed: z.number().int().nonnegative(),
  }),
});
export type RegistryStatus = z.infer<typeof registryStatusSchema>;

/** One constituent as the chain stores it: mint, token program and weight. */
export const registryLegSchema = z.object({
  mint: base58AddressSchema,
  tokenProgram: tokenProgramSchema,
  weightBps: basisPointsSchema.min(1),
});

/** A record as indexed from the chain; exists whether or not a Markov version matches it. */
export const registryRecordSchema = z.object({
  address: base58AddressSchema,
  programId: base58AddressSchema,
  network: networkIdentitySchema,
  publisher: base58AddressSchema,
  status: registryRecordStatusSchema,
  layoutVersion: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  relation: registryRelationSchema,
  parentManifestHash: sha256HexSchema.nullable(),
  manifestHash: sha256HexSchema,
  contentDigest: sha256HexSchema,
  cashWeightBps: basisPointsSchema,
  legs: z.array(registryLegSchema),
  registeredSlot: z.number().int().nonnegative(),
  registeredAt: z.iso.datetime(),
  statusUpdatedSlot: z.number().int().nonnegative(),
  /** The Markov version whose manifest hash this record carries, when one is public. */
  version: z
    .object({ strategyId: idSchema, versionId: idSchema, versionNumber: z.number().int() })
    .nullable(),
  observedSlot: z.number().int().nonnegative(),
  observedAt: z.iso.datetime(),
  explorerUrl: z.url().nullable(),
});
export type RegistryRecord = z.infer<typeof registryRecordSchema>;

/** Registration evidence: finalized transaction and the record the chain holds. */
export const registrationEvidenceSchema = z.object({
  signature: transactionSignatureSchema,
  slot: z.number().int().nonnegative(),
  blockTime: z.iso.datetime().nullable(),
  recordAddress: base58AddressSchema,
  publisher: base58AddressSchema,
  status: registryRecordStatusSchema,
  transactionUrl: z.url().nullable(),
  recordUrl: z.url().nullable(),
});
export type RegistrationEvidence = z.infer<typeof registrationEvidenceSchema>;

export const PUBLICATION_FAILURE_CODES = [
  'program_error',
  'transaction_error',
  'rejected_by_node',
  'blockhash_expired',
  'record_mismatch',
] as const;
export const publicationFailureSchema = z.object({
  code: z.enum(PUBLICATION_FAILURE_CODES),
  /** The program's custom error code, when the chain reported one. */
  programErrorCode: z.number().int().nullable(),
  programError: z.string().nullable(),
  message: z.string().max(500),
});
export type PublicationFailure = z.infer<typeof publicationFailureSchema>;

/** The unsigned transaction the owner's wallet signs; present only while a signature is awaited. */
export const publicationTransactionSchema = z.object({
  /** Wire transaction with zeroed signature slots (base64): what `solana:signTransaction` receives. */
  unsignedTransaction: transactionBase64Schema,
  /** The message bytes the signature covers (base64), for verification and for signers that take a message. */
  message: z.string(),
  recentBlockhash: base58AddressSchema,
  lastValidBlockHeight: z.number().int().nonnegative(),
  feePayer: base58AddressSchema,
  /** Rent the record costs the publisher, in lamports, plus the base fee. */
  estimatedCostLamports: z.number().int().nonnegative(),
});

/** Exactly what becomes public on chain and in the public API, and what never does. */
export const publicationPreviewSchema = z.object({
  manifest: z.object({
    schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
    kind: strategyKindSchema,
    network: networkIdentitySchema,
    strategyId: idSchema,
    versionNumber: z.number().int().positive(),
    parentVersionId: idSchema.nullable(),
    forkOf: forkOfSchema.nullable(),
    title: z.string(),
    thesis: z.string(),
    thesisId: idSchema.nullable(),
    legs: z.array(
      z.object({
        instrumentId: idSchema,
        symbol: z.string(),
        issuer: issuerSchema,
        mint: base58AddressSchema,
        tokenProgram: tokenProgramSchema,
        weightBps: basisPointsSchema.min(1),
      }),
    ),
    cashWeightBps: basisPointsSchema,
    maintenance: maintenanceSchema,
    references: z.array(z.string()),
    manifestHash: sha256HexSchema,
    contentDigest: sha256HexSchema,
  }),
  onChain: z.object({
    recordAddress: base58AddressSchema,
    publisher: base58AddressSchema,
    legs: z.array(registryLegSchema),
    cashWeightBps: basisPointsSchema,
    manifestHash: sha256HexSchema,
    contentDigest: sha256HexSchema,
    relation: registryRelationSchema,
    parentManifestHash: sha256HexSchema.nullable(),
    parentRecordAddress: base58AddressSchema.nullable(),
  }),
  /** Named things that stay private whatever happens. */
  neverPublished: z.array(z.string()),
  /** Registration is permanent: a plain statement the person confirms. */
  permanence: z.string(),
});
export type PublicationPreview = z.infer<typeof publicationPreviewSchema>;

export const publicationSchema = z.object({
  publicationId: idSchema,
  strategyId: idSchema,
  versionId: idSchema,
  operation: publicationOperationSchema,
  state: publicationLifecycleSchema,
  programId: base58AddressSchema,
  network: networkIdentitySchema,
  recordAddress: base58AddressSchema,
  publisher: z.object({ walletId: idSchema, address: base58AddressSchema }),
  manifestHash: sha256HexSchema,
  contentDigest: sha256HexSchema,
  transaction: publicationTransactionSchema.nullable(),
  signature: transactionSignatureSchema.nullable(),
  submittedAt: z.iso.datetime().nullable(),
  /** The node's confirmation level of the submitted transaction at the last check; only `finalized` can register. */
  confirmationStatus: z.enum(['processed', 'confirmed', 'finalized']).nullable(),
  evidence: registrationEvidenceSchema.nullable(),
  failure: publicationFailureSchema.nullable(),
  preview: publicationPreviewSchema,
  /** When the chain was last consulted about this publication. */
  lastCheckedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Publication = z.infer<typeof publicationSchema>;

export const publicationPrepareRequestSchema = z.object({
  /** One of the caller's verified wallets; it signs, pays and becomes the record's publisher. */
  walletId: idSchema,
});
export type PublicationPrepareRequest = z.infer<typeof publicationPrepareRequestSchema>;

/** Ask the publisher wallet to mark a registered version deprecated or active again. */
export const statusChangeRequestSchema = z.object({
  walletId: idSchema,
  status: registryRecordStatusSchema,
});
export type StatusChangeRequest = z.infer<typeof statusChangeRequestSchema>;

export const publicationSubmitRequestSchema = z.object({
  /** The prepared transaction, signed by the publisher wallet, base64. */
  signedTransaction: transactionBase64Schema,
});
export type PublicationSubmitRequest = z.infer<typeof publicationSubmitRequestSchema>;

/** Registered, publicly listed version: manifest, hash and chain evidence, verified on read. */
export const publicVersionSchema = z.object({
  strategyId: idSchema,
  versionId: idSchema,
  versionNumber: z.number().int().positive(),
  schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
  kind: strategyKindSchema,
  title: z.string(),
  thesis: z.string(),
  thesisId: idSchema.nullable(),
  legs: z.array(
    z.object({
      instrumentId: idSchema,
      symbol: z.string(),
      companyName: z.string(),
      issuer: issuerSchema,
      mint: base58AddressSchema,
      tokenProgram: tokenProgramSchema,
      weightBps: basisPointsSchema.min(1),
    }),
  ),
  cashWeightBps: basisPointsSchema,
  maintenance: maintenanceSchema,
  disclosures: disclosuresSchema,
  references: z.array(z.string()),
  parentVersionId: idSchema.nullable(),
  forkOf: forkOfSchema.nullable(),
  /** The exact canonical bytes the manifest hash covers, so anyone can recompute it. */
  canonicalManifest: z.string(),
  manifestHash: sha256HexSchema,
  contentDigest: sha256HexSchema,
  registration: registrationEvidenceSchema,
  verification: z.object({
    /** The manifest hash recomputed from `canonicalManifest` equals the hash the record carries. */
    manifestHashMatches: z.boolean(),
    /** The record's legs, cash, digest and lineage equal the version's. */
    contentMatches: z.boolean(),
    recomputedManifestHash: sha256HexSchema,
    mismatches: z.array(z.string()),
    checkedAt: z.iso.datetime(),
  }),
  deprecatedBy: idSchema.nullable(),
  frozenAt: z.iso.datetime(),
});
export type PublicVersion = z.infer<typeof publicVersionSchema>;

export const publicStrategySchema = z.object({
  strategyId: idSchema,
  title: z.string(),
  forkOf: forkOfSchema.nullable(),
  /** People following this strategy (F08); a count, never who. */
  followerCount: z.number().int().nonnegative(),
  versions: z.array(
    z.object({
      versionId: idSchema,
      versionNumber: z.number().int().positive(),
      title: z.string(),
      manifestHash: sha256HexSchema,
      recordAddress: base58AddressSchema,
      status: registryRecordStatusSchema,
      registeredAt: z.iso.datetime(),
      frozenAt: z.iso.datetime(),
    }),
  ),
});
export type PublicStrategy = z.infer<typeof publicStrategySchema>;
