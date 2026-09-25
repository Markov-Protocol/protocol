'use client';

import type { PublicVersion, RegistrationEvidence, SolanaCluster } from '@markov/contracts';
import { formatInstant, shortenAddress } from '@markov/formatters';
import { Notice, StatusBadge } from '@markov/ui';
import { CopyButton } from '../funding/copy-button';
import { networkLabel } from '../markets/labels';

function ExplorerLink({ href, label }: { readonly href: string | null; readonly label: string }) {
  if (!href) {
    return (
      <span className="text-caption text-text-muted">no public explorer for this network</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-2"
    >
      {label}
    </a>
  );
}

/**
 * Registration evidence exactly as the API validated it from finalized
 * chain state: the transaction, the record address, the publisher and the
 * status marker, with explorer links the API built for the bound network.
 * Nothing here comes from a database flag.
 */
export function RegistrationEvidenceView({
  registration,
  cluster,
  genesisHash,
  programId,
  verification,
}: {
  readonly registration: RegistrationEvidence;
  readonly cluster: SolanaCluster | null;
  readonly genesisHash: string | null;
  readonly programId: string | null;
  readonly verification?: PublicVersion['verification'];
}) {
  return (
    <div className="space-y-3" data-testid="registration-evidence">
      <dl className="grid gap-x-6 gap-y-2 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-text-muted">Network</dt>
        <dd>
          {networkLabel(cluster)}
          {genesisHash ? (
            <>
              {' · genesis '}
              <code className="break-all font-mono">
                {shortenAddress(genesisHash, { head: 6, tail: 6 })}
              </code>
            </>
          ) : null}
        </dd>
        {programId ? (
          <>
            <dt className="text-text-muted">Registry program</dt>
            <dd>
              <code className="break-all font-mono">{programId}</code>
            </dd>
          </>
        ) : null}
        <dt className="text-text-muted">Record</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <code className="break-all font-mono" data-testid="record-address">
            {registration.recordAddress}
          </code>
          <CopyButton value={registration.recordAddress} label="Copy the record address" />
          <ExplorerLink href={registration.recordUrl} label="Record on Solana Explorer" />
        </dd>
        <dt className="text-text-muted">Transaction</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <code className="break-all font-mono" data-testid="registration-signature">
            {shortenAddress(registration.signature, { head: 8, tail: 8 })}
          </code>
          <CopyButton value={registration.signature} label="Copy the transaction signature" />
          <ExplorerLink href={registration.transactionUrl} label="Transaction on Solana Explorer" />
        </dd>
        <dt className="text-text-muted">Finalized</dt>
        <dd>
          slot {registration.slot.toLocaleString('en-US')}
          {registration.blockTime ? ` · ${formatInstant(registration.blockTime)} UTC` : ''}
        </dd>
        <dt className="text-text-muted">Publisher wallet</dt>
        <dd>
          <code className="break-all font-mono">{registration.publisher}</code>
        </dd>
        <dt className="text-text-muted">Status marker</dt>
        <dd>
          <StatusBadge tone={registration.status === 'active' ? 'success' : 'attention'}>
            {registration.status === 'active' ? 'Active' : 'Deprecated'}
          </StatusBadge>
        </dd>
      </dl>
      {verification ? (
        verification.manifestHashMatches && verification.contentMatches ? (
          <Notice tone="success" title="Verified against the chain" data-testid="verification">
            The manifest hash recomputed from the canonical bytes equals the hash the record
            carries, and the record's constituents, cash, digest and lineage equal this version's.
            Checked {formatInstant(verification.checkedAt)} UTC.
          </Notice>
        ) : (
          <Notice tone="error" title="Does not match the chain" data-testid="verification">
            Markov could not verify this version against the record it is linked to. Do not rely on
            it.
            <ul className="mt-1 list-disc pl-5">
              {verification.mismatches.map((mismatch) => (
                <li key={mismatch}>{mismatch}</li>
              ))}
            </ul>
          </Notice>
        )
      ) : null}
    </div>
  );
}
