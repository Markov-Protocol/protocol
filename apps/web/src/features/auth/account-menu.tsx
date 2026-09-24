'use client';

import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  StatusBadge,
} from '@markov/ui';
import { CircleUserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { issuerLabel, shortSubject } from './format';
import { signInHref } from './return-path';
import { useSession } from './session-context';

/**
 * Top-bar account control. Every state is explicit: signed out offers
 * sign-in with a validated return path; signed in exposes Settings, Switch
 * account and Sign out with their real effects; expired and unavailable
 * sessions say so instead of pretending.
 */
export function AccountMenu() {
  const { state, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (state.status === 'signed-out') {
    return (
      <Button asChild size="sm" variant="secondary">
        <Link href={signInHref(pathname)}>Sign in</Link>
      </Button>
    );
  }
  if (state.status === 'expired') {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge tone="attention">Session expired</StatusBadge>
        <Button asChild size="sm">
          <Link href={signInHref(pathname)}>Sign in again</Link>
        </Button>
      </div>
    );
  }
  if (state.status === 'unavailable') {
    return <StatusBadge tone="error">Session unverified</StatusBadge>;
  }

  const { account } = state;
  const switchHref = `/sign-in?switch=1${signInHref(pathname).includes('?') ? `&next=${encodeURIComponent(pathname)}` : ''}`;

  async function handleSignOut() {
    setSigningOut(true);
    const result = await signOut();
    setSigningOut(false);
    if (result && !result.revoked) {
      setNotice(
        'Signed out on this device. The server session could not be revoked right now; it expires on its own.',
      );
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {notice ? (
        <span role="status" className="sr-only">
          {notice}
        </span>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Account menu for ${shortSubject(account.subject)}`}
            loading={signingOut}
          >
            <CircleUserRound aria-hidden="true" className="size-4" />
            <span className="max-w-40 truncate">{shortSubject(account.subject)}</span>
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>
            Signed in as {shortSubject(account.subject)} · {issuerLabel(account.issuer)}
          </MenuLabel>
          <MenuItem onSelect={() => router.push('/settings')}>Settings</MenuItem>
          <MenuItem onSelect={() => router.push(switchHref)}>Switch account</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => void handleSignOut()}>Sign out</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
