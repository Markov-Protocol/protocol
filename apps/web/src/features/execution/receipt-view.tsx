'use client';

import type { Receipt } from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  SkeletonText,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@markov/ui';
import Link from 'next/link';
import { useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { downloadJson } from '../portfolio/download';
import { receiptFeeSummary, receiptLegRows } from '../portfolio/portfolio-model';
import { formatSol } from '../review/plan-model';
import { stateLabel } from './execution-model';
import { describeExecutionFailure } from './execution-panel';
import { useReceipt, useReceiptKeys, useSetReceiptPublic } from './queries';

/**
 * `/receipts/[receiptId]`: the signed record of what was requested,
 * approved, submitted, filled and charged, with its signer and canonical
 * hash. Cryptographic verification against the published keys is what the
 * CLI and the SDK do offline (`markov receipts verify`); this page shows
 * the key's published status and the exact JSON to verify, and never calls
 * a receipt a proof of ownership or of settlement.
 */
export function ReceiptView({ receiptId }: { readonly receiptId: string }) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const receiptQuery = useReceipt(receiptId, true);
  const keys = useReceiptKeys(receiptQuery.data !== undefined);
  const setPublic = useSetReceiptPublic(receiptId);
  const [failure, setFailure] = useState<string | null>(null);
  const receipt = receiptQuery.data ?? null;

  if (receiptQuery.error instanceof WebApiError && receiptQuery.error.status === 404) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState
          title="Not found"
          description="There is no receipt with this id that you can read. A private receipt is readable by its owner only."
          action={
            <Button asChild variant="secondary">
              <Link href={signedIn ? '/activity' : '/sign-in'}>
                {signedIn ? 'Back to activity' : 'Sign in'}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (receiptQuery.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <ErrorBlock
          title="The receipt could not be read"
          message={receiptQuery.error.message}
          onRetry={() => void receiptQuery.refetch()}
        />
      </div>
    );
  }
  if (receipt === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <SkeletonText lines={5} />
      </div>
    );
  }
  const body = receipt.body;
  const owner = receipt.ownerUserId !== null;
  const key = keys.data?.keys.find((entry) => entry.keyId === receipt.signer.keyId) ?? null;
  const json = JSON.stringify(receipt, null, 2);
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6" data-testid="receipt-view">
      <header className="space-y-2">
        <p className="text-caption text-text-muted">
          {owner ? (
            <Link
              href={`/activity/${body.subject.intentId}`}
              className="underline underline-offset-2"
            >
              Activity
            </Link>
          ) : (
            'Public receipt'
          )}{' '}
          · issued {formatInstant(body.issuedAt)} UTC
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-heading-lg font-semibold">
          {body.kind === 'execution' ? 'Execution receipt' : 'Decision receipt'}
          <StatusBadge tone={body.status.terminal ? 'success' : 'pending'}>
            {stateLabel(body.status.intentState)}
          </StatusBadge>
          {receipt.public ? <StatusBadge tone="info">Public</StatusBadge> : null}
        </h1>
        <p className="text-supporting text-text-muted">{receiptMeaning(receipt)}</p>
      </header>

      <section aria-labelledby="receipt-record" className="space-y-2">
        <h2 id="receipt-record" className="text-heading-sm font-semibold">
          What the record says
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-supporting sm:grid-cols-2">
          <Row label="Requested">
            {body.subject.intentKind.replace('_', ' ')} on {body.network.cluster} from wallet{' '}
            {shortenAddress(body.subject.walletAddress)}
            {body.subject.continuationOfIntentId ? ' (reviewed completion)' : ''}
          </Row>
          <Row label="Approved">
            plan{' '}
            <code className="font-mono">
              {shortenAddress(body.hashes.planHash, { head: 10, tail: 6 })}
            </code>
            {body.timestamps.acknowledgedAt
              ? ` at ${formatInstant(body.timestamps.acknowledgedAt)} UTC`
              : ''}
            ; policy {body.policy.policyVersion ?? 'unversioned'} ({body.policy.outcome}), slippage{' '}
            {body.policy.slippageBps / 100}%, total spend at most {body.approved.totalSpendRaw} raw,
            network fee at most {formatSol(body.approved.networkFeeMaxLamports)}
          </Row>
          <Row label="Submitted">
            {body.chain.signatures.length === 0
              ? 'nothing (decision receipt)'
              : `${body.chain.signatures.length} signature${body.chain.signatures.length === 1 ? '' : 's'}, finality ${body.chain.finality}${
                  body.timestamps.firstSubmittedAt
                    ? `, first at ${formatInstant(body.timestamps.firstSubmittedAt)} UTC`
                    : ''
                }`}
          </Row>
          <Row label="Filled">
            {body.fills.length === 0
              ? 'nothing recorded'
              : body.fills
                  .map(
                    (fill) =>
                      `leg ${fill.legIndex + 1}: ${fill.inputSpentRaw} raw in, ${fill.outputReceivedRaw} raw out${fill.withinBounds ? '' : ' (outside bounds)'}`,
                  )
                  .join('; ')}
          </Row>
          <Row label="Charged">
            network fee {formatSol(body.fees.networkFeeLamports)}, rent{' '}
            {formatSol(body.fees.rentLamports)}, protocol fee {body.fees.protocolFeeRaw} raw
          </Row>
          <Row label="Reconciled">
            {body.status.intentState}
            {body.timestamps.settledAt ? ` at ${formatInstant(body.timestamps.settledAt)} UTC` : ''}
            {body.status.failure ? ` · ${body.status.failure}` : ''}
            {body.status.recovery ? ` · ${body.status.recovery}` : ''}
          </Row>
          <Row label="Versions">
            receipt v{body.version}
            {body.subject.strategyVersionId
              ? `, strategy version ${shortenAddress(body.subject.strategyVersionId)}`
              : ''}
            {body.subject.manifestHash
              ? `, manifest ${shortenAddress(body.subject.manifestHash, { head: 8, tail: 6 })}`
              : ''}
          </Row>
        </dl>
      </section>

      <section aria-labelledby="receipt-fills" className="space-y-2">
        <h2 id="receipt-fills" className="text-heading-sm font-semibold">
          Requested against filled
        </h2>
        <p className="text-caption text-text-muted">
          Each approved leg with its bounds (at most this much in, at least this much out) next to
          what the chain recorded. Raw base units: the receipt carries no decimals, so the exact
          integers are shown. A leg without a fill was not executed.
        </p>
        <Table regionLabel="Requested against filled" data-testid="receipt-legs">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Leg</TableHeaderCell>
              <TableHeaderCell numeric>Approved max in</TableHeaderCell>
              <TableHeaderCell numeric>Approved min out</TableHeaderCell>
              <TableHeaderCell numeric>Filled in</TableHeaderCell>
              <TableHeaderCell numeric>Filled out</TableHeaderCell>
              <TableHeaderCell>Outcome</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {receiptLegRows(body).map((leg) => (
              <TableRow key={leg.legIndex} data-testid="receipt-leg" data-status={leg.status}>
                <TableCell>
                  {leg.legIndex + 1} · {leg.side}
                </TableCell>
                <TableCell numeric>
                  <code className="font-mono">{leg.approvedMaxInputRaw}</code>
                </TableCell>
                <TableCell numeric>
                  <code className="font-mono">{leg.approvedMinimumOutputRaw}</code>
                </TableCell>
                <TableCell numeric>
                  <code className="font-mono">{leg.filledInputRaw ?? '—'}</code>
                </TableCell>
                <TableCell numeric>
                  <code className="font-mono">{leg.filledOutputRaw ?? '—'}</code>
                </TableCell>
                <TableCell>
                  {leg.status === 'filled' ? (
                    <StatusBadge tone={leg.withinBounds ? 'success' : 'error'}>
                      {leg.withinBounds ? 'filled within bounds' : 'filled outside bounds'}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">not filled</StatusBadge>
                  )}
                  {leg.signature ? (
                    <code className="block font-mono text-caption text-text-muted">
                      {shortenAddress(leg.signature, { head: 8, tail: 6 })}
                    </code>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-caption text-text-muted" data-testid="receipt-fee-cap">
          {(() => {
            const fees = receiptFeeSummary(body);
            return `Network fees actually paid ${formatSol(fees.spentLamports)} against the approved cap of ${formatSol(fees.capLamports)} (${fees.withinCap ? 'within the cap' : 'above the cap'}); chain evidence: ${body.chain.signatures.length} signature${body.chain.signatures.length === 1 ? '' : 's'}, finality ${body.chain.finality}${body.chain.slots.length > 0 ? `, slots ${body.chain.slots.join(', ')}` : ''}.`;
          })()}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="download-receipt"
            onClick={() => downloadJson(`receipt-${body.receiptId.slice(0, 8)}.json`, receipt)}
          >
            Download receipt (JSON)
          </Button>
          {owner ? (
            <Button asChild variant="secondary" size="sm">
              <Link href="/portfolio">Holdings in the portfolio</Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="receipt-signature" className="space-y-2">
        <h2 id="receipt-signature" className="text-heading-sm font-semibold">
          Signature
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-supporting sm:grid-cols-2">
          <Row label="Signing key">
            <code className="font-mono">{receipt.signer.keyId}</code> ({receipt.signer.algorithm}){' '}
            {key ? (
              <StatusBadge
                tone={key.status === 'active' ? 'success' : 'attention'}
                data-testid="key-status"
              >
                {key.status === 'active' ? 'published, active' : 'published, retired'}
              </StatusBadge>
            ) : keys.data ? (
              <StatusBadge tone="error" data-testid="key-status">
                not among the published keys
              </StatusBadge>
            ) : (
              <StatusBadge tone="pending">checking the published keys</StatusBadge>
            )}
          </Row>
          <Row label="Canonical hash">
            <code className="break-all font-mono">{receipt.canonicalHash}</code>
          </Row>
        </dl>
        <p className="text-caption text-text-muted">
          Verify offline with the CLI: save the JSON below and run{' '}
          <code className="font-mono">markov receipts verify --file receipt.json</code> against{' '}
          <code className="font-mono">GET /v1/receipts/keys</code>. A valid signature proves Markov
          attested to this record; settlement is the chain evidence it references.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton value={json} label="Copy receipt JSON" />
          {owner ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setFailure(null);
                setPublic.mutate(
                  { public: !receipt.public },
                  { onError: (error) => setFailure(describeExecutionFailure(error, 'receipt')) },
                );
              }}
              loading={setPublic.isPending}
              data-testid="toggle-public"
            >
              {receipt.public ? 'Make private' : 'Make public (redacted)'}
            </Button>
          ) : null}
        </div>
        {owner ? (
          <p className="text-caption text-text-muted">
            A public receipt is readable by anyone with its link, with your account id omitted; the
            signed body stays intact, so it still verifies.
          </p>
        ) : null}
        {failure ? (
          <Notice tone="error" title="That did not complete" live="assertive">
            {failure}
          </Notice>
        ) : null}
      </section>

      <details className="text-caption">
        <summary className="cursor-pointer text-text-muted">Receipt JSON</summary>
        <pre
          className="mt-2 max-h-96 overflow-auto rounded-panel border border-border/40 p-3 font-mono"
          data-testid="receipt-json"
        >
          {json}
        </pre>
      </details>
    </div>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption uppercase tracking-wide text-text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function receiptMeaning(receipt: Receipt): string {
  const scope = receipt.body.scope;
  return `Attests to the ${scope.attests}; settlement rests on ${scope.settlement.replace('_', ' ')}; ownership ${scope.ownership.replace('_', ' ')}; policy ${scope.policy.replace(/_/g, ' ')}.`;
}
