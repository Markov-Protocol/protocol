'use client';

import type {
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  PreparedTransaction,
} from '@markov/contracts';
import { formatInstant, formatRawAmount, shortenAddress } from '@markov/formatters';
import {
  Button,
  Notice,
  SkeletonText,
  StatusBadge,
  type StatusTone,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@markov/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { StaleSessionError, useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { formatSol, formatUnits } from '../review/plan-model';
import { INTENTS_KEY, intentKey, useCancelIntent } from '../review/queries';
import { useWallet, WalletSigningError } from '../wallets/wallet-context';
import {
  announcementFor,
  cancelRule,
  describeState,
  type ExecutionAction,
  nextExecutionAction,
  type SigningContext,
  type StageState,
  signingIssues,
  stateLabel,
  type TimelineBatch,
  timelineOf,
  walletChainFor,
} from './execution-model';
import {
  executionKey,
  useBuildTransaction,
  useExecutionStatus,
  useIntentReceipts,
  useIssueReceipt,
  useReconcileExecution,
  useSubmitTransaction,
} from './queries';
import { checkSignedAgainstPrepared, messageHashOf } from './transaction-check';

/**
 * The execution panel (F10): from an approved plan to a reconciled result.
 * It builds the plan's next transaction through the API, checks the bytes
 * and the context before the wallet opens, submits the signed bytes once,
 * and then reads the state from chain evidence on a bounded schedule. The
 * timeline is server state: a reload shows the same thing, a wallet popup
 * changes nothing until its result is verified, and no failure ever creates
 * a second intent or a second transaction on its own.
 */

/** After this long the person is told the wallet has not answered; the request stays open. */
export const WALLET_WAIT_MS = 45_000;

export interface ExecutionPanelProps {
  readonly intent: Intent;
  readonly plan: ExecutionPlan | null;
  /** The hash the person approved on the review; null when the panel opens without it (activity deep link). */
  readonly approvedPlanHash: string | null;
  /** Where the panel lives: the review hands off to the activity page after the first submission. */
  readonly variant: 'review' | 'activity';
  readonly onSubmitted?: (status: ExecutionStatus) => void;
  /** Test hook: how long the wallet may stay silent before the person is told (default WALLET_WAIT_MS). */
  readonly walletWaitMs?: number;
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'hidden',
    () => false,
  );
}

export function explorerTransactionUrl(signature: string, cluster: string | null): string | null {
  switch (cluster) {
    case 'mainnet-beta':
      return `https://explorer.solana.com/tx/${signature}`;
    case 'devnet':
    case 'testnet':
      return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
    default:
      return null;
  }
}

/** What a failed step means, in the person's words: always what was and was not sent. */
export function describeExecutionFailure(
  error: unknown,
  step: 'build' | 'sign' | 'submit' | 'reconcile' | 'cancel' | 'receipt',
): string {
  if (error instanceof StaleSessionError) {
    return 'Your session changed while this was in progress. Nothing was sent.';
  }
  if (error instanceof WalletSigningError) {
    switch (error.reason) {
      case 'declined':
        return 'The wallet declined to sign. Nothing was sent; the built transaction stays available until its blockhash expires.';
      case 'altered':
        return `The wallet did not return the prepared transaction (${error.message}). Nothing was sent.`;
      case 'context-changed':
        return 'The wallet or account changed while the signature was pending. That signature is discarded; nothing was sent.';
      default:
        return `${error.message}. Nothing was sent.`;
    }
  }
  if (error instanceof WebApiError) {
    const refusal = error.details[0]?.message ?? null;
    switch (error.code) {
      case 'NETWORK':
        return step === 'submit'
          ? 'The answer was lost after the signed transaction left the browser. Do not sign again: the existing attempt is checked against the chain; a new transaction is never sent for an unknown result.'
          : 'Markov could not be reached. Nothing changed; try again.';
      case 'SIGNATURE_MISMATCH':
        return 'Markov refused the signed bytes: they are not the prepared message carrying your wallet’s signature. Nothing reached the network.';
      case 'TRANSACTION_REFUSED':
        switch (refusal) {
          case 'PLAN_NOT_APPROVED':
            return 'The plan is not approved (or no longer is). Review it again; nothing was built.';
          case 'PLAN_EXPIRED':
          case 'PLAN_CHANGED':
            return 'The plan expired or changed; nothing was built. Start a new review.';
          case 'BUILD_UNAVAILABLE':
            return 'No venue can build this transaction right now. Nothing was sent; try again later.';
          case 'VALIDATION_FAILED':
            return `The venue produced bytes the plan does not explain, so Markov refused them before anyone signed (${error.details
              .slice(1, 4)
              .map((detail) => detail.message)
              .join('; ')}). Nothing was sent.`;
          case 'SIMULATION_FAILED':
            return 'The transaction failed simulation, so it was not offered for signing. Nothing was sent.';
          case 'ATTEMPT_IN_FLIGHT':
            return 'A transaction of this intent is already in flight. This screen watches it; nothing else is sent.';
          case 'TRANSACTION_EXPIRED':
            return 'The prepared transaction’s blockhash can no longer land. Nothing was sent; build it again.';
          case 'BATCH_NOT_READY':
            return 'The previous transaction has not finalized with its fills recorded yet. Nothing was sent; wait for it.';
          case 'LEG_TERMS_CHANGED':
            return 'The fresh quote for this leg no longer meets the bounds you approved. The run stopped as partially completed; nothing was sent for this leg.';
          case 'PLAN_COMPLETED':
            return 'Every transaction of this plan is finalized; there is nothing left to build.';
          default:
            return `${error.message}. Nothing was sent.`;
        }
      case 'QUOTE_EXPIRED':
        return 'The plan expired before this step. Nothing was sent; start a new review for fresh terms.';
      case 'POLICY_DENIED':
        return `Policy denied this submission (${error.details.map((detail) => detail.message).join('; ') || error.message}). Nothing was sent and every reservation was released.`;
      case 'PROVIDER_UNAVAILABLE':
        return step === 'receipt'
          ? 'Receipts cannot be issued here: no signing key is configured. The execution record stays as shown.'
          : 'The network node could not be reached, so nothing was sent. Try again shortly.';
      case 'RATE_LIMITED':
        return 'Too many attempts in a short time. Wait a minute, then try again; nothing was sent.';
      case 'PLAN_CHANGED':
        return 'The intent moved on while this was in progress. The screen shows its current state.';
      default:
        return `${error.message}. Nothing was sent.`;
    }
  }
  return 'Something unexpected happened. Nothing was sent.';
}

const STAGE_TONES: Record<StageState, StatusTone> = {
  done: 'success',
  active: 'pending',
  pending: 'neutral',
  failed: 'error',
  unknown: 'attention',
  skipped: 'neutral',
};

const STATE_TONES: Partial<Record<Intent['state'], StatusTone>> = {
  FINALIZED: 'success',
  PARTIALLY_COMPLETED: 'attention',
  UNKNOWN_REQUIRES_RECONCILIATION: 'attention',
  CANCEL_REQUESTED: 'attention',
  FAILED: 'error',
  EXPIRED: 'error',
  REJECTED: 'error',
  CANCELLED: 'neutral',
  SUBMITTING: 'pending',
  SUBMITTED: 'pending',
  CONFIRMED: 'pending',
};

function currentTransaction(
  status: ExecutionStatus,
  action: ExecutionAction,
): PreparedTransaction | null {
  if (action.batch === null) {
    return null;
  }
  return (
    status.transactions.find(
      (transaction) => transaction.batch === action.batch && transaction.state === 'prepared',
    ) ?? null
  );
}

export function ExecutionPanel({
  intent,
  plan,
  approvedPlanHash,
  variant,
  onSubmitted,
  walletWaitMs = WALLET_WAIT_MS,
}: ExecutionPanelProps) {
  const intentId = intent.intentId;
  const wallet = useWallet();
  const { platform } = useSession();
  const client = useQueryClient();
  const hidden = useDocumentHidden();
  const watchedSince = useRef<number | null>(null);
  const statusQuery = useExecutionStatus(intentId, true, {
    hidden,
    watchedSince: watchedSince.current,
  });
  const status = statusQuery.data ?? null;
  const build = useBuildTransaction(intentId);
  const submit = useSubmitTransaction(intentId);
  const reconcile = useReconcileExecution(intentId);
  const cancel = useCancelIntent(intentId);
  const issue = useIssueReceipt(intentId);
  const receipts = useIntentReceipts(intentId, status !== null && status.attempts.length > 0);

  const [phase, setPhase] = useState<'idle' | 'signing' | 'submitting'>('idle');
  const [waitingLong, setWaitingLong] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lostAnswer, setLostAnswer] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const signingToken = useRef(0);
  const previousStatus = useRef<ExecutionStatus | null>(null);

  // Meaningful transitions are announced; a poll that changes nothing says nothing.
  useEffect(() => {
    if (status === null) {
      return;
    }
    const line = announcementFor(previousStatus.current, status);
    if (line !== null) {
      setAnnouncement(line);
    }
    previousStatus.current = status;
    if (watchedSince.current === null && status.nextAction === 'wait') {
      watchedSince.current = Date.now();
    }
  }, [status]);

  const action = status ? nextExecutionAction(status) : null;
  const transaction = status && action ? currentTransaction(status, action) : null;
  const connectedAddress =
    wallet.connection.status === 'connected' ? wallet.connection.account.address : null;
  const cluster = platform.state === 'connected' ? platform.solanaCluster : null;
  const messageHashOfBytes = useMemo(
    () => (transaction ? messageHashOf(transaction.unsignedTransaction) : null),
    [transaction],
  );
  const signingContext: SigningContext | null = transaction
    ? {
        intent,
        approvedPlanHash,
        transaction,
        connectedAddress,
        connectedChain:
          wallet.connection.status !== 'connected' || wallet.chainMatches === null
            ? null
            : wallet.chainMatches
              ? walletChainFor(transaction.network.cluster)
              : (wallet.connection.account.chains.find((chain) => chain.startsWith('solana:')) ??
                'solana:unknown'),
        walletCanSign:
          wallet.connection.status === 'connected'
            ? wallet.connection.capabilities.signTransaction
            : null,
        network: { cluster: cluster ?? transaction.network.cluster, genesisHash: null },
        messageHashOfBytes,
        planExpiresAt: plan?.validity.expiresAt ?? null,
        now: new Date(),
      }
    : null;
  const issues = signingContext ? signingIssues(signingContext) : [];
  const rule = cancelRule(intent, status);
  const timeline = status ? timelineOf(status, plan) : [];

  const invalidateAll = () => {
    void client.invalidateQueries({ queryKey: executionKey(intentId), exact: true });
    void client.invalidateQueries({ queryKey: intentKey(intentId), exact: true });
    void client.invalidateQueries({ queryKey: INTENTS_KEY });
  };

  async function sign(prepared: PreparedTransaction) {
    const token = ++signingToken.current;
    setFailure(null);
    setLostAnswer(false);
    setWaitingLong(false);
    setPhase('signing');
    const generationAtStart = wallet.generation;
    const timer = setTimeout(() => {
      if (signingToken.current === token) {
        setWaitingLong(true);
      }
    }, walletWaitMs);
    try {
      const signed = await wallet.signTransaction(prepared.unsignedTransaction);
      if (signingToken.current !== token) {
        return;
      }
      if (signed.generation !== generationAtStart) {
        throw new WalletSigningError('context-changed', 'the wallet context changed');
      }
      const check = checkSignedAgainstPrepared(prepared, signed.signedTransaction);
      if (!check.ok) {
        throw new WalletSigningError('altered', check.reason);
      }
      setPhase('submitting');
      const result = await submit.mutateAsync({
        transactionIndex: prepared.transactionIndex,
        signedTransaction: signed.signedTransaction,
      });
      if (signingToken.current !== token) {
        return;
      }
      setPhase('idle');
      setAnnouncement(`${stateLabel(result.state)}. ${describeState(result)}`);
      onSubmitted?.(result);
    } catch (error) {
      if (signingToken.current !== token) {
        return;
      }
      setPhase('idle');
      setFailure(describeExecutionFailure(error, 'submit'));
      if (error instanceof WebApiError && error.code === 'NETWORK') {
        // The bytes may have reached the node: reconcile the existing attempt, never re-sign.
        setLostAnswer(true);
        reconcile.mutate();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function stopWaiting() {
    signingToken.current += 1;
    setPhase('idle');
    setWaitingLong(false);
    setFailure(
      'Stopped waiting for the wallet. A signature it produces later is discarded; nothing is sent without a fresh signing request from you.',
    );
  }

  if (statusQuery.isPending && status === null) {
    return (
      <section
        aria-labelledby="execution-heading"
        className="space-y-3"
        data-testid="execution-panel"
      >
        <h2 id="execution-heading" className="text-heading-sm font-semibold">
          Execution
        </h2>
        <SkeletonText lines={3} />
      </section>
    );
  }
  if (status === null) {
    return (
      <section
        aria-labelledby="execution-heading"
        className="space-y-3"
        data-testid="execution-panel"
      >
        <h2 id="execution-heading" className="text-heading-sm font-semibold">
          Execution
        </h2>
        <Notice tone="error" title="The execution status could not be read" live="polite">
          {statusQuery.error?.message ?? 'Markov could not be reached.'} Nothing is assumed;{' '}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void statusQuery.refetch()}
          >
            Try again
          </Button>
        </Notice>
      </section>
    );
  }

  const stateTone = STATE_TONES[status.state] ?? 'info';
  const busy = phase !== 'idle' || build.isPending || reconcile.isPending;
  // The review's approval panel shows its own cancel control while the intent is open there.
  const cancelOwnedByReview = variant === 'review' && status.state === 'AWAITING_APPROVAL';
  const primaryReason = action?.kind === 'sign' ? issues[0]?.message : undefined;

  return (
    <section
      aria-labelledby="execution-heading"
      className="space-y-4 rounded-panel border border-border/60 bg-surface p-4"
      data-testid="execution-panel"
      data-state={status.state}
    >
      <p aria-live="polite" className="sr-only" data-testid="execution-announcement">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="execution-heading" className="text-heading-sm font-semibold">
          Execution
        </h2>
        <StatusBadge tone={stateTone} data-testid="execution-state">
          {stateLabel(status.state)}
        </StatusBadge>
      </div>
      <p className="text-supporting text-text-muted" data-testid="execution-summary">
        {describeState(status)}
      </p>

      {statusQuery.isError && status ? (
        <Notice
          tone="attention"
          title="Connection lost"
          live="polite"
          data-testid="execution-stale"
        >
          Showing the last state read
          {status.reconciliation.lastCheckedAt
            ? ` (checked ${formatInstant(status.reconciliation.lastCheckedAt)} UTC)`
            : ''}
          . Reads retry on their own; nothing here is assumed to have settled.
        </Notice>
      ) : null}

      {status.reconciliation.frozen ? (
        <Notice tone="attention" title="Frozen for review" data-testid="execution-frozen">
          A fill missed its approved bounds or the result is unknown. The intent stays frozen until
          a person reviews it; nothing is retried on its own.
        </Notice>
      ) : null}

      {lostAnswer ? (
        <Notice
          tone="attention"
          title="Result unknown, being checked"
          live="polite"
          data-testid="lost-answer"
        >
          The signed transaction left the browser but the answer was lost. The existing attempt is
          checked against the chain; no second transaction is sent.
        </Notice>
      ) : null}

      {/* ------------------------------------------------ the next step */}
      {action ? (
        <div className="space-y-3" data-testid="next-step" data-kind={action.kind}>
          <p className="text-supporting">{action.detail}</p>
          {action.kind === 'sign' && transaction ? (
            <TransactionPreview transaction={transaction} plan={plan} />
          ) : null}
          {waitingLong ? (
            <Notice
              tone="attention"
              title="Still waiting for the wallet"
              live="polite"
              data-testid="wallet-waiting"
            >
              The wallet has not answered. Check its window; nothing is sent until it does.{' '}
              <Button type="button" variant="secondary" size="sm" onClick={stopWaiting}>
                Stop waiting
              </Button>
            </Notice>
          ) : null}
          {failure ? (
            <Notice
              tone="error"
              title="This step did not complete"
              live="assertive"
              data-testid="execution-failure"
            >
              {failure}
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {action.kind === 'build' ? (
              <Button
                type="button"
                onClick={() => {
                  setFailure(null);
                  build.mutate(undefined, {
                    onError: (error) => setFailure(describeExecutionFailure(error, 'build')),
                  });
                }}
                loading={build.isPending}
                data-testid="build-cta"
              >
                {action.label}
              </Button>
            ) : null}
            {action.kind === 'sign' ? (
              <Button
                type="button"
                onClick={() => {
                  if (transaction) {
                    void sign(transaction);
                  }
                }}
                loading={phase !== 'idle'}
                {...(primaryReason ? { disabledReason: primaryReason } : {})}
                data-testid="sign-cta"
              >
                {phase === 'submitting' ? 'Submitting…' : action.label}
              </Button>
            ) : null}
            {action.kind === 'wait' || action.kind === 'reconcile' ? (
              <Button
                type="button"
                variant={action.kind === 'reconcile' ? 'primary' : 'secondary'}
                onClick={() => {
                  setFailure(null);
                  reconcile.mutate(undefined, {
                    onError: (error) => setFailure(describeExecutionFailure(error, 'reconcile')),
                  });
                }}
                loading={reconcile.isPending}
                data-testid="reconcile-cta"
              >
                {action.kind === 'reconcile' ? action.label : 'Check now'}
              </Button>
            ) : null}
            {action.kind === 'review' && plan ? (
              <Button asChild data-testid="review-continuation">
                <Link href={continuationHref(intent, plan, status)}>{action.label}</Link>
              </Button>
            ) : null}
            {action.kind === 'receipt' ? (
              <Button
                type="button"
                onClick={() => {
                  setFailure(null);
                  issue.mutate(
                    { kind: 'execution' },
                    {
                      onError: (error) => setFailure(describeExecutionFailure(error, 'receipt')),
                    },
                  );
                }}
                loading={issue.isPending}
                data-testid="issue-receipt"
              >
                {action.label}
              </Button>
            ) : null}
            {rule.allowed && !cancelOwnedByReview ? (
              confirmCancel ? (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() =>
                      cancel.mutate(undefined, {
                        onSuccess: () => {
                          setConfirmCancel(false);
                          invalidateAll();
                        },
                        onError: (error) => setFailure(describeExecutionFailure(error, 'cancel')),
                      })
                    }
                    loading={cancel.isPending}
                    data-testid="confirm-cancel"
                  >
                    Confirm: {rule.label.toLowerCase()}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                    Keep going
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmCancel(true)}
                  {...(busy ? { disabledReason: 'Wait for the current step to finish.' } : {})}
                  data-testid="cancel-cta"
                >
                  {rule.label}
                </Button>
              )
            ) : null}
          </div>
          {confirmCancel ? (
            <p className="text-supporting text-text-muted" data-testid="cancel-consequence">
              {rule.consequence}
            </p>
          ) : null}
          {action.kind === 'sign' && issues.length > 1 ? (
            <ul
              className="list-disc space-y-1 pl-5 text-supporting text-text-muted"
              data-testid="signing-issues"
            >
              {issues.slice(1).map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
          {variant === 'review' ? (
            <p className="text-caption text-text-muted">
              The timeline lives at{' '}
              <Link href={`/activity/${intentId}`} className="underline underline-offset-2">
                Activity
              </Link>{' '}
              and survives reloads and wallet popups.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------ receipts */}
      {receipts.data && receipts.data.receipts.length > 0 ? (
        <ul className="space-y-1 text-supporting" aria-label="Receipts" data-testid="receipt-list">
          {receipts.data.receipts.map((receipt) => (
            <li key={receipt.body.receiptId}>
              <Link
                href={`/receipts/${receipt.body.receiptId}`}
                className="underline underline-offset-2"
              >
                {receipt.body.kind === 'execution' ? 'Execution receipt' : 'Decision receipt'} ·{' '}
                {stateLabel(receipt.body.status.intentState)} · issued{' '}
                {formatInstant(receipt.body.issuedAt)} UTC
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {issue.data ? (
        <Notice tone="success" title="Receipt issued" live="polite" data-testid="receipt-issued">
          Signed by key <code className="font-mono">{issue.data.signer.keyId}</code>.{' '}
          <Link
            href={`/receipts/${issue.data.body.receiptId}`}
            className="underline underline-offset-2"
            data-testid="open-receipt"
          >
            Open the receipt
          </Link>
          . A receipt records what was requested, approved, submitted and filled; settlement is the
          chain evidence it references.
        </Notice>
      ) : null}

      {/* ------------------------------------------------ timeline */}
      <div className="space-y-3" data-testid="timeline">
        <h3 className="text-supporting font-semibold uppercase tracking-wide text-text-muted">
          Timeline
        </h3>
        {timeline.map((row) => (
          <TimelineBatchView key={row.batch} row={row} cluster={cluster} />
        ))}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-caption text-text-muted sm:grid-cols-2">
          <div>
            <dt className="inline">Last checked: </dt>
            <dd className="inline" data-testid="last-checked">
              {status.reconciliation.lastCheckedAt
                ? `${formatInstant(status.reconciliation.lastCheckedAt)} UTC`
                : 'not yet'}
              {status.reconciliation.blockHeight !== null
                ? ` · finalized block height ${status.reconciliation.blockHeight}`
                : ''}
            </dd>
          </div>
          <div>
            <dt className="inline">Plan: </dt>
            <dd className="inline">
              {status.planHash ? (
                <code className="font-mono">
                  {shortenAddress(status.planHash, { head: 10, tail: 6 })}
                </code>
              ) : (
                'none'
              )}
              {' · '}
              <Link href={`/review/${intentId}`} className="underline underline-offset-2">
                Review
              </Link>
            </dd>
          </div>
        </dl>
        {status.reconciliation.evidence.length > 0 ? (
          <details className="text-caption text-text-muted">
            <summary className="cursor-pointer">Evidence the state rests on</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5" data-testid="evidence">
              {status.reconciliation.evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

/** The exact transaction the wallet will show: what it may spend, what it must receive, what it costs. */
function TransactionPreview({
  transaction,
  plan,
}: {
  readonly transaction: PreparedTransaction;
  readonly plan: ExecutionPlan | null;
}) {
  const input = plan?.legs[0] ?? null;
  return (
    <div
      className="space-y-2 rounded-panel border border-border/40 p-3 text-supporting"
      data-testid="transaction-preview"
    >
      <p className="font-medium">
        Transaction {transaction.transactionIndex + 1}: {transaction.legIndexes.length} leg
        {transaction.legIndexes.length === 1 ? '' : 's'}, {transaction.instructions.length}{' '}
        instructions, {transaction.version} format
      </p>
      <ul className="space-y-1">
        {transaction.effects.legs.map((leg) => {
          const planLeg = plan?.legs.find((entry) => entry.legIndex === leg.legIndex) ?? null;
          return (
            <li key={leg.legIndex}>
              {leg.side === 'sell' ? 'Sell' : 'Buy'}{' '}
              {planLeg?.symbol ?? shortenAddress(leg.outputMint)}: at most{' '}
              {planLeg
                ? formatUnits(leg.maxInputRaw, planLeg.inputDecimals, planLeg.inputSymbol)
                : leg.maxInputRaw}{' '}
              in, at least{' '}
              {planLeg
                ? formatUnits(leg.minimumOutputRaw, planLeg.outputDecimals, planLeg.outputSymbol)
                : leg.minimumOutputRaw}{' '}
              out
            </li>
          );
        })}
        <li>
          Network cost at most {formatSol(transaction.effects.totalLamportsMax)} (fee{' '}
          {formatSol(transaction.effects.baseFeeLamports)}, priority up to{' '}
          {formatSol(transaction.effects.priorityFeeMaxLamports)}, rent{' '}
          {formatSol(transaction.effects.rentLamports)} for{' '}
          {transaction.effects.accountsCreated.length} account
          {transaction.effects.accountsCreated.length === 1 ? '' : 's'}), paid by{' '}
          {shortenAddress(transaction.feePayer)}
        </li>
        <li>
          Signer {shortenAddress(transaction.expectedSigner)} · blockhash{' '}
          <code className="font-mono">{shortenAddress(transaction.recentBlockhash)}</code> valid to
          block {transaction.lastValidBlockHeight} · simulation {transaction.simulation.status}
          {transaction.simulation.unitsConsumed !== null
            ? ` (${transaction.simulation.unitsConsumed} units)`
            : ''}
        </li>
        <li>
          Message hash{' '}
          <code className="font-mono">
            {shortenAddress(transaction.messageHash, { head: 10, tail: 6 })}
          </code>
          {input ? '' : ''}
        </li>
      </ul>
      <details className="text-caption text-text-muted">
        <summary className="cursor-pointer">Decoded instructions</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          {transaction.instructions.map((instruction) => (
            <li key={instruction.index}>
              {instruction.program} · {instruction.kind}: {instruction.summary}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function TimelineBatchView({
  row,
  cluster,
}: {
  readonly row: TimelineBatch;
  readonly cluster: string | null;
}) {
  const explorer = row.signature ? explorerTransactionUrl(row.signature, cluster) : null;
  return (
    <article
      className="space-y-2 rounded-panel border border-border/40 p-3"
      data-testid="timeline-batch"
      data-batch-state={row.state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {row.title}: {row.legs.map((leg) => leg.label).join(', ')}
        </p>
        <StatusBadge tone={STAGE_TONES[batchTone(row.state)]}>{row.state}</StatusBadge>
      </div>
      <ol className="space-y-1 text-supporting" aria-label={`${row.title} stages`}>
        {row.stages.map((stage) => (
          <li key={stage.key} className="flex flex-wrap items-start gap-2" data-stage={stage.state}>
            <StatusBadge tone={STAGE_TONES[stage.state]} className="shrink-0">
              {stage.state === 'done'
                ? 'done'
                : stage.state === 'active'
                  ? 'now'
                  : stage.state === 'skipped'
                    ? 'skipped'
                    : stage.state}
            </StatusBadge>
            <span className={stage.state === 'skipped' ? 'text-text-muted' : ''}>
              {stage.label}
              {stage.detail ? (
                <span className="block text-caption text-text-muted">{stage.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {row.signature ? (
        <p className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
          Signature{' '}
          <code className="font-mono" data-testid="batch-signature">
            {shortenAddress(row.signature, { head: 8, tail: 8 })}
          </code>
          <CopyButton value={row.signature} label="Copy signature" />
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Explorer
            </a>
          ) : null}
        </p>
      ) : null}
      {row.reason && row.state !== 'stale' ? (
        <p className="text-caption text-text-muted">Reason: {row.reason}</p>
      ) : null}
      {row.fills.length > 0 ? (
        <Table regionLabel={`${row.title} fills`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Leg</TableHeaderCell>
              <TableHeaderCell>Spent</TableHeaderCell>
              <TableHeaderCell>Received</TableHeaderCell>
              <TableHeaderCell>Network fee</TableHeaderCell>
              <TableHeaderCell>Bounds</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {row.fills.map((fill) => (
              <TableRow key={fill.fillId} data-testid="fill-row">
                <TableCell>
                  {row.legs.find((leg) => leg.legIndex === fill.legIndex)?.label ?? fill.legIndex}
                </TableCell>
                <TableCell className="font-mono">{fill.inputSpentRaw} raw</TableCell>
                <TableCell className="font-mono">{fill.outputReceivedRaw} raw</TableCell>
                <TableCell className="font-mono">
                  {formatRawAmount(fill.lamportsSpent, 9)} SOL
                </TableCell>
                <TableCell>
                  {fill.withinBounds ? (
                    <StatusBadge tone="success">within bounds</StatusBadge>
                  ) : (
                    <StatusBadge tone="error">outside bounds</StatusBadge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {row.feeLamports !== null ? (
        <p className="text-caption text-text-muted" data-testid="batch-fee">
          Network fee charged: {formatSol(row.feeLamports)}
        </p>
      ) : null}
    </article>
  );
}

function batchTone(state: TimelineBatch['state']): StageState {
  switch (state) {
    case 'finalized':
      return 'done';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'unknown':
      return 'unknown';
    case 'cancelled':
    case 'stale':
      return 'skipped';
    case 'pending':
      return 'pending';
    default:
      return 'active';
  }
}

/** A reviewed completion: the unfilled legs at their original targets, budget equal to their sum. */
export function continuationHref(
  intent: Intent,
  plan: ExecutionPlan,
  status: ExecutionStatus,
): string {
  const filled = new Set(status.fills.map((fill) => fill.legIndex));
  const budget = plan.legs
    .filter((leg) => !filled.has(leg.legIndex))
    .reduce((sum, leg) => sum + BigInt(leg.targetInputRaw), 0n)
    .toString();
  const params = new URLSearchParams({
    walletId: intent.wallet.walletId,
    budget,
    continueIntentId: intent.intentId,
  });
  if (intent.strategy) {
    params.set('strategyId', intent.strategy.strategyId);
    params.set('versionId', intent.strategy.versionId);
  }
  return `/review/new?${params.toString()}`;
}
