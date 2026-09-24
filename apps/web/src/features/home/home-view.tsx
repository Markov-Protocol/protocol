import { CompanionPresence } from '@markov/shell';
import { Button, Skeleton, SkeletonText } from '@markov/ui';
import Link from 'next/link';

export type HomeState = 'anonymous' | 'auth-loading';

/**
 * Companion home. The anonymous variant offers Explore and Sign in and
 * explains the model; it never invents a balance, activity or statistic.
 * The auth-loading variant shows placeholders while a session is resolved
 * (F03) and reads as busy to assistive technology.
 */
export function HomeView({ state }: { readonly state: HomeState }) {
  if (state === 'auth-loading') {
    return (
      <section
        aria-busy="true"
        aria-label="Loading your home"
        className="mx-auto flex min-h-full max-w-2xl flex-col items-center gap-6 px-4 py-12"
      >
        <CompanionPresence status="Markov is loading your session" size="hero" expression="muted" />
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={2} className="w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-11 w-24" />
        </div>
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
        <Button variant="secondary" disabledReason="Sign-in arrives with session F03.">
          Sign in
        </Button>
      </div>
      <p className="text-caption text-text-muted">
        Markov shows no balance, activity or statistic before you sign in, and none of it is
        invented afterwards.
      </p>
    </section>
  );
}
