'use client';

import {
  type EffectiveLimitsResponse,
  effectiveLimitsResponseSchema,
  type Strategy,
  type StrategyDetail,
  type StrategyDraft,
  type StrategyDraftContent,
  type StrategyStatus,
  strategyDetailSchema,
  strategyDraftSchema,
  strategySchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { BASKET_DRAFTS_KEY } from '../research/queries';

export const strategyKey = (strategyId: string) => ['me', 'strategy', strategyId] as const;
export const EFFECTIVE_LIMITS_KEY = ['me', 'limits'] as const;

function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

/** One draft identity: the strategy, its validated draft with its revision, and the frozen versions. */
export function useStrategy(strategyId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<StrategyDetail>({
    queryKey: strategyKey(strategyId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/strategies/${strategyId}`, strategyDetailSchema, { signal }),
  });
}

export interface SaveDraftInput {
  readonly content: StrategyDraftContent;
  /** The revision the edits started from; the API refuses a stale one with the current revision. */
  readonly ifRevision: number;
}

/** Revision-checked save; the returned draft carries the backend's validation of exactly what was sent. */
export function useSaveDraft(strategyId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDraftInput) =>
      api.put(`/v1/me/strategies/${strategyId}/draft`, input, strategyDraftSchema),
    onSuccess: (draft: StrategyDraft) => {
      client.setQueryData<StrategyDetail>(strategyKey(strategyId), (current) =>
        current
          ? {
              ...current,
              draft,
              strategy: {
                ...current.strategy,
                draftRevision: draft.revision,
                updatedAt: draft.updatedAt,
              },
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: BASKET_DRAFTS_KEY });
    },
  });
}

export function useSetStrategyStatus(strategyId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (status: StrategyStatus) =>
      api.patch(`/v1/me/strategies/${strategyId}`, { status }, strategySchema),
    onSuccess: (strategy: Strategy) => {
      client.setQueryData<StrategyDetail>(strategyKey(strategyId), (current) =>
        current ? { ...current, strategy } : current,
      );
      void client.invalidateQueries({ queryKey: BASKET_DRAFTS_KEY });
    },
  });
}

/** The limits that apply to the person now (policy defaults, beta caps and their own tightening). */
export function useEffectiveLimits(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<EffectiveLimitsResponse>({
    queryKey: EFFECTIVE_LIMITS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/me/limits', effectiveLimitsResponseSchema, { signal }),
  });
}
