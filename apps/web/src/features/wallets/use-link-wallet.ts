'use client';

import {
  encodeBase58,
  type WalletChallengeResponse,
  type WalletLink,
  walletChallengeResponseSchema,
  walletLinkSchema,
} from '@markov/contracts';
import { useCallback, useState } from 'react';
import { useMarkovApi, WebApiError } from '../api/use-markov-api';
import { StaleSessionError } from '../auth/session-context';
import { useWallet, WalletSigningError } from './wallet-context';

export interface LinkFailure {
  readonly code: string;
  readonly message: string;
  /** What the person can do next; never an automatic workaround. */
  readonly recovery: string | null;
}

export type LinkState =
  | { readonly step: 'idle' }
  | { readonly step: 'challenge' }
  | { readonly step: 'signing'; readonly challenge: WalletChallengeResponse }
  | { readonly step: 'linking'; readonly challenge: WalletChallengeResponse }
  | { readonly step: 'linked'; readonly link: WalletLink }
  | { readonly step: 'failed'; readonly failure: LinkFailure };

export function describeLinkError(error: unknown): LinkFailure {
  if (error instanceof StaleSessionError) {
    return {
      code: 'SESSION_CHANGED',
      message: 'Your session changed while the wallet was open. Nothing was linked.',
      recovery: 'Check which account is signed in, then start again.',
    };
  }
  if (error instanceof WalletSigningError) {
    switch (error.reason) {
      case 'context-changed':
        return {
          code: 'WALLET_CHANGED',
          message:
            'The wallet or account changed while the signature was pending. Nothing was linked.',
          recovery: 'Choose the wallet and account again, then start over.',
        };
      case 'altered':
        return {
          code: 'SIGNATURE_ALTERED',
          message: `The wallet did not sign the exact message (${error.message}).`,
          recovery: 'This wallet cannot be used for ownership verification. Choose another wallet.',
        };
      case 'declined':
        return {
          code: 'WALLET_DECLINED',
          message: 'The wallet declined the signature. Nothing was linked.',
          recovery: null,
        };
      case 'unsupported':
        return {
          code: 'UNSUPPORTED',
          message: error.message,
          recovery: 'Choose a wallet that supports message signing.',
        };
      default:
        return {
          code: 'NOT_CONNECTED',
          message: error.message,
          recovery: 'Connect a wallet first.',
        };
    }
  }
  if (error instanceof WebApiError) {
    switch (error.code) {
      case 'CHALLENGE_INVALID':
        return {
          code: error.code,
          message:
            'The ownership challenge expired, was already used or does not match this wallet.',
          recovery: 'Start again to get a fresh challenge. Signatures are never reused.',
        };
      case 'WALLET_ALREADY_LINKED':
        return {
          code: error.code,
          message: 'This wallet is already verified on another Markov account.',
          recovery:
            'Sign in to that account and unlink it under Settings → Wallets, or use a different wallet here. Markov never moves a wallet between accounts on its own.',
        };
      case 'STEP_UP_REQUIRED':
        return {
          code: error.code,
          message: 'Linking a wallet needs a recent sign-in.',
          recovery: 'Sign in again, then retry.',
        };
      case 'AUTH_REQUIRED':
        return {
          code: error.code,
          message: 'Your session ended.',
          recovery: 'Sign in again, then retry.',
        };
      case 'RATE_LIMITED':
        return {
          code: error.code,
          message: 'Too many attempts in a short time.',
          recovery: 'Wait a minute, then retry.',
        };
      case 'NETWORK':
      case 'PROVIDER_UNAVAILABLE':
        return { code: error.code, message: error.message, recovery: 'Try again shortly.' };
      default:
        return { code: error.code, message: error.message, recovery: null };
    }
  }
  return {
    code: 'UNKNOWN',
    message: 'Something unexpected happened. Nothing was linked.',
    recovery: null,
  };
}

/**
 * Ownership verification: a fresh challenge from the API, the exact text
 * signed by the connected account, and the signature presented once. The
 * session epoch and the wallet generation are both checked after every
 * await, so a signature obtained under another account or wallet is never
 * submitted.
 */
export function useLinkWallet(): {
  readonly state: LinkState;
  start(): Promise<void>;
  reset(): void;
} {
  const api = useMarkovApi();
  const wallet = useWallet();
  const [state, setState] = useState<LinkState>({ step: 'idle' });

  const start = useCallback(async () => {
    if (wallet.connection.status !== 'connected') {
      setState({
        step: 'failed',
        failure: describeLinkError(
          new WalletSigningError('not-connected', 'connect a wallet first'),
        ),
      });
      return;
    }
    const address = wallet.connection.account.address;
    setState({ step: 'challenge' });
    try {
      const challenge = await api.post(
        '/v1/me/wallets/challenges',
        { address },
        walletChallengeResponseSchema,
      );
      if (!challenge.message.includes(`Address: ${address}`)) {
        throw new WebApiError(
          200,
          'CONTRACT_MISMATCH',
          'The challenge does not name the connected wallet.',
        );
      }
      setState({ step: 'signing', challenge });
      const signed = await wallet.signMessage(challenge.message);
      setState({ step: 'linking', challenge });
      const link = await api.post(
        '/v1/me/wallets',
        { challengeId: challenge.challengeId, address, signature: encodeBase58(signed.signature) },
        walletLinkSchema,
      );
      setState({ step: 'linked', link });
    } catch (error) {
      setState({ step: 'failed', failure: describeLinkError(error) });
    }
  }, [api, wallet]);

  return { state, start, reset: () => setState({ step: 'idle' }) };
}
