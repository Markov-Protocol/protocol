'use client';

import { Button, Notice } from '@markov/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signInHref } from './return-path';
import { useSession } from './session-context';

/**
 * Shown on every route when the session ended or cannot be verified. The
 * recovery link returns to the current page after signing in again; no
 * private content stays visible meanwhile.
 */
export function SessionExpiredNotice() {
  const { state, revalidate, verifying } = useSession();
  const pathname = usePathname();
  if (state.status === 'expired') {
    return (
      <Notice
        tone="attention"
        title="Your session has expired"
        live="polite"
        className="m-4"
        actions={
          <Button asChild>
            <Link href={signInHref(pathname)}>Sign in again</Link>
          </Button>
        }
      >
        <p>
          Sign in again to continue where you were. Nothing you were viewing is kept in this
          browser.
        </p>
      </Notice>
    );
  }
  if (state.status === 'unavailable') {
    return (
      <Notice
        tone="error"
        title="Markov cannot verify your session right now"
        live="polite"
        className="m-4"
        actions={
          <Button variant="secondary" loading={verifying} onClick={() => void revalidate()}>
            Try again
          </Button>
        }
      >
        <p>
          {state.reason === 'contract-mismatch'
            ? 'The backend answered in an unexpected shape, so nothing private is shown.'
            : 'The backend is unreachable, so nothing private is shown. Your session is kept until it can be verified.'}
        </p>
      </Notice>
    );
  }
  return null;
}
