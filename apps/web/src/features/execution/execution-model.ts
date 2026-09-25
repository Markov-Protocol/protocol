import type {
  ExecutionBatch,
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  IntentState,
  PreparedTransaction,
} from '@markov/contracts';

/**
 * Pure rules for the execution screen (F10): what the person may do next,
 * what must be true before the wallet is asked to sign, how a status turns
 * into a per-transaction timeline, and how a state is announced. Nothing
 * here talks to the wallet, the API or the clock; the view supplies them.
 */

/* ------------------------------------------------------------ states */

const LIVE_STATES: readonly IntentState[] = [
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMED',
  'CANCEL_REQUESTED',
  'UNKNOWN_REQUIRES_RECONCILIATION',
];
const TERMINAL_STATES: readonly IntentState[] = [
  'FINALIZED',
  'PARTIALLY_COMPLETED',
  'EXPIRED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
];
/** States in which a cancel is a plain refusal to continue: nothing was signed for the current batch. */
const CANCELLABLE_STATES: readonly IntentState[] = [
  'DRAFT',
  'QUOTED',
  'AWAITING_APPROVAL',
  'AUTHORIZED',
];

export const isLiveState = (state: IntentState): boolean => LIVE_STATES.includes(state);
export const isTerminalState = (state: IntentState): boolean => TERMINAL_STATES.includes(state);

/* ------------------------------------------------------------ polling */

export interface PollingPlan {
  /** Milliseconds between status reads; null when nothing is expected to change. */
  readonly intervalMs: number | null;
  readonly reason: string;
}

/**
 * Bounded polling in place of a stream (the API has no event stream; it
 * reconciles a live attempt on every read, throttled to 2 s): fast while
 * the network is being watched, slower after a while, slower still in a
 * hidden tab, and off once the intent is terminal or waits for the person.
 */
export function pollingPlan(input: {
  readonly status: ExecutionStatus | null;
  readonly hidden: boolean;
  readonly watchedForMs: number;
}): PollingPlan {
  const status = input.status;
  if (status === null) {
    return { intervalMs: null, reason: 'no status yet' };
  }
  if (isTerminalState(status.state)) {
    return { intervalMs: null, reason: 'the intent is settled' };
  }
  const watching = isLiveState(status.state) || status.nextAction === 'wait';
  if (!watching) {
    return { intervalMs: null, reason: 'waiting for the person' };
  }
  if (input.hidden) {
    return { intervalMs: 15_000, reason: 'hidden tab' };
  }
  return input.watchedForMs >= 30_000
    ? { intervalMs: 5_000, reason: 'watching (slow)' }
    : { intervalMs: 2_000, reason: 'watching' };
}

/* ------------------------------------------------------------ actions */

export type ExecutionActionKind =
  | 'build'
  | 'sign'
  | 'wait'
  | 'reconcile'
  | 'review'
  | 'receipt'
  | 'none';

export interface ExecutionAction {
  readonly kind: ExecutionActionKind;
  /** The one primary control's label; names the next thing that happens. */
  readonly label: string;
  /** One sentence the person reads under the control. */
  readonly detail: string;
  /** Which batch (transaction) the action concerns; null when none. */
  readonly batch: number | null;
}

export interface CancelRule {
  readonly allowed: boolean;
  readonly label: string;
  /** What cancelling does (or why it is not offered). */
  readonly consequence: string;
}

const ordinal = (batch: number, total: number): string => `transaction ${batch + 1} of ${total}`;

/** The primary action after the plan was approved, from the API's next action and the state. */
export function nextExecutionAction(status: ExecutionStatus): ExecutionAction {
  const total = Math.max(status.batches.length, 1);
  const current =
    status.batches.find((batch) =>
      ['pending', 'prepared', 'submitting', 'submitted', 'confirmed', 'unknown'].includes(
        batch.state,
      ),
    ) ?? null;
  const batchIndex = current?.batch ?? null;
  switch (status.nextAction) {
    case 'build':
      return {
        kind: 'build',
        batch: batchIndex,
        label: `Build ${ordinal(batchIndex ?? 0, total)}`,
        detail:
          'The API builds the transaction from the approved plan, decodes it, checks it against the plan and simulates it before you see it. Nothing is signed yet.',
      };
    case 'sign':
      return {
        kind: 'sign',
        batch: batchIndex,
        label: `Sign ${ordinal(batchIndex ?? 0, total)}`,
        detail:
          'Your wallet shows the exact transaction. Signing sends it once; the same bytes are never sent as a second purchase.',
      };
    case 'wait':
      return {
        kind: 'wait',
        batch: batchIndex,
        label: 'Waiting for the network',
        detail:
          'The transaction was broadcast. Its result is read from the chain; a signature is not a result.',
      };
    case 'reconcile':
      return {
        kind: 'reconcile',
        batch: batchIndex,
        label: 'Check with the network',
        detail:
          'The node has not given a clear answer for the existing attempt. Checking reads chain evidence; it never signs or sends a new transaction.',
      };
    case 'review':
      return {
        kind: 'review',
        batch: null,
        label: 'Review the unfilled legs',
        detail:
          'Some legs filled and the rest did not. A reviewed completion buys exactly the unfilled legs at their original targets, or you can leave it here.',
      };
    default:
      return status.state === 'FINALIZED'
        ? {
            kind: 'receipt',
            batch: null,
            label: 'Issue a receipt',
            detail:
              'Every transaction is finalized and its fills are recorded. A receipt is a signed record of what was requested, approved, submitted and filled.',
          }
        : {
            kind: 'none',
            batch: null,
            label: 'Nothing to do',
            detail: describeState(status),
          };
  }
}

export function cancelRule(
  intent: Pick<Intent, 'state'>,
  status: ExecutionStatus | null,
): CancelRule {
  const state = intent.state;
  if (state === 'CANCELLED') {
    return { allowed: false, label: 'Cancelled', consequence: 'This intent was cancelled.' };
  }
  if (state === 'CANCEL_REQUESTED') {
    return {
      allowed: false,
      label: 'Cancellation requested',
      consequence:
        'A transaction was already broadcast. It settles or expires on the chain; nothing here can recall it.',
    };
  }
  if (isTerminalState(state)) {
    return { allowed: false, label: 'Cancel', consequence: 'The intent is settled.' };
  }
  if (CANCELLABLE_STATES.includes(state)) {
    const filled = status?.fills.length ?? 0;
    return {
      allowed: true,
      label: filled > 0 ? 'Stop here' : 'Cancel',
      consequence:
        filled > 0
          ? `${filled} leg${filled === 1 ? '' : 's'} already filled and stay in your wallet. Stopping records the intent as partially completed; nothing is sold back.`
          : 'Nothing was signed. Cancelling records the intent as cancelled; no transaction is sent.',
    };
  }
  if (
    state === 'SUBMITTING' ||
    state === 'SUBMITTED' ||
    state === 'UNKNOWN_REQUIRES_RECONCILIATION'
  ) {
    return {
      allowed: true,
      label: 'Request cancellation',
      consequence:
        'The signed transaction was broadcast and can still land. The request is recorded; the intent is cancelled only if the blockhash expires unseen, and a landed transaction is honoured as it settled.',
    };
  }
  return {
    allowed: false,
    label: 'Cancel',
    consequence:
      'The transaction landed on the chain and waits for finality; nothing here can undo it.',
  };
}

/* ------------------------------------------------------------ signing */

export type SigningIssueCode =
  | 'NO_TRANSACTION'
  | 'ALREADY_SUBMITTED'
  | 'INTENT_MISMATCH'
  | 'PLAN_MISMATCH'
  | 'NO_WALLET'
  | 'SIGNER_MISMATCH'
  | 'FEE_PAYER_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'WALLET_CHAIN_MISMATCH'
  | 'PLAN_EXPIRED'
  | 'MESSAGE_HASH_MISMATCH'
  | 'SIMULATION_NOT_OK'
  | 'WALLET_CANNOT_SIGN';

export interface SigningIssue {
  readonly code: SigningIssueCode;
  readonly message: string;
}

export interface SigningContext {
  readonly intent: Pick<Intent, 'intentId' | 'latestPlanId' | 'latestPlanHash'>;
  /** The hash the person approved on the review; the transaction must be built from that plan. */
  readonly approvedPlanHash: string | null;
  readonly transaction: PreparedTransaction | null;
  /** The connected wallet account's address, or null when none is connected. */
  readonly connectedAddress: string | null;
  /** The connected wallet's chain identifier (`solana:devnet`), or null when unknown. */
  readonly connectedChain: string | null;
  /** Whether the connected wallet offers `solana:signTransaction`; null when none is connected. */
  readonly walletCanSign: boolean | null;
  /** The network the app runs against (the platform snapshot); the genesis hash when the app knows it. */
  readonly network: { readonly cluster: string; readonly genesisHash: string | null };
  /** SHA-256 of the message bytes decoded from the unsigned transaction, computed by the caller; null when it could not be computed. */
  readonly messageHashOfBytes: string | null;
  readonly planExpiresAt: string | null;
  readonly now: Date;
}

/** The chain identifier a Wallet Standard account carries for a cluster. */
export function walletChainFor(cluster: string): string {
  return `solana:${cluster === 'mainnet-beta' ? 'mainnet' : cluster}`;
}

/**
 * Every check that must pass before the wallet is opened. The API checks
 * the same things again at submission; these keep the wallet popup from
 * ever showing a transaction the review did not approve.
 */
export function signingIssues(context: SigningContext): SigningIssue[] {
  const issues: SigningIssue[] = [];
  const tx = context.transaction;
  if (tx === null) {
    return [{ code: 'NO_TRANSACTION', message: 'No transaction is built for this step yet.' }];
  }
  if (tx.state !== 'prepared' || tx.attempt !== null) {
    issues.push({
      code: 'ALREADY_SUBMITTED',
      message: `This transaction is ${tx.state}; it is not waiting for a signature.`,
    });
  }
  if (tx.intentId !== context.intent.intentId) {
    issues.push({ code: 'INTENT_MISMATCH', message: 'The transaction belongs to another intent.' });
  }
  if (
    tx.planId !== context.intent.latestPlanId ||
    tx.planHash !== context.intent.latestPlanHash ||
    (context.approvedPlanHash !== null && tx.planHash !== context.approvedPlanHash)
  ) {
    issues.push({
      code: 'PLAN_MISMATCH',
      message: 'The transaction was not built from the plan you approved. Review the plan again.',
    });
  }
  if (context.connectedAddress === null) {
    issues.push({
      code: 'NO_WALLET',
      message: `Connect the wallet ${shorten(tx.expectedSigner)} to sign.`,
    });
  } else if (context.connectedAddress !== tx.expectedSigner) {
    issues.push({
      code: 'SIGNER_MISMATCH',
      message: `The connected wallet ${shorten(context.connectedAddress)} is not the wallet this plan was reviewed for (${shorten(tx.expectedSigner)}). Switch accounts in the wallet; nothing is signed with another account.`,
    });
  }
  if (context.walletCanSign === false) {
    issues.push({
      code: 'WALLET_CANNOT_SIGN',
      message:
        'The connected wallet cannot sign transactions. Connect one that offers transaction signing.',
    });
  }
  if (tx.feePayer !== tx.expectedSigner) {
    issues.push({
      code: 'FEE_PAYER_MISMATCH',
      message: 'The fee payer is not your wallet; the plan said you pay the network fee.',
    });
  }
  if (
    tx.network.cluster !== context.network.cluster ||
    (context.network.genesisHash !== null && tx.network.genesisHash !== context.network.genesisHash)
  ) {
    issues.push({
      code: 'NETWORK_MISMATCH',
      message: `The transaction targets ${tx.network.cluster}; this app runs against ${context.network.cluster}.`,
    });
  }
  if (
    context.connectedChain !== null &&
    context.connectedChain !== walletChainFor(tx.network.cluster)
  ) {
    issues.push({
      code: 'WALLET_CHAIN_MISMATCH',
      message: `The wallet account is on ${context.connectedChain}; the transaction is for ${walletChainFor(tx.network.cluster)}.`,
    });
  }
  if (
    context.planExpiresAt !== null &&
    context.now.getTime() >= Date.parse(context.planExpiresAt)
  ) {
    issues.push({
      code: 'PLAN_EXPIRED',
      message:
        'The plan expired. Refresh the terms on the review; nothing is signed against expired terms.',
    });
  }
  if (context.messageHashOfBytes === null || context.messageHashOfBytes !== tx.messageHash) {
    issues.push({
      code: 'MESSAGE_HASH_MISMATCH',
      message:
        'The transaction bytes do not hash to the message the API validated. Nothing is signed; build the transaction again.',
    });
  }
  if (tx.simulation.status !== 'ok') {
    issues.push({
      code: 'SIMULATION_NOT_OK',
      message: `The simulation did not pass (${tx.simulation.status}); the API would refuse it and so does this screen.`,
    });
  }
  return issues;
}

/* ---------------------------------------------------------- timeline */

export type StageState = 'done' | 'active' | 'pending' | 'failed' | 'unknown' | 'skipped';

export interface TimelineStage {
  readonly key: 'built' | 'signed' | 'broadcast' | 'confirmed' | 'finalized' | 'recorded';
  readonly label: string;
  readonly state: StageState;
  readonly detail: string | null;
}

export interface TimelineBatch {
  readonly batch: number;
  readonly title: string;
  /** Leg labels (symbols) in leg order. */
  readonly legs: readonly { readonly legIndex: number; readonly label: string }[];
  readonly state: ExecutionBatch['state'];
  readonly signature: string | null;
  readonly reason: string | null;
  readonly stages: readonly TimelineStage[];
  /** Fills recorded for this batch's legs. */
  readonly fills: ExecutionStatus['fills'];
  /** Actual lamports paid by this batch's landed transaction (from its fills), null when none landed. */
  readonly feeLamports: string | null;
}

function legLabel(plan: ExecutionPlan | null, legIndex: number): string {
  const leg = plan?.legs.find((entry) => entry.legIndex === legIndex);
  if (!leg) {
    return `Leg ${legIndex + 1}`;
  }
  return `${leg.side === 'sell' ? 'Sell' : 'Buy'} ${leg.symbol}`;
}

const stage = (
  key: TimelineStage['key'],
  label: string,
  state: StageState,
  detail: string | null = null,
): TimelineStage => ({ key, label, state, detail });

/** One transaction's six stages from its batch state, its attempt and its fills. */
export function stagesOf(
  batch: ExecutionBatch,
  attempt: ExecutionStatus['attempts'][number] | null,
  fills: ExecutionStatus['fills'],
): TimelineStage[] {
  const finalityDetail = attempt?.confirmationStatus
    ? `Node reports ${attempt.confirmationStatus}${attempt.slot !== null ? ` at slot ${attempt.slot}` : ''}.`
    : null;
  const submittedDetail = attempt?.submittedAt
    ? `Broadcast ${attempt.resendCount > 0 ? `and resent ${attempt.resendCount}× with the same bytes ` : ''}at ${attempt.submittedAt}.`
    : null;
  const recordedDetail =
    fills.length > 0
      ? `${fills.length} fill${fills.length === 1 ? '' : 's'} recorded from the landed transaction's balance changes.`
      : null;
  switch (batch.state) {
    case 'pending':
      return [
        stage('built', 'Built and checked', 'active'),
        stage('signed', 'Signed by you', 'pending'),
        stage('broadcast', 'Broadcast', 'pending'),
        stage('confirmed', 'Confirmed by the network', 'pending'),
        stage('finalized', 'Finalized', 'pending'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'prepared':
      return [
        stage(
          'built',
          'Built and checked',
          'done',
          'Decoded, validated against the plan and simulated.',
        ),
        stage('signed', 'Signed by you', 'active'),
        stage('broadcast', 'Broadcast', 'pending'),
        stage('confirmed', 'Confirmed by the network', 'pending'),
        stage('finalized', 'Finalized', 'pending'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'submitting':
      return [
        stage('built', 'Built and checked', 'done'),
        stage(
          'signed',
          'Signed by you',
          'done',
          'Signature verified by the API and the attempt persisted.',
        ),
        stage('broadcast', 'Broadcast', 'active', 'Sending to the node.'),
        stage('confirmed', 'Confirmed by the network', 'pending'),
        stage('finalized', 'Finalized', 'pending'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'submitted':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', 'done'),
        stage('broadcast', 'Broadcast', 'done', submittedDetail),
        stage('confirmed', 'Confirmed by the network', 'active', finalityDetail),
        stage('finalized', 'Finalized', 'pending'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'confirmed':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', 'done'),
        stage('broadcast', 'Broadcast', 'done', submittedDetail),
        stage('confirmed', 'Confirmed by the network', 'done', finalityDetail),
        stage('finalized', 'Finalized', 'active', 'Waiting for the finality the policy requires.'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'finalized':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', 'done'),
        stage('broadcast', 'Broadcast', 'done', submittedDetail),
        stage('confirmed', 'Confirmed by the network', 'done'),
        stage('finalized', 'Finalized', 'done', finalityDetail),
        stage(
          'recorded',
          'Fills recorded',
          fills.length > 0 ? 'done' : 'unknown',
          recordedDetail ?? 'Finalized, but no fill was read from the transaction; reconcile.',
        ),
      ];
    case 'failed':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', attempt ? 'done' : 'skipped'),
        stage('broadcast', 'Broadcast', attempt?.submittedAt ? 'done' : 'skipped', submittedDetail),
        stage(
          'confirmed',
          'Landed with an error',
          'failed',
          attempt?.chainError ?? batch.reason ?? 'The transaction failed.',
        ),
        stage('finalized', 'Finalized', 'skipped'),
        stage(
          'recorded',
          'Fills recorded',
          'skipped',
          'Nothing filled. Any network fee charged is shown above.',
        ),
      ];
    case 'expired':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', attempt ? 'done' : 'skipped'),
        stage(
          'broadcast',
          'Broadcast',
          attempt?.submittedAt ? 'done' : 'skipped',
          submittedDetail ?? batch.reason,
        ),
        stage(
          'confirmed',
          'Expired unseen',
          'failed',
          attempt
            ? 'The blockhash passed its last valid block without the transaction landing. Nothing was spent.'
            : (batch.reason ?? 'The prepared transaction expired before it was signed.'),
        ),
        stage('finalized', 'Finalized', 'skipped'),
        stage('recorded', 'Fills recorded', 'skipped'),
      ];
    case 'cancelled':
      return [
        stage('built', 'Built and checked', attempt ? 'done' : 'skipped'),
        stage('signed', 'Signed by you', 'skipped', 'Cancelled before a signature.'),
        stage('broadcast', 'Broadcast', 'skipped'),
        stage('confirmed', 'Confirmed by the network', 'skipped'),
        stage('finalized', 'Finalized', 'skipped'),
        stage('recorded', 'Fills recorded', 'skipped'),
      ];
    case 'unknown':
      return [
        stage('built', 'Built and checked', 'done'),
        stage('signed', 'Signed by you', 'done'),
        stage(
          'broadcast',
          'Broadcast',
          'unknown',
          'The node did not answer the broadcast. The attempt keeps its signed bytes; the result is decided from chain evidence, never by sending a new transaction.',
        ),
        stage('confirmed', 'Confirmed by the network', 'unknown'),
        stage('finalized', 'Finalized', 'pending'),
        stage('recorded', 'Fills recorded', 'pending'),
      ];
    case 'stale':
      return [
        stage(
          'built',
          'Not built',
          'skipped',
          batch.reason ?? 'The run stopped before this transaction.',
        ),
        stage('signed', 'Signed by you', 'skipped'),
        stage('broadcast', 'Broadcast', 'skipped'),
        stage('confirmed', 'Confirmed by the network', 'skipped'),
        stage('finalized', 'Finalized', 'skipped'),
        stage('recorded', 'Fills recorded', 'skipped'),
      ];
  }
}

/** The per-transaction timeline the execution screen renders, in batch order. */
export function timelineOf(status: ExecutionStatus, plan: ExecutionPlan | null): TimelineBatch[] {
  const total = status.batches.length;
  return status.batches.map((batch) => {
    const attempt = status.attempts.find((entry) => entry.attemptId === batch.attemptId) ?? null;
    const fills = status.fills.filter((fill) => batch.legIndexes.includes(fill.legIndex));
    const feeLamports =
      fills.length > 0
        ? fills.reduce((sum, fill) => sum + BigInt(fill.feeLamports), 0n).toString()
        : null;
    return {
      batch: batch.batch,
      title: total === 1 ? 'Transaction' : `Transaction ${batch.batch + 1} of ${total}`,
      legs: batch.legIndexes.map((legIndex) => ({ legIndex, label: legLabel(plan, legIndex) })),
      state: batch.state,
      signature: batch.signature,
      reason: batch.reason,
      stages: stagesOf(batch, attempt, fills),
      fills,
      feeLamports,
    };
  });
}

/* --------------------------------------------------------- narration */

const STATE_LABELS: Record<IntentState, string> = {
  DRAFT: 'Draft',
  QUOTED: 'Quoted',
  AWAITING_APPROVAL: 'Approved; nothing built yet',
  AUTHORIZED: 'Approved; waiting for a signature',
  SUBMITTING: 'Sending',
  SUBMITTED: 'Broadcast; waiting for the network',
  CONFIRMED: 'Confirmed; waiting for finality',
  FINALIZED: 'Finalized',
  PARTIALLY_COMPLETED: 'Partially completed',
  EXPIRED: 'Expired',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  CANCEL_REQUESTED: 'Cancellation requested',
  CANCELLED: 'Cancelled',
  UNKNOWN_REQUIRES_RECONCILIATION: 'Result unknown; reconciling',
};

export function stateLabel(state: IntentState): string {
  return STATE_LABELS[state];
}

/** One sentence for the state, with the recorded reason when there is one. */
export function describeState(
  status: Pick<ExecutionStatus, 'state' | 'stateReason' | 'fills' | 'batches' | 'reconciliation'>,
): string {
  const filled = status.fills.length;
  switch (status.state) {
    case 'FINALIZED':
      return `Every transaction is finalized on the chain and ${filled} fill${filled === 1 ? ' is' : 's are'} recorded.`;
    case 'PARTIALLY_COMPLETED':
      return `${filled} leg${filled === 1 ? '' : 's'} filled; the rest did not run (${status.stateReason ?? 'stopped'}). What filled stays in your wallet.`;
    case 'UNKNOWN_REQUIRES_RECONCILIATION':
      return status.reconciliation.frozen
        ? 'The result is unknown or a fill missed its bounds; the intent is frozen until it is reconciled or reviewed. No new transaction is sent.'
        : 'The result is unknown; the existing attempt is reconciled from chain evidence.';
    case 'FAILED':
      return `The transaction failed: ${status.stateReason ?? 'the chain reported an error'}. Nothing filled.`;
    case 'EXPIRED':
      return (
        status.stateReason ??
        'The plan or the transaction expired before it landed. Nothing was spent.'
      );
    case 'CANCELLED':
      return 'Cancelled before any signature. Nothing was sent.';
    case 'CANCEL_REQUESTED':
      return 'Cancellation requested after a broadcast; the chain decides what already went out.';
    default:
      return `${STATE_LABELS[status.state]}.`;
  }
}

/**
 * What a screen reader hears when the state changes: only meaningful
 * transitions, never every poll.
 */
export function announcementFor(
  previous: ExecutionStatus | null,
  next: ExecutionStatus,
): string | null {
  if (previous === null) {
    return null;
  }
  if (previous.state !== next.state) {
    return `${STATE_LABELS[next.state]}. ${describeState(next)}`;
  }
  const changed = next.batches.find((batch) => {
    const before = previous.batches.find((entry) => entry.batch === batch.batch);
    return before !== undefined && before.state !== batch.state;
  });
  if (changed) {
    return `Transaction ${changed.batch + 1} of ${next.batches.length} is ${changed.state}.`;
  }
  return null;
}

/* ------------------------------------------------------------ helpers */

export function shorten(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** The plan's batch count, for "1 of N" labels before any status exists. */
export function transactionTotal(plan: Pick<ExecutionPlan, 'grouping'> | null): number {
  return plan?.grouping.batches.length ?? 1;
}
