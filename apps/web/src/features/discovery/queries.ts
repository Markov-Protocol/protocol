'use client';

import {
  type CreatorProfile,
  creatorProfileSchema,
  type DiscoveryPeriod,
  discoveryResponseSchema,
  type PortfolioInstance,
  portfolioInstanceSchema,
  type RankingResponse,
  rankingResponseSchema,
} from '@markov/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { INSTANCES_KEY, instanceKey } from '../portfolio/queries';
import { STRATEGY_PAGE_SIZE, type StrategyFilters, serializeStrategyFilters } from './filters';

/**
 * Discovery reads are public and carry no per-person state: the keys hold
 * only the filters, so a shared cache can never leak who follows what.
 * Followed state comes from the private follows query and is composed in
 * the view, never written into these entries.
 */
export const strategiesKey = (filters: StrategyFilters) =>
  [
    'discovery',
    'strategies',
    filters.q,
    filters.issuer ?? '',
    filters.instrumentId ?? '',
    filters.creator ?? '',
    filters.period,
    filters.sort,
  ] as const;
export const creatorKey = (publisherWallet: string, period: DiscoveryPeriod) =>
  ['discovery', 'creator', publisherWallet, period] as const;
export const rankingsKey = (period: DiscoveryPeriod) => ['rankings', 'model', period] as const;

/** The most entries one ranking read returns; the API caps a page at this. */
export const RANKINGS_LIMIT = 200;

/** An answer is an answer: nothing below 500 (not found, refused, rate limited) or a shape mismatch is retried. */
function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status < 500 || error.code === 'CONTRACT_MISMATCH')) {
    return false;
  }
  return count < 2;
}

/**
 * Pages of public strategies for one filter set. The key is the filter set,
 * so a late answer to an older search lands in its own cache entry; the
 * previous page stays visible (marked as placeholder) while the next loads.
 */
export function useStrategyPages(filters: StrategyFilters, enabled = true) {
  const api = useMarkovApi();
  return useInfiniteQuery({
    queryKey: strategiesKey(filters),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ pageParam, signal }) =>
      api.get(
        `/v1/strategies${serializeStrategyFilters(filters, { cursor: pageParam, limit: STRATEGY_PAGE_SIZE })}`,
        discoveryResponseSchema,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useCreator(publisherWallet: string, period: DiscoveryPeriod, enabled = true) {
  const api = useMarkovApi();
  return useQuery<CreatorProfile, WebApiError>({
    queryKey: creatorKey(publisherWallet, period),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/creators/${publisherWallet}?period=${period}`, creatorProfileSchema, {
        signal,
      }),
  });
}

/** The model ranking cohort for one period: every entry, ranked and unranked, as the API orders them. */
export function useRankings(period: DiscoveryPeriod, enabled = true) {
  const api = useMarkovApi();
  return useQuery<RankingResponse, WebApiError>({
    queryKey: rankingsKey(period),
    enabled,
    retry: retryUnlessAnswered,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/rankings/model?period=${period}&limit=${RANKINGS_LIMIT}`,
        rankingResponseSchema,
        {
          signal,
        },
      ),
  });
}

/**
 * Accept a proposed version: the pin moves to the version the person names,
 * nothing else changes and nothing trades. The instance cache is replaced
 * with the API's answer so the page shows the pin the server holds.
 */
export function usePinInstance() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<PortfolioInstance, WebApiError, { instanceId: string; versionId: string }>({
    mutationFn: ({ instanceId, versionId }) =>
      api.post(`/v1/me/instances/${instanceId}/pin`, { versionId }, portfolioInstanceSchema),
    onSuccess: (instance) => {
      client.setQueryData<PortfolioInstance>(instanceKey(instance.instanceId), instance);
      void client.invalidateQueries({ queryKey: INSTANCES_KEY });
    },
  });
}
