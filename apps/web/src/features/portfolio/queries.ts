'use client';

import {
  type ExternalFlowAcknowledgementRequest,
  type InstanceCreateRequest,
  type InstanceHoldingsResponse,
  instanceHoldingsResponseSchema,
  instanceListResponseSchema,
  type JournalEntry,
  type JournalListResponse,
  journalEntrySchema,
  journalListResponseSchema,
  type MethodologySummary,
  methodologySummarySchema,
  type PerformanceExport,
  type PerformancePeriod,
  type PerformanceResponse,
  type PortfolioInstance,
  performanceExportSchema,
  performanceResponseSchema,
  portfolioInstanceSchema,
  type WalletHoldingsResponse,
  walletHoldingsResponseSchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';

export const INSTANCES_KEY = ['me', 'instances'] as const;
export const instanceKey = (instanceId: string) => ['me', 'instance', instanceId] as const;
export const instanceHoldingsKey = (instanceId: string) =>
  ['me', 'instance', instanceId, 'holdings'] as const;
export const walletHoldingsKey = (walletId: string) =>
  ['me', 'wallets', walletId, 'holdings'] as const;
export const walletJournalKey = (walletId: string) =>
  ['me', 'wallets', walletId, 'journal'] as const;
export const walletPerformanceKey = (walletId: string, period: PerformancePeriod) =>
  ['me', 'wallets', walletId, 'performance', period] as const;
export const instancePerformanceKey = (instanceId: string, period: PerformancePeriod) =>
  ['me', 'instance', instanceId, 'performance', period] as const;
export const versionPerformanceKey = (
  strategyId: string,
  versionNumber: number,
  period: PerformancePeriod,
) => ['strategy', strategyId, 'version', String(versionNumber), 'performance', period] as const;
export const METHODOLOGY_KEY = ['performance', 'methodology'] as const;

function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

export function useInstances(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<readonly PortfolioInstance[], WebApiError>({
    queryKey: INSTANCES_KEY,
    enabled,
    retry: retryUnlessAnswered,
    queryFn: async ({ signal }) =>
      (await api.get('/v1/me/instances', instanceListResponseSchema, { signal })).instances,
  });
}

export function useInstance(instanceId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<PortfolioInstance, WebApiError>({
    queryKey: instanceKey(instanceId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/instances/${instanceId}`, portfolioInstanceSchema, { signal }),
  });
}

/**
 * The one active instance of a strategy in a wallet, created when none
 * exists. A basket investment is attributed to exactly that instance by the
 * backend (a token counts towards one portfolio only), so the review
 * ensures it before the intent is created; nothing is bought here.
 */
export function useEnsureInstance() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<
    PortfolioInstance,
    WebApiError,
    { readonly strategyId: string; readonly versionId: string; readonly walletId: string }
  >({
    mutationFn: async ({ strategyId, versionId, walletId }) => {
      const existing = (await api.get('/v1/me/instances', instanceListResponseSchema)).instances;
      const active = existing.find(
        (instance) =>
          instance.status === 'active' &&
          instance.strategyId === strategyId &&
          instance.walletId === walletId,
      );
      if (active) {
        return active;
      }
      const request: InstanceCreateRequest = { strategyId, versionId, walletId, label: null };
      return api.post('/v1/me/instances', request, portfolioInstanceSchema);
    },
    onSuccess: (instance) => {
      client.setQueryData(instanceKey(instance.instanceId), instance);
      void client.invalidateQueries({ queryKey: INSTANCES_KEY });
    },
  });
}

export function useWalletHoldings(walletId: string | null, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<WalletHoldingsResponse, WebApiError>({
    queryKey: walletHoldingsKey(walletId ?? 'none'),
    enabled: enabled && walletId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/wallets/${walletId}/holdings`, walletHoldingsResponseSchema, { signal }),
  });
}

/** Reconcile the wallet against the chain now; the answer replaces the holdings and refreshes the series. */
export function useReconcileWallet(walletId: string | null) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<WalletHoldingsResponse, WebApiError, void>({
    mutationFn: () =>
      api.post(`/v1/me/wallets/${walletId}/reconciliations`, {}, walletHoldingsResponseSchema),
    onSuccess: (holdings) => {
      client.setQueryData(walletHoldingsKey(holdings.walletId), holdings);
      void client.invalidateQueries({ queryKey: walletJournalKey(holdings.walletId) });
      void client.invalidateQueries({
        queryKey: ['me', 'wallets', holdings.walletId, 'performance'],
      });
      void client.invalidateQueries({ queryKey: ['me', 'instance'] });
    },
  });
}

export function useWalletJournal(walletId: string | null, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<JournalListResponse, WebApiError>({
    queryKey: walletJournalKey(walletId ?? 'none'),
    enabled: enabled && walletId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/wallets/${walletId}/journal`, journalListResponseSchema, { signal }),
  });
}

/** Explain an external flow; the API moves it to wallet-level attribution and never to a strategy. */
export function useAcknowledgeFlow(walletId: string | null) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<
    JournalEntry,
    WebApiError,
    { readonly entryId: string; readonly request: ExternalFlowAcknowledgementRequest }
  >({
    mutationFn: ({ entryId, request }) =>
      api.post(`/v1/me/journal/${entryId}/acknowledgements`, request, journalEntrySchema),
    onSuccess: () => {
      if (walletId !== null) {
        void client.invalidateQueries({ queryKey: walletHoldingsKey(walletId) });
        void client.invalidateQueries({ queryKey: walletJournalKey(walletId) });
        void client.invalidateQueries({ queryKey: ['me', 'wallets', walletId, 'performance'] });
      }
    },
  });
}

export function useInstanceHoldings(instanceId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<InstanceHoldingsResponse, WebApiError>({
    queryKey: instanceHoldingsKey(instanceId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/instances/${instanceId}/holdings`, instanceHoldingsResponseSchema, {
        signal,
      }),
  });
}

export function useInstancePerformance(
  instanceId: string,
  period: PerformancePeriod,
  enabled: boolean,
) {
  const api = useMarkovApi();
  return useQuery<PerformanceResponse, WebApiError>({
    queryKey: instancePerformanceKey(instanceId, period),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/me/instances/${instanceId}/performance?period=${period}`,
        performanceResponseSchema,
        { signal },
      ),
  });
}

export function useWalletPerformance(
  walletId: string | null,
  period: PerformancePeriod,
  enabled: boolean,
) {
  const api = useMarkovApi();
  return useQuery<PerformanceResponse, WebApiError>({
    queryKey: walletPerformanceKey(walletId ?? 'none', period),
    enabled: enabled && walletId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/me/wallets/${walletId}/performance?period=${period}`,
        performanceResponseSchema,
        { signal },
      ),
  });
}

/** The model series of a version: public for a registered version, owner-only before that (the API decides). */
export function useVersionPerformance(
  strategyId: string,
  versionNumber: number | null,
  period: PerformancePeriod,
  enabled: boolean,
) {
  const api = useMarkovApi();
  return useQuery<PerformanceResponse, WebApiError>({
    queryKey: versionPerformanceKey(strategyId, versionNumber ?? 0, period),
    enabled: enabled && versionNumber !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(
        `/v1/strategies/${strategyId}/versions/${versionNumber}/performance?period=${period}`,
        performanceResponseSchema,
        { signal },
      ),
  });
}

export function useMethodology(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<MethodologySummary, WebApiError>({
    queryKey: METHODOLOGY_KEY,
    enabled,
    staleTime: 60 * 60 * 1000,
    queryFn: ({ signal }) =>
      api.get('/v1/performance/methodology', methodologySummarySchema, { signal }),
  });
}

export type ExportSubject =
  | { readonly kind: 'wallet'; readonly walletId: string }
  | { readonly kind: 'instance'; readonly instanceId: string }
  | { readonly kind: 'version'; readonly strategyId: string; readonly versionNumber: number };

export function exportPath(subject: ExportSubject, period: PerformancePeriod): string {
  switch (subject.kind) {
    case 'wallet':
      return `/v1/me/wallets/${subject.walletId}/performance/export?period=${period}`;
    case 'instance':
      return `/v1/me/instances/${subject.instanceId}/performance/export?period=${period}`;
    default:
      return `/v1/strategies/${subject.strategyId}/versions/${subject.versionNumber}/performance/export?period=${period}`;
  }
}

/** Fetches the complete record behind a performance answer (observations, multipliers, every window). */
export function useExportPerformance() {
  const api = useMarkovApi();
  return useMutation<
    PerformanceExport,
    WebApiError,
    { readonly subject: ExportSubject; readonly period: PerformancePeriod }
  >({
    mutationFn: ({ subject, period }) =>
      api.get(exportPath(subject, period), performanceExportSchema),
  });
}
