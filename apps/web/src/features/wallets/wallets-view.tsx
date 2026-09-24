'use client';

import type { WalletLink } from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import {
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  ErrorBlock,
  Notice,
  Skeleton,
  StatusBadge,
} from '@markov/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { FundingPanel } from '../funding/funding-panel';
import { LinkWalletDialog } from './link-wallet-dialog';
import { useUnlinkWallet, useVerifiedWallets } from './queries';
import { ReadinessSummary } from './readiness-summary';
import { clusterLabel, type DiscoveredWallet } from './standard';
import { useLinkWallet } from './use-link-wallet';
import { useWallet } from './wallet-context';

function CapabilityBadges({ wallet }: { readonly wallet: DiscoveredWallet }) {
  const { capabilities } = wallet;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={`${wallet.name} capabilities`}>
      <li>
        <StatusBadge tone={capabilities.signMessage ? 'success' : 'error'}>
          {capabilities.signMessage ? 'Signs messages' : 'No message signing'}
        </StatusBadge>
      </li>
      <li>
        <StatusBadge tone={capabilities.signTransaction ? 'success' : 'neutral'}>
          {capabilities.signTransaction
            ? `Signs transactions (${capabilities.transactionVersions.map((version) => (version === 0 ? 'v0' : version)).join(', ') || 'versions unknown'})`
            : 'No transaction signing'}
        </StatusBadge>
      </li>
      <li>
        <StatusBadge tone="neutral">
          {capabilities.signAndSendTransaction
            ? 'Sign and send: unsupported by Markov'
            : 'Sign only'}
        </StatusBadge>
      </li>
      {wallet.chains.map((chain) => (
        <li key={chain}>
          <StatusBadge tone="info">{clusterLabel(chain)}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

function VerifiedWalletRow({
  wallet,
  canUnlink,
  onUnlink,
  unlinking,
  connectedAddress,
}: {
  readonly wallet: WalletLink;
  readonly canUnlink: boolean;
  readonly onUnlink: () => void;
  readonly unlinking: boolean;
  readonly connectedAddress: string | null;
}) {
  const [showFunding, setShowFunding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <li
      className="space-y-3 rounded-panel border border-border/60 p-4"
      data-testid="verified-wallet"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-supporting">{wallet.address}</code>
            <CopyButton
              value={wallet.address}
              label={`Copy address ${shortenAddress(wallet.address)}`}
            />
          </div>
          <p className="text-caption text-text-muted">
            Verified {formatInstant(wallet.verifiedAt)} · chain {wallet.chain} · genesis{' '}
            {shortenAddress(wallet.genesisHash)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connectedAddress === wallet.address ? (
            <StatusBadge tone="success">Connected now</StatusBadge>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowFunding((value) => !value)}
            aria-expanded={showFunding}
          >
            {showFunding ? 'Hide funding' : 'Receive and funding'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} disabled={!canUnlink}>
            Unlink
          </Button>
        </div>
      </div>
      {!canUnlink ? (
        <p className="text-caption text-text-muted">Unlinking needs a recent sign-in.</p>
      ) : null}
      {showFunding ? <FundingPanel walletId={wallet.walletId} /> : null}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title="Unlink this wallet?"
          description="Markov forgets the ownership proof. Funds stay in the wallet; nothing moves."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                loading={unlinking}
                onClick={() => {
                  onUnlink();
                  setConfirm(false);
                }}
              >
                Unlink
              </Button>
            </>
          }
        >
          <code className="break-all font-mono text-supporting">{wallet.address}</code>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/**
 * Wallets settings: verified wallets with receive/funding, explicit
 * external-wallet selection, the connected wallet with its checks, and
 * ownership verification through the fresh challenge.
 */
export function WalletsView() {
  const { state, platform } = useSession();
  const wallet = useWallet();
  const verified = useVerifiedWallets(state.status === 'signed-in');
  const unlink = useUnlinkWallet();
  const link = useLinkWallet();
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [lastWalletName, setLastWalletName] = useState('the wallet');
  const stepUpFresh = state.status === 'signed-in' && state.account.stepUpFresh;
  const cluster = platform.state === 'connected' ? platform.solanaCluster : null;
  const connection = wallet.connection;
  const connectedAddress = connection.status === 'connected' ? connection.account.address : null;
  const connectedIsVerified =
    connectedAddress !== null &&
    (verified.data ?? []).some((row) => row.address === connectedAddress);

  useEffect(() => {
    if (link.state.step === 'linked') {
      void verified.refetch();
    }
  }, [link.state.step, verified.refetch]);
  useEffect(() => {
    if (connection.status === 'connected') {
      setLastWalletName(connection.walletName);
    }
  }, [connection]);

  const canVerify =
    connection.status === 'connected' &&
    wallet.chainMatches === true &&
    connection.capabilities.signMessage &&
    stepUpFresh &&
    !connectedIsVerified;

  return (
    <section className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-heading-lg font-semibold">Wallets</h1>
        <p className="text-body text-text-muted">
          Being signed in, having a wallet connected, having proven you own it and being eligible to
          trade are four different things. Each is shown on its own.
        </p>
        <ReadinessSummary />
      </header>

      {wallet.notice ? (
        <Notice
          tone="attention"
          title="Wallet context changed"
          live="polite"
          actions={
            <Button size="sm" variant="ghost" onClick={wallet.dismissNotice}>
              Dismiss
            </Button>
          }
        >
          {wallet.notice}
        </Notice>
      ) : null}

      <section aria-labelledby="verified-heading" className="space-y-3">
        <h2 id="verified-heading" className="text-heading-sm font-semibold">
          Verified wallets
        </h2>
        {verified.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading verified wallets">
            <Skeleton className="h-20 w-full" />
          </div>
        ) : verified.isError ? (
          <ErrorBlock
            title="Verified wallets could not be loaded"
            message={verified.error.message}
            onRetry={() => void verified.refetch()}
          />
        ) : verified.data.length === 0 ? (
          <EmptyState
            title="No verified wallet yet"
            description="Connect a wallet below and sign the ownership challenge. Until then nothing can be signed for this account."
          />
        ) : (
          <ul className="space-y-3">
            {verified.data.map((row) => (
              <VerifiedWalletRow
                key={row.walletId}
                wallet={row}
                canUnlink={stepUpFresh}
                unlinking={unlink.isPending}
                connectedAddress={connectedAddress}
                onUnlink={() => {
                  setUnlinkError(null);
                  unlink.mutate(row, {
                    onError: (error) =>
                      setUnlinkError(error instanceof Error ? error.message : 'Unlink failed.'),
                  });
                }}
              />
            ))}
          </ul>
        )}
        {unlinkError ? (
          <Notice tone="error" title="Unlink failed" live="assertive">
            {unlinkError}
          </Notice>
        ) : null}
        {!stepUpFresh && state.status === 'signed-in' ? (
          <p className="text-supporting text-text-muted">
            Linking and unlinking need a recent sign-in.{' '}
            <Link href={signInHref('/settings/wallets')} className="underline underline-offset-2">
              Sign in again
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="connected-heading" className="space-y-3">
        <h2 id="connected-heading" className="text-heading-sm font-semibold">
          Connected wallet
        </h2>
        {connection.status === 'none' ? (
          <p className="text-supporting text-text-muted">
            No wallet is connected. Choose one below; Markov never picks one for you.
          </p>
        ) : null}
        {connection.status === 'connecting' ? (
          <p aria-busy="true" className="text-supporting text-text-muted">
            Waiting for {connection.walletName} to approve the connection…
          </p>
        ) : null}
        {connection.status === 'declined' ? (
          <Notice tone="error" title={`${connection.walletName} did not connect`} live="assertive">
            {connection.message}
          </Notice>
        ) : null}
        {connection.status === 'choose-account' ? (
          <div className="space-y-2">
            <p className="text-supporting">
              {connection.walletName} exposes several accounts. Choose the one that will sign:
            </p>
            <ul className="space-y-2">
              {connection.accounts.map((account) => (
                <li key={account.address}>
                  <Button variant="secondary" onClick={() => wallet.chooseAccount(account.address)}>
                    {account.label ? `${account.label} · ` : ''}
                    <code className="font-mono">
                      {shortenAddress(account.address, { head: 6, tail: 6 })}
                    </code>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {connection.status === 'connected' ? (
          <div
            className="space-y-3 rounded-panel border border-border/60 p-4"
            data-testid="connected-wallet"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium">{connection.walletName}</p>
                <code
                  className="break-all font-mono text-supporting"
                  data-testid="connected-address"
                >
                  {connection.account.address}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={connectedIsVerified ? 'success' : 'attention'}>
                  {connectedIsVerified ? 'Verified owner' : 'Ownership not verified'}
                </StatusBadge>
                <StatusBadge tone={wallet.chainMatches ? 'success' : 'error'}>
                  {wallet.chainMatches ? `Network: ${cluster}` : 'Network mismatch'}
                </StatusBadge>
              </div>
            </div>
            {wallet.chainMatches === false ? (
              <Notice tone="error" title="This wallet account is on another network" live="polite">
                The account reports{' '}
                {connection.account.chains.map(clusterLabel).join(', ') || 'no network'}; Markov
                runs on Solana {cluster ?? 'an unknown cluster'}. Switch the wallet to{' '}
                {cluster ?? 'the platform network'} and choose it again. No signature is requested
                until they match.
              </Notice>
            ) : null}
            {!connection.capabilities.signMessage ? (
              <Notice tone="error" title="This wallet cannot sign messages">
                Ownership verification needs the Wallet Standard <code>solana:signMessage</code>{' '}
                feature. Choose another wallet.
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void link.start()}
                disabled={!canVerify}
                data-testid="verify-ownership"
              >
                {connectedIsVerified ? 'Ownership verified' : 'Verify ownership'}
              </Button>
              <Button variant="secondary" onClick={() => void wallet.disconnect()}>
                Disconnect wallet
              </Button>
            </div>
            <p className="text-caption text-text-muted">
              Disconnecting forgets the connection on this page only. It does not sign you out of
              Markov; use the account menu for that.
            </p>
          </div>
        ) : null}
      </section>

      {/* Outside the connected card so an outcome stays visible even when the wallet disconnects mid-flow. */}
      <LinkWalletDialog
        state={link.state}
        walletName={lastWalletName}
        onClose={link.reset}
        onRetry={() => {
          link.reset();
          void link.start();
        }}
      />

      <section aria-labelledby="choose-heading" className="space-y-3">
        <h2 id="choose-heading" className="text-heading-sm font-semibold">
          Choose a wallet
        </h2>
        {wallet.wallets.length === 0 ? (
          <EmptyState
            title="No Solana wallet detected"
            description="Install or unlock a wallet that supports the Wallet Standard, then return here. Markov does not create a wallet for you."
          />
        ) : (
          <ul className="space-y-2">
            {wallet.wallets.map((candidate) => (
              <li
                key={candidate.name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-border/60 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs declared by the wallet; nothing to optimise */}
                  <img src={candidate.icon} alt="" className="size-8 rounded-md" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{candidate.name}</p>
                    <CapabilityBadges wallet={candidate} />
                  </div>
                </div>
                <Button
                  variant={
                    connection.status === 'connected' && connection.walletName === candidate.name
                      ? 'secondary'
                      : 'primary'
                  }
                  onClick={() => void wallet.select(candidate.name)}
                  disabled={connection.status === 'connecting'}
                >
                  {connection.status === 'connected' && connection.walletName === candidate.name
                    ? 'Connected'
                    : `Choose ${candidate.name}`}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-panel border border-dashed border-border/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Markov-managed (embedded) wallet</p>
            <StatusBadge tone="neutral">Not available</StatusBadge>
          </div>
          <p className="text-supporting text-text-muted">
            No hosted wallet provider is integrated (open decision OD-05). When one is, it will be
            an explicit choice with the provider's own recovery flow, never a silent side effect of
            signing in.
          </p>
        </div>
      </section>
    </section>
  );
}
