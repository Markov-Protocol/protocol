import { Button, Notice } from '@markov/ui';
import Link from 'next/link';
import { signInHref } from './return-path';

export type CallbackOutcome = 'cancelled' | 'failed' | 'unsupported' | 'none';

export interface CallbackViewProps {
  readonly outcome: CallbackOutcome;
  /** Sanitised, length-limited provider description; never raw query text. */
  readonly detail: string | null;
  readonly next: string;
}

const copy: Record<
  CallbackOutcome,
  { title: string; body: string; tone: 'attention' | 'error' | 'info' }
> = {
  cancelled: {
    tone: 'attention',
    title: 'Sign-in was cancelled',
    body: 'You closed or declined the identity provider before it finished. Nothing was signed in and no wallet was touched.',
  },
  failed: {
    tone: 'error',
    title: 'Sign-in did not complete',
    body: 'The identity provider reported an error. You can try again; nothing private was revealed.',
  },
  unsupported: {
    tone: 'info',
    title: 'The hosted identity provider is not connected in this build',
    body: 'Markov received a provider callback, but the hosted sign-in adapter is not configured for this deployment (readiness BLOCKED, open decision OD-05). No session was created.',
  },
  none: {
    tone: 'info',
    title: 'No sign-in is in progress',
    body: 'This page completes a sign-in started from the identity provider. Start from the sign-in page instead.',
  },
};

/** Landing route for identity-provider redirects: every outcome is explicit and offers a safe way forward. */
export function CallbackView({ outcome, detail, next }: CallbackViewProps) {
  const text = copy[outcome];
  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-heading-lg font-semibold">Sign-in callback</h1>
      <Notice
        tone={text.tone}
        title={text.title}
        live="polite"
        actions={
          <>
            <Button asChild>
              <Link href={signInHref(next)}>
                {outcome === 'none' ? 'Go to sign-in' : 'Try again'}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">Back to home</Link>
            </Button>
          </>
        }
      >
        <p>{text.body}</p>
        {detail ? (
          <p className="mt-2 text-caption text-text-muted">Provider message: {detail}</p>
        ) : null}
      </Notice>
    </div>
  );
}

/** Keep only printable text of bounded length from a provider-supplied description. */
export function sanitiseDetail(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }
  const cleaned = raw.replace(/[^\x20-\x7e]/g, '').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, 160);
}
