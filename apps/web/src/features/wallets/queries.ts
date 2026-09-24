'use client';

import {
  currentTermsResponseSchema,
  type EligibilityStatusResponse,
  eligibilityStatusResponseSchema,
  type WalletFundingResponse,
  type WalletLink,
  walletFundingResponseSchema,
  walletListResponseSchema,
} from '@markov/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMarkovApi } from '../api/use-markov-api';

export const WALLETS_KEY = ['me', 'wallets'] as const;
export const ELIGIBILITY_KEY = ['me', 'eligibility'] as const;
export const TERMS_KEY = ['terms', 'current'] as const;
export const fundingKey = (walletId: string) => ['me', 'wallets', walletId, 'funding'] as const;

export function useVerifiedWallets(enabled = true) {
  const api = useMarkovApi();
  return useQuery({
    queryKey: WALLETS_KEY,
    enabled,
    queryFn: async () => (await api.get('/v1/me/wallets', walletListResponseSchema)).wallets,
  });
}

export function useEligibility(enabled = true) {
  const api = useMarkovApi();
  return useQuery<EligibilityStatusResponse>({
    queryKey: ELIGIBILITY_KEY,
    enabled,
    queryFn: () => api.get('/v1/me/eligibility', eligibilityStatusResponseSchema),
  });
}

export function useCurrentTerms(enabled = true) {
  const api = useMarkovApi();
  return useQuery({
    queryKey: TERMS_KEY,
    enabled,
    queryFn: async () => (await api.get('/v1/terms/current', currentTermsResponseSchema)).documents,
  });
}

export function useFunding(walletId: string | null) {
  const api = useMarkovApi();
  return useQuery<WalletFundingResponse>({
    queryKey: walletId ? fundingKey(walletId) : ['me', 'wallets', 'none', 'funding'],
    enabled: walletId !== null,
    queryFn: () => api.get(`/v1/me/wallets/${walletId}/funding`, walletFundingResponseSchema),
  });
}

export function useUnlinkWallet() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (wallet: WalletLink) => api.del(`/v1/me/wallets/${wallet.walletId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: WALLETS_KEY });
      void client.invalidateQueries({ queryKey: ELIGIBILITY_KEY });
    },
  });
}

export function useDeclareJurisdiction() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jurisdiction: string) =>
      api.post(
        '/v1/me/eligibility/declarations',
        { jurisdiction, attestation: true },
        eligibilityStatusResponseSchema.shape.decision.unwrap(),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ELIGIBILITY_KEY });
    },
  });
}

export function useAcknowledgeTerms() {
  const api = useMarkovApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { termsVersion: string; contentHash: string }) =>
      api.post(
        '/v1/me/terms/acknowledgements',
        { ...input, channel: 'app' },
        eligibilityStatusResponseSchema.shape.terms.shape.acknowledged.element,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ELIGIBILITY_KEY });
    },
  });
}
