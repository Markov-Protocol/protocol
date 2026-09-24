import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  ISSUERS,
  type MappingRequest,
  type MappingResponse,
  type PublicThesis,
  type ResearchRun,
  type ResearchRunRequest,
  type RevisionListResponse,
  type RunListResponse,
  type RunOutput,
  type RunProvenance,
  type SourceAttachRequest,
  type SourceListResponse,
  type SourceRecord,
  type SourceRole,
  type SourceStatus,
  type Thesis,
  type ThesisCreateRequest,
  type ThesisDetail,
  type ThesisListQuery,
  type ThesisListResponse,
  type ThesisRevision,
  type ThesisRevisionInput,
  type ThesisStatus,
  type ThesisUpdateRequest,
  type ThesisVisibility,
} from '@markov/contracts';
import {
  appendRevision,
  cancelRun,
  createRun,
  createThesis,
  currentRevision,
  type Database,
  findInstrumentsByIds,
  findRun,
  findThesis,
  findThesisAnyOwner,
  finishRun,
  listInstrumentsForPlanning,
  listRevisions,
  listRuns,
  listSources,
  listTheses,
  type ResearchRunRow,
  recordAuditEvent,
  recordSource,
  type SourceRecordRow,
  startRun,
  type ThesisRevisionRow,
  type ThesisRow,
  updateThesis,
} from '@markov/db';
import {
  canonicalRevision,
  contentHashOf,
  type KnownInstrument,
  type KnownSource,
  type ModelInput,
  mapCompanies,
  promptHashOf,
  type ResearchModelAdapter,
  validateModelOutput,
  validateRevision,
} from '@markov/research';
import { ApiError } from '../errors.js';
import type { Retriever } from './retrieval.js';

/** A model call is bounded in time as well as in output; the run fails rather than hangs. */
export const RUN_TIMEOUT_MS = 20_000;

export interface ResearchServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly retriever: Retriever;
  /** Null when no model provider is configured: manual research works without one. */
  readonly model: ResearchModelAdapter | null;
  readonly now?: () => Date;
}

export interface ResearchService {
  createThesis(
    principal: Principal,
    request: ThesisCreateRequest,
    requestId: string,
  ): Promise<ThesisDetail>;
  listTheses(principal: Principal, query: ThesisListQuery): Promise<ThesisListResponse>;
  getThesis(principal: Principal, thesisId: string): Promise<ThesisDetail>;
  updateThesis(
    principal: Principal,
    thesisId: string,
    request: ThesisUpdateRequest,
    requestId: string,
  ): Promise<ThesisDetail>;
  addRevision(
    principal: Principal,
    thesisId: string,
    input: ThesisRevisionInput,
    requestId: string,
  ): Promise<ThesisRevision>;
  listRevisions(principal: Principal, thesisId: string): Promise<RevisionListResponse>;
  attachSource(
    principal: Principal,
    thesisId: string,
    request: SourceAttachRequest,
    requestId: string,
  ): Promise<SourceRecord>;
  listSources(principal: Principal, thesisId: string): Promise<SourceListResponse>;
  mapCompanies(request: MappingRequest): Promise<MappingResponse>;
  createRun(
    principal: Principal,
    request: ResearchRunRequest,
    requestId: string,
  ): Promise<ResearchRun>;
  getRun(principal: Principal, runId: string): Promise<ResearchRun>;
  listRuns(principal: Principal, thesisId: string | null): Promise<RunListResponse>;
  cancelRun(principal: Principal, runId: string, requestId: string): Promise<ResearchRun>;
  publicThesis(thesisId: string): Promise<PublicThesis>;
}

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

function thesisOf(row: ThesisRow): Thesis {
  return {
    thesisId: row.id,
    ownerUserId: row.ownerUserId,
    visibility: row.visibility as ThesisVisibility,
    status: row.status as ThesisStatus,
    currentRevisionNumber: row.currentRevisionNumber,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function revisionOf(row: ThesisRevisionRow): ThesisRevision {
  return {
    revisionId: row.id,
    thesisId: row.thesisId,
    revisionNumber: row.revisionNumber,
    title: row.title,
    claim: row.claim,
    statements: row.statements,
    counterarguments: row.counterarguments,
    instruments: row.instruments,
    subjects: row.subjects,
    privateNotes: row.privateNotes,
    authorPrincipal: row.authorPrincipal,
    contentHash: row.contentHash,
    createdAt: row.createdAt.toISOString(),
  };
}

function sourceOf(row: SourceRecordRow): SourceRecord {
  return {
    sourceId: row.id,
    thesisId: row.thesisId,
    role: row.role as SourceRole,
    url: row.url,
    finalUrl: row.finalUrl,
    title: row.title,
    status: row.status as SourceStatus,
    blockedReason: row.blockedReason,
    contentType: row.contentType,
    byteLength: row.byteLength,
    contentHash: row.contentHash,
    excerpt: row.excerpt,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    observedAt: row.observedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(),
    redirects: row.redirects,
  };
}

function runOf(row: ResearchRunRow): ResearchRun {
  return {
    runId: row.id,
    thesisId: row.thesisId,
    ownerUserId: row.ownerUserId,
    status: row.status as ResearchRun['status'],
    question: row.question,
    sourceIds: row.sourceIds,
    budget: row.budget,
    provenance: (row.provenance as RunProvenance | null) ?? null,
    output: (row.output as RunOutput | null) ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`model did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export function createResearchService(deps: ResearchServiceDeps): ResearchService {
  const { db, retriever, model } = deps;
  const now = deps.now ?? (() => new Date());

  const authorOf = (principal: Principal) => `${principal.class}:${principal.id}`;

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType,
      targetId,
      requestId,
      details,
    });

  const ownedThesis = async (principal: Principal, thesisId: string): Promise<ThesisRow> => {
    const thesis = await findThesis(db, ownerOf(principal), thesisId);
    if (!thesis) {
      throw new ApiError('NOT_FOUND', 'no thesis with that id');
    }
    return thesis;
  };

  /** Admitted or paused instruments across every issuer: the only executable references. */
  const candidates = async () => {
    const rows = (
      await Promise.all(ISSUERS.map((issuer) => listInstrumentsForPlanning(db, issuer)))
    )
      .flat()
      .filter((row) => row.status === 'admitted' || row.status === 'paused');
    return rows.map((row) => ({
      instrumentId: row.id,
      issuer: row.issuer as (typeof ISSUERS)[number],
      symbol: row.symbol,
      companyName: row.companyName,
      status: row.status,
    }));
  };

  /** Applies the research rules against the catalog, this thesis's sources and its finished runs. */
  const validated = async (
    ownerUserId: string,
    thesisId: string | null,
    input: ThesisRevisionInput,
  ): Promise<{ contentHash: string }> => {
    const instrumentRows = await findInstrumentsByIds(
      db,
      input.instruments.map((reference) => reference.instrumentId),
    );
    const instruments = new Map<string, KnownInstrument>(
      instrumentRows.map((row) => [
        row.id,
        { instrumentId: row.id, companyName: row.companyName, status: row.status },
      ]),
    );
    const sources = new Map<string, KnownSource>();
    const runIds = new Set<string>();
    if (thesisId !== null) {
      for (const row of await listSources(db, thesisId)) {
        sources.set(row.id, {
          sourceId: row.id,
          role: row.role as SourceRole,
          status: row.status as SourceStatus,
        });
      }
      for (const row of await listRuns(db, ownerUserId, thesisId, 500)) {
        if (row.status === 'succeeded') {
          runIds.add(row.id);
        }
      }
    }
    const issues = validateRevision(input, { instruments, sources, runIds });
    if (issues.length > 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'the revision breaks a research rule',
        issues.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
    return { contentHash: contentHashOf(canonicalRevision(input)) };
  };

  const detailOf = async (thesis: ThesisRow): Promise<ThesisDetail> => {
    const [revision, sources] = await Promise.all([
      currentRevision(db, thesis),
      listSources(db, thesis.id),
    ]);
    return {
      thesis: thesisOf(thesis),
      revision: revisionOf(revision),
      sources: sources.map(sourceOf),
    };
  };

  return {
    async createThesis(principal, request, requestId) {
      const ownerUserId = ownerOf(principal);
      const { contentHash } = await validated(ownerUserId, null, request.revision);
      const created = await createThesis(db, {
        ownerUserId,
        visibility: request.visibility,
        revision: { ...request.revision, authorPrincipal: authorOf(principal), contentHash },
        now: now(),
      });
      await audit(principal, 'research.thesis.create', 'thesis', created.thesis.id, requestId, {
        visibility: request.visibility,
        contentHash,
      });
      return detailOf(created.thesis);
    },

    async listTheses(principal, query) {
      const rows = await listTheses(db, ownerOf(principal), {
        instrumentId: query.instrumentId ?? null,
      });
      return {
        theses: rows.map(({ thesis, revision }) => ({
          ...thesisOf(thesis),
          title: revision.title,
          claim: revision.claim,
          instrumentIds: revision.instruments.map((reference) => reference.instrumentId),
        })),
      };
    },

    async getThesis(principal, thesisId) {
      return detailOf(await ownedThesis(principal, thesisId));
    },

    async updateThesis(principal, thesisId, request, requestId) {
      if (principal.class !== 'user') {
        throw new ApiError(
          'FORBIDDEN',
          'only the person can change visibility or archive a thesis',
        );
      }
      const updated = await updateThesis(db, {
        ownerUserId: ownerOf(principal),
        thesisId,
        ...(request.visibility ? { visibility: request.visibility } : {}),
        ...(request.status ? { status: request.status } : {}),
        now: now(),
      });
      if (!updated) {
        throw new ApiError('NOT_FOUND', 'no thesis with that id');
      }
      await audit(principal, 'research.thesis.update', 'thesis', thesisId, requestId, {
        visibility: updated.visibility,
        status: updated.status,
      });
      return detailOf(updated);
    },

    async addRevision(principal, thesisId, input, requestId) {
      const thesis = await ownedThesis(principal, thesisId);
      if (thesis.status === 'archived') {
        throw new ApiError('VALIDATION_FAILED', 'an archived thesis takes no new revisions');
      }
      const { contentHash } = await validated(thesis.ownerUserId, thesis.id, input);
      const appended = await appendRevision(db, {
        ownerUserId: thesis.ownerUserId,
        thesisId: thesis.id,
        revision: { ...input, authorPrincipal: authorOf(principal), contentHash },
        now: now(),
      });
      if (!appended) {
        throw new ApiError('NOT_FOUND', 'no thesis with that id');
      }
      await audit(principal, 'research.revision.create', 'thesis', thesis.id, requestId, {
        revisionNumber: appended.revision.revisionNumber,
        contentHash,
      });
      return revisionOf(appended.revision);
    },

    async listRevisions(principal, thesisId) {
      const thesis = await ownedThesis(principal, thesisId);
      return { revisions: (await listRevisions(db, thesis.id)).map(revisionOf) };
    },

    async attachSource(principal, thesisId, request, requestId) {
      const thesis = await ownedThesis(principal, thesisId);
      const outcome = await retriever.retrieve(request.url);
      const retrievedAt = now();
      const record = await recordSource(
        db,
        outcome.status === 'fetched'
          ? {
              thesisId: thesis.id,
              role: request.role,
              url: request.url,
              finalUrl: outcome.finalUrl,
              title: outcome.title,
              status: 'fetched',
              blockedReason: null,
              contentType: outcome.contentType,
              byteLength: outcome.byteLength,
              contentHash: outcome.contentHash,
              excerpt: outcome.excerpt,
              publishedAt: request.publishedAt ? new Date(request.publishedAt) : null,
              observedAt: request.observedAt ? new Date(request.observedAt) : null,
              retrievedAt,
              redirects: outcome.redirects,
            }
          : {
              thesisId: thesis.id,
              role: request.role,
              url: request.url,
              finalUrl: null,
              title: null,
              status: outcome.status,
              blockedReason: outcome.reason.slice(0, 300),
              contentType: null,
              byteLength: null,
              contentHash: null,
              excerpt: null,
              publishedAt: request.publishedAt ? new Date(request.publishedAt) : null,
              observedAt: request.observedAt ? new Date(request.observedAt) : null,
              retrievedAt,
              redirects: outcome.redirects,
            },
      );
      await audit(principal, 'research.source.attach', 'source', record.id, requestId, {
        thesisId: thesis.id,
        status: outcome.status,
        ...(outcome.status === 'fetched'
          ? { origin: outcome.origin, contentHash: outcome.contentHash }
          : { reason: outcome.reason.slice(0, 300) }),
      });
      return sourceOf(record);
    },

    async listSources(principal, thesisId) {
      const thesis = await ownedThesis(principal, thesisId);
      return { sources: (await listSources(db, thesis.id)).map(sourceOf) };
    },

    async mapCompanies(request) {
      return mapCompanies(request.companies, await candidates());
    },

    async createRun(principal, request, requestId) {
      if (model === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'no research model provider is configured; manual research works without one',
        );
      }
      const thesis = await ownedThesis(principal, request.thesisId);
      const revision = await currentRevision(db, thesis);
      const available = new Map((await listSources(db, thesis.id)).map((row) => [row.id, row]));
      const chosen: SourceRecordRow[] = [];
      for (const sourceId of request.sourceIds) {
        const source = available.get(sourceId);
        if (!source) {
          throw new ApiError('VALIDATION_FAILED', `unknown source ${sourceId}`);
        }
        if (source.status !== 'fetched') {
          throw new ApiError(
            'VALIDATION_FAILED',
            `source ${sourceId} was ${source.status}; a run reads fetched sources only`,
          );
        }
        chosen.push(source);
      }
      const pool = await candidates();
      const input: ModelInput = {
        question: request.question,
        thesis: { title: revision.title, claim: revision.claim },
        sources: chosen.map((source) => ({
          sourceId: source.id,
          role: source.role as SourceRole,
          excerpt: source.excerpt ?? '',
        })),
        candidates: pool,
        budget: request.budget,
      };
      const promptHash = promptHashOf(input);
      const queued = await createRun(db, {
        thesisId: thesis.id,
        ownerUserId: thesis.ownerUserId,
        question: request.question,
        sourceIds: chosen.map((source) => source.id),
        budget: request.budget,
        now: now(),
      });
      const started = await startRun(db, queued.id, now());
      if (!started) {
        return runOf((await findRun(db, thesis.ownerUserId, queued.id)) ?? queued);
      }
      const provenanceBase = {
        provider: model.provider,
        model: model.model,
        modelVersion: model.modelVersion,
        promptHash,
        toolCalls: [] as RunProvenance['toolCalls'],
      };
      let finished: ResearchRunRow | null;
      try {
        const output = await withTimeout(model.generate(input), RUN_TIMEOUT_MS);
        const result = validateModelOutput(output, {
          runId: queued.id,
          candidates: pool,
          sourceIds: new Set(chosen.map((source) => source.id)),
          budget: request.budget,
        });
        const provenance: RunProvenance = { ...provenanceBase, budgetUsed: result.budgetUsed };
        const runOutput: RunOutput = {
          draft: result.draft,
          suggestedInstrumentIds: result.suggestedInstrumentIds,
          unmatchedCompanies: result.unmatchedCompanies,
          rejected: result.rejected,
        };
        finished = await finishRun(db, {
          runId: queued.id,
          status: 'succeeded',
          provenance,
          output: runOutput,
          error: null,
          now: now(),
        });
      } catch (error) {
        const provenance: RunProvenance = {
          ...provenanceBase,
          budgetUsed: { outputChars: 0, statements: 0 },
        };
        finished = await finishRun(db, {
          runId: queued.id,
          status: 'failed',
          provenance,
          output: null,
          error: (error instanceof Error ? error.message : 'model failed').slice(0, 300),
          now: now(),
        });
      }
      const final = finished ?? (await findRun(db, thesis.ownerUserId, queued.id)) ?? queued;
      await audit(principal, 'research.run.create', 'research_run', queued.id, requestId, {
        thesisId: thesis.id,
        status: final.status,
        provider: model.provider,
        model: model.model,
        promptHash,
      });
      return runOf(final);
    },

    async getRun(principal, runId) {
      const run = await findRun(db, ownerOf(principal), runId);
      if (!run) {
        throw new ApiError('NOT_FOUND', 'no research run with that id');
      }
      return runOf(run);
    },

    async listRuns(principal, thesisId) {
      const ownerUserId = ownerOf(principal);
      if (thesisId !== null) {
        await ownedThesis(principal, thesisId);
      }
      return { runs: (await listRuns(db, ownerUserId, thesisId)).map(runOf) };
    },

    async cancelRun(principal, runId, requestId) {
      const ownerUserId = ownerOf(principal);
      const cancelled = await cancelRun(db, ownerUserId, runId, now());
      if (cancelled) {
        await audit(principal, 'research.run.cancel', 'research_run', runId, requestId);
        return runOf(cancelled);
      }
      const run = await findRun(db, ownerUserId, runId);
      if (!run) {
        throw new ApiError('NOT_FOUND', 'no research run with that id');
      }
      // Already finished: cancelling is a no-op and the final state is the answer.
      return runOf(run);
    },

    async publicThesis(thesisId) {
      const thesis = await findThesisAnyOwner(db, thesisId);
      if (!thesis) {
        throw new ApiError('NOT_FOUND', 'no public thesis with that id');
      }
      if (thesis.visibility !== 'public' || thesis.status === 'archived') {
        throw new ApiError('NOT_FOUND', 'no public thesis with that id');
      }
      const [revision, sources] = await Promise.all([
        currentRevision(db, thesis),
        listSources(db, thesis.id),
      ]);
      return {
        thesisId: thesis.id,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
        title: revision.title,
        claim: revision.claim,
        statements: revision.statements,
        counterarguments: revision.counterarguments,
        instruments: revision.instruments,
        subjects: revision.subjects,
        sources: sources.map((row) => {
          const { thesisId: _omitted, ...rest } = sourceOf(row);
          return rest;
        }),
        publishedAt: revision.createdAt.toISOString(),
      };
    },
  };
}
