'use client';

import { Button, ErrorBlock, Field, Notice, StatusBadge, TextInput } from '@markov/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { shortSubject } from './format';
import { useSession } from './session-context';

export interface SignInViewProps {
  /** Validated local path to return to after sign-in. */
  readonly next: string;
  /** True when the person asked to switch accounts while signed in. */
  readonly switching: boolean;
}

/**
 * The one sign-in screen. It offers exactly the identity path the backend
 * runs: the nonproduction development issuer when the API reports it, or an
 * honest "not available" for a hosted provider whose browser adapter is not
 * configured (OD-05). No provider is duplicated in the browser and no role
 * is stored locally; the server session cookie is the only credential.
 */
export function SignInView({ next, switching }: SignInViewProps) {
  const { state, platform, signInWithDevelopmentIssuer } = useSession();
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantsSwitch, setWantsSwitch] = useState(switching);

  const signedInElsewhere = state.status === 'signed-in' && !wantsSwitch;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await signInWithDevelopmentIssuer(subject, next);
    setPending(false);
    if (result.ok) {
      router.replace(result.next);
      router.refresh();
      return;
    }
    setError(result.message);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 text-heading-lg font-semibold">Sign in</h1>
      <p className="mb-6 text-body text-text-muted">
        Signing in identifies you to Markov. It never connects a wallet, links ownership or approves
        anything; those are separate, explicit steps.
      </p>

      {state.status === 'signed-in' ? (
        <Notice
          tone="info"
          title={`You are signed in as ${shortSubject(state.account.subject)}`}
          className="mb-6"
          actions={
            signedInElsewhere ? (
              <>
                <Button asChild>
                  <Link href={next}>Continue</Link>
                </Button>
                <Button variant="secondary" onClick={() => setWantsSwitch(true)}>
                  Switch account
                </Button>
              </>
            ) : null
          }
        >
          <p>
            {signedInElsewhere
              ? 'Continue as this account, or sign in as a different one. Switching ends the current session on this browser.'
              : 'Signing in as a different account ends this session on this browser and discards its private data.'}
          </p>
        </Notice>
      ) : null}

      {platform.state === 'unreachable' ? (
        <ErrorBlock
          title="Markov cannot reach its backend"
          message="Sign-in needs the backend to verify your identity. Try again in a moment."
          onRetry={() => router.refresh()}
        />
      ) : platform.identityProvider === 'test' && !signedInElsewhere ? (
        <form onSubmit={submit} className="space-y-4" aria-labelledby="dev-issuer-heading">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="dev-issuer-heading" className="text-heading-sm font-semibold">
              Development issuer
            </h2>
            <StatusBadge tone="attention">Nonproduction</StatusBadge>
          </div>
          <p className="text-supporting text-text-muted">
            This backend runs the in-process test issuer, which accepts any subject without a
            password. Production backends refuse this path at configuration time; a hosted identity
            provider replaces it there.
          </p>
          <Field
            label="Subject"
            description="An identifier such as did:test:alice. It becomes your account id on this backend."
            required
            id="dev-subject"
            {...(error ? { error } : {})}
          >
            {(control) => (
              <TextInput
                {...control}
                name="subject"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="did:test:alice"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              loading={pending}
              {...(subject.trim().length < 3
                ? { disabledReason: 'Enter a subject of at least 3 characters.' }
                : {})}
            >
              Sign in
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">Cancel</Link>
            </Button>
          </div>
        </form>
      ) : platform.identityProvider === 'oidc' ? (
        <Notice
          tone="info"
          title="Sign-in with the hosted identity provider is not available in this build"
        >
          <p>
            This backend verifies tokens from a hosted identity provider, but the browser adapter
            for it is not configured in this deployment. Readiness: BLOCKED until open decision
            OD-05 (identity provider account and callback configuration) is resolved. No substitute
            sign-in is offered.
          </p>
        </Notice>
      ) : null}

      <p className="mt-8 text-caption text-text-muted">
        After sign-in you return to <span className="font-medium text-text">{next}</span>. Markov
        only ever returns you to a page on this site.
      </p>
    </div>
  );
}
