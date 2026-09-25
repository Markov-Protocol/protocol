'use client';

import {
  type FollowListResponse,
  followListResponseSchema,
  type Publication,
  type PublicStrategy,
  type PublicVersion,
  publicationSchema,
  publicStrategySchema,
  publicVersionSchema,
  type RegistryRecord,
  type RegistryStatus,
  registryRecordSchema,
  registryStatusSchema,
  type StrategyDetail,
  type StrategyVersion,
  strategyDetailSchema,
  strategyVersionSchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { strategyKey } from '../builder/queries';
import { BASKET_DRAFTS_KEY } from '../research/queries';

export const REGISTRY_KEY = ['registry', 'status'] as const;
export const FOLLOWS_KEY = ['me', 'follows'] as const;
export const publicStrategyKey = (strategyId: string) =>
  ['public', 'strategy', strategyId] as const;
export const publicVersionKey = (strategyId: string, versionId: string) =>
  ['public', 'strategy', strategyId, 'version', versionId] as const;
export const ownVersionKey = (strategyId: string, versionId: string) =>
  ['me', 'strategy', strategyId, 'version', versionId] as const;
export const publicationKey = (strategyId: string, versionId: string) =>
  ['me', 'strategy', strategyId, 'version', versionId, 'publication'] as const;
export const statusChangeKey = (strategyId: string, versionId: string) =>
  ['me', 'strategy', strategyId, 'version', versionId, 'status-change'] as const;
export const recordKey = (address: string) => ['registry', 'record', address] as const;

function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

/** Program id, network and whether this deployment can register at all. */
export function useRegistryStatus(enabled = true) {
  const api = useMarkovApi();
  return useQuery<RegistryStatus>({
    queryKey: REGISTRY_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: ({ signal }) => api.get('/v1/registry', registryStatusSchema, { signal }),
  });
}

export function usePublicStrategy(strategyId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<PublicStrategy>({
    queryKey: publicStrategyKey(strategyId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/strategies/${strategyId}`, publicStrategySchema, { signal }),
  });
}

export function usePublicVersion(strategyId: string, versionId: string | null, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<PublicVersion>({
    queryKey: publicVersionKey(strategyId, versionId ?? ''),
    enabled: enabled && versionId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/strategies/${strategyId}/versions/${versionId}`, publicVersionSchema, {
        signal,
      }),
  });
}

export function useOwnVersion(strategyId: string, versionId: string | null, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<StrategyVersion>({
    queryKey: ownVersionKey(strategyId, versionId ?? ''),
    enabled: enabled && versionId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/strategies/${strategyId}/versions/${versionId}`, strategyVersionSchema, {
        signal,
      }),
  });
}

export function useRegistryRecord(address: string | null) {
  const api = useMarkovApi();
  return useQuery<RegistryRecord>({
    queryKey: recordKey(address ?? ''),
    enabled: address !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/registry/records/${address}`, registryRecordSchema, { signal }),
  });
}

/** How often to ask the API again while the chain has not decided; the API re-checks on every read. */
export function publicationPollInterval(
  publication: Publication | null | undefined,
): number | false {
  if (!publication) {
    return false;
  }
  if (publication.state === 'submitted') {
    return 3000;
  }
  if (publication.state === 'unknown') {
    return 10_000;
  }
  return false;
}

/**
 * The latest registration attempt of a version: null before anything was
 * prepared (the API answers 404), polled while the network has not decided.
 * A reload lands here first, so the status a person sees after a refresh
 * is what the chain reports, never what the last click assumed.
 */
export function useVersionPublication(strategyId: string, versionId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<Publication | null>({
    queryKey: publicationKey(strategyId, versionId),
    enabled,
    retry: retryUnlessAnswered,
    refetchInterval: (query) => publicationPollInterval(query.state.data),
    queryFn: async ({ signal }) => {
      try {
        return await api.get(
          `/v1/me/strategies/${strategyId}/versions/${versionId}/publication`,
          publicationSchema,
          { signal },
        );
      } catch (error) {
        if (error instanceof WebApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

/**
 * The latest deprecation or reactivation attempt of a version (its own
 * publication, apart from the registration): null before any was prepared,
 * polled while the network has not decided.
 */
export function useVersionStatusChange(strategyId: string, versionId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<Publication | null>({
    queryKey: statusChangeKey(strategyId, versionId),
    enabled,
    retry: retryUnlessAnswered,
    refetchInterval: (query) => publicationPollInterval(query.state.data),
    queryFn: async ({ signal }) => {
      try {
        return await api.get(
          `/v1/me/strategies/${strategyId}/versions/${versionId}/status-changes`,
          publicationSchema,
          { signal },
        );
      } catch (error) {
        if (error instanceof WebApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
}

/** Keeps the caches in step with a publication the API just answered: registration or status change, by operation. */
function useRecordPublication(strategyId: string, versionId: string) {
  const client = useQueryClient();
  return (publication: Publication) => {
    const key =
      publication.operation === 'register'
        ? publicationKey(strategyId, versionId)
        : statusChangeKey(strategyId, versionId);
    client.setQueryData<Publication | null>(key, publication);
    void client.invalidateQueries({ queryKey: ownVersionKey(strategyId, versionId) });
    void client.invalidateQueries({ queryKey: strategyKey(strategyId), exact: true });
    if (publication.state === 'registered') {
      void client.invalidateQueries({ queryKey: publicVersionKey(strategyId, versionId) });
      void client.invalidateQueries({ queryKey: publicStrategyKey(strategyId) });
    }
  };
}

/** Prepare the registration with one verified wallet; answers the preview, the cost and the unsigned transaction. */
export function usePreparePublication(strategyId: string, versionId: string) {
  const api = useMarkovApi();
  const record = useRecordPublication(strategyId, versionId);
  return useMutation({
    mutationFn: (walletId: string) =>
      api.post(
        `/v1/me/strategies/${strategyId}/versions/${versionId}/publication`,
        { walletId },
        publicationSchema,
      ),
    onSuccess: record,
  });
}

export function usePrepareStatusChange(strategyId: string, versionId: string) {
  const api = useMarkovApi();
  const record = useRecordPublication(strategyId, versionId);
  return useMutation({
    mutationFn: (input: { walletId: string; status: 'active' | 'deprecated' }) =>
      api.post(
        `/v1/me/strategies/${strategyId}/versions/${versionId}/status-changes`,
        input,
        publicationSchema,
      ),
    onSuccess: record,
  });
}

/** Submit the wallet-signed transaction; the API checks the message and signature before the node sees it. */
export function useSubmitPublication(strategyId: string, versionId: string) {
  const api = useMarkovApi();
  const record = useRecordPublication(strategyId, versionId);
  return useMutation({
    mutationFn: (input: { publicationId: string; signedTransaction: string }) =>
      api.post(
        `/v1/me/publications/${input.publicationId}/submit`,
        { signedTransaction: input.signedTransaction },
        publicationSchema,
      ),
    onSuccess: record,
  });
}

/** Freeze the validated draft as the next immutable version (200 with the current one when nothing changed). */
export function useFreezeVersion(strategyId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ifRevision: number | null) =>
      api.post(
        `/v1/me/strategies/${strategyId}/versions`,
        ifRevision === null ? {} : { ifRevision },
        strategyVersionSchema,
      ),
    onSuccess: (version: StrategyVersion) => {
      client.setQueryData<StrategyVersion>(ownVersionKey(strategyId, version.versionId), version);
      void client.invalidateQueries({ queryKey: strategyKey(strategyId) });
      void client.invalidateQueries({ queryKey: BASKET_DRAFTS_KEY });
    },
  });
}

/** Fork a version into a new private draft of the caller's own, with attribution. */
export function useForkVersion(strategyId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/v1/me/strategies/${strategyId}/forks`, { versionId }, strategyDetailSchema),
    onSuccess: (detail: StrategyDetail) => {
      client.setQueryData<StrategyDetail>(strategyKey(detail.strategy.strategyId), detail);
      void client.invalidateQueries({ queryKey: BASKET_DRAFTS_KEY });
    },
  });
}

export function useFollows(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<FollowListResponse>({
    queryKey: FOLLOWS_KEY,
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) => api.get('/v1/me/follows', followListResponseSchema, { signal }),
  });
}

function useRecordFollows() {
  const client = useQueryClient();
  return (strategyId: string, follows: FollowListResponse) => {
    client.setQueryData<FollowListResponse>(FOLLOWS_KEY, follows);
    void client.invalidateQueries({ queryKey: publicStrategyKey(strategyId) });
  };
}

export function useFollow() {
  const api = useMarkovApi();
  const record = useRecordFollows();
  return useMutation({
    mutationFn: (strategyId: string) =>
      api.put(`/v1/me/follows/${strategyId}`, {}, followListResponseSchema),
    onSuccess: (follows, strategyId) => record(strategyId, follows),
  });
}

export function useUnfollow() {
  const api = useMarkovApi();
  const record = useRecordFollows();
  return useMutation({
    mutationFn: (strategyId: string) =>
      api.delete(`/v1/me/follows/${strategyId}`, followListResponseSchema),
    onSuccess: (follows, strategyId) => record(strategyId, follows),
  });
}
