'use client';

import type {
  Publication,
  PublicationPreview,
  RegistryStatus,
  SolanaCluster,
  StrategyVersion,
} from '@markov/contracts';
import { formatBasisPoints, shortenAddress } from '@markov/formatters';
import { Button, Field, Notice, SelectInput, StatusBadge } from '@markov/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { StaleSessionError, useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { clusterOf, networkLabel } from '../markets/labels';
import { useVerifiedWallets } from '../wallets/queries';
import { useWallet, WalletSigningError } from '../wallets/wallet-context';
import {
  formatLamports,
  type PublicationReading,
  readRegistration,
  readStatusChange,
} from './publication-state';
import {
  ownVersionKey,
  publicStrategyKey,
  publicVersionKey,
  usePreparePublication,
  usePrepareStatusChange,
  useSubmitPublication,
  useVersionPublication,
  useVersionStatusChange,
} from './queries';

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof WebApiError) {
    const details = error.details.map((detail) => detail.message).join('; ');
    return details ? `${error.message} (${details})` : error.message;
  }
  return fallback;
}

/** What went wrong between the wallet and the API, and what is true afterwards: nothing was sent unless stated. */
export function describeSigningError(error: unknown): string {
  if (error instanceof StaleSessionError) {
    return 'Your session changed while the wallet was open. Nothing was submitted.';
  }
  if (error instanceof WalletSigningError) {
    switch (error.reason) {
      case 'context-changed':
        return 'The wallet or account changed while the signature was pending. Nothing was submitted.';
      case 'altered':
        return `The wallet did not return the prepared transaction (${error.message}). Nothing was submitted.`;
      case 'declined':
        return 'The wallet declined to sign. Nothing was submitted.';
      default:
        return `${error.message}. Nothing was submitted.`;
    }
  }
  if (error instanceof WebApiError) {
    switch (error.code) {
      case 'SIGNATURE_MISMATCH':
        return 'Markov refused the signed transaction: it is not the prepared message carrying the publisher wallet’s signature. Nothing reached the network.';
      case 'PUBLICATION_EXPIRED':
        return 'The prepared transaction expired before it was submitted. Nothing reached the network; prepare it again.';
      case 'PROVIDER_UNAVAILABLE':
        return 'The network node could not be reached, so the signed transaction was not sent. Try again shortly.';
      case 'RATE_LIMITED':
        return 'Too many attempts in a short time. Wait a minute, then try again.';
      default:
        return `${error.message}. Nothing was submitted.`;
    }
  }
  return 'Something unexpected happened. Nothing was submitted.';
}

function Hash({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <li>
      {label}:{' '}
      <code className="break-all font-mono text-caption" title={value}>
        {value}
      </code>
    </li>
  );
}

/** Exactly what the API will put on chain and in the public API, and what it never will. */
function PreviewBlock({
  preview,
  cluster,
}: {
  readonly preview: PublicationPreview;
  readonly cluster: SolanaCluster | null;
}) {
  const { manifest, onChain } = preview;
  return (
    <div className="space-y-3" data-testid="publish-preview">
      <div>
        <h3 className="font-medium">What becomes public</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-supporting">
          <li>
            Version {manifest.versionNumber} of “{manifest.title}” on {networkLabel(cluster)}: the
            thesis text, {manifest.legs.length} constituent
            {manifest.legs.length === 1 ? '' : 's'} by mint and weight, cash{' '}
            {formatBasisPoints(manifest.cashWeightBps)}, the maintenance rule and{' '}
            {manifest.references.length} reference{manifest.references.length === 1 ? '' : 's'}.
          </li>
          {manifest.legs.map((leg) => (
            <li key={leg.instrumentId} data-testid="preview-leg">
              {leg.symbol} · <code className="font-mono">{shortenAddress(leg.mint)}</code> ·{' '}
              {formatBasisPoints(leg.weightBps)}
            </li>
          ))}
          <Hash label="Manifest hash" value={manifest.manifestHash} />
          <Hash label="Content digest" value={manifest.contentDigest} />
          <li>
            Publisher wallet: <code className="break-all font-mono">{onChain.publisher}</code>
          </li>
          <li>
            Record address: <code className="break-all font-mono">{onChain.recordAddress}</code>
          </li>
          {onChain.relation !== 'none' && onChain.parentRecordAddress ? (
            <li>
              Lineage: {onChain.relation} of record{' '}
              <code className="break-all font-mono">{onChain.parentRecordAddress}</code>
            </li>
          ) : null}
        </ul>
      </div>
      <div>
        <h3 className="font-medium">What never becomes public</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-supporting text-text-muted">
          {preview.neverPublished.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <Notice tone="attention" title="Permanent" data-testid="permanence">
        {preview.permanence}
      </Notice>
    </div>
  );
}

/** Signs a prepared transaction with the connected wallet and submits it; one submission per click, never a retry on its own. */
function SignStep({
  strategyId,
  versionId,
  publication,
  cluster,
  headline,
}: {
  readonly strategyId: string;
  readonly versionId: string;
  readonly publication: Publication;
  readonly cluster: SolanaCluster | null;
  readonly headline: string;
}) {
  const wallet = useWallet();
  const submit = useSubmitPublication(strategyId, versionId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [signing, setSigning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const transaction = publication.transaction;
  const connection = wallet.connection;
  const connectedAddress = connection.status === 'connected' ? connection.account.address : null;
  const publisher = publication.publisher.address;
  const network = networkLabel(cluster);
  let disabledReason: string | undefined;
  if (!transaction) {
    disabledReason = 'No transaction is waiting for a signature.';
  } else if (!acknowledged) {
    disabledReason = 'Confirm the statement above first.';
  } else if (connectedAddress === null) {
    disabledReason = `Connect the publisher wallet ${shortenAddress(publisher)} (Settings → Wallets) to sign.`;
  } else if (connectedAddress !== publisher) {
    disabledReason = `The connected wallet ${shortenAddress(connectedAddress)} is not the publisher wallet ${shortenAddress(publisher)}. Connect that wallet to sign.`;
  } else if (wallet.chainMatches === false) {
    disabledReason = `The connected wallet is on another network. Switch it to ${network} before signing.`;
  } else if (connection.status === 'connected' && !connection.capabilities.signTransaction) {
    disabledReason = `${connection.walletName} cannot sign transactions.`;
  }

  const signAndSubmit = async () => {
    if (!transaction || signing) {
      return;
    }
    setSigning(true);
    setFailure(null);
    try {
      const signed = await wallet.signTransaction(transaction.unsignedTransaction);
      await submit.mutateAsync({
        publicationId: publication.publicationId,
        signedTransaction: signed.signedTransaction,
      });
    } catch (error) {
      setFailure(describeSigningError(error));
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="sign-step">
      <h3 className="font-medium">{headline}</h3>
      <PreviewBlock preview={publication.preview} cluster={cluster} />
      {transaction ? (
        <dl
          className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]"
          data-testid="transaction-facts"
        >
          <dt className="text-text-muted">Cost to the publisher wallet</dt>
          <dd data-testid="estimated-cost">{formatLamports(transaction.estimatedCostLamports)}</dd>
          <dt className="text-text-muted">Fee payer</dt>
          <dd>
            <code className="break-all font-mono">{transaction.feePayer}</code>
          </dd>
          <dt className="text-text-muted">Valid until</dt>
          <dd>
            block height {transaction.lastValidBlockHeight.toLocaleString('en-US')} (blockhash{' '}
            <code className="font-mono">{shortenAddress(transaction.recentBlockhash)}</code>); after
            that the transaction expires and nothing is sent.
          </dd>
        </dl>
      ) : null}
      <label className="flex items-start gap-2 text-supporting">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1"
          data-testid="permanence-checkbox"
        />
        <span>
          I understand that the wallet approval registers this permanently and publicly, and that
          the cost above leaves the publisher wallet.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          loading={signing || submit.isPending}
          {...(disabledReason ? { disabledReason } : {})}
          onClick={() => void signAndSubmit()}
          data-testid="sign-button"
        >
          {connection.status === 'connected'
            ? `Sign with ${connection.walletName}`
            : 'Sign with the publisher wallet'}
        </Button>
        {connectedAddress === null || connectedAddress !== publisher ? (
          <Link href="/settings/wallets" className="text-supporting underline underline-offset-2">
            Wallet settings
          </Link>
        ) : null}
      </div>
      {failure ? (
        <p role="alert" className="text-supporting text-error" data-testid="sign-failure">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function SubmittedBlock({
  publication,
  onRecheck,
  rechecking,
}: {
  readonly publication: Publication;
  readonly onRecheck: () => void;
  readonly rechecking: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="submitted-block">
      {publication.signature ? (
        <p className="flex flex-wrap items-center gap-2 text-supporting">
          Transaction{' '}
          <code className="break-all font-mono" data-testid="submitted-signature">
            {shortenAddress(publication.signature, { head: 8, tail: 8 })}
          </code>
          <CopyButton value={publication.signature} label="Copy the transaction signature" />
          {publication.confirmationStatus ? (
            <StatusBadge tone="pending">{publication.confirmationStatus}</StatusBadge>
          ) : null}
        </p>
      ) : null}
      <p className="text-caption text-text-muted">
        Explorer links appear once the network has finalized the transaction and Markov has read the
        record back.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={rechecking}
        onClick={onRecheck}
        data-testid="recheck-button"
      >
        Re-check now
      </Button>
    </div>
  );
}

/** Choose the verified wallet that signs and pays, then ask the API to prepare the registration. */
function PrepareRegistration({
  strategyId,
  version,
  registry,
  retry,
}: {
  readonly strategyId: string;
  readonly version: StrategyVersion;
  readonly registry: RegistryStatus | null;
  readonly retry: boolean;
}) {
  const wallets = useVerifiedWallets(true);
  const wallet = useWallet();
  const prepare = usePreparePublication(strategyId, version.versionId);
  const [chosen, setChosen] = useState<string | null>(null);
  const connectedAddress =
    wallet.connection.status === 'connected' ? wallet.connection.account.address : null;
  const verified = wallets.data ?? [];
  const walletId =
    chosen ?? verified.find((link) => link.address === connectedAddress)?.walletId ?? null;
  if (registry && !registry.publicationEnabled) {
    return (
      <Notice tone="attention" title="Registration is not available in this deployment">
        {registry.disabledReason ?? 'No registry program is configured.'} The version stays saved
        privately.
      </Notice>
    );
  }
  return (
    <div className="space-y-3" data-testid="prepare-step">
      <h3 className="font-medium">{retry ? 'Try again' : 'Register this version'}</h3>
      <p className="text-supporting text-text-muted">
        Registering publishes version {version.versionNumber} of “{version.title}”: the recipe above
        (constituents by mint and weight, cash), the thesis text, the maintenance rule and
        references, the manifest hash and content digest, and the address of the wallet you sign
        with. It never publishes your account, budgets, balances, notes or drafts. The exact
        payload, its cost and the permanence statement are shown before the wallet asks for a
        signature.
      </p>
      {wallets.isPending ? (
        <p className="text-caption text-text-muted" aria-busy="true">
          Reading your verified wallets…
        </p>
      ) : verified.length === 0 ? (
        <Notice
          tone="attention"
          title="No verified wallet yet"
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link href="/settings/wallets">Verify a wallet</Link>
            </Button>
          }
        >
          A registration is signed and paid by one of your verified wallets, which becomes the
          record's publisher.
        </Notice>
      ) : (
        <Field
          label="Publisher wallet"
          id="publisher-wallet"
          description="Signs the registration, pays its cost and is written on chain as the publisher."
          className="max-w-lg"
        >
          {(control) => (
            <SelectInput
              id={control.id}
              value={walletId}
              placeholder="Choose a verified wallet"
              onValueChange={setChosen}
              options={verified.map((link) => ({
                value: link.walletId,
                label: `${shortenAddress(link.address)} · verified ${link.verifiedAt.slice(0, 10)}`,
              }))}
            />
          )}
        </Field>
      )}
      <Button
        type="button"
        loading={prepare.isPending}
        {...(walletId === null ? { disabledReason: 'Choose a verified wallet to sign with.' } : {})}
        onClick={() => walletId && prepare.mutate(walletId)}
        data-testid="prepare-button"
      >
        Prepare registration
      </Button>
      {prepare.error ? (
        <p role="alert" className="text-supporting text-error">
          {apiMessage(prepare.error, 'Could not prepare the registration.')}
        </p>
      ) : null}
    </div>
  );
}

/** Deprecate or reactivate a registered version with the publisher wallet; only the status marker changes. */
function StatusChangeSection({
  strategyId,
  version,
  latest,
  currentStatus,
  cluster,
  onRecheck,
  rechecking,
}: {
  readonly strategyId: string;
  readonly version: StrategyVersion;
  readonly latest: Publication | null;
  readonly currentStatus: 'active' | 'deprecated' | null;
  readonly cluster: SolanaCluster | null;
  readonly onRecheck: () => void;
  readonly rechecking: boolean;
}) {
  const wallets = useVerifiedWallets(true);
  const prepare = usePrepareStatusChange(strategyId, version.versionId);
  const publisher = version.publisherWallet;
  const publisherLink = (wallets.data ?? []).find((link) => link.address === publisher) ?? null;
  const reading: PublicationReading | null = latest ? readStatusChange(latest) : null;
  const inFlight =
    latest !== null && (latest.state === 'awaiting_signature' || latest.state === 'submitted');
  const next: 'active' | 'deprecated' = currentStatus === 'deprecated' ? 'active' : 'deprecated';
  const changeReason =
    currentStatus === null
      ? 'The current status marker is still being read from the chain.'
      : publisherLink === null
        ? `Only the publisher wallet ${publisher ? shortenAddress(publisher) : ''} can change the status, and it is not verified on this account.`
        : null;
  return (
    <div className="space-y-3 border-border/60 border-t pt-4" data-testid="status-change">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Status marker</h3>
        {reading ? (
          <StatusBadge tone={reading.tone} data-testid="status-change-state">
            {reading.label}
          </StatusBadge>
        ) : null}
      </div>
      {reading ? <p className="text-supporting text-text-muted">{reading.detail}</p> : null}
      {latest && latest.state === 'awaiting_signature' ? (
        <SignStep
          strategyId={strategyId}
          versionId={version.versionId}
          publication={latest}
          cluster={cluster}
          headline={
            latest.operation === 'deprecate' ? 'Sign the deprecation' : 'Sign the reactivation'
          }
        />
      ) : latest && latest.state === 'submitted' ? (
        <SubmittedBlock publication={latest} onRecheck={onRecheck} rechecking={rechecking} />
      ) : null}
      {!inFlight ? (
        <>
          <p className="text-supporting text-text-muted">
            {next === 'deprecated'
              ? 'Deprecating tells followers you no longer stand behind this version. The record, its recipe and its hash stay on chain unchanged; only the status byte moves, and only the publisher wallet can move it.'
              : 'Reactivating marks the record active again; nothing else changes.'}
          </p>
          <Button
            type="button"
            variant="secondary"
            loading={prepare.isPending}
            {...(changeReason ? { disabledReason: changeReason } : {})}
            onClick={() =>
              publisherLink && prepare.mutate({ walletId: publisherLink.walletId, status: next })
            }
            data-testid="status-change-button"
          >
            {next === 'deprecated' ? 'Deprecate this version' : 'Reactivate this version'}
          </Button>
          {prepare.error ? (
            <p role="alert" className="text-supporting text-error">
              {apiMessage(prepare.error, 'Could not prepare the status change.')}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The owner's registration panel for one frozen version. Every state shown
 * here is read from the API, which derives it from the chain; a reload
 * lands in the same place. Nothing here sells, buys or moves a pin.
 */
export function PublishPanel({
  strategyId,
  version,
  registry,
  currentStatus,
}: {
  readonly strategyId: string;
  readonly version: StrategyVersion;
  readonly registry: RegistryStatus | null;
  /** The record's status marker as the public projection reports it; null until read or when not registered. */
  readonly currentStatus: 'active' | 'deprecated' | null;
}) {
  const { platform } = useSession();
  const cluster = clusterOf(platform);
  const registered = version.publication === 'registered';
  const publication = useVersionPublication(strategyId, version.versionId, true);
  const change = useVersionStatusChange(strategyId, version.versionId, registered);
  const registration = publication.data ?? null;
  const statusChange = change.data ?? null;
  const reading = readRegistration(version.publication, registration);
  const recheck = () => void publication.refetch();
  const recheckChange = () => void change.refetch();
  // A re-check that moves a publication also moves the version and the public projection: read them again.
  const client = useQueryClient();
  useEffect(() => {
    if (registration && registration.state !== version.publication) {
      void client.invalidateQueries({ queryKey: ownVersionKey(strategyId, version.versionId) });
    }
    if (registration?.state === 'registered' || statusChange?.state === 'registered') {
      void client.invalidateQueries({ queryKey: publicVersionKey(strategyId, version.versionId) });
      void client.invalidateQueries({ queryKey: publicStrategyKey(strategyId) });
    }
  }, [registration, statusChange, version.publication, version.versionId, strategyId, client]);
  return (
    <section
      aria-labelledby="publish-heading"
      className="space-y-4 rounded-panel border border-border p-4"
      data-testid="publish-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="publish-heading" className="text-heading-sm font-semibold">
          On-chain registration
        </h2>
        <StatusBadge tone={reading.tone} data-testid="publication-state">
          {reading.label}
        </StatusBadge>
      </div>
      <p className="text-supporting text-text-muted" data-testid="publication-detail">
        {reading.detail}
      </p>
      {publication.isPending ? (
        <p className="text-caption text-text-muted" aria-busy="true">
          Checking the registration status…
        </p>
      ) : publication.error ? (
        <Notice
          tone="attention"
          title="Registration status unavailable"
          actions={
            <Button size="sm" variant="secondary" onClick={recheck}>
              Re-check
            </Button>
          }
        >
          Markov could not read the registration status (
          {apiMessage(publication.error, 'unreachable')}). Nothing is assumed about the chain.
        </Notice>
      ) : reading.phase === 'registered' ? (
        <>
          <Notice tone="success" title="This version is public">
            Anyone can open{' '}
            <Link
              href={`/strategies/${strategyId}/versions/${version.versionId}`}
              className="underline underline-offset-2"
            >
              its public page
            </Link>{' '}
            and verify it against the chain.
          </Notice>
          <StatusChangeSection
            strategyId={strategyId}
            version={version}
            latest={statusChange}
            currentStatus={currentStatus}
            cluster={cluster}
            onRecheck={recheckChange}
            rechecking={change.isFetching}
          />
        </>
      ) : reading.phase === 'publishing' && registration?.state === 'awaiting_signature' ? (
        <SignStep
          strategyId={strategyId}
          versionId={version.versionId}
          publication={registration}
          cluster={cluster}
          headline="Review, then sign"
        />
      ) : reading.phase === 'publishing' && registration ? (
        <SubmittedBlock
          publication={registration}
          onRecheck={recheck}
          rechecking={publication.isFetching}
        />
      ) : reading.phase === 'unknown' && registration ? (
        <SubmittedBlock
          publication={registration}
          onRecheck={recheck}
          rechecking={publication.isFetching}
        />
      ) : (
        <PrepareRegistration
          strategyId={strategyId}
          version={version}
          registry={registry}
          retry={reading.phase === 'failed' || reading.phase === 'expired'}
        />
      )}
    </section>
  );
}
