'use client';

import type { WalletFundingResponse } from '@markov/contracts';
import { formatRawAmount, formatRelativeAge } from '@markov/formatters';
import { Button, ErrorBlock, Notice, Skeleton, StatusBadge, type StatusTone } from '@markov/ui';
import { WebApiError } from '../api/use-markov-api';
import { useFunding } from '../wallets/queries';
import { CopyButton } from './copy-button';
import { QrCode } from './qr-code';

const readinessTone: Record<WalletFundingResponse['readiness'], StatusTone> = {
  funded: 'success',
  needs_sol: 'attention',
  needs_stablecoin: 'attention',
  unfunded: 'neutral',
};
const readinessWords: Record<WalletFundingResponse['readiness'], string> = {
  funded: 'Funded',
  needs_sol: 'Needs SOL for fees',
  needs_stablecoin: 'Needs stablecoin',
  unfunded: 'Not funded',
};

function sol(lamports: string): string {
  return `${formatRawAmount(lamports, 9)} SOL`;
}

/**
 * Receive and funding status for one verified wallet: the person's own
 * address (full text, copy, QR), the exact network and asset mint, and
 * balances as observed by the backend at a stated moment. No pooled
 * address, no bridge, no onramp, no deposit credit.
 */
export function FundingPanel({ walletId }: { readonly walletId: string }) {
  const funding = useFunding(walletId);
  if (funding.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading funding status" className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-44 w-44" />
        <Skeleton className="h-5 w-full" />
      </div>
    );
  }
  if (funding.isError) {
    const error = funding.error;
    const unavailable = error instanceof WebApiError && error.code === 'PROVIDER_UNAVAILABLE';
    return (
      <ErrorBlock
        title={unavailable ? 'Balances unknown right now' : 'Funding status could not be loaded'}
        message={
          unavailable
            ? 'The network endpoint could not be read. Markov shows unknown, never zero, until it answers.'
            : error instanceof Error
              ? error.message
              : 'Unexpected error.'
        }
        onRetry={() => void funding.refetch()}
      />
    );
  }
  const data = funding.data;
  return (
    <div className="space-y-4" data-testid="funding-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-heading-sm font-semibold">Receive and funding</h3>
        <div className="flex items-center gap-2">
          <StatusBadge tone={readinessTone[data.readiness]}>
            {readinessWords[data.readiness]}
          </StatusBadge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void funding.refetch()}
            loading={funding.isFetching}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <QrCode
          value={data.address}
          label={`QR code of your wallet address on Solana ${data.cluster}`}
        />
        <div className="min-w-0 space-y-2">
          <p className="text-supporting text-text-muted">
            Your own verified wallet on{' '}
            <span className="font-medium text-text">Solana {data.cluster}</span>. Markov never gives
            you a pooled deposit address.
          </p>
          <code
            className="block break-all rounded-md bg-surface-sunken px-2 py-1 font-mono text-supporting"
            data-testid="receive-address"
          >
            {data.address}
          </code>
          <CopyButton value={data.address} label="Copy wallet address" />
          {data.stablecoin ? (
            <div className="space-y-1">
              <p className="text-supporting">
                Send only <span className="font-medium">{data.stablecoin.symbol}</span> on Solana{' '}
                {data.cluster} with this mint:
              </p>
              <code className="block break-all rounded-md bg-surface-sunken px-2 py-1 font-mono text-caption">
                {data.stablecoin.mint}
              </code>
              <CopyButton
                value={data.stablecoin.mint}
                label={`Copy ${data.stablecoin.symbol} mint address`}
              />
            </div>
          ) : (
            <Notice tone="attention" title="No stablecoin configured on this network">
              {data.stablecoinUnavailableReason}
            </Notice>
          )}
        </div>
      </div>
      <dl className="grid gap-2 rounded-panel border border-border/60 p-3 text-supporting sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">SOL balance</dt>
          <dd className="font-medium" data-testid="sol-balance">
            {sol(data.sol.lamports)}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">
            {data.stablecoin ? `${data.stablecoin.symbol} balance` : 'Stablecoin balance'}
          </dt>
          <dd className="font-medium" data-testid="stablecoin-balance">
            {data.stablecoin
              ? `${formatRawAmount(data.stablecoin.raw, data.stablecoin.decimals)} ${data.stablecoin.symbol}`
              : 'not observed'}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Observed</dt>
          <dd>
            {formatRelativeAge(data.observedAt)} at slot {data.slot} ({data.commitment})
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">Needed for fees</dt>
          <dd className="font-medium" data-testid="required-lamports">
            {sol(data.requirements.requiredLamports)}{' '}
            {data.sol.sufficientForFees ? '(covered)' : '(not covered)'}
          </dd>
        </div>
      </dl>
      <p className="text-caption text-text-muted">{data.requirements.explanation}</p>
      <p className="text-caption text-text-muted">
        A {data.stablecoin?.symbol ?? 'stablecoin'} balance does not pay SOL network fees. Bridges,
        fiat onramps and fee sponsorship are not integrated; nothing here credits a deposit before
        the network shows it.
      </p>
    </div>
  );
}
