'use client';

import type { ExecutionPlan, Intent } from '@markov/contracts';
import { formatBasisPoints, formatInstant, shortenAddress } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  Skeleton,
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
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useStrategy } from '../builder/queries';
import { ExecutionPanel } from '../execution/execution-panel';
import { CopyButton } from '../funding/copy-button';
import { ISSUER_LABELS } from '../markets/labels';
import { usePublicStrategy } from '../publishing/queries';
import { useWallet } from '../wallets/wallet-context';
import {
  contextWarnings,
  ctaLabel,
  describeRefusal,
  diffPlans,
  feeRows,
  formatCountdown,
  formatSol,
  formatUnits,
  INTENT_STATE_LABELS,
  intentOpen,
  isAcknowledged,
  legRows,
  type PlanDifference,
  planValidity,
  transactionCount,
} from './plan-model';
import { useAcknowledgePlan, useBuildPlan, useCancelIntent, useIntent, usePlan } from './queries';

function isNotFound(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 404;
}

function Loading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading review"
      className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6"
    >
      <Skeleton className="h-8 w-2/3" />
      <SkeletonText lines={6} />
    </section>
  );
}

/** A clock that ticks once a second while the review is open, so the countdown is the plan's, not a guess. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The newest frozen version number of the plan's strategy: the owner's list, or the public one for everyone else. */
function useNewestVersionNumber(strategyId: string | null): number | null {
  const own = useStrategy(strategyId ?? '', strategyId !== null);
  const pub = usePublicStrategy(strategyId ?? '', strategyId !== null && isNotFound(own.error));
  const numbers = own.data
    ? own.data.versions.map((version) => version.versionNumber)
    : pub.data
      ? pub.data.versions.map((version) => version.versionNumber)
      : [];
  return numbers.length === 0 ? null : Math.max(...numbers);
}

function Definition({
  term,
  children,
  testId,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="contents">
      <dt className="text-text-muted">{term}</dt>
      <dd {...(testId ? { 'data-testid': testId } : {})}>{children}</dd>
    </div>
  );
}

const DL = 'grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]';

function InputSection({ plan }: { readonly plan: ExecutionPlan }) {
  const input = plan.input;
  const stable = (raw: string) => formatUnits(raw, input.decimals, input.symbol);
  return (
    <section aria-labelledby="input-heading" className="space-y-2">
      <h2 id="input-heading" className="text-heading-sm font-semibold">
        Input and allocation
      </h2>
      <dl className={DL} data-testid="plan-input">
        <Definition term="Budget">
          {stable(input.budgetRaw)}{' '}
          <span className="text-text-muted">
            (
            {input.budgetMode === 'all_in_stablecoin'
              ? 'all-in stablecoin spend'
              : 'investable notional'}
            )
          </span>
        </Definition>
        <Definition term="Investable">{stable(input.investableRaw)}</Definition>
        <Definition term="Most that leaves the wallet" testId="total-spend">
          {stable(input.totalSpendRaw)}
        </Definition>
        <Definition term="Cash that stays" testId="cash-remainder">
          {stable(plan.bounds.residualCashRaw)}
          {plan.allocation.dustRaw !== '0' ? (
            <span className="text-text-muted">
              {' '}
              (including {stable(plan.allocation.dustRaw)} the routes did not consume)
            </span>
          ) : null}
        </Definition>
        <Definition term="Stablecoin fee reserve">
          {stable(plan.allocation.feeReserveRaw)}
        </Definition>
        <Definition term="Rounding">
          largest remainder in {input.symbol} base units; targets plus cash equal the investable
          amount exactly
        </Definition>
      </dl>
    </section>
  );
}

function LegsSection({ plan }: { readonly plan: ExecutionPlan }) {
  const rows = legRows(plan);
  return (
    <section aria-labelledby="legs-heading" className="space-y-2">
      <h2 id="legs-heading" className="text-heading-sm font-semibold">
        Constituents and quotes
      </h2>
      <p className="text-supporting text-text-muted">
        Exact-in quotes from {plan.legs[0]?.quote.venue ?? 'the venue'} (
        {plan.mode === 'fixture' ? 'synthetic fixture quotes' : 'live quotes'}). "Expected" is the
        quote; "at least" is what the route commits to at your slippage limit, and an execution
        below it must fail.
      </p>
      <Table regionLabel="Constituents and quotes" data-testid="legs-table">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Constituent</TableHeaderCell>
            <TableHeaderCell numeric>Weight</TableHeaderCell>
            <TableHeaderCell numeric>Max input</TableHeaderCell>
            <TableHeaderCell numeric>Expected</TableHeaderCell>
            <TableHeaderCell numeric>At least</TableHeaderCell>
            <TableHeaderCell numeric>Price impact</TableHeaderCell>
            <TableHeaderCell numeric>Slippage limit</TableHeaderCell>
            <TableHeaderCell>Transaction</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.instrumentId} data-testid="leg-row">
              <TableCell>
                <span className="font-medium">{row.symbol}</span>
                <span className="block text-caption text-text-muted">
                  {ISSUER_LABELS[row.issuer]} ·{' '}
                  <code className="font-mono" title={row.mint}>
                    {shortenAddress(row.mint)}
                  </code>{' '}
                  · {plan.network.cluster}
                </span>
              </TableCell>
              <TableCell numeric>{row.weight}</TableCell>
              <TableCell numeric>{row.maxInput}</TableCell>
              <TableCell numeric>{row.expectedOutput}</TableCell>
              <TableCell numeric>{row.minimumOutput}</TableCell>
              <TableCell numeric>{row.priceImpact}</TableCell>
              <TableCell numeric>{row.slippage}</TableCell>
              <TableCell>{row.batchLabel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function FeesSection({ plan }: { readonly plan: ExecutionPlan }) {
  return (
    <section aria-labelledby="fees-heading" className="space-y-2">
      <h2 id="fees-heading" className="text-heading-sm font-semibold">
        Fees and who pays
      </h2>
      <Table regionLabel="Fees" data-testid="fees-table">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Cost</TableHeaderCell>
            <TableHeaderCell numeric>Amount</TableHeaderCell>
            <TableHeaderCell>Basis</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {feeRows(plan).map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell numeric>{row.value}</TableCell>
              <TableCell className="text-caption text-text-muted">{row.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-supporting" data-testid="fee-payer">
        Fee payer:{' '}
        <code className="font-mono" title={plan.fees.feePayer}>
          {shortenAddress(plan.fees.feePayer)}
        </code>{' '}
        <span className="text-text-muted">
          (your wallet). SOL and {plan.input.symbol} are separate units; neither is a USD valuation.
        </span>
      </p>
    </section>
  );
}

function TransactionsSection({ plan }: { readonly plan: ExecutionPlan }) {
  const count = transactionCount(plan);
  const stable = (raw: string) => formatUnits(raw, plan.input.decimals, plan.input.symbol);
  return (
    <section aria-labelledby="transactions-heading" className="space-y-2">
      <h2 id="transactions-heading" className="text-heading-sm font-semibold">
        Transactions and signatures
      </h2>
      <p className="text-supporting" data-testid="transaction-count">
        {count.signatures} signature{count.signatures === 1 ? '' : 's'} across {count.batches}{' '}
        transaction{count.batches === 1 ? '' : 's'}, all signed by your wallet.
      </p>
      {plan.grouping.mode === 'atomic' ? (
        <Notice tone="info" title="One transaction, all or nothing" data-testid="grouping-atomic">
          {plan.grouping.note}
        </Notice>
      ) : (
        <Notice tone="attention" title="Staged execution" data-testid="grouping-staged">
          <p>
            {plan.grouping.batches.length} separate transactions land one by one. A later one can
            fail or expire after earlier ones filled; each is reported on its own, no budget moves
            between constituents on its own, and nothing is rolled back across transactions. A
            wallet that signs several transactions at once does not make them atomic.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5" aria-label="Transactions in order">
            {plan.grouping.batches.map((batch) => (
              <li key={batch.batch}>
                {batch.description.replace(/ raw \w+$/, ` ${plan.input.symbol}`)}: at most{' '}
                {stable(batch.worstCaseSpentRaw)} spent in total after it,{' '}
                {stable(batch.remainingCashRaw)} still in the wallet.
              </li>
            ))}
          </ol>
          <p className="mt-2 text-caption">{plan.grouping.note}</p>
        </Notice>
      )}
    </section>
  );
}

function PolicySection({ plan }: { readonly plan: ExecutionPlan }) {
  const evidence = plan.validity.evidence;
  return (
    <section aria-labelledby="policy-heading" className="space-y-2">
      <h2 id="policy-heading" className="text-heading-sm font-semibold">
        Policy and eligibility
      </h2>
      <dl className={DL} data-testid="policy-evidence">
        <Definition term="Policy version">
          {evidence.policyVersion ?? 'no published policy'}
        </Definition>
        <Definition term="Eligibility decision">
          {evidence.eligibilityDecisionId ? (
            <code className="font-mono">{evidence.eligibilityDecisionId.slice(0, 8)}</code>
          ) : (
            'none'
          )}{' '}
          <Link href="/settings/eligibility" className="underline underline-offset-2">
            eligibility and terms
          </Link>
        </Definition>
        <Definition term="Decisions per constituent">
          {plan.legs.map((leg) => (
            <span key={leg.legIndex} className="block">
              {leg.symbol}: {leg.policyDecision.outcome}{' '}
              <code className="font-mono text-caption">
                {leg.policyDecision.decisionId.slice(0, 8)}
              </code>
              , valid until {formatInstant(leg.policyDecision.expiresAt)} UTC
            </span>
          ))}
        </Definition>
        <Definition term="Re-check">
          policy is evaluated again before any signature; a denial then stops the trade
        </Definition>
      </dl>
    </section>
  );
}

function ValiditySection({
  plan,
  secondsLeft,
  phase,
}: {
  readonly plan: ExecutionPlan;
  readonly secondsLeft: number;
  readonly phase: string;
}) {
  const first = plan.legs[0];
  return (
    <section aria-labelledby="validity-heading" className="space-y-2">
      <h2 id="validity-heading" className="text-heading-sm font-semibold">
        Validity and evidence
      </h2>
      <dl className={DL} data-testid="plan-validity">
        <Definition term="Quotes observed">
          {formatInstant(plan.validity.quotesObservedAt)} UTC
        </Definition>
        <Definition term="Quotes expire">
          {formatInstant(plan.validity.quotesExpireAt)} UTC
        </Definition>
        <Definition term="Policy decisions expire">
          {formatInstant(plan.validity.policyExpiresAt)} UTC
        </Definition>
        <Definition term="Plan valid until" testId="valid-until">
          {formatInstant(plan.validity.expiresAt)} UTC
          {phase === 'valid' || phase === 'expiring' ? (
            <span className="text-text-muted"> · {formatCountdown(secondsLeft)} left</span>
          ) : (
            <span className="text-text-muted"> · {phase}</span>
          )}
        </Definition>
        <Definition term="Simulation">
          {plan.validity.simulation
            ? `${plan.validity.simulation.status}${
                plan.validity.simulation.unitsConsumed !== null
                  ? ` (${plan.validity.simulation.unitsConsumed} compute units at slot ${plan.validity.simulation.slot ?? '?'})`
                  : ''
              }${plan.validity.simulation.err ? `: ${plan.validity.simulation.err}` : ''} at plan time; each transaction is simulated again when it is built`
            : 'not simulated at plan time (single leg or staged plan); each transaction is simulated when it is built'}
        </Definition>
        <Definition term="Quote source">
          {first ? `${first.quote.venue} · ${first.quote.mode} · ${first.quote.sourceRef}` : 'none'}
        </Definition>
        <Definition term="Quote references">
          {plan.validity.evidence.quoteRefs.join(', ')}
        </Definition>
        <Definition term="Funds observed" testId="funds-observed">
          {formatUnits(plan.funds.stablecoinRaw, plan.input.decimals, plan.input.symbol)} and{' '}
          {formatSol(plan.funds.lamports)} at slot {plan.funds.slot} ·{' '}
          {plan.funds.sufficient ? 'enough for this plan' : 'not enough for this plan'}
        </Definition>
        <Definition term="Network">
          {plan.network.cluster} ·{' '}
          <code className="font-mono" title={plan.network.genesisHash}>
            {shortenAddress(plan.network.genesisHash)}
          </code>
        </Definition>
      </dl>
    </section>
  );
}

function DifferencePanel({
  difference,
  onAccept,
}: {
  readonly difference: PlanDifference;
  readonly onAccept: () => void;
}) {
  return (
    <Notice
      tone="attention"
      title="The terms changed since you last looked"
      data-testid="plan-difference"
      actions={
        <Button type="button" size="sm" onClick={onAccept} data-testid="accept-new-terms">
          I have read the new terms
        </Button>
      }
    >
      <p>
        A refreshed plan replaced the one on screen. Approval stays unavailable until you have read
        what changed; the old plan can no longer be approved.
      </p>
      {difference.constituentsDiffer ? (
        <p className="mt-1">The constituents themselves differ between the two plans.</p>
      ) : null}
      {difference.fields.length > 0 ? (
        <ul className="mt-2 space-y-1" aria-label="Changed terms">
          {difference.fields.map((field) => (
            <li key={field.label}>
              <span className="font-medium">{field.label}:</span> {field.before} → {field.after}
            </li>
          ))}
        </ul>
      ) : null}
      {difference.legs.map((leg) => (
        <ul key={leg.symbol} className="mt-2 space-y-1" aria-label={`Changes for ${leg.symbol}`}>
          {leg.changes.map((field) => (
            <li key={`${leg.symbol}-${field.label}`}>
              <span className="font-medium">
                {leg.symbol} {field.label.toLowerCase()}:
              </span>{' '}
              {field.before} → {field.after}
            </li>
          ))}
        </ul>
      ))}
    </Notice>
  );
}

function newReviewHref(intent: Intent): string {
  const wallet = `walletId=${intent.wallet.walletId}`;
  return intent.strategy
    ? `/review/new?strategyId=${intent.strategy.strategyId}&versionId=${intent.strategy.versionId}&${wallet}`
    : `/review/new?instrumentId=${intent.instrumentId ?? ''}&${wallet}`;
}

function RefusalPanel({
  error,
  intent,
  onRetry,
  retrying,
}: {
  readonly error: WebApiError;
  readonly intent: Intent;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}) {
  const guidance = describeRefusal(error, { newReviewHref: newReviewHref(intent) });
  const action = guidance.action;
  const retryLabel =
    action.kind === 'retry' || action.kind === 'reload'
      ? action.label
      : action.kind === 'fund'
        ? 'Check again'
        : 'Get quotes again';
  return (
    <Notice
      tone="error"
      title={guidance.title}
      data-testid="plan-refusal"
      actions={
        <>
          {intentOpen(intent) ? (
            <Button type="button" size="sm" onClick={onRetry} loading={retrying}>
              {retryLabel}
            </Button>
          ) : null}
          {action.href ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <p>{guidance.detail}</p>
      {guidance.items.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {guidance.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {guidance.minimumBudgetRaw ? (
        <p className="mt-1">
          Smallest workable budget:{' '}
          {formatUnits(guidance.minimumBudgetRaw, intent.budget.decimals, intent.budget.symbol)}.
          The recipe's weights were not changed.
        </p>
      ) : null}
    </Notice>
  );
}

function ReviewBody({ intent }: { readonly intent: Intent }) {
  const now = useNow();
  const router = useRouter();
  const wallet = useWallet();
  const build = useBuildPlan(intent.intentId);
  const cancel = useCancelIntent(intent.intentId);
  const planQuery = usePlan(intent.intentId, intent.latestPlanId, true);
  const plan = planQuery.data ?? null;
  const acknowledge = useAcknowledgePlan(intent.intentId, plan?.planId ?? '');
  const newestVersion = useNewestVersionNumber(intent.strategy?.strategyId ?? null);
  const [seen, setSeen] = useState<ExecutionPlan | null>(null);
  const [difference, setDifference] = useState<PlanDifference | null>(null);
  const [stagedAccepted, setStagedAccepted] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const autoBuilt = useRef(false);
  const open = intentOpen(intent);

  // First plan: quote as soon as the intent is opened; nothing is reserved by doing so.
  useEffect(() => {
    if (intent.state === 'DRAFT' && intent.latestPlanId === null && open && !autoBuilt.current) {
      autoBuilt.current = true;
      build.mutate();
    }
  }, [intent.state, intent.latestPlanId, open, build]);

  // The review is bound to the plan on screen: a plan with another hash is shown as a difference first.
  useEffect(() => {
    if (plan === null) {
      return;
    }
    if (seen === null || seen.planHash === plan.planHash) {
      if (seen !== plan) {
        setSeen(plan);
      }
      return;
    }
    const diff = diffPlans(seen, plan);
    if (diff.changed) {
      setDifference(diff);
    } else {
      setSeen(plan);
    }
  }, [plan, seen]);

  const validity = plan ? planValidity(plan, now) : null;
  const acknowledged = plan !== null && isAcknowledged(plan);
  const termsCurrent = plan !== null && seen?.planHash === plan.planHash && difference === null;
  const warnings = useMemo(
    () =>
      plan
        ? contextWarnings(plan, {
            connectedAddress:
              wallet.connection.status === 'connected' ? wallet.connection.account.address : null,
            chainMatches: wallet.chainMatches,
            newestVersionNumber: newestVersion,
          })
        : [],
    [plan, wallet.connection, wallet.chainMatches, newestVersion],
  );
  const stateReading = INTENT_STATE_LABELS[intent.state];
  const approveReason = !open
    ? `This review is ${stateReading.label.toLowerCase()}.`
    : plan === null || validity === null
      ? 'No plan to approve yet.'
      : validity.phase === 'superseded'
        ? 'A newer plan replaced this one.'
        : validity.phase === 'expired'
          ? 'These terms expired; refresh them to continue.'
          : !termsCurrent
            ? 'Read the changed terms first.'
            : plan.grouping.acknowledgementRequired && !stagedAccepted
              ? 'Confirm that you understand staged execution first.'
              : acknowledge.isPending
                ? 'Sending your approval…'
                : null;
  const title = intent.strategy
    ? `${intent.strategy.title} · version ${intent.strategy.versionNumber}`
    : plan?.legs[0]
      ? `Buy ${plan.legs[0].symbol}`
      : intent.kind === 'single_sell'
        ? 'Single sell'
        : 'Single buy';
  const refreshReason = !open
    ? `This review is ${stateReading.label.toLowerCase()}.`
    : build.isPending
      ? 'Getting quotes…'
      : null;

  const approve = () => {
    if (plan === null || approveReason !== null) {
      return;
    }
    acknowledge.mutate(
      { planHash: plan.planHash, stagedAcknowledged: plan.grouping.acknowledgementRequired },
      {
        onError: () => {
          void planQuery.refetch();
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/review" className="underline underline-offset-2">
            Reviews
          </Link>{' '}
          <span className="text-text-muted">/ review</span>
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 text-heading-lg font-semibold" title={title}>
            {title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={stateReading.tone} data-testid="intent-state">
              {stateReading.label}
            </StatusBadge>
            {plan?.mode === 'fixture' ? (
              <StatusBadge tone="attention">Fixture quotes</StatusBadge>
            ) : null}
            <StatusBadge tone="neutral">
              {intent.kind === 'basket_investment'
                ? 'Basket investment'
                : intent.kind === 'single_sell'
                  ? 'Single sell'
                  : 'Single buy'}
            </StatusBadge>
          </div>
        </div>
        <p className="text-supporting text-text-muted" data-testid="review-context">
          Wallet{' '}
          <code className="font-mono" title={intent.wallet.address}>
            {shortenAddress(intent.wallet.address)}
          </code>{' '}
          on {plan?.network.cluster ?? 'the platform network'} · budget{' '}
          {formatUnits(intent.budget.rawAmount, intent.budget.decimals, intent.budget.symbol)} ·
          slippage limit {formatBasisPoints(intent.slippageBps)}
          {intent.strategy ? (
            <>
              {' '}
              · manifest{' '}
              <code className="font-mono" title={intent.strategy.manifestHash}>
                {shortenAddress(intent.strategy.manifestHash, { head: 8, tail: 8 })}
              </code>
            </>
          ) : null}
        </p>
        {intent.stateReason ? (
          <p className="text-caption text-text-muted" data-testid="state-reason">
            {intent.stateReason}
          </p>
        ) : null}
      </header>

      {build.error ? (
        <RefusalPanel
          error={build.error}
          intent={intent}
          onRetry={() => build.mutate()}
          retrying={build.isPending}
        />
      ) : null}

      {plan === null ? (
        build.isPending || (intent.latestPlanId !== null && planQuery.isPending) ? (
          <section aria-busy="true" aria-label="Getting quotes" className="space-y-3">
            <p className="text-supporting text-text-muted" data-testid="quoting">
              Getting quotes for this exact budget…
            </p>
            <SkeletonText lines={5} />
          </section>
        ) : planQuery.error ? (
          <ErrorBlock
            title="The plan could not be read"
            message={
              isNotFound(planQuery.error)
                ? 'No plan with that id for this review.'
                : 'Try again in a moment.'
            }
            onRetry={() => void planQuery.refetch()}
          />
        ) : !build.error && open ? (
          <EmptyState
            title="No plan yet"
            description="Ask for quotes to see every term of this investment before approving anything."
            action={
              <Button type="button" onClick={() => build.mutate()}>
                Get quotes
              </Button>
            }
          />
        ) : !open ? (
          <EmptyState
            title={`This review is ${stateReading.label.toLowerCase()}`}
            description="Nothing was signed or bought. Start a new review to invest."
            action={
              <Button asChild variant="secondary">
                <Link href={newReviewHref(intent)}>Start a new review</Link>
              </Button>
            }
          />
        ) : null
      ) : (
        <>
          <section
            aria-label="Plan identity"
            className="space-y-1 rounded-panel border border-border/60 p-3"
          >
            <p className="flex flex-wrap items-center gap-2 text-supporting">
              <span className="text-text-muted">Plan</span>
              <code className="font-mono" data-testid="plan-id">
                {plan.planId}
              </code>
              <span className="text-text-muted">hash</span>
              <code className="font-mono" title={plan.planHash} data-testid="plan-hash">
                {shortenAddress(plan.planHash, { head: 12, tail: 8 })}
              </code>
              <CopyButton value={plan.planHash} label="Copy plan hash" />
            </p>
            <p className="text-caption text-text-muted">
              Built {formatInstant(plan.createdAt)} UTC. Immutable: the hash covers every amount,
              bound and expiry above and below; your approval is recorded against it.
            </p>
          </section>

          {validity && validity.phase === 'expired' && open ? (
            <Notice
              tone="attention"
              title="These terms expired"
              data-testid="terms-expired"
              actions={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => build.mutate()}
                  loading={build.isPending}
                  data-testid="refresh-terms"
                >
                  Refresh terms
                </Button>
              }
            >
              The quotes or policy decisions behind this plan are past their validity; nothing can
              be approved against them. Refreshing quotes again and shows what changed.
            </Notice>
          ) : null}
          {validity && validity.phase === 'expiring' ? (
            <p className="text-supporting text-attention" aria-live="polite" data-testid="expiring">
              These terms expire in {formatCountdown(validity.secondsLeft)}.
            </p>
          ) : null}
          {validity?.phase === 'superseded' ? (
            <Notice tone="info" title="A newer plan replaced this one">
              Open the newest plan from the review to continue.
            </Notice>
          ) : null}

          {difference ? (
            <DifferencePanel
              difference={difference}
              onAccept={() => {
                setSeen(plan);
                setDifference(null);
                setStagedAccepted(false);
              }}
            />
          ) : null}

          {plan.warnings.map((warning) => (
            <Notice
              key={warning}
              tone={warning.startsWith('Fixture mode') ? 'attention' : 'info'}
              title={warning.startsWith('Fixture mode') ? 'Fixture quotes' : 'Plan note'}
              data-testid="plan-warning"
            >
              {warning}
            </Notice>
          ))}
          {warnings.map((warning) => (
            <Notice
              key={warning.code}
              tone={warning.code === 'not_connected' ? 'info' : 'attention'}
              title={
                warning.code === 'newer_version'
                  ? 'A newer version exists'
                  : warning.code === 'not_connected'
                    ? 'No wallet connected'
                    : 'Connected wallet differs from the plan'
              }
              data-testid={`context-${warning.code}`}
            >
              {warning.message}
            </Notice>
          ))}

          <InputSection plan={plan} />
          <LegsSection plan={plan} />
          <FeesSection plan={plan} />
          <TransactionsSection plan={plan} />
          <PolicySection plan={plan} />
          {validity ? (
            <ValiditySection
              plan={plan}
              secondsLeft={validity.secondsLeft}
              phase={validity.phase}
            />
          ) : null}

          <section
            aria-labelledby="approval-heading"
            className="space-y-3 rounded-panel border border-border/60 bg-surface p-4"
            data-testid="approval-panel"
          >
            <h2 id="approval-heading" className="text-heading-sm font-semibold">
              Your approval
            </h2>
            {acknowledged ? (
              <Notice tone="success" title="Approved by you" data-testid="approved">
                Recorded{' '}
                {plan.review.acknowledgedAt ? formatInstant(plan.review.acknowledgedAt) : ''} UTC
                against plan hash{' '}
                <code className="font-mono">
                  {shortenAddress(plan.planHash, { head: 12, tail: 8 })}
                </code>
                {plan.review.stagedAcknowledged ? ', staged execution acknowledged' : ''}. Nothing
                is reserved, signed or bought until your wallet signs the exact transaction below.
              </Notice>
            ) : (
              <>
                <p className="text-supporting text-text-muted">
                  Approving binds your review to this plan's hash. It reserves nothing and buys
                  nothing; the wallet signs the exact transactions later, and a plan with another
                  hash needs a new review. A preview amount is not a reserved fill.
                </p>
                {plan.grouping.acknowledgementRequired ? (
                  <label className="flex items-start gap-2 text-supporting">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={stagedAccepted}
                      onChange={(event) => setStagedAccepted(event.target.checked)}
                      data-testid="staged-checkbox"
                    />
                    <span>
                      I understand this basket executes as {plan.grouping.batches.length} separate
                      transactions: some can succeed while others fail or expire, each is reported
                      on its own, and nothing is rolled back.
                    </span>
                  </label>
                ) : null}
              </>
            )}
            {acknowledge.error ? (
              <Notice
                tone="error"
                title="The approval was not recorded"
                data-testid="approve-error"
              >
                {acknowledge.error.code === 'PLAN_CHANGED'
                  ? 'The plan changed before your approval arrived; the review shows the current plan.'
                  : acknowledge.error.code === 'QUOTE_EXPIRED'
                    ? 'The plan expired before your approval arrived; refresh the terms.'
                    : acknowledge.error.message}
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {acknowledged ? null : validity && validity.phase === 'expired' ? (
                <Button
                  type="button"
                  onClick={() => build.mutate()}
                  loading={build.isPending}
                  {...(refreshReason ? { disabledReason: refreshReason } : {})}
                  data-testid="approve"
                >
                  Refresh terms
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={approve}
                  loading={acknowledge.isPending}
                  {...(approveReason ? { disabledReason: approveReason } : {})}
                  data-testid="approve"
                >
                  {validity ? ctaLabel(plan, validity) : 'Approve plan'}
                </Button>
              )}
              {!acknowledged && validity && validity.phase !== 'expired' ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => build.mutate()}
                  loading={build.isPending}
                  {...(refreshReason ? { disabledReason: refreshReason } : {})}
                  data-testid="refresh-terms"
                >
                  Refresh terms
                </Button>
              ) : null}
              {open ? (
                confirmCancel ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => cancel.mutate()}
                      loading={cancel.isPending}
                      data-testid="confirm-cancel"
                    >
                      Confirm cancel
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                      Keep reviewing
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirmCancel(true)}
                    data-testid="cancel-review"
                  >
                    Cancel review
                  </Button>
                )
              ) : null}
              {acknowledged ? null : (
                <StatusBadge tone="neutral">No signature, no order</StatusBadge>
              )}
            </div>
            {cancel.error ? (
              <p className="text-supporting text-error">{cancel.error.message}</p>
            ) : null}
          </section>
          {acknowledged &&
          termsCurrent &&
          validity !== null &&
          validity.phase !== 'expired' &&
          validity.phase !== 'superseded' ? (
            <ExecutionPanel
              intent={intent}
              plan={plan}
              approvedPlanHash={plan.review.acknowledgedHash}
              variant="review"
              onSubmitted={(status) => router.push(`/activity/${status.intentId}`)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** One review by intent id: the owner's intent and its latest bounded plan; anything else is "not found". */
export function ReviewView({ intentId }: { readonly intentId: string }) {
  const intent = useIntent(intentId, true);
  if (intent.data) {
    return <ReviewBody intent={intent.data} />;
  }
  if (intent.isPending) {
    return <Loading />;
  }
  if (isNotFound(intent.error)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState
          title="No review with that id"
          description="It is not yours, or it never existed."
          action={
            <Button asChild variant="secondary">
              <Link href="/review">Your reviews</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <ErrorBlock
        title="The review could not be read"
        message={
          intent.error instanceof WebApiError ? intent.error.message : 'Try again in a moment.'
        }
        onRetry={() => void intent.refetch()}
      />
    </div>
  );
}
