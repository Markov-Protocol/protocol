'use client';

import { CompanionPresence } from '@markov/shell';
import { Button, ErrorBlock, Skeleton, SkeletonText, StatusBadge } from '@markov/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { shortSubject } from '@/features/auth/format';
import type { SessionAccount } from '@/features/auth/session-types';
import { useReadiness } from '@/features/wallets/readiness';

export type HomeState = 'anonymous' | 'auth-loading' | 'signed-in' | 'unavailable';

export interface HomeViewProps {
  readonly state: HomeState;
  readonly account?: SessionAccount;
  readonly onRetry?: () => void;
}

const CHECKLIST_DISMISSED_KEY = 'markov.home.checklist.dismissed';

interface NextStep {
  readonly key: string;
  readonly label: string;
  readonly href: string | null;
  readonly state: 'done' | 'todo' | 'later' | 'checking' | 'anytime';
  readonly note: string;
}

/** Only the actions this account still needs, from live readiness; a delivered step disappears from the list. */
function useNextSteps(): readonly NextStep[] {
  const readiness = useReadiness();
  const verified = readiness.facts.find((fact) => fact.key === 'verified');
  const eligible = readiness.facts.find((fact) => fact.key === 'eligible');
  const stateOf = (fact: typeof verified): NextStep['state'] =>
    !fact || fact.state === 'loading'
      ? 'checking'
      : fact.state === 'yes' || fact.state === 'partial'
        ? fact.state === 'yes'
          ? 'done'
          : 'todo'
        : 'todo';
  return [
    {
      key: 'wallet',
      label: 'Choose and verify a wallet',
      href: '/settings/wallets',
      state:
        verified?.state === 'partial' || verified?.state === 'yes' ? 'done' : stateOf(verified),
      note: verified?.detail ?? '',
    },
    {
      key: 'eligibility',
      label: 'Resolve eligibility and terms',
      href: '/settings/eligibility',
      state: stateOf(eligible),
      note: eligible?.detail ?? '',
    },
    {
      key: 'funding',
      label: 'Add funds if needed',
      href: readiness.verifiedWallets.length > 0 ? '/settings/wallets' : null,
      state: readiness.verifiedWallets.length > 0 ? 'todo' : 'later',
      note:
        readiness.verifiedWallets.length > 0
          ? 'Receive into your own verified wallet; balances show once the network has them.'
          : 'Available once a wallet is verified.',
    },
    {
      key: 'strategy',
      label: 'Build a strategy you can explain',
      href: '/strategies/new',
      // Not tracked per account here, so it never claims to be outstanding.
      state: 'anytime',
      note: 'Research, assemble and set rules; publishing and investing stay separate steps.',
    },
  ];
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(CHECKLIST_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function SignedInHome({ account }: { readonly account: SessionAccount }) {
  const nextSteps = useNextSteps();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1');
    } catch {
      // a per-viewer convenience only
    }
  };
  return (
    <section className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <CompanionPresence status="Markov is ready" size="hero" />
        <div className="space-y-2">
          <h1 className="text-heading-lg font-semibold">An idea for your next strategy?</h1>
          <p className="text-body text-text-muted">
            Signed in as{' '}
            <span className="font-medium text-text">{shortSubject(account.subject)}</span>. Nothing
            here is pending: reviews and executions you start appear in Activity, and Markov never
            fills this space with invented activity.
          </p>
        </div>
      </div>
      {dismissed ? null : (
        <section
          aria-labelledby="next-steps-heading"
          className="rounded-lg border border-border/60 p-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="next-steps-heading" className="text-heading-sm font-semibold">
              Before your first strategy
            </h2>
            <Button variant="ghost" size="sm" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
          <ul className="space-y-2">
            {nextSteps.map((step) => (
              <li
                key={step.key}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span>
                  {step.href && step.state !== 'done' ? (
                    <Link href={step.href} className="underline underline-offset-2">
                      {step.label}
                    </Link>
                  ) : (
                    step.label
                  )}
                  <span className="block text-caption text-text-muted">{step.note}</span>
                </span>
                <StatusBadge
                  tone={
                    step.state === 'done'
                      ? 'success'
                      : step.state === 'todo'
                        ? 'attention'
                        : step.state === 'checking'
                          ? 'pending'
                          : 'neutral'
                  }
                >
                  {step.state === 'done'
                    ? 'Done'
                    : step.state === 'todo'
                      ? 'To do'
                      : step.state === 'checking'
                        ? 'Checking'
                        : step.state === 'anytime'
                          ? 'Anytime'
                          : 'Later'}
                </StatusBadge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-text-muted">
            None of these requires a Mark I device. Each control appears only once the feature is
            real.
          </p>
        </section>
      )}
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Button asChild>
          <Link href="/explore">Explore</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/settings">Settings</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * Companion home. The anonymous variant offers Explore and Sign in and
 * explains the model; it never invents a balance, activity or statistic.
 * The auth-loading variant shows placeholders while a session is verified
 * and reads as busy to assistive technology. The signed-in variant lists
 * only the next steps that are actually needed, with honest availability.
 */
export function HomeView({ state, account, onRetry }: HomeViewProps) {
  if (state === 'auth-loading') {
    return (
      <section
        aria-busy="true"
        aria-label="Loading your home"
        className="mx-auto flex min-h-full max-w-2xl flex-col items-center gap-6 px-4 py-12"
      >
        <CompanionPresence
          status="Markov is verifying your session"
          size="hero"
          expression="muted"
        />
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={2} className="w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-24" />
        </div>
      </section>
    );
  }
  if (state === 'signed-in' && account) {
    return <SignedInHome account={account} />;
  }
  if (state === 'unavailable') {
    return (
      <section className="mx-auto flex min-h-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
        <CompanionPresence
          status="Markov cannot reach its backend"
          size="hero"
          expression="muted"
        />
        <ErrorBlock
          title="Markov cannot reach its backend"
          message="Your session cannot be verified, so nothing private is shown. This is a service failure, not an empty account."
          {...(onRetry ? { onRetry } : {})}
        />
      </section>
    );
  }
  return (
    <section className="mx-auto flex min-h-full max-w-2xl flex-col items-center gap-6 px-4 py-12 text-center">
      <CompanionPresence status="Markov is ready" size="hero" />
      <div className="space-y-2">
        <h1 className="text-heading-lg font-semibold">An idea for your next strategy?</h1>
        <p className="text-body text-text-muted">
          Research the companies behind it, assemble a portfolio you can explain, set your own rules
          and approve every trade yourself. You keep the supported constituent tokens in your own
          wallet.
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Button asChild>
          <Link href="/explore">Explore</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
      <p className="text-caption text-text-muted">
        Markov shows no balance, activity or statistic before you sign in, and none of it is
        invented afterwards.
      </p>
    </section>
  );
}
