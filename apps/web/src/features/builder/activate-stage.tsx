'use client';

import type { StrategyDraft, StrategyDraftContent, VersionSummary } from '@markov/contracts';
import { formatBasisPoints, formatRawAmount, shortenAddress } from '@markov/formatters';
import {
  AmountInput,
  Button,
  Field,
  Notice,
  SelectInput,
  StatusBadge,
  type StatusTone,
} from '@markov/ui';
import Link from 'next/link';
import { useActionAvailability, useInstrument } from '../markets/queries';
import { useEligibility, useFunding, useVerifiedWallets } from '../wallets/queries';
import { splitBudget } from './draft-state';
import { useEffectiveLimits } from './queries';

export interface PlanInputs {
  readonly walletId: string | null;
  /** Raw stablecoin base units as a decimal string; null until entered. */
  readonly budgetRaw: string | null;
}

const OUTCOME_TONE: Readonly<Record<'eligible' | 'ineligible' | 'unknown', StatusTone>> = {
  eligible: 'success',
  ineligible: 'error',
  unknown: 'attention',
};

function EstimateRow({
  instrumentId,
  weightBps,
  raw,
  decimals,
  symbol,
}: {
  readonly instrumentId: string;
  readonly weightBps: number;
  readonly raw: bigint | null;
  readonly decimals: number;
  readonly symbol: string;
}) {
  const instrument = useInstrument(instrumentId);
  const availability = useActionAvailability(instrumentId, true);
  const buyable = availability.data?.capabilities.buyable ?? null;
  return (
    <tr data-testid="estimate-row">
      <td className="py-1 pr-3">
        {instrument.data
          ? `${instrument.data.symbol} · ${instrument.data.companyName}`
          : instrumentId.slice(0, 8)}
      </td>
      <td className="py-1 pr-3 text-right font-mono">{formatBasisPoints(weightBps)}</td>
      <td className="py-1 pr-3 text-right font-mono">
        {raw === null ? '—' : `${formatRawAmount(raw, decimals)} ${symbol}`}
        {raw === 0n ? (
          <span className="block text-caption text-error">too small to buy anything</span>
        ) : null}
      </td>
      <td className="py-1">
        {availability.data ? (
          <StatusBadge tone={buyable ? 'success' : 'neutral'}>
            {buyable ? 'Buyable' : 'Not buyable'}
          </StatusBadge>
        ) : availability.error ? (
          <StatusBadge tone="attention">Unknown</StatusBadge>
        ) : (
          <span className="text-caption text-text-muted" aria-busy="true">
            Checking…
          </span>
        )}
        {availability.data && !buyable && availability.data.conditions.length > 0 ? (
          <span className="block text-caption text-text-muted">
            {availability.data.conditions.join(', ').replace(/_/g, ' ')}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Stage 04: a personal plan from the saved recipe, a verified wallet and a
 * budget; every number here is an orientation estimate from exact integer
 * arithmetic, and nothing is bought. "Review investment" opens the review
 * (F09) for the newest frozen version with real quotes; a draft that was
 * never frozen cannot be invested in, and the button says so.
 */
export function ActivateStage({
  content,
  server,
  dirty,
  plan,
  onPlanChange,
  strategyId,
  versions,
}: {
  readonly content: StrategyDraftContent;
  readonly server: StrategyDraft;
  readonly dirty: boolean;
  readonly plan: PlanInputs;
  readonly onPlanChange: (next: PlanInputs) => void;
  readonly strategyId: string;
  readonly versions: readonly VersionSummary[];
}) {
  const newest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
  const reviewHref =
    newest === null
      ? null
      : `/review/new?strategyId=${strategyId}&versionId=${newest.versionId}${plan.walletId ? `&walletId=${plan.walletId}` : ''}${plan.budgetRaw ? `&budget=${plan.budgetRaw}` : ''}`;
  const wallets = useVerifiedWallets(true);
  const funding = useFunding(plan.walletId);
  const limits = useEffectiveLimits(true);
  const eligibility = useEligibility(true);
  const stablecoin = funding.data?.stablecoin ?? null;
  const decimals = stablecoin?.decimals ?? 6;
  const symbol = stablecoin?.symbol ?? 'stablecoin';
  const budget =
    plan.budgetRaw !== null && /^\d+$/.test(plan.budgetRaw) ? BigInt(plan.budgetRaw) : null;
  const split = budget === null ? null : splitBudget(budget, server.content.legs);
  const perOrder = limits.data ? BigInt(limits.data.effective.maxOrderNotionalUsdcRaw) : null;
  const perAccount = limits.data ? BigInt(limits.data.effective.maxAccountNotionalUsdcRaw) : null;
  const overOrder = budget !== null && perOrder !== null && budget > perOrder;
  const overAccount = budget !== null && perAccount !== null && budget > perAccount;
  const balance = stablecoin ? BigInt(stablecoin.raw) : null;
  const overBalance = budget !== null && balance !== null && budget > balance;
  const recipeReady = server.validation.valid && !dirty;
  const checks: readonly {
    readonly label: string;
    readonly ok: boolean | null;
    readonly detail: string;
  }[] = [
    {
      label: 'Recipe validated by the backend',
      ok: recipeReady,
      detail: dirty
        ? 'Saving your latest edits; the plan uses the last saved revision until then.'
        : server.validation.valid
          ? `Revision ${server.revision} is valid.`
          : 'Fix the rules listed in the summary.',
    },
    {
      label: 'Verified wallet chosen',
      ok: plan.walletId !== null,
      detail:
        plan.walletId === null
          ? 'Choose one of your verified wallets.'
          : 'This wallet would sign every transaction.',
    },
    {
      label: 'Stablecoin known for this network',
      ok: funding.data ? stablecoin !== null : null,
      detail:
        funding.data?.stablecoinUnavailableReason ??
        (stablecoin ? `${symbol} on ${funding.data?.cluster}` : 'Waiting for the wallet read.'),
    },
    {
      label: 'Budget within your limits and balance',
      ok: budget === null ? false : !(overOrder || overAccount || overBalance),
      detail:
        budget === null
          ? 'Enter a budget.'
          : overOrder
            ? 'Above your per-order limit; the review will refuse or split it.'
            : overAccount
              ? 'Above your per-account limit.'
              : overBalance
                ? `More than the ${symbol} observed in the wallet.`
                : 'Within the limits that apply to you.',
    },
    {
      label: 'Eligibility resolved',
      ok: eligibility.data ? eligibility.data.outcome === 'eligible' : null,
      detail: eligibility.data?.summary ?? 'Checking…',
    },
  ];
  return (
    <div className="space-y-6">
      {dirty ? (
        <Notice tone="attention" title="Recipe changed since this plan">
          The plan below uses saved revision {server.revision}; your latest edits are being saved
          and the plan refreshes with them.
        </Notice>
      ) : null}
      <section className="space-y-3" aria-labelledby="wallet-heading">
        <h2 id="wallet-heading" className="text-heading-sm font-semibold">
          Wallet and budget
        </h2>
        <p className="text-supporting text-text-muted">
          Kept apart from the recipe: the weights say how a budget is split; the wallet and the
          budget are yours to choose each time. Nothing here is stored with the strategy.
        </p>
        {wallets.data && wallets.data.length === 0 ? (
          <Notice
            tone="info"
            title="No verified wallet yet"
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link href="/settings/wallets">Verify a wallet</Link>
              </Button>
            }
          >
            Your draft stays saved on the server; come back to this page afterwards.
          </Notice>
        ) : (
          <Field label="Wallet" id="plan-wallet" className="max-w-lg">
            {(control) => (
              <SelectInput
                id={control.id}
                value={plan.walletId}
                placeholder={
                  wallets.isPending ? 'Reading your wallets…' : 'Choose a verified wallet'
                }
                onValueChange={(value) => onPlanChange({ ...plan, walletId: value })}
                options={(wallets.data ?? []).map((wallet) => ({
                  value: wallet.walletId,
                  label: `${shortenAddress(wallet.address)} · verified ${wallet.verifiedAt.slice(0, 10)}`,
                }))}
              />
            )}
          </Field>
        )}
        {funding.data ? (
          <p className="text-caption text-text-muted" data-testid="funding-line">
            {stablecoin
              ? `${formatRawAmount(stablecoin.raw, stablecoin.decimals)} ${stablecoin.symbol} observed at slot ${funding.data.slot} (${funding.data.commitment}).`
              : `No stablecoin balance can be observed: ${funding.data.stablecoinUnavailableReason ?? 'unknown reason'}.`}
          </p>
        ) : funding.error ? (
          <p className="text-caption text-text-muted">
            Balances unknown right now; the plan cannot check them.
          </p>
        ) : null}
        <Field
          label={`Budget (${symbol})`}
          id="plan-budget"
          description="Exact units; a USDC budget is not a USD valuation."
          className="max-w-xs"
        >
          {(control) => (
            <AmountInput
              {...control}
              value={plan.budgetRaw}
              decimals={decimals}
              unit={symbol}
              onValueChange={(change) => onPlanChange({ ...plan, budgetRaw: change.raw })}
            />
          )}
        </Field>
      </section>

      <section className="space-y-3" aria-labelledby="estimates-heading">
        <h2 id="estimates-heading" className="text-heading-sm font-semibold">
          How the budget would split
        </h2>
        <p className="text-supporting text-text-muted">
          floor(budget × weight) per constituent in exact base units, the remainder as cash. An
          estimate for orientation: the review quotes real outputs, fees, minimums and route
          conditions for the frozen version you invest in.
        </p>
        {server.content.legs.length === 0 ? (
          <p className="text-supporting text-text-muted">No constituent in the saved revision.</p>
        ) : (
          <section className="overflow-x-auto" aria-label="Budget split">
            <table className="w-full text-supporting">
              <thead>
                <tr className="text-left text-caption text-text-muted">
                  <th className="py-1 pr-3 font-medium">Constituent</th>
                  <th className="py-1 pr-3 text-right font-medium">Weight</th>
                  <th className="py-1 pr-3 text-right font-medium">Estimate</th>
                  <th className="py-1 font-medium">Availability for you</th>
                </tr>
              </thead>
              <tbody>
                {server.content.legs.map((leg, index) => (
                  <EstimateRow
                    key={leg.instrumentId}
                    instrumentId={leg.instrumentId}
                    weightBps={leg.weightBps}
                    raw={split?.perLeg[index]?.raw ?? null}
                    decimals={decimals}
                    symbol={symbol}
                  />
                ))}
                <tr>
                  <td className="py-1 pr-3">Cash</td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {formatBasisPoints(server.content.cashWeightBps)}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono" data-testid="cash-estimate">
                    {split ? `${formatRawAmount(split.cashRaw, decimals)} ${symbol}` : '—'}
                  </td>
                  <td className="py-1 text-caption text-text-muted">stays as {symbol}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="readiness-heading">
        <h2 id="readiness-heading" className="text-heading-sm font-semibold">
          Readiness
        </h2>
        <ul className="space-y-1" aria-label="Readiness checks" data-testid="readiness">
          {checks.map((check) => (
            <li key={check.label} className="flex flex-wrap items-baseline gap-2 text-supporting">
              <StatusBadge
                tone={check.ok === null ? 'pending' : check.ok ? 'success' : 'attention'}
              >
                {check.ok === null ? 'Checking' : check.ok ? 'Ready' : 'Not yet'}
              </StatusBadge>
              <span>{check.label}</span>
              <span className="text-text-muted">{check.detail}</span>
            </li>
          ))}
        </ul>
        {eligibility.data ? (
          <p className="text-caption text-text-muted">
            Eligibility{' '}
            <StatusBadge tone={OUTCOME_TONE[eligibility.data.outcome]}>
              {eligibility.data.outcome}
            </StatusBadge>{' '}
            {eligibility.data.policyVersion
              ? `under policy ${eligibility.data.policyVersion}`
              : 'with no published policy'}
            .
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {reviewHref ? (
            <Button asChild data-testid="review-investment">
              <Link href={reviewHref}>Review investment (version {newest?.versionNumber})</Link>
            </Button>
          ) : (
            <Button
              type="button"
              disabledReason="Freeze a version first: a review invests in an immutable version, never in the working draft."
            >
              Review investment
            </Button>
          )}
          <StatusBadge tone="neutral">No order, no signature</StatusBadge>
        </div>
        <p className="text-caption text-text-muted">
          The review quotes the newest frozen version with your wallet and budget carried over; this
          draft's unsaved or unfrozen edits are not what gets bought.
        </p>
        {content.legs.length !== server.content.legs.length ? null : null}
      </section>
    </div>
  );
}
