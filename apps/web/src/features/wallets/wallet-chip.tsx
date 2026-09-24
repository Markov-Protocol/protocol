'use client';

import { shortenAddress } from '@markov/formatters';
import { StatusBadge } from '@markov/ui';
import { Wallet as WalletIcon } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '../auth/session-context';
import { useReadiness } from './readiness';
import { useWallet } from './wallet-context';

/** Which wallet would sign, shown near the account control; a link to change it. */
export function WalletChip() {
  const { state } = useSession();
  const wallet = useWallet();
  const readiness = useReadiness();
  if (state.status !== 'signed-in') {
    return null;
  }
  const connection = wallet.connection;
  if (connection.status !== 'connected') {
    return (
      <Link
        href="/settings/wallets"
        className="inline-flex items-center gap-1 text-supporting underline underline-offset-2"
        data-testid="wallet-chip"
      >
        <WalletIcon aria-hidden="true" className="size-4" />
        No wallet connected
      </Link>
    );
  }
  return (
    <Link
      href="/settings/wallets"
      className="inline-flex items-center gap-2 text-supporting"
      data-testid="wallet-chip"
    >
      <WalletIcon aria-hidden="true" className="size-4" />
      <span>
        {connection.walletName} ·{' '}
        <code className="font-mono">{shortenAddress(connection.account.address)}</code>
      </span>
      <StatusBadge
        tone={
          readiness.connectedIsVerified
            ? 'success'
            : wallet.chainMatches === false
              ? 'error'
              : 'attention'
        }
      >
        {readiness.connectedIsVerified
          ? 'Verified'
          : wallet.chainMatches === false
            ? 'Wrong network'
            : 'Unverified'}
      </StatusBadge>
    </Link>
  );
}
