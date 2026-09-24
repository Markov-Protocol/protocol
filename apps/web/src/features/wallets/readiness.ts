'use client';

import type { EligibilityStatusResponse, WalletLink } from '@markov/contracts';
import { useSession } from '../auth/session-context';
import { useEligibility, useVerifiedWallets } from './queries';
import { useWallet } from './wallet-context';

export type FactState = 'yes' | 'no' | 'partial' | 'loading' | 'error';

export interface ReadinessFact {
  readonly key: 'account' | 'connected' | 'verified' | 'eligible';
  readonly label: string;
  readonly state: FactState;
  readonly detail: string;
  readonly href: string | null;
}

export interface Readiness {
  readonly facts: readonly ReadinessFact[];
  readonly verifiedWallets: readonly WalletLink[];
  readonly eligibility: EligibilityStatusResponse | null;
  /** The connected account is one of the verified wallets. */
  readonly connectedIsVerified: boolean;
  readonly loading: boolean;
}

/**
 * Four separate facts, never one boolean: an authenticated account, a
 * connected wallet, a verified owner and an eligible trader. Each fact says
 * what is missing and where to resolve it.
 */
export function useReadiness(): Readiness {
  const { state } = useSession();
  const wallet = useWallet();
  const signedIn = state.status === 'signed-in';
  const wallets = useVerifiedWallets(signedIn);
  const eligibility = useEligibility(signedIn);
  const verified = wallets.data ?? [];
  const connectedAddress =
    wallet.connection.status === 'connected' ? wallet.connection.account.address : null;
  const connectedIsVerified =
    connectedAddress !== null && verified.some((link) => link.address === connectedAddress);

  const account: ReadinessFact = signedIn
    ? {
        key: 'account',
        label: 'Signed in',
        state: 'yes',
        detail: 'Your Markov account is verified by the server.',
        href: null,
      }
    : {
        key: 'account',
        label: 'Signed in',
        state: 'no',
        detail: 'Sign in to link a wallet and check eligibility.',
        href: '/sign-in',
      };

  const connected: ReadinessFact =
    wallet.connection.status === 'connected'
      ? wallet.chainMatches === false
        ? {
            key: 'connected',
            label: 'Wallet connected',
            state: 'partial',
            detail: `${wallet.connection.walletName} is on another network than this platform.`,
            href: '/settings/wallets',
          }
        : {
            key: 'connected',
            label: 'Wallet connected',
            state: 'yes',
            detail: `${wallet.connection.walletName} will be asked to sign.`,
            href: '/settings/wallets',
          }
      : {
          key: 'connected',
          label: 'Wallet connected',
          state: 'no',
          detail: 'No wallet is connected. Nothing can be signed.',
          href: '/settings/wallets',
        };

  const verifiedFact: ReadinessFact = !signedIn
    ? {
        key: 'verified',
        label: 'Verified owner',
        state: 'no',
        detail: 'Sign in first.',
        href: '/sign-in',
      }
    : wallets.isPending
      ? {
          key: 'verified',
          label: 'Verified owner',
          state: 'loading',
          detail: 'Checking verified wallets…',
          href: null,
        }
      : wallets.isError
        ? {
            key: 'verified',
            label: 'Verified owner',
            state: 'error',
            detail: 'Verified wallets could not be loaded.',
            href: '/settings/wallets',
          }
        : connectedIsVerified
          ? {
              key: 'verified',
              label: 'Verified owner',
              state: 'yes',
              detail: 'The connected wallet is verified as yours.',
              href: '/settings/wallets',
            }
          : verified.length > 0
            ? {
                key: 'verified',
                label: 'Verified owner',
                state: 'partial',
                detail: `${verified.length} verified wallet${verified.length === 1 ? '' : 's'}; connect one of them to sign.`,
                href: '/settings/wallets',
              }
            : {
                key: 'verified',
                label: 'Verified owner',
                state: 'no',
                detail: 'No wallet has proven ownership yet.',
                href: '/settings/wallets',
              };

  const eligible: ReadinessFact = !signedIn
    ? {
        key: 'eligible',
        label: 'Eligible trader',
        state: 'no',
        detail: 'Sign in first.',
        href: '/sign-in',
      }
    : eligibility.isPending
      ? {
          key: 'eligible',
          label: 'Eligible trader',
          state: 'loading',
          detail: 'Checking eligibility…',
          href: null,
        }
      : eligibility.isError
        ? {
            key: 'eligible',
            label: 'Eligible trader',
            state: 'error',
            detail: 'Eligibility could not be loaded.',
            href: '/settings/eligibility',
          }
        : eligibility.data.outcome === 'eligible' && eligibility.data.terms.complete
          ? {
              key: 'eligible',
              label: 'Eligible trader',
              state: 'yes',
              detail: `Eligible under policy ${eligibility.data.policyVersion ?? 'n/a'}; terms acknowledged.`,
              href: '/settings/eligibility',
            }
          : eligibility.data.outcome === 'ineligible'
            ? {
                key: 'eligible',
                label: 'Eligible trader',
                state: 'no',
                detail: 'Tokenised stocks are not available in your declared jurisdiction.',
                href: '/settings/eligibility',
              }
            : {
                key: 'eligible',
                label: 'Eligible trader',
                state: 'partial',
                detail: eligibility.data.summary,
                href: '/settings/eligibility',
              };

  return {
    facts: [account, connected, verifiedFact, eligible],
    verifiedWallets: verified,
    eligibility: eligibility.data ?? null,
    connectedIsVerified,
    loading: signedIn && (wallets.isPending || eligibility.isPending),
  };
}
