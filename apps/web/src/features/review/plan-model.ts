import type { ExecutionPlan, Intent, IntentState, PlanLeg } from '@markov/contracts';
import { formatBasisPoints, formatRawAmount, shortenAddress } from '@markov/formatters';
import type { StatusTone } from '@markov/ui';

/**
 * Pure helpers for the review screen: what a plan says in the person's
 * units, whether it may still be approved, what changed between two plans,
 * and what a refusal lets the person do next. Nothing here quotes, reserves
 * or signs; every number is the API's, formatted exactly.
 */
export const LAMPORT_DECIMALS = 9;
/** Below this many seconds left the review says so loudly; at zero the approval is disabled. */
export const EXPIRING_SECONDS = 15;

export function formatSol(lamports: string | bigint): string {
  return `${formatRawAmount(lamports, LAMPORT_DECIMALS)} SOL`;
}

export function formatUnits(raw: string | bigint, decimals: number, symbol: string): string {
  return `${formatRawAmount(raw, decimals)} ${symbol}`;
}

export function secondsUntil(iso: string, now: Date): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return 0;
  }
  return Math.max(0, Math.floor((at - now.getTime()) / 1000));
}

export type PlanPhase = 'valid' | 'expiring' | 'expired' | 'superseded';

export interface PlanValidity {
  readonly phase: PlanPhase;
  readonly secondsLeft: number;
  /** Whether an approval may be sent for this plan right now. */
  readonly approvable: boolean;
}

/** The API's status wins; a valid plan additionally counts down to its own expiry. */
export function planValidity(plan: ExecutionPlan, now: Date): PlanValidity {
  if (plan.status === 'superseded') {
    return { phase: 'superseded', secondsLeft: 0, approvable: false };
  }
  const secondsLeft = secondsUntil(plan.validity.expiresAt, now);
  if (plan.status === 'expired' || secondsLeft === 0) {
    return { phase: 'expired', secondsLeft: 0, approvable: false };
  }
  return {
    phase: secondsLeft <= EXPIRING_SECONDS ? 'expiring' : 'valid',
    secondsLeft,
    approvable: true,
  };
}

export function formatCountdown(secondsLeft: number): string {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return minutes > 0 ? `${minutes} min ${seconds.toString().padStart(2, '0')} s` : `${seconds} s`;
}

export interface TransactionCount {
  readonly batches: number;
  readonly signaturesPerBatch: number;
  readonly signatures: number;
}

export function transactionCount(plan: ExecutionPlan): TransactionCount {
  const batches = plan.fees.network.batches;
  const signaturesPerBatch = plan.fees.network.signaturesPerBatch;
  return { batches, signaturesPerBatch, signatures: batches * signaturesPerBatch };
}

export function isAcknowledged(plan: ExecutionPlan): boolean {
  return plan.review.acknowledgedHash === plan.planHash;
}

/** The final button names the next action; it never says the investment is complete. */
export function ctaLabel(plan: ExecutionPlan, validity: PlanValidity): string {
  if (isAcknowledged(plan)) {
    return `Sign transaction 1 of ${transactionCount(plan).batches}`;
  }
  if (!validity.approvable) {
    return 'Refresh terms';
  }
  return plan.grouping.mode === 'staged' ? 'Approve staged plan' : 'Approve plan';
}

export const INTENT_STATE_LABELS: Readonly<
  Record<IntentState, { readonly label: string; readonly tone: StatusTone }>
> = {
  DRAFT: { label: 'Not quoted yet', tone: 'neutral' },
  QUOTED: { label: 'Quoted, awaiting your review', tone: 'info' },
  AWAITING_APPROVAL: { label: 'Approved, awaiting your signature', tone: 'success' },
  AUTHORIZED: { label: 'Authorized', tone: 'success' },
  SUBMITTING: { label: 'Submitting', tone: 'pending' },
  SUBMITTED: { label: 'Submitted', tone: 'pending' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  FINALIZED: { label: 'Finalized', tone: 'success' },
  PARTIALLY_COMPLETED: { label: 'Partially completed', tone: 'attention' },
  EXPIRED: { label: 'Expired', tone: 'attention' },
  REJECTED: { label: 'Rejected', tone: 'error' },
  FAILED: { label: 'Failed', tone: 'error' },
  CANCEL_REQUESTED: { label: 'Cancellation requested', tone: 'pending' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  UNKNOWN_REQUIRES_RECONCILIATION: { label: 'Unknown, needs reconciliation', tone: 'attention' },
};

/** States in which a new plan may be requested; the API refuses the others. */
export function intentOpen(intent: Intent): boolean {
  return (
    intent.state === 'DRAFT' || intent.state === 'QUOTED' || intent.state === 'AWAITING_APPROVAL'
  );
}

export interface LegRow {
  readonly legIndex: number;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly issuer: PlanLeg['issuer'];
  readonly mint: string;
  readonly weight: string;
  readonly maxInput: string;
  readonly expectedOutput: string;
  readonly minimumOutput: string;
  readonly priceImpact: string;
  readonly slippage: string;
  readonly batchLabel: string;
  readonly decision: string;
}

export function legRows(plan: ExecutionPlan): readonly LegRow[] {
  const input = plan.input;
  return plan.legs.map((leg) => ({
    legIndex: leg.legIndex,
    instrumentId: leg.instrumentId,
    symbol: leg.symbol,
    issuer: leg.issuer,
    mint: leg.mint,
    weight: formatBasisPoints(leg.weightBps),
    maxInput: formatUnits(leg.maxInputRaw, input.decimals, input.symbol),
    expectedOutput: formatUnits(leg.expectedOutputRaw, leg.decimals, leg.symbol),
    minimumOutput: formatUnits(leg.minimumOutputRaw, leg.decimals, leg.symbol),
    priceImpact:
      leg.priceImpactBps === null ? 'not reported' : formatBasisPoints(leg.priceImpactBps),
    slippage: formatBasisPoints(leg.slippageBps),
    batchLabel:
      plan.grouping.mode === 'staged'
        ? `Transaction ${leg.batch + 1} of ${plan.grouping.batches.length}`
        : 'One transaction',
    decision: `${leg.policyDecision.outcome} (${leg.policyDecision.policyVersion ?? 'no published policy'})`,
  }));
}

export interface FeeRow {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

/** Network costs in SOL and the protocol fee in the stablecoin, each counted once. */
export function feeRows(plan: ExecutionPlan): readonly FeeRow[] {
  const network = plan.fees.network;
  const protocol = plan.fees.protocol;
  return [
    {
      label: 'Base network fee',
      value: formatSol(network.baseFeeLamports),
      note: `${network.baseFeeLamportsPerSignature} lamports per signature × ${network.signaturesPerBatch} per transaction × ${network.batches} transaction${network.batches === 1 ? '' : 's'}`,
    },
    {
      label: 'Priority fee, at most',
      value: formatSol(network.priorityFeeCapLamports),
      note: 'An upper bound; the built transaction may use less, never more.',
    },
    {
      label: 'Token account rent, at most',
      value: formatSol(network.rentLamports),
      note:
        network.newTokenAccounts === 0
          ? 'No new token account is assumed.'
          : `${network.rentExemptTokenAccountLamports} lamports for each of up to ${network.newTokenAccounts} new token account${network.newTokenAccounts === 1 ? '' : 's'} (worst case; an existing account costs nothing).`,
    },
    {
      label: 'Total SOL needed, at most',
      value: formatSol(network.totalLamportsMax),
      note: `Paid in SOL by the fee payer, never taken from the ${plan.input.symbol} budget.`,
    },
    {
      label: 'Markov fee',
      value: formatUnits(protocol.feeRaw, plan.input.decimals, plan.input.symbol),
      note: `Fee policy ${protocol.feePolicyVersion}: ${formatBasisPoints(protocol.feeBps)} of the investable amount.`,
    },
  ];
}

export interface FieldChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

export interface LegChange {
  readonly symbol: string;
  readonly changes: readonly FieldChange[];
}

export interface PlanDifference {
  readonly changed: boolean;
  readonly fields: readonly FieldChange[];
  readonly legs: readonly LegChange[];
  /** Constituents present in one plan and not the other; the two plans describe different recipes. */
  readonly constituentsDiffer: boolean;
}

function change(label: string, before: string, after: string): FieldChange | null {
  return before === after ? null : { label, before, after };
}

/** What differs between the plan the person saw and a refreshed one; labels and warnings are not compared. */
export function diffPlans(previous: ExecutionPlan, next: ExecutionPlan): PlanDifference {
  const stable = (raw: string) => formatUnits(raw, next.input.decimals, next.input.symbol);
  const fields = [
    change('Total spend', stable(previous.input.totalSpendRaw), stable(next.input.totalSpendRaw)),
    change('Investable', stable(previous.input.investableRaw), stable(next.input.investableRaw)),
    change(
      'Cash remainder',
      stable(previous.bounds.residualCashRaw),
      stable(next.bounds.residualCashRaw),
    ),
    change(
      'Total SOL needed, at most',
      formatSol(previous.fees.network.totalLamportsMax),
      formatSol(next.fees.network.totalLamportsMax),
    ),
    change('Markov fee', stable(previous.fees.protocol.feeRaw), stable(next.fees.protocol.feeRaw)),
    change(
      'Transactions',
      String(previous.fees.network.batches),
      String(next.fees.network.batches),
    ),
    change('Execution', previous.grouping.mode, next.grouping.mode),
    change('Fee payer', previous.fees.feePayer, next.fees.feePayer),
    change('Wallet', previous.wallet.address, next.wallet.address),
    change(
      'Strategy version',
      previous.strategy ? `version ${previous.strategy.versionNumber}` : 'single buy',
      next.strategy ? `version ${next.strategy.versionNumber}` : 'single buy',
    ),
    change('Quote mode', previous.mode, next.mode),
    change('Valid until', previous.validity.expiresAt, next.validity.expiresAt),
  ].filter((entry): entry is FieldChange => entry !== null);
  const legs: LegChange[] = [];
  let constituentsDiffer = previous.legs.length !== next.legs.length;
  for (const leg of next.legs) {
    const before = previous.legs.find((candidate) => candidate.instrumentId === leg.instrumentId);
    if (!before) {
      constituentsDiffer = true;
      continue;
    }
    const changes = [
      change('Max input', stable(before.maxInputRaw), stable(leg.maxInputRaw)),
      change(
        'Expected output',
        formatUnits(before.expectedOutputRaw, before.decimals, before.symbol),
        formatUnits(leg.expectedOutputRaw, leg.decimals, leg.symbol),
      ),
      change(
        'Minimum output',
        formatUnits(before.minimumOutputRaw, before.decimals, before.symbol),
        formatUnits(leg.minimumOutputRaw, leg.decimals, leg.symbol),
      ),
      change(
        'Price impact',
        before.priceImpactBps === null ? 'not reported' : formatBasisPoints(before.priceImpactBps),
        leg.priceImpactBps === null ? 'not reported' : formatBasisPoints(leg.priceImpactBps),
      ),
      change(
        'Slippage limit',
        formatBasisPoints(before.slippageBps),
        formatBasisPoints(leg.slippageBps),
      ),
      change('Transaction', String(before.batch + 1), String(leg.batch + 1)),
    ].filter((entry): entry is FieldChange => entry !== null);
    if (changes.length > 0) {
      legs.push({ symbol: leg.symbol, changes });
    }
  }
  return {
    changed: fields.length > 0 || legs.length > 0 || constituentsDiffer,
    fields,
    legs,
    constituentsDiffer,
  };
}

export type ContextWarningCode =
  | 'not_connected'
  | 'wallet_differs'
  | 'wallet_network'
  | 'newer_version';

export interface ContextWarning {
  readonly code: ContextWarningCode;
  readonly message: string;
}

export interface ReviewContext {
  /** Address of the connected wallet account, or null when none is connected. */
  readonly connectedAddress: string | null;
  /** Null until a wallet is connected; then whether it is on the platform's network. */
  readonly chainMatches: boolean | null;
  /** The newest frozen version number of the plan's strategy, when known. */
  readonly newestVersionNumber: number | null;
}

/** Context the plan is bound to and how the person's current context differs; the plan itself never changes. */
export function contextWarnings(
  plan: ExecutionPlan,
  context: ReviewContext,
): readonly ContextWarning[] {
  const warnings: ContextWarning[] = [];
  const bound = shortenAddress(plan.wallet.address);
  if (context.connectedAddress === null) {
    warnings.push({
      code: 'not_connected',
      message: `No wallet is connected. This plan is bound to ${bound}; that wallet signs when signing arrives.`,
    });
  } else if (context.connectedAddress !== plan.wallet.address) {
    warnings.push({
      code: 'wallet_differs',
      message: `The connected wallet (${shortenAddress(context.connectedAddress)}) is not the plan's wallet (${bound}). Approval stays bound to ${bound}; connect that wallet before signing, or start a new review from the connected one.`,
    });
  } else if (context.chainMatches === false) {
    warnings.push({
      code: 'wallet_network',
      message: `The connected wallet is not on ${plan.network.cluster}; switch its network before signing.`,
    });
  }
  if (
    plan.strategy !== null &&
    context.newestVersionNumber !== null &&
    context.newestVersionNumber > plan.strategy.versionNumber
  ) {
    warnings.push({
      code: 'newer_version',
      message: `Version ${context.newestVersionNumber} of this strategy exists; this plan invests in version ${plan.strategy.versionNumber} exactly as reviewed. Start a new review to invest in the newer version.`,
    });
  }
  return warnings;
}

export interface RefusalLike {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: readonly { readonly path: string; readonly message: string }[];
}

export type RefusalActionKind = 'retry' | 'fund' | 'eligibility' | 'budget' | 'reload' | 'none';

export interface RefusalGuidance {
  readonly title: string;
  readonly detail: string;
  readonly items: readonly string[];
  readonly action: {
    readonly kind: RefusalActionKind;
    readonly label: string;
    readonly href: string | null;
  };
  /** Smallest budget the API named, raw stablecoin units, when the budget was the problem. */
  readonly minimumBudgetRaw: string | null;
}

export function minimumBudgetFromDetails(
  details: readonly { readonly message: string }[],
): string | null {
  for (const detail of details) {
    const match = /smallest workable budget is (\d+) raw/.exec(detail.message);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/** Turns an API refusal into something the person can act on; never a way around the check. */
export function describeRefusal(
  error: RefusalLike,
  context: { readonly newReviewHref: string | null },
): RefusalGuidance {
  const items = error.details.map((detail) => detail.message);
  const budgetAction = {
    kind: 'budget' as const,
    label: 'Start over with another budget',
    href: context.newReviewHref,
  };
  switch (error.code) {
    case 'INSUFFICIENT_FUNDS':
      return {
        title: 'The wallet cannot fund this plan',
        detail:
          'The API observed the wallet before quoting anything. Add funds, then check again; the budget itself was not changed.',
        items,
        action: { kind: 'fund', label: 'Add funds', href: '/settings/wallets' },
        minimumBudgetRaw: null,
      };
    case 'POLICY_DENIED': {
      const text = items.join(' ');
      const eligibility = /ELIGIBILITY|TERMS/.test(text);
      const caps = /CAP|CONCENTRATION|LIMIT/.test(text);
      return {
        title: 'Policy refused this plan',
        detail: error.message,
        items,
        action: eligibility
          ? {
              kind: 'eligibility',
              label: 'Open eligibility and terms',
              href: '/settings/eligibility',
            }
          : caps
            ? budgetAction
            : { kind: 'none', label: '', href: null },
        minimumBudgetRaw: null,
      };
    }
    case 'PROVIDER_UNAVAILABLE':
      return {
        title: 'Quotes are unavailable right now',
        detail: error.message,
        items,
        action: { kind: 'retry', label: 'Try again', href: null },
        minimumBudgetRaw: null,
      };
    case 'VALIDATION_FAILED': {
      const minimumBudgetRaw = minimumBudgetFromDetails(error.details);
      return {
        title: minimumBudgetRaw
          ? 'The budget is too small for the route'
          : 'This plan cannot be built',
        detail: error.message,
        items,
        action: minimumBudgetRaw ? budgetAction : { kind: 'none', label: '', href: null },
        minimumBudgetRaw,
      };
    }
    case 'ASSET_NOT_ADMITTED':
      return {
        title: 'A constituent is no longer admitted',
        detail: error.message,
        items,
        action: { kind: 'none', label: '', href: null },
        minimumBudgetRaw: null,
      };
    case 'PLAN_CHANGED':
      return {
        title: 'The plan changed',
        detail: error.message,
        items,
        action: { kind: 'reload', label: 'Reload the plan', href: null },
        minimumBudgetRaw: null,
      };
    case 'QUOTE_EXPIRED':
      return {
        title: 'These terms expired',
        detail: error.message,
        items,
        action: { kind: 'retry', label: 'Refresh terms', href: null },
        minimumBudgetRaw: null,
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many attempts',
        detail: 'Wait a moment before asking for another plan.',
        items,
        action: { kind: 'retry', label: 'Try again', href: null },
        minimumBudgetRaw: null,
      };
    case 'NETWORK':
      return {
        title: 'Markov could not be reached',
        detail: error.message,
        items,
        action: { kind: 'retry', label: 'Try again', href: null },
        minimumBudgetRaw: null,
      };
    default:
      return {
        title: 'Markov refused this request',
        detail: error.message,
        items,
        action: { kind: 'retry', label: 'Try again', href: null },
        minimumBudgetRaw: null,
      };
  }
}
