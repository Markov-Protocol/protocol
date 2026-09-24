import { z } from 'zod';
import { issuerSchema } from './catalog.js';
import { idSchema } from './identity.js';

/**
 * Sourced research and versioned theses (B06). A thesis is a claim with
 * typed statements: facts and issuer assertions must cite source records,
 * opinions are the author's own, and model inferences carry the run that
 * produced them. Instruments are referenced only by admitted catalog ids;
 * a company the catalog does not know becomes a research subject, never a
 * mint. Nothing here is investment advice.
 */

export const STATEMENT_KINDS = [
  'fact',
  'issuer_assertion',
  'user_opinion',
  'model_inference',
] as const;
export const statementKindSchema = z.enum(STATEMENT_KINDS);
export type StatementKind = z.infer<typeof statementKindSchema>;

/** Topics whose claims must rest on issuer or legal evidence rather than memory. */
export const EVIDENCE_TOPICS = ['backing', 'rights', 'fees', 'redemption', 'general'] as const;
export const evidenceTopicSchema = z.enum(EVIDENCE_TOPICS);
export type EvidenceTopic = z.infer<typeof evidenceTopicSchema>;

export const SOURCE_ROLES = ['issuer', 'legal', 'filing', 'news', 'data', 'other'] as const;
export const sourceRoleSchema = z.enum(SOURCE_ROLES);
export type SourceRole = z.infer<typeof sourceRoleSchema>;

export const SOURCE_STATUSES = ['fetched', 'blocked', 'failed'] as const;
export const sourceStatusSchema = z.enum(SOURCE_STATUSES);

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused on purpose
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Plain text only, bounded; markup is stripped on the way in and never rendered as HTML. */
export const plainTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !/[<>]/.test(text), 'markup is not allowed')
    .refine((text) => !CONTROL_CHARACTER.test(text), 'control characters are not allowed');

export const thesisStatementSchema = z.object({
  statementId: z.string().min(1).max(40),
  kind: statementKindSchema,
  topic: evidenceTopicSchema.default('general'),
  text: plainTextSchema(2000),
  /** Source records this statement rests on; required for facts and issuer assertions. */
  sourceIds: z.array(idSchema).max(20).default([]),
  /** Research run that produced a model inference; required for that kind. */
  runId: idSchema.nullable().default(null),
});
export type ThesisStatement = z.infer<typeof thesisStatementSchema>;

export const instrumentReferenceSchema = z.object({
  instrumentId: idSchema,
  note: plainTextSchema(300).nullable().default(null),
});
export type InstrumentReference = z.infer<typeof instrumentReferenceSchema>;

/** A company the author wrote about that the catalog does not carry: research only, never executable. */
export const researchSubjectSchema = z.object({
  name: plainTextSchema(120),
  note: plainTextSchema(300).nullable().default(null),
});
export type ResearchSubject = z.infer<typeof researchSubjectSchema>;

export const thesisRevisionInputSchema = z.object({
  title: plainTextSchema(160),
  claim: plainTextSchema(2000),
  statements: z.array(thesisStatementSchema).max(100).default([]),
  counterarguments: z.array(plainTextSchema(1000)).max(20).default([]),
  instruments: z.array(instrumentReferenceSchema).max(20).default([]),
  subjects: z.array(researchSubjectSchema).max(20).default([]),
  /** Private notes never enter a public projection. */
  privateNotes: plainTextSchema(4000).nullable().default(null),
});
export type ThesisRevisionInput = z.infer<typeof thesisRevisionInputSchema>;

export const thesisRevisionSchema = z.object({
  revisionId: idSchema,
  thesisId: idSchema,
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  claim: z.string(),
  statements: z.array(thesisStatementSchema),
  counterarguments: z.array(z.string()),
  instruments: z.array(instrumentReferenceSchema),
  subjects: z.array(researchSubjectSchema),
  privateNotes: z.string().nullable(),
  authorPrincipal: z.string(),
  /** SHA-256 of the canonical public content (private notes excluded). */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
});
export type ThesisRevision = z.infer<typeof thesisRevisionSchema>;

export const THESIS_VISIBILITIES = ['private', 'public'] as const;
export const thesisVisibilitySchema = z.enum(THESIS_VISIBILITIES);
export const THESIS_STATUSES = ['draft', 'archived'] as const;
export const thesisStatusSchema = z.enum(THESIS_STATUSES);

export const thesisSchema = z.object({
  thesisId: idSchema,
  ownerUserId: idSchema,
  visibility: thesisVisibilitySchema,
  status: thesisStatusSchema,
  currentRevisionNumber: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Thesis = z.infer<typeof thesisSchema>;

export const thesisCreateRequestSchema = z.object({
  visibility: thesisVisibilitySchema.default('private'),
  revision: thesisRevisionInputSchema,
});
export type ThesisCreateRequest = z.infer<typeof thesisCreateRequestSchema>;

export const thesisUpdateRequestSchema = z.object({
  visibility: thesisVisibilitySchema.optional(),
  status: thesisStatusSchema.optional(),
});
export type ThesisUpdateRequest = z.infer<typeof thesisUpdateRequestSchema>;
export type ThesisVisibility = z.infer<typeof thesisVisibilitySchema>;
export type ThesisStatus = z.infer<typeof thesisStatusSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const sourceRecordSchema = z.object({
  sourceId: idSchema,
  thesisId: idSchema,
  role: sourceRoleSchema,
  /** The URL the author gave; `finalUrl` is where the retriever ended up after validated redirects. */
  url: z.url(),
  finalUrl: z.url().nullable(),
  title: z.string().max(300).nullable(),
  status: sourceStatusSchema,
  blockedReason: z.string().max(300).nullable(),
  contentType: z.string().max(100).nullable(),
  byteLength: z.number().int().nonnegative().nullable(),
  contentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  /** Sanitised plain-text excerpt, bounded to what quotation for research permits. */
  excerpt: z.string().max(1200).nullable(),
  publishedAt: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  retrievedAt: z.iso.datetime(),
  redirects: z.array(z.url()).max(5),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const sourceAttachRequestSchema = z.object({
  url: z.url(),
  role: sourceRoleSchema.default('other'),
  /** When the author knows when the source was published or observed; the retriever records when it fetched. */
  publishedAt: z.iso.datetime().nullable().default(null),
  observedAt: z.iso.datetime().nullable().default(null),
});
export type SourceAttachRequest = z.infer<typeof sourceAttachRequestSchema>;

export const thesisDetailSchema = z.object({
  thesis: thesisSchema,
  revision: thesisRevisionSchema,
  sources: z.array(sourceRecordSchema),
});
export type ThesisDetail = z.infer<typeof thesisDetailSchema>;

export const thesisListResponseSchema = z.object({
  theses: z.array(thesisSchema.extend({ title: z.string(), claim: z.string() })),
});
export type ThesisListResponse = z.infer<typeof thesisListResponseSchema>;

export const revisionListResponseSchema = z.object({ revisions: z.array(thesisRevisionSchema) });
export type RevisionListResponse = z.infer<typeof revisionListResponseSchema>;
export const sourceListResponseSchema = z.object({ sources: z.array(sourceRecordSchema) });
export type SourceListResponse = z.infer<typeof sourceListResponseSchema>;

/** Public projection: labelled statements and sources, no private notes, no owner identity. */
export const publicThesisSchema = z.object({
  thesisId: idSchema,
  revisionNumber: z.number().int().positive(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string(),
  claim: z.string(),
  statements: z.array(thesisStatementSchema),
  counterarguments: z.array(z.string()),
  instruments: z.array(instrumentReferenceSchema),
  subjects: z.array(researchSubjectSchema),
  sources: z.array(sourceRecordSchema.omit({ thesisId: true })),
  publishedAt: z.iso.datetime(),
});
export type PublicThesis = z.infer<typeof publicThesisSchema>;

/* ---------------------------------------------------------------- mapping */

export const mappingRequestSchema = z.object({
  companies: z.array(plainTextSchema(120)).min(1).max(50),
});
export type MappingRequest = z.infer<typeof mappingRequestSchema>;

export const mappingMatchSchema = z.object({
  instrumentId: idSchema,
  issuer: issuerSchema,
  symbol: z.string(),
  companyName: z.string(),
  status: z.enum(['admitted', 'paused']),
});

export const mappingResultSchema = z.object({
  company: z.string(),
  /** Deterministic normalisation of the name that was compared. */
  companyKey: z.string(),
  matches: z.array(mappingMatchSchema),
  /** True when nothing admitted or paused matches: the company stays research only. */
  unmatched: z.boolean(),
});
export const mappingResponseSchema = z.object({ results: z.array(mappingResultSchema) });
export type MappingResponse = z.infer<typeof mappingResponseSchema>;

/* ----------------------------------------------------------- research runs */

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const researchRunRequestSchema = z.object({
  thesisId: idSchema,
  question: plainTextSchema(1000),
  /** Sources the model may read; nothing else is retrieved during a run. */
  sourceIds: z.array(idSchema).max(10).default([]),
  budget: z
    .object({
      maxOutputChars: z.number().int().min(200).max(8000).default(4000),
      maxStatements: z.number().int().min(1).max(20).default(8),
    })
    .default({ maxOutputChars: 4000, maxStatements: 8 }),
});
export type ResearchRunRequest = z.infer<typeof researchRunRequestSchema>;

export const runProvenanceSchema = z.object({
  provider: z.string(),
  model: z.string(),
  modelVersion: z.string(),
  /** SHA-256 of the exact prompt text; the text itself is not stored. */
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Tools the run was allowed to call; V1 allows none. */
  toolCalls: z.array(z.object({ tool: z.string(), detail: z.string().max(300) })),
  budgetUsed: z.object({
    outputChars: z.number().int().nonnegative(),
    statements: z.number().int().nonnegative(),
  }),
});

export const runOutputSchema = z.object({
  /** Draft statements, every one labelled `model_inference` and bound to this run. */
  draft: z.array(thesisStatementSchema),
  /** Admitted or paused instruments the run pointed at, validated against the catalog. */
  suggestedInstrumentIds: z.array(idSchema),
  /** Companies the run named that the catalog does not carry. */
  unmatchedCompanies: z.array(z.string()),
  /** Identifiers the model produced that failed validation and were dropped. */
  rejected: z.array(z.string()),
});

export const researchRunSchema = z.object({
  runId: idSchema,
  thesisId: idSchema,
  ownerUserId: idSchema,
  status: runStatusSchema,
  question: z.string(),
  sourceIds: z.array(idSchema),
  budget: z.object({ maxOutputChars: z.number().int(), maxStatements: z.number().int() }),
  provenance: runProvenanceSchema.nullable(),
  output: runOutputSchema.nullable(),
  error: z.string().max(300).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type ResearchRun = z.infer<typeof researchRunSchema>;

export const runListResponseSchema = z.object({ runs: z.array(researchRunSchema) });
export type RunListResponse = z.infer<typeof runListResponseSchema>;
export type RunProvenance = z.infer<typeof runProvenanceSchema>;
export type RunOutput = z.infer<typeof runOutputSchema>;
