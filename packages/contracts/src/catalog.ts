import { z } from 'zod';
import { base58AddressSchema, idSchema } from './identity.js';
import { genesisHashSchema } from './platform.js';
import { typedPriceSchema } from './price.js';

/**
 * Instrument catalog. Every instrument is a token issued by a known issuer
 * and admitted by an operator after on-chain verification; nothing here is
 * a quote, an offer or an eligibility decision.
 */
export const ISSUERS = ['prestocks', 'xstocks', 'tessera'] as const;
export const issuerSchema = z.enum(ISSUERS);
export type Issuer = z.infer<typeof issuerSchema>;

export const INSTRUMENT_KINDS = ['pre_ipo_exposure', 'listed_stock'] as const;
export const instrumentKindSchema = z.enum(INSTRUMENT_KINDS);
export type InstrumentKind = z.infer<typeof instrumentKindSchema>;

/**
 * Lifecycle. Ingested products start quarantined; only an operator decision
 * admits them, and only after the mint matched on chain. Paused instruments
 * stay visible for research but cannot enter a new strategy version.
 */
export const INSTRUMENT_STATUSES = [
  'quarantined',
  'admitted',
  'paused',
  'rejected',
  'delisted',
] as const;
export const instrumentStatusSchema = z.enum(INSTRUMENT_STATUSES);
export type InstrumentStatus = z.infer<typeof instrumentStatusSchema>;

export const TOKEN_PROGRAMS = ['spl-token', 'token-2022', 'unknown'] as const;
export const tokenProgramSchema = z.enum(TOKEN_PROGRAMS);
export type TokenProgram = z.infer<typeof tokenProgramSchema>;

/** Symbol rule shared by ingestion and search: uppercase letters, digits, dot and dash, 1 to 12 characters. */
export const INSTRUMENT_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
export const instrumentSymbolSchema = z.string().regex(INSTRUMENT_SYMBOL_PATTERN);

/** Reference prices a catalog may carry. Never an execution quote. */
export const CATALOG_PRICE_KINDS = [
  'issuer_mark',
  'implied_valuation',
  'secondary_market',
] as const;
export const catalogPriceSchema = typedPriceSchema.extend({
  kind: z.enum(CATALOG_PRICE_KINDS),
  expiresAt: z.null(),
});
export type CatalogPrice = z.infer<typeof catalogPriceSchema>;

/**
 * What a principal may do with an instrument right now. `trade` is false
 * for every instrument until execution and policy sessions (B05, B09, B10)
 * turn it on per action and per owner; the catalog never implies it.
 */
export const instrumentAvailabilitySchema = z.object({
  research: z.boolean(),
  strategy: z.boolean(),
  trade: z.literal(false),
  reasons: z.array(z.string().max(100)),
});
export type InstrumentAvailability = z.infer<typeof instrumentAvailabilitySchema>;

export const onChainMintSchema = z.object({
  tokenProgram: tokenProgramSchema,
  decimals: z.number().int().min(0).max(255),
  /** Supply in base units as a digit string; never a float. */
  supply: z.string().regex(/^\d+$/),
  mintAuthority: base58AddressSchema.nullable(),
  freezeAuthority: base58AddressSchema.nullable(),
  isInitialized: z.boolean(),
  /** Token-2022 extension names present on the mint (empty for spl-token). */
  extensions: z.array(z.string().max(60)),
  /** Extension type numbers the parser did not recognise; presence blocks admission until reviewed. */
  unknownExtensionTypes: z.array(z.number().int()),
});
export type OnChainMint = z.infer<typeof onChainMintSchema>;

export const MINT_VERIFICATION_RESULTS = [
  'verified',
  'mismatch',
  'not_found',
  'not_a_mint',
  'error',
] as const;
export const mintVerificationResultSchema = z.enum(MINT_VERIFICATION_RESULTS);
export type MintVerificationResult = z.infer<typeof mintVerificationResultSchema>;

export const mintVerificationSchema = z.object({
  verificationId: z.number().int(),
  instrumentId: idSchema,
  verifiedAt: z.iso.datetime(),
  /** Host of the RPC endpoint used, never the URL with its key. */
  rpcHost: z.string().max(253),
  slot: z.number().int().nullable(),
  result: mintVerificationResultSchema,
  onChain: onChainMintSchema.nullable(),
  mismatches: z.array(z.string().max(200)),
});
export type MintVerification = z.infer<typeof mintVerificationSchema>;

const instrumentBaseSchema = z.object({
  instrumentId: idSchema,
  issuer: issuerSchema,
  issuerProductId: z.string().min(1).max(100),
  symbol: instrumentSymbolSchema,
  name: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  kind: instrumentKindSchema,
  chain: z.literal('solana'),
  genesisHash: genesisHashSchema,
  mint: base58AddressSchema,
  decimals: z.number().int().min(0).max(18),
  tokenProgram: tokenProgramSchema,
  status: instrumentStatusSchema,
  statusReason: z.string().max(500).nullable(),
  /** Sanitised, length-limited issuer metadata; never HTML. */
  metadata: z.object({
    website: z.url().nullable(),
    description: z.string().max(1000).nullable(),
  }),
  referencePrice: catalogPriceSchema.nullable(),
  availability: instrumentAvailabilitySchema,
  admittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

/** Public projection: only admitted or paused instruments are ever listed publicly. */
export const instrumentSchema = instrumentBaseSchema;
export type Instrument = z.infer<typeof instrumentSchema>;

export const instrumentDetailSchema = instrumentBaseSchema.extend({
  latestMintVerification: mintVerificationSchema.nullable(),
});
export type InstrumentDetail = z.infer<typeof instrumentDetailSchema>;

export const instrumentListQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  issuer: issuerSchema.optional(),
  kind: instrumentKindSchema.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const operatorInstrumentListQuerySchema = instrumentListQuerySchema.extend({
  status: instrumentStatusSchema.optional(),
});

export const instrumentListResponseSchema = z.object({
  instruments: z.array(instrumentSchema),
  nextCursor: z.string().nullable(),
});
export type InstrumentListResponse = z.infer<typeof instrumentListResponseSchema>;

/** Operator lifecycle decisions. Admission needs a matching mint verification; nothing admits automatically. */
export const INSTRUMENT_DECISIONS = ['admit', 'reject', 'pause', 'resume', 'delist'] as const;
export const instrumentDecisionKindSchema = z.enum(INSTRUMENT_DECISIONS);
export type InstrumentDecisionKind = z.infer<typeof instrumentDecisionKindSchema>;

export const instrumentDecisionRequestSchema = z.object({
  decision: instrumentDecisionKindSchema,
  reason: z.string().trim().min(3).max(500),
  /** Secret-free references: terms review ids, document hashes, ticket links. */
  evidence: z.record(z.string().max(60), z.string().max(500)).default({}),
});

export const instrumentDecisionSchema = z.object({
  decisionId: z.number().int(),
  instrumentId: idSchema,
  decision: instrumentDecisionKindSchema,
  reason: z.string(),
  evidence: z.record(z.string(), z.string()),
  previousStatus: instrumentStatusSchema,
  newStatus: instrumentStatusSchema,
  decidedBy: z.string(),
  decidedAt: z.iso.datetime(),
});
export type InstrumentDecision = z.infer<typeof instrumentDecisionSchema>;

/** Where an ingestion reads from. Fixture sources exist only in local and test modes. */
export const INGESTION_SOURCES = ['fixture', 'configured_url'] as const;
export const ingestionSourceSchema = z.enum(INGESTION_SOURCES);
export type IngestionSource = z.infer<typeof ingestionSourceSchema>;

export const ingestionRequestSchema = z.object({
  issuer: issuerSchema,
  source: ingestionSourceSchema,
});

export const SNAPSHOT_STATUSES = ['accepted', 'rejected'] as const;
export const snapshotStatusSchema = z.enum(SNAPSHOT_STATUSES);

export const issuerSnapshotSchema = z.object({
  snapshotId: idSchema,
  issuer: issuerSchema,
  source: ingestionSourceSchema,
  /** Fixture name or the URL without query string or credentials. */
  sourceRef: z.string().max(500),
  fetchedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  schemaVersion: z.string().max(20).nullable(),
  itemCount: z.number().int().min(0),
  status: snapshotStatusSchema,
  rejectionReason: z.string().max(1000).nullable(),
  createdBy: z.string(),
});
export type IssuerSnapshot = z.infer<typeof issuerSnapshotSchema>;

export const ingestionProductOutcomeSchema = z.object({
  issuerProductId: z.string(),
  symbol: z.string().nullable(),
  outcome: z.enum(['inserted', 'updated', 'unchanged', 'rejected', 'paused']),
  reasons: z.array(z.string().max(200)),
});

export const ingestionReportSchema = z.object({
  snapshot: issuerSnapshotSchema,
  products: z.array(ingestionProductOutcomeSchema),
  counts: z.object({
    inserted: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    rejected: z.number().int(),
    paused: z.number().int(),
  }),
});
export type IngestionReport = z.infer<typeof ingestionReportSchema>;

export const snapshotListResponseSchema = z.object({ snapshots: z.array(issuerSnapshotSchema) });

/**
 * Issuer product feed, schema version 1. This is a Markov-owned contract for
 * what an issuer source must deliver after its adapter mapped the upstream
 * response; it is not a claim about any issuer's public API.
 */
export const ISSUER_FEED_SCHEMA_VERSION = '1' as const;

/**
 * Field-level problems (empty names, bad mints, out-of-range decimals) are
 * rejected per product by the catalog rules with every reason listed; only
 * structural drift (renamed or missing keys, unknown schema version) rejects
 * a whole snapshot.
 */
export const issuerFeedProductSchema = z.object({
  productId: z.string().max(100),
  symbol: z.string().max(40),
  name: z.string().max(200),
  companyName: z.string().max(200),
  kind: instrumentKindSchema,
  mint: z.string().max(60),
  decimals: z.number().int(),
  tokenProgram: tokenProgramSchema.optional(),
  website: z.string().max(500).optional(),
  description: z.string().max(4000).optional(),
  referencePrice: z
    .object({
      value: z.string().max(60),
      unit: z.string().max(20),
      kind: z.enum(CATALOG_PRICE_KINDS),
      observedAt: z.iso.datetime(),
      source: z.string().max(200),
    })
    .optional(),
});
export type IssuerFeedProduct = z.infer<typeof issuerFeedProductSchema>;

export const issuerFeedSchema = z.object({
  schemaVersion: z.literal(ISSUER_FEED_SCHEMA_VERSION),
  issuer: issuerSchema,
  generatedAt: z.iso.datetime(),
  products: z.array(issuerFeedProductSchema).max(5000),
});
export type IssuerFeed = z.infer<typeof issuerFeedSchema>;
