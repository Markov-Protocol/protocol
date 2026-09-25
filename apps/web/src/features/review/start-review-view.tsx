'use client';

import type { IntentCreateRequest, PublicVersion, StrategyVersion } from '@markov/contracts';
import { formatBasisPoints, formatRawAmount, shortenAddress } from '@markov/formatters';
import {
  AmountInput,
  Button,
  ErrorBlock,
  Field,
  Notice,
  PercentInput,
  SelectInput,
  Skeleton,
  SkeletonText,
  StatusBadge,
} from '@markov/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { useEffectiveLimits } from '../builder/queries';
import { ISSUER_LABELS } from '../markets/labels';
import { useInstrument } from '../markets/queries';
import { useEnsureInstance } from '../portfolio/queries';
import { useOwnVersion, usePublicVersion } from '../publishing/queries';
import { useEligibility, useFunding, useVerifiedWallets } from '../wallets/queries';
import { describeRefusal } from './plan-model';
import { useCreateIntent } from './queries';

/** The platform's slippage default; the person may only tighten it, and never beyond their policy limit. */
export const DEFAULT_SLIPPAGE_BPS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Target =
  | { readonly kind: 'basket_investment'; readonly strategyId: string; readonly versionId: string }
  | { readonly kind: 'single_buy'; readonly instrumentId: string }
  | null;

function targetOf(params: URLSearchParams): Target {
  const strategyId = params.get('strategyId');
  const versionId = params.get('versionId');
  const instrumentId = params.get('instrumentId');
  if (strategyId && versionId && UUID.test(strategyId) && UUID.test(versionId)) {
    return { kind: 'basket_investment', strategyId, versionId };
  }
  if (instrumentId && UUID.test(instrumentId)) {
    return { kind: 'single_buy', instrumentId };
  }
  return null;
}

function isNotFound(error: unknown): boolean {
  return error instanceof WebApiError && error.status === 404;
}

type ReviewVersion = StrategyVersion | PublicVersion;

/** The pinned version the review invests in: the owner's copy, or the public projection for everyone else. */
function useReviewVersion(target: Target): {
  readonly version: ReviewVersion | null;
  readonly pending: boolean;
  readonly unknown: boolean;
} {
  const basket = target?.kind === 'basket_investment' ? target : null;
  const own = useOwnVersion(basket?.strategyId ?? '', basket?.versionId ?? null, basket !== null);
  const pub = usePublicVersion(
    basket?.strategyId ?? '',
    basket?.versionId ?? null,
    basket !== null && own.error !== null && isNotFound(own.error),
  );
  return {
    version: own.data ?? pub.data ?? null,
    pending: basket !== null && (own.isPending || (own.error !== null && pub.isPending)),
    unknown: isNotFound(own.error) && (pub.error === null || isNotFound(pub.error)),
  };
}

function VersionTarget({
  strategyId,
  versionId,
  version,
  pending,
  unknown,
}: {
  readonly strategyId: string;
  readonly versionId: string;
  readonly version: ReviewVersion | null;
  readonly pending: boolean;
  readonly unknown: boolean;
}) {
  if (version === null) {
    if (pending) {
      return <SkeletonText lines={3} />;
    }
    return (
      <ErrorBlock
        title="This version cannot be reviewed"
        message={
          unknown
            ? 'It is not yours and not public, or the id is unknown.'
            : 'The version could not be read right now.'
        }
      />
    );
  }
  const legs =
    'admission' in (version.legs[0] ?? {})
      ? (version as StrategyVersion).legs.map((leg) => ({
          symbol: leg.symbol,
          issuer: leg.issuer,
          mint: leg.admission.mint,
          weightBps: leg.weightBps,
        }))
      : (version as PublicVersion).legs.map((leg) => ({
          symbol: leg.symbol,
          issuer: leg.issuer,
          mint: leg.mint,
          weightBps: leg.weightBps,
        }));
  return (
    <div className="space-y-2" data-testid="review-target">
      <p className="flex flex-wrap items-center gap-2">
        <Link
          href={`/strategies/${strategyId}/versions/${versionId}`}
          className="font-medium underline underline-offset-2"
        >
          {version.title} · version {version.versionNumber}
        </Link>
        <StatusBadge tone="info">Basket investment</StatusBadge>
      </p>
      <ul className="space-y-1 text-supporting" aria-label="Recipe">
        {legs.map((leg) => (
          <li key={leg.mint} className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono">{formatBasisPoints(leg.weightBps)}</span>
            <span>
              {leg.symbol} · {ISSUER_LABELS[leg.issuer]} ·{' '}
              <code className="font-mono text-caption" title={leg.mint}>
                {shortenAddress(leg.mint)}
              </code>
            </span>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono">{formatBasisPoints(version.cashWeightBps)}</span>
          <span>cash, kept as stablecoin</span>
        </li>
      </ul>
      <p className="text-caption text-text-muted">
        Manifest hash{' '}
        <code className="font-mono" title={version.manifestHash}>
          {shortenAddress(version.manifestHash, { head: 8, tail: 8 })}
        </code>
        . The plan invests in exactly this version; a newer version is a new review.
      </p>
    </div>
  );
}

function InstrumentTarget({ instrumentId }: { readonly instrumentId: string }) {
  const instrument = useInstrument(instrumentId);
  if (instrument.data) {
    return (
      <div className="space-y-1" data-testid="review-target">
        <p className="flex flex-wrap items-center gap-2">
          <Link
            href={`/markets/${instrumentId}`}
            className="font-medium underline underline-offset-2"
          >
            {instrument.data.symbol} · {instrument.data.companyName}
          </Link>
          <StatusBadge tone="info">Single buy</StatusBadge>
          {instrument.data.status !== 'admitted' ? (
            <StatusBadge tone="attention">{instrument.data.status}</StatusBadge>
          ) : null}
        </p>
        <p className="text-caption text-text-muted">
          {ISSUER_LABELS[instrument.data.issuer]} · mint{' '}
          <code className="font-mono" title={instrument.data.mint}>
            {shortenAddress(instrument.data.mint)}
          </code>{' '}
          · {instrument.data.decimals} decimals
        </p>
      </div>
    );
  }
  if (instrument.isPending) {
    return <SkeletonText lines={2} />;
  }
  return (
    <ErrorBlock
      title="This instrument cannot be reviewed"
      message={
        isNotFound(instrument.error)
          ? 'No admitted instrument with that id.'
          : 'The instrument could not be read right now.'
      }
    />
  );
}

/**
 * Start a review: the target (a pinned version or one instrument), one of
 * the person's verified wallets, an exact stablecoin budget and a slippage
 * limit derived from policy. Creating the intent quotes nothing yet; the
 * plan is built on the review page, where every term is shown before any
 * approval. A budget here is not a reserved fill.
 */
export function StartReviewView() {
  const params = useSearchParams();
  const router = useRouter();
  const target = useMemo(() => targetOf(params), [params]);
  const prefillWallet = params.get('walletId');
  const prefillBudget = params.get('budget');
  /** A reviewed completion (F10): the unfilled legs of a partially completed basket at their original targets. */
  const continueIntentId = (() => {
    const value = params.get('continueIntentId');
    return value && UUID.test(value) ? value : null;
  })();
  const wallets = useVerifiedWallets(true);
  const limits = useEffectiveLimits(true);
  const eligibility = useEligibility(true);
  const [walletId, setWalletId] = useState<string | null>(
    prefillWallet && UUID.test(prefillWallet) ? prefillWallet : null,
  );
  const [budgetRaw, setBudgetRaw] = useState<string | null>(
    prefillBudget && /^\d{1,30}$/.test(prefillBudget) ? prefillBudget : null,
  );
  const [slippageBps, setSlippageBps] = useState<number | null>(null);
  const [slippageError, setSlippageError] = useState<string | null>(null);
  const [budgetMode, setBudgetMode] =
    useState<IntentCreateRequest['budgetMode']>('all_in_stablecoin');
  const funding = useFunding(walletId);
  const reviewVersion = useReviewVersion(target);
  const create = useCreateIntent();
  const ensureInstance = useEnsureInstance();
  /** One key per screen visit: a retry after a lost response answers the same intent. */
  const idempotencyKey = useRef(`web-${crypto.randomUUID()}`);

  const stablecoin = funding.data?.stablecoin ?? null;
  const decimals = stablecoin?.decimals ?? 6;
  const symbol = stablecoin?.symbol ?? 'stablecoin';
  const maxSlippage = limits.data?.effective.maxSlippageBps ?? null;
  const defaultSlippage =
    maxSlippage === null ? DEFAULT_SLIPPAGE_BPS : Math.min(DEFAULT_SLIPPAGE_BPS, maxSlippage);
  const effectiveSlippage = slippageBps ?? defaultSlippage;
  const budget = budgetRaw !== null && /^\d+$/.test(budgetRaw) ? BigInt(budgetRaw) : null;
  const perOrder = limits.data ? BigInt(limits.data.effective.maxOrderNotionalUsdcRaw) : null;
  const balance = stablecoin ? BigInt(stablecoin.raw) : null;
  // Policy caps each order: a single buy is the whole budget, a basket's largest constituent its share.
  const largestWeightBps =
    target?.kind === 'single_buy'
      ? 10_000
      : reviewVersion.version
        ? reviewVersion.version.legs.reduce((max, leg) => Math.max(max, leg.weightBps), 0)
        : null;
  const largestOrder =
    budget !== null && largestWeightBps !== null
      ? (budget * BigInt(largestWeightBps)) / 10_000n
      : null;
  const overOrder = largestOrder !== null && perOrder !== null && largestOrder > perOrder;
  const overBalance = budget !== null && balance !== null && budget > balance;
  const slippageTooHigh = maxSlippage !== null && effectiveSlippage > maxSlippage;
  const ready =
    target !== null &&
    walletId !== null &&
    budget !== null &&
    budget > 0n &&
    slippageError === null &&
    !slippageTooHigh &&
    !create.isPending &&
    !ensureInstance.isPending;
  const disabledReason =
    target === null
      ? 'Open this page from a strategy version or an instrument.'
      : walletId === null
        ? 'Choose the verified wallet that pays and signs.'
        : budget === null || budget === 0n
          ? 'Enter a budget.'
          : (slippageError ?? (slippageTooHigh ? 'Slippage is above your limit.' : null));
  const refusal =
    create.error !== null
      ? describeRefusal(create.error, { newReviewHref: null })
      : ensureInstance.error !== null
        ? describeRefusal(ensureInstance.error, { newReviewHref: null })
        : null;

  const submit = () => {
    if (!ready || target === null || walletId === null || budgetRaw === null) {
      return;
    }
    const request: IntentCreateRequest = {
      schemaVersion: '1',
      kind: target.kind,
      strategyVersionId: target.kind === 'basket_investment' ? target.versionId : null,
      instrumentId: target.kind === 'single_buy' ? target.instrumentId : null,
      walletId,
      budget: { rawAmount: budgetRaw },
      budgetMode,
      executionPreference: 'atomic_or_explicit_staged_review',
      approvalMode: 'owner_each_plan',
      slippageBps: slippageBps === null ? null : effectiveSlippage,
      continuationOfIntentId: continueIntentId,
      idempotencyKey: idempotencyKey.current,
    };
    const createIntent = () =>
      create.mutate(request, {
        onSuccess: (intent) => router.push(`/review/${intent.intentId}`),
      });
    if (target.kind === 'basket_investment') {
      // A basket investment is tracked by the one active instance of the strategy in the paying
      // wallet (created here when none exists), so its fills are attributed to a portfolio and not
      // left at the wallet level. Bookkeeping only: nothing is bought until the plan is signed.
      ensureInstance.mutate(
        { strategyId: target.strategyId, versionId: target.versionId, walletId },
        { onSuccess: createIntent },
      );
      return;
    }
    createIntent();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className="text-caption">
          <Link href="/review" className="underline underline-offset-2">
            Reviews
          </Link>{' '}
          <span className="text-text-muted">/ start</span>
        </p>
        <h1 className="text-heading-lg font-semibold">Review an investment</h1>
        <p className="text-supporting text-text-muted">
          Markov builds a bounded plan from real quotes for this exact budget and shows every term
          before anything is approved or signed. Nothing is reserved or bought on this page.
        </p>
        {continueIntentId ? (
          <Notice tone="info" title="Reviewed completion" data-testid="continuation-notice">
            This review completes a partially completed basket: only the legs it left unfilled, at
            their original targets, in the same wallet and version. The budget must equal their sum;
            Markov refuses anything else. Nothing already filled is touched.{' '}
            <Link href={`/activity/${continueIntentId}`} className="underline underline-offset-2">
              See the earlier run
            </Link>
            .
          </Notice>
        ) : null}
      </header>

      <section className="space-y-2" aria-labelledby="target-heading">
        <h2 id="target-heading" className="text-heading-sm font-semibold">
          What you are buying
        </h2>
        {target === null ? (
          <Notice tone="attention" title="Nothing to review">
            Open this page from a strategy version ("Review investment") or an instrument page
            ("Buy"). A review always names exactly what it buys.
          </Notice>
        ) : target.kind === 'basket_investment' ? (
          <VersionTarget
            strategyId={target.strategyId}
            versionId={target.versionId}
            version={reviewVersion.version}
            pending={reviewVersion.pending}
            unknown={reviewVersion.unknown}
          />
        ) : (
          <InstrumentTarget instrumentId={target.instrumentId} />
        )}
      </section>

      <section className="space-y-3" aria-labelledby="wallet-heading">
        <h2 id="wallet-heading" className="text-heading-sm font-semibold">
          Wallet and budget
        </h2>
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
            The plan is bound to one of your verified wallets: it pays the budget and the fees and
            it signs later.
          </Notice>
        ) : (
          <Field label="Wallet" id="review-wallet" className="max-w-lg">
            {(control) => (
              <SelectInput
                id={control.id}
                value={wallets.data?.some((wallet) => wallet.walletId === walletId) ? walletId : ''}
                placeholder={
                  wallets.isPending ? 'Reading your wallets…' : 'Choose a verified wallet'
                }
                onValueChange={setWalletId}
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
              ? `${formatRawAmount(stablecoin.raw, stablecoin.decimals)} ${stablecoin.symbol} and ${formatRawAmount(funding.data.sol.lamports, 9)} SOL observed at slot ${funding.data.slot}.`
              : `No stablecoin balance can be observed: ${funding.data.stablecoinUnavailableReason ?? 'unknown reason'}.`}
          </p>
        ) : funding.error ? (
          <p className="text-caption text-text-muted">
            Balances unknown right now; the plan checks them again before quoting.
          </p>
        ) : walletId === null ? (
          <Skeleton className="h-4 w-1/2" aria-hidden="true" />
        ) : null}
        <Field
          label={`Budget (${symbol})`}
          id="review-budget"
          description={`Exact ${symbol} base units leave the wallet, never more. A ${symbol} budget is not a USD valuation.`}
          error={
            overOrder && perOrder !== null
              ? target?.kind === 'single_buy'
                ? `Above your per-order limit of ${formatRawAmount(perOrder.toString(), decimals)} ${symbol}; the plan will be refused.`
                : `The largest constituent (${formatBasisPoints(largestWeightBps ?? 0)} of the budget) would exceed your per-order limit of ${formatRawAmount(perOrder.toString(), decimals)} ${symbol}; the plan will be refused.`
              : overBalance
                ? `More than the ${symbol} observed in the wallet; the plan will be refused until funds arrive.`
                : undefined
          }
          className="max-w-xs"
        >
          {(control) => (
            <AmountInput
              {...control}
              value={budgetRaw}
              decimals={decimals}
              unit={symbol}
              onValueChange={(change) => setBudgetRaw(change.raw)}
            />
          )}
        </Field>
        <Field
          label="Budget mode"
          id="review-mode"
          description="All-in: the budget is the most that leaves the wallet in stablecoin. Investable: any stablecoin fee comes on top (none under the beta fee policy)."
          className="max-w-lg"
        >
          {(control) => (
            <SelectInput
              id={control.id}
              value={budgetMode}
              onValueChange={(value) =>
                setBudgetMode(
                  value === 'investable_notional' ? 'investable_notional' : 'all_in_stablecoin',
                )
              }
              options={[
                { value: 'all_in_stablecoin', label: 'All-in stablecoin spend' },
                { value: 'investable_notional', label: 'Investable notional' },
              ]}
            />
          )}
        </Field>
        <Field
          label="Slippage limit"
          id="review-slippage"
          description={
            maxSlippage === null
              ? `Platform default ${formatBasisPoints(DEFAULT_SLIPPAGE_BPS)}; your policy limit is being read.`
              : `Platform default ${formatBasisPoints(defaultSlippage)} within your limit of ${formatBasisPoints(maxSlippage)} (from your policy, not a guess). Leave empty for the default; you may only tighten it.`
          }
          error={slippageError ?? (slippageTooHigh ? 'Above your policy limit.' : undefined)}
          className="max-w-xs"
        >
          {(control) => (
            <PercentInput
              {...control}
              valueBps={slippageBps}
              placeholder={formatBasisPoints(defaultSlippage).replace('%', '')}
              onValueChange={(change) => {
                setSlippageBps(change.bps);
                setSlippageError(
                  change.error ? 'At most two decimals; a limit is exact basis points.' : null,
                );
              }}
            />
          )}
        </Field>
        <p className="text-caption text-text-muted" data-testid="slippage-line">
          Quotes will be taken at {formatBasisPoints(effectiveSlippage)} slippage.
        </p>
      </section>

      <section className="space-y-2" aria-labelledby="readiness-heading">
        <h2 id="readiness-heading" className="text-heading-sm font-semibold">
          Eligibility
        </h2>
        {eligibility.data ? (
          <p className="text-supporting" data-testid="eligibility-line">
            <StatusBadge
              tone={
                eligibility.data.outcome === 'eligible'
                  ? 'success'
                  : eligibility.data.outcome === 'ineligible'
                    ? 'error'
                    : 'attention'
              }
            >
              {eligibility.data.outcome}
            </StatusBadge>{' '}
            <span className="text-text-muted">{eligibility.data.summary}</span>{' '}
            {eligibility.data.outcome !== 'eligible' ? (
              <Link href="/settings/eligibility" className="underline underline-offset-2">
                Resolve eligibility and terms
              </Link>
            ) : null}
          </p>
        ) : eligibility.error ? (
          <p className="text-supporting text-text-muted">
            Eligibility unknown right now; the plan is checked against policy anyway.
          </p>
        ) : (
          <SkeletonText lines={1} />
        )}
      </section>

      {refusal ? (
        <Notice tone="error" title={refusal.title} data-testid="create-refusal">
          <p>{refusal.detail}</p>
          {refusal.items.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {refusal.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={submit}
          loading={create.isPending}
          {...(disabledReason ? { disabledReason } : {})}
          data-testid="create-intent"
        >
          Get quotes and review
        </Button>
        <StatusBadge tone="neutral">Nothing is reserved or bought yet</StatusBadge>
      </div>
    </div>
  );
}
