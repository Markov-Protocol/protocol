'use client';

import {
  type ExecutionStatus,
  executionStatusSchema,
  type PreparedTransaction,
  preparedTransactionSchema,
  type Receipt,
  type ReceiptKeysResponse,
  type ReceiptKind,
  type ReceiptListResponse,
  receiptKeysResponseSchema,
  receiptListResponseSchema,
  receiptSchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { INTENTS_KEY, intentKey } from '../review/queries';
import { pollingPlan } from './execution-model';

export const executionKey = (intentId: string) => ['me', 'intent', intentId, 'execution'] as const;
export const intentReceiptsKey = (intentId: string) =>
  ['me', 'intent', intentId, 'receipts'] as const;
export const RECEIPTS_KEY = ['me', 'receipts'] as const;
export const receiptKey = (receiptId: string) => ['receipt', receiptId] as const;
export const RECEIPT_KEYS_KEY = ['receipts', 'keys'] as const;

function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

/**
 * The execution status, read on a bounded schedule while the network is
 * being watched (the API reconciles a live attempt on every read). The
 * schedule comes from the pure model; a hidden tab reads rarely; a settled
 * intent stops. A failed read retries with backoff and the screen shows
 * the last answer as stale, never as a result.
 */
export function useExecutionStatus(
  intentId: string,
  enabled: boolean,
  options: { readonly hidden: boolean; readonly watchedSince: number | null },
) {
  const api = useMarkovApi();
  return useQuery<ExecutionStatus, WebApiError>({
    queryKey: executionKey(intentId),
    enabled,
    retry: retryUnlessAnswered,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    refetchInterval: (query) => {
      const plan = pollingPlan({
        status: query.state.data ?? null,
        hidden: options.hidden,
        watchedForMs: options.watchedSince === null ? 0 : Date.now() - options.watchedSince,
      });
      return plan.intervalMs ?? false;
    },
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/intents/${intentId}/execution`, executionStatusSchema, { signal }),
  });
}

function useInvalidateExecution(intentId: string) {
  const client = useQueryClient();
  return (status?: ExecutionStatus) => {
    if (status) {
      client.setQueryData(executionKey(intentId), status);
    }
    void client.invalidateQueries({ queryKey: executionKey(intentId), exact: true });
    void client.invalidateQueries({ queryKey: intentKey(intentId), exact: true });
    void client.invalidateQueries({ queryKey: INTENTS_KEY });
  };
}

/** Builds the plan's next transaction (the API decodes, validates and simulates it first). */
export function useBuildTransaction(intentId: string) {
  const api = useMarkovApi();
  const invalidate = useInvalidateExecution(intentId);
  return useMutation<PreparedTransaction, WebApiError, void>({
    mutationFn: () =>
      api.post(`/v1/me/intents/${intentId}/transactions`, {}, preparedTransactionSchema),
    onSuccess: () => invalidate(),
    onError: () => invalidate(),
  });
}

/** Submits the owner-signed bytes once; the same bytes submitted again answer the same attempt. */
export function useSubmitTransaction(intentId: string) {
  const api = useMarkovApi();
  const invalidate = useInvalidateExecution(intentId);
  return useMutation<
    ExecutionStatus,
    WebApiError,
    { readonly transactionIndex: number; readonly signedTransaction: string }
  >({
    mutationFn: (input) =>
      api.post(
        `/v1/me/intents/${intentId}/transactions/${input.transactionIndex}/submissions`,
        { signedTransaction: input.signedTransaction },
        executionStatusSchema,
      ),
    onSuccess: (status) => invalidate(status),
    onError: () => invalidate(),
  });
}

/** Reconciles a live attempt from chain evidence now; never signs or sends a new transaction. */
export function useReconcileExecution(intentId: string) {
  const api = useMarkovApi();
  const invalidate = useInvalidateExecution(intentId);
  return useMutation<ExecutionStatus, WebApiError, void>({
    mutationFn: () =>
      api.post(`/v1/me/intents/${intentId}/execution/reconciliations`, {}, executionStatusSchema),
    onSuccess: (status) => invalidate(status),
    onError: () => invalidate(),
  });
}

export function useIntentReceipts(intentId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<ReceiptListResponse, WebApiError>({
    queryKey: intentReceiptsKey(intentId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/intents/${intentId}/receipts`, receiptListResponseSchema, { signal }),
  });
}

/** Issues (or answers the existing) receipt of the intent for a kind and its current state. */
export function useIssueReceipt(intentId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<Receipt, WebApiError, { readonly kind: ReceiptKind }>({
    mutationFn: (input) =>
      api.post(`/v1/me/intents/${intentId}/receipts`, { kind: input.kind }, receiptSchema),
    onSuccess: (receipt) => {
      client.setQueryData(receiptKey(receipt.body.receiptId), receipt);
      void client.invalidateQueries({ queryKey: intentReceiptsKey(intentId), exact: true });
      void client.invalidateQueries({ queryKey: RECEIPTS_KEY });
    },
  });
}

export function useReceipts(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<ReceiptListResponse, WebApiError>({
    queryKey: RECEIPTS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/me/receipts', receiptListResponseSchema, { signal }),
  });
}

/** One receipt: complete for its owner, redacted when public, not found otherwise. */
export function useReceipt(receiptId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<Receipt, WebApiError>({
    queryKey: receiptKey(receiptId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) => api.get(`/v1/receipts/${receiptId}`, receiptSchema, { signal }),
  });
}

export function useReceiptKeys(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<ReceiptKeysResponse, WebApiError>({
    queryKey: RECEIPT_KEYS_KEY,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: ({ signal }) => api.get('/v1/receipts/keys', receiptKeysResponseSchema, { signal }),
  });
}

export function useSetReceiptPublic(receiptId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<Receipt, WebApiError, { readonly public: boolean }>({
    mutationFn: (input) =>
      api.post(`/v1/me/receipts/${receiptId}/visibility`, { public: input.public }, receiptSchema),
    onSuccess: (receipt) => {
      client.setQueryData(receiptKey(receiptId), receipt);
      void client.invalidateQueries({ queryKey: RECEIPTS_KEY });
    },
  });
}
