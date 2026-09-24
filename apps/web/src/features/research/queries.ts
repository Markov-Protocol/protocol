'use client';

import {
  type MappingResponse,
  mappingResponseSchema,
  type PublicThesis,
  publicThesisSchema,
  type ResearchRun,
  type ResearchRunRequest,
  type RevisionListResponse,
  type RunListResponse,
  researchRunSchema,
  revisionListResponseSchema,
  runListResponseSchema,
  type SourceAttachRequest,
  type SourceRecord,
  type StrategyDetail,
  type StrategyDraftContent,
  type StrategyLimits,
  type StrategyListResponse,
  sourceRecordSchema,
  strategyDetailSchema,
  strategyLimitsSchema,
  strategyListResponseSchema,
  type ThesisCreateRequest,
  type ThesisDetail,
  type ThesisListResponse,
  type ThesisRevision,
  type ThesisRevisionInput,
  type ThesisUpdateRequest,
  thesisDetailSchema,
  thesisListResponseSchema,
  thesisRevisionSchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';

export const thesesKey = (instrumentId: string | null) =>
  ['me', 'theses', instrumentId ?? ''] as const;
export const thesisKey = (thesisId: string) => ['me', 'thesis', thesisId] as const;
export const revisionsKey = (thesisId: string) => ['me', 'thesis', thesisId, 'revisions'] as const;
export const runsKey = (thesisId: string) => ['me', 'thesis', thesisId, 'runs'] as const;
export const runKey = (runId: string) => ['me', 'run', runId] as const;
export const publicThesisKey = (thesisId: string) => ['public', 'thesis', thesisId] as const;
export const BASKET_DRAFTS_KEY = ['me', 'strategies'] as const;
export const STRATEGY_LIMITS_KEY = ['strategies', 'limits'] as const;

/** A 404 from the API is an answer (not found or not yours), not something to retry. */
function retryUnlessNotFound(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

/** The person's theses, newest first; with an instrument id only those whose current revision references it. */
export function useTheses(enabled: boolean, instrumentId: string | null = null) {
  const api = useMarkovApi();
  return useQuery<ThesisListResponse>({
    queryKey: thesesKey(instrumentId),
    enabled,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/me/theses${instrumentId ? `?instrumentId=${encodeURIComponent(instrumentId)}` : ''}`,
        thesisListResponseSchema,
        { signal },
      ),
  });
}

export function useThesis(thesisId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<ThesisDetail>({
    queryKey: thesisKey(thesisId),
    enabled,
    retry: retryUnlessNotFound,
    queryFn: ({ signal }) => api.get(`/v1/me/theses/${thesisId}`, thesisDetailSchema, { signal }),
  });
}

/** The published projection anyone may read: no private notes, no owner. */
export function usePublicThesis(thesisId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<PublicThesis>({
    queryKey: publicThesisKey(thesisId),
    enabled,
    retry: retryUnlessNotFound,
    queryFn: ({ signal }) =>
      api.get(`/v1/research/theses/${thesisId}`, publicThesisSchema, { signal }),
  });
}

export function useRevisions(thesisId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<RevisionListResponse>({
    queryKey: revisionsKey(thesisId),
    enabled,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/theses/${thesisId}/revisions`, revisionListResponseSchema, { signal }),
  });
}

export function useRuns(thesisId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<RunListResponse>({
    queryKey: runsKey(thesisId),
    enabled,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/me/research/runs?thesisId=${encodeURIComponent(thesisId)}`,
        runListResponseSchema,
        { signal },
      ),
  });
}

const FINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export function isRunFinished(run: Pick<ResearchRun, 'status'>): boolean {
  return FINAL_RUN_STATUSES.has(run.status);
}

/** One run, polled every two seconds while it is queued or running. */
export function useRun(runId: string | null) {
  const api = useMarkovApi();
  return useQuery<ResearchRun>({
    queryKey: runKey(runId ?? ''),
    enabled: runId !== null,
    retry: retryUnlessNotFound,
    refetchInterval: (query) =>
      query.state.data && !isRunFinished(query.state.data) ? 2000 : false,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/research/runs/${runId}`, researchRunSchema, { signal }),
  });
}

export function useCreateThesis() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ThesisCreateRequest) =>
      api.post('/v1/me/theses', input, thesisDetailSchema),
    onSuccess: (detail) => {
      client.setQueryData(thesisKey(detail.thesis.thesisId), detail);
      void client.invalidateQueries({ queryKey: ['me', 'theses'] });
    },
  });
}

/** Saving appends an immutable revision; the thesis, its list rows and the revision log are refreshed. */
export function useSaveRevision(thesisId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ThesisRevisionInput) =>
      api.post(`/v1/me/theses/${thesisId}/revisions`, input, thesisRevisionSchema),
    onSuccess: (revision: ThesisRevision) => {
      client.setQueryData<ThesisDetail>(thesisKey(thesisId), (current) =>
        current
          ? {
              ...current,
              revision,
              thesis: {
                ...current.thesis,
                currentRevisionNumber: revision.revisionNumber,
                updatedAt: revision.createdAt,
              },
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: revisionsKey(thesisId) });
      void client.invalidateQueries({ queryKey: ['me', 'theses'] });
    },
  });
}

export function useUpdateThesis(thesisId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ThesisUpdateRequest) =>
      api.patch(`/v1/me/theses/${thesisId}`, input, thesisDetailSchema),
    onSuccess: (detail) => {
      client.setQueryData(thesisKey(thesisId), detail);
      void client.invalidateQueries({ queryKey: ['me', 'theses'] });
      void client.invalidateQueries({ queryKey: publicThesisKey(thesisId) });
    },
  });
}

/** The API retrieves the URL under its safe-retrieval policy; the browser never fetches a source. */
export function useAttachSource(thesisId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceAttachRequest) =>
      api.post(`/v1/me/theses/${thesisId}/sources`, input, sourceRecordSchema),
    onSuccess: (source: SourceRecord) => {
      client.setQueryData<ThesisDetail>(thesisKey(thesisId), (current) =>
        current ? { ...current, sources: [source, ...current.sources] } : current,
      );
    },
  });
}

export function useMapCompanies() {
  const api = useMarkovApi();
  return useMutation({
    mutationFn: (companies: readonly string[]) =>
      api.post('/v1/me/research/mappings', { companies }, mappingResponseSchema),
  });
}
export type { MappingResponse };

export function useCreateRun(thesisId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ResearchRunRequest) =>
      api.post('/v1/me/research/runs', input, researchRunSchema),
    onSuccess: (run) => {
      client.setQueryData(runKey(run.runId), run);
      void client.invalidateQueries({ queryKey: runsKey(thesisId) });
    },
  });
}

export function useCancelRun(thesisId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api.post(`/v1/me/research/runs/${runId}/cancel`, {}, researchRunSchema),
    onSuccess: (run) => {
      client.setQueryData(runKey(run.runId), run);
      void client.invalidateQueries({ queryKey: runsKey(thesisId) });
    },
  });
}

/** Recipe rules of this deployment (public): leg cap and concentration ceilings. */
export function useStrategyLimits(enabled = true) {
  const api = useMarkovApi();
  return useQuery<StrategyLimits>({
    queryKey: STRATEGY_LIMITS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/strategies/limits', strategyLimitsSchema, { signal }),
  });
}

export function useBasketDrafts(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<StrategyListResponse>({
    queryKey: BASKET_DRAFTS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/me/strategies', strategyListResponseSchema, { signal }),
  });
}

/** A basket draft from a shortlist: the backend validates and stores it; nothing is normalised here. */
export function useCreateBasketDraft() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (content: StrategyDraftContent) =>
      api.post('/v1/me/strategies', { content }, strategyDetailSchema),
    onSuccess: (detail: StrategyDetail) => {
      void client.invalidateQueries({ queryKey: BASKET_DRAFTS_KEY });
      return detail;
    },
  });
}
