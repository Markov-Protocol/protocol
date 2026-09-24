'use client';

import {
  corporateActionListResponseSchema,
  type InstrumentActionAvailability,
  type InstrumentDetail,
  instrumentActionAvailabilitySchema,
  instrumentDetailSchema,
  instrumentListResponseSchema,
  multiplierHistoryResponseSchema,
  type Watchlist,
  watchlistSchema,
} from '@markov/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMarkovApi } from '../api/use-markov-api';
import { type InstrumentFilters, PAGE_SIZE, serializeFilters } from './filters';

export const WATCHLIST_KEY = ['me', 'watchlist'] as const;
export const instrumentsKey = (filters: InstrumentFilters) =>
  ['catalog', 'instruments', filters.q, filters.issuer ?? '', filters.kind ?? ''] as const;
export const instrumentKey = (instrumentId: string) =>
  ['catalog', 'instrument', instrumentId] as const;

/**
 * Pages of admitted or paused instruments for one filter set. The key is
 * the filter set, so a late answer to an older search lands in its own
 * cache entry and never replaces newer results; the previous page stays
 * visible (marked as placeholder) while the next one loads.
 */
export function useInstrumentPages(filters: InstrumentFilters) {
  const api = useMarkovApi();
  return useInfiniteQuery({
    queryKey: instrumentsKey(filters),
    queryFn: ({ pageParam, signal }) =>
      api.get(
        `/v1/catalog/instruments${serializeFilters(filters, { cursor: pageParam, limit: PAGE_SIZE })}`,
        instrumentListResponseSchema,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useInstrument(instrumentId: string) {
  const api = useMarkovApi();
  return useQuery<InstrumentDetail>({
    queryKey: instrumentKey(instrumentId),
    queryFn: ({ signal }) =>
      api.get(`/v1/catalog/instruments/${instrumentId}`, instrumentDetailSchema, { signal }),
  });
}

export function useCorporateActions(instrumentId: string) {
  const api = useMarkovApi();
  return useQuery({
    queryKey: ['catalog', 'instrument', instrumentId, 'corporate-actions'] as const,
    queryFn: async ({ signal }) =>
      (
        await api.get(
          `/v1/catalog/instruments/${instrumentId}/corporate-actions`,
          corporateActionListResponseSchema,
          { signal },
        )
      ).actions,
  });
}

export function useMultiplierHistory(instrumentId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery({
    queryKey: ['catalog', 'instrument', instrumentId, 'multipliers'] as const,
    enabled,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/catalog/instruments/${instrumentId}/multipliers`,
        multiplierHistoryResponseSchema,
        { signal },
      ),
  });
}

/** What the signed-in person may do with the instrument now (B05 capability states). */
export function useActionAvailability(instrumentId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<InstrumentActionAvailability>({
    queryKey: ['me', 'instruments', instrumentId, 'availability'] as const,
    enabled,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/me/instruments/${instrumentId}/availability`,
        instrumentActionAvailabilitySchema,
        { signal },
      ),
  });
}

export function useWatchlist(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<Watchlist>({
    queryKey: WATCHLIST_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/me/watchlist', watchlistSchema, { signal }),
  });
}

export function useSaveInstrument() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { instrumentId: string; ifVersion: number | null }) =>
      api.put(
        `/v1/me/watchlist/items/${input.instrumentId}`,
        input.ifVersion === null ? {} : { ifVersion: input.ifVersion },
        watchlistSchema,
      ),
    onSuccess: (watchlist) => client.setQueryData(WATCHLIST_KEY, watchlist),
    onError: () => client.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}

export function useRemoveSavedInstrument() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { instrumentId: string; ifVersion: number | null }) =>
      api.delete(
        `/v1/me/watchlist/items/${input.instrumentId}${input.ifVersion === null ? '' : `?ifVersion=${input.ifVersion}`}`,
        watchlistSchema,
      ),
    onSuccess: (watchlist) => client.setQueryData(WATCHLIST_KEY, watchlist),
    onError: () => client.invalidateQueries({ queryKey: WATCHLIST_KEY }),
  });
}
