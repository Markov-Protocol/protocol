'use client';

import {
  type ExecutionPlan,
  executionPlanSchema,
  type Intent,
  type IntentCreateRequest,
  type IntentListResponse,
  intentListResponseSchema,
  intentSchema,
  type PlanAcknowledgementRequest,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';

export const INTENTS_KEY = ['me', 'intents'] as const;
export const intentKey = (intentId: string) => ['me', 'intent', intentId] as const;
export const planKey = (intentId: string, planId: string) =>
  ['me', 'intent', intentId, 'plan', planId] as const;

function retryUnlessAnswered(count: number, error: unknown): boolean {
  if (error instanceof WebApiError && (error.status === 404 || error.status === 401)) {
    return false;
  }
  return count < 2;
}

/** Reviews in progress: newest first, as the API lists them. */
export function useIntents(enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<IntentListResponse>({
    queryKey: INTENTS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get('/v1/me/intents', intentListResponseSchema, { signal }),
  });
}

export function useIntent(intentId: string, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<Intent>({
    queryKey: intentKey(intentId),
    enabled,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) => api.get(`/v1/me/intents/${intentId}`, intentSchema, { signal }),
  });
}

export function usePlan(intentId: string, planId: string | null, enabled: boolean) {
  const api = useMarkovApi();
  return useQuery<ExecutionPlan>({
    queryKey: planKey(intentId, planId ?? ''),
    enabled: enabled && planId !== null,
    retry: retryUnlessAnswered,
    queryFn: ({ signal }) =>
      api.get(`/v1/me/intents/${intentId}/plans/${planId}`, executionPlanSchema, { signal }),
  });
}

/** Creates an intent; the caller keeps the idempotency key so a retry answers the same intent. */
export function useCreateIntent() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<Intent, WebApiError, IntentCreateRequest>({
    mutationFn: (request) => api.post('/v1/me/intents', request, intentSchema),
    onSuccess: (intent) => {
      client.setQueryData(intentKey(intent.intentId), intent);
      void client.invalidateQueries({ queryKey: INTENTS_KEY });
    },
  });
}

/** Builds (or refreshes) the bounded plan; the new plan supersedes the intent's earlier ones. */
export function useBuildPlan(intentId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<ExecutionPlan, WebApiError, void>({
    mutationFn: () => api.post(`/v1/me/intents/${intentId}/plans`, {}, executionPlanSchema),
    onSuccess: (plan) => {
      client.setQueryData(planKey(intentId, plan.planId), plan);
      void client.invalidateQueries({ queryKey: intentKey(intentId), exact: true });
      void client.invalidateQueries({ queryKey: INTENTS_KEY });
    },
  });
}

export function useAcknowledgePlan(intentId: string, planId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<ExecutionPlan, WebApiError, PlanAcknowledgementRequest>({
    mutationFn: (request) =>
      api.post(
        `/v1/me/intents/${intentId}/plans/${planId}/acknowledgements`,
        request,
        executionPlanSchema,
      ),
    onSuccess: (plan) => {
      client.setQueryData(planKey(intentId, plan.planId), plan);
      void client.invalidateQueries({ queryKey: intentKey(intentId), exact: true });
      void client.invalidateQueries({ queryKey: INTENTS_KEY });
    },
  });
}

export function useCancelIntent(intentId: string) {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation<Intent, WebApiError, void>({
    mutationFn: () => api.post(`/v1/me/intents/${intentId}/cancel`, {}, intentSchema),
    onSuccess: (intent) => {
      client.setQueryData(intentKey(intentId), intent);
      void client.invalidateQueries({ queryKey: INTENTS_KEY });
    },
  });
}
