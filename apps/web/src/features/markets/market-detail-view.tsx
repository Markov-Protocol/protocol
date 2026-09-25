'use client';

import type { CorporateAction, InstrumentDetail, SolanaCluster } from '@markov/contracts';
import { formatInstant, formatRelativeAge, priceKindLabel } from '@markov/formatters';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Notice,
  Skeleton,
  SkeletonText,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@markov/ui';
import Link from 'next/link';
import { type ReactNode, useMemo } from 'react';
import { WebApiError } from '../api/use-markov-api';
import { signInHref } from '../auth/return-path';
import { useSession } from '../auth/session-context';
import { CopyButton } from '../funding/copy-button';
import { AddToBasketButton } from '../research/add-to-basket-button';
import { InstrumentResearchTab } from '../research/instrument-research-tab';
import {
  AvailabilityLine,
  InstrumentIdentity,
  KindLine,
  Monogram,
  PriceLine,
} from './instrument-parts';
import {
  BUILD_WIDE_REASONS,
  clusterOf,
  explorerAddressUrl,
  ISSUER_LABELS,
  networkLabel,
  reasonLabel,
  STATUS_LABELS,
  statusTone,
} from './labels';
import {
  useActionAvailability,
  useCorporateActions,
  useInstrument,
  useMultiplierHistory,
} from './queries';
import { WatchlistButton } from './watchlist-button';

const CONDITION_LABELS: Readonly<Record<string, string>> = {
  stale_reference: 'the reference price is stale',
  underlying_market_closed: 'the underlying market is closed',
  venue_disabled: 'no execution venue is enabled',
  issuer_halted: 'the issuer halted this instrument',
  corporate_action_pending: 'a corporate action is due',
  migration_required: 'a migration to a successor token is required',
  instrument_sunset: 'the instrument is past its sunset date',
  instrument_not_admitted: 'the instrument is not admitted',
  eligibility_unknown: 'your eligibility is unknown (declare where you live)',
  eligibility_denied: 'your eligibility decision denies this',
  terms_not_acknowledged: 'the current terms are not acknowledged',
  execution_disabled: 'execution is disabled in this build',
  multiplier_unknown: 'no multiplier evidence exists yet',
};

function conditionLabel(code: string): string {
  return CONDITION_LABELS[code] ?? code.replace(/_/g, ' ');
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.host : null;
  } catch {
    return null;
  }
}

function ActionRow({
  label,
  allowed,
  reason,
  action,
}: {
  readonly label: string;
  readonly allowed: boolean;
  readonly reason: string;
  readonly action?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-body">{label}</span>
      {allowed ? (
        (action ?? <StatusBadge tone="success">Available</StatusBadge>)
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">Not available</StatusBadge>
          <span className="text-caption text-text-muted">{reason}</span>
        </span>
      )}
    </li>
  );
}

/** What this person can do now: the public availability, refined by B05 capability states when signed in. */
function WhatYouCanDo({
  instrument,
  personal,
  returnTo,
}: {
  readonly instrument: InstrumentDetail;
  readonly personal: ReturnType<typeof useActionAvailability>;
  readonly returnTo: string;
}) {
  const { state } = useSession();
  const signedIn = state.status === 'signed-in';
  const publicReasons = instrument.availability.reasons
    .filter((code) => !BUILD_WIDE_REASONS.has(code))
    .map(reasonLabel);
  const conditions = personal.data?.conditions.map(conditionLabel) ?? [];
  const because = (allowed: boolean, extra: readonly string[]) =>
    allowed
      ? ''
      : [...extra, ...publicReasons, ...conditions].filter(Boolean).join('; ') || 'not permitted';
  const capabilities = personal.data?.capabilities;
  return (
    <section
      className="space-y-3 rounded-panel border border-border/60 bg-surface p-4"
      aria-labelledby="actions-heading"
    >
      <h2 id="actions-heading" className="text-heading-sm font-semibold">
        What you can do now
      </h2>
      <ul className="divide-y divide-border/60">
        <ActionRow
          label="Research"
          allowed={capabilities ? capabilities.researchable : instrument.availability.research}
          reason={because(false, [])}
        />
        <ActionRow
          label="Add to a basket"
          allowed={
            capabilities
              ? capabilities.discoverable && instrument.availability.strategy
              : instrument.availability.strategy
          }
          reason={because(false, [])}
          action={
            signedIn ? (
              <AddToBasketButton instrument={instrument} />
            ) : (
              <StatusBadge tone="success">Available after sign-in</StatusBadge>
            )
          }
        />
        <ActionRow
          label="Buy"
          allowed={signedIn ? (capabilities?.quoteable ?? false) : instrument.availability.trade}
          reason={because(false, signedIn ? [] : ['sign in to review a buy'])}
          action={
            <Button asChild size="sm" data-testid="review-buy">
              <Link href={`/review/new?instrumentId=${instrument.instrumentId}`}>Review a buy</Link>
            </Button>
          }
        />
        <ActionRow
          label="Sell"
          allowed={false}
          reason={because(false, ['selling is not offered in the app yet'])}
        />
        <ActionRow
          label="Redeem with the issuer"
          allowed={false}
          reason="redemption happens with the issuer under its terms, never through Markov"
        />
      </ul>
      {signedIn ? (
        personal.isPending ? (
          <p className="text-caption text-text-muted" aria-busy="true">
            Checking your eligibility and limits…
          </p>
        ) : personal.error ? (
          <p className="text-caption text-text-muted">
            Your personal capability states could not be read; the public availability above still
            applies.
          </p>
        ) : (
          <p className="text-caption text-text-muted">
            Evaluated for you {formatRelativeAge(personal.data.evaluatedAt)}
            {personal.data.policyVersion
              ? ` under policy ${personal.data.policyVersion}`
              : ' with no published policy'}
            .{personal.data.reasons.length > 0 ? ` ${personal.data.reasons.join(' ')}` : ''}
          </p>
        )
      ) : (
        <p className="text-caption text-text-muted">
          <Link href={signInHref(returnTo)} className="underline underline-offset-2">
            Sign in
          </Link>{' '}
          to see what applies to you (eligibility, terms, limits). Switching issuer or restating
          where you live does not change a decision.
        </p>
      )}
    </section>
  );
}

function LifecycleNotices({
  instrument,
  actions,
}: {
  readonly instrument: InstrumentDetail;
  readonly actions: readonly CorporateAction[] | undefined;
}) {
  const { lifecycle } = instrument;
  const notices: {
    readonly key: string;
    readonly tone: 'attention' | 'error' | 'info';
    readonly title: string;
    readonly body: string;
  }[] = [];
  if (lifecycle.halted) {
    notices.push({
      key: 'halted',
      tone: 'error',
      title: 'Halted by the issuer',
      body: lifecycle.haltedReason ?? 'No reason was published.',
    });
  }
  if (lifecycle.migration) {
    notices.push({
      key: 'migration',
      tone: 'attention',
      title: 'Migration required',
      body: `Holders must migrate to product ${lifecycle.migration.targetProductId} before ${formatInstant(lifecycle.migration.deadlineAt)}.${lifecycle.migration.targetInstrumentId ? '' : ' The successor is not in the catalog yet.'}`,
    });
  }
  if (lifecycle.sunsetAt) {
    notices.push({
      key: 'sunset',
      tone: 'attention',
      title: 'Sunset scheduled',
      body: `The issuer sunsets this token at ${formatInstant(lifecycle.sunsetAt)}.`,
    });
  }
  for (const pending of lifecycle.pendingActions) {
    notices.push({
      key: pending.actionId,
      tone: 'info',
      title: `Pending ${pending.type.replace(/_/g, ' ')}`,
      body: `Effective ${formatInstant(pending.effectiveAt)}; balances are restated only after operators apply it with evidence.`,
    });
  }
  if (instrument.status === 'paused') {
    notices.push({
      key: 'paused',
      tone: 'attention',
      title: 'Paused by Markov operators',
      body:
        instrument.statusReason ??
        'Research stays available; strategy building and trading do not.',
    });
  }
  if (notices.length === 0 && (actions?.length ?? 0) === 0) {
    return null;
  }
  return (
    <section className="space-y-3" aria-labelledby="lifecycle-heading">
      <h2 id="lifecycle-heading" className="text-heading-sm font-semibold">
        Lifecycle notices
      </h2>
      {notices.map((notice) => (
        <Notice key={notice.key} tone={notice.tone} title={notice.title}>
          {notice.body}
        </Notice>
      ))}
      {actions && actions.length > 0 ? (
        <ul className="space-y-2" aria-label="Corporate actions">
          {actions.map((action) => (
            <li
              key={action.actionId}
              className="rounded-panel border border-border/60 p-3 text-supporting"
            >
              <p className="font-medium">
                {action.type.replace(/_/g, ' ')}{' '}
                <StatusBadge
                  tone={
                    action.status === 'applied'
                      ? 'success'
                      : action.status === 'pending'
                        ? 'pending'
                        : 'neutral'
                  }
                >
                  {action.status}
                </StatusBadge>
              </p>
              <p className="text-text-muted">
                Announced {formatInstant(action.announcedAt)} · effective{' '}
                {formatInstant(action.effectiveAt)}
                {action.appliedAt ? ` · applied ${formatInstant(action.appliedAt)}` : ''}
              </p>
              <p>{action.summary}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function OverviewTab({
  instrument,
  actions,
  personal,
  returnTo,
}: {
  readonly instrument: InstrumentDetail;
  readonly actions: readonly CorporateAction[] | undefined;
  readonly personal: ReturnType<typeof useActionAvailability>;
  readonly returnTo: string;
}) {
  const website = instrument.metadata.website ? hostOf(instrument.metadata.website) : null;
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-heading-sm font-semibold">
          About this exposure
        </h2>
        {instrument.metadata.description ? (
          <p className="text-body" data-testid="issuer-description">
            {instrument.metadata.description}
          </p>
        ) : (
          <p className="text-supporting text-text-muted">The issuer published no description.</p>
        )}
        <p className="text-caption text-text-muted">
          Source: the {ISSUER_LABELS[instrument.issuer]} feed as sanitised by Markov (plain text
          only), catalog updated {formatInstant(instrument.updatedAt)}.
          {website && instrument.metadata.website ? (
            <>
              {' '}
              Issuer page:{' '}
              <a
                href={instrument.metadata.website}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {website}
              </a>
              .
            </>
          ) : null}
        </p>
        <Notice tone="info" title="What this token is">
          {instrument.kind === 'listed_stock'
            ? `${instrument.symbol} is ${ISSUER_LABELS[instrument.issuer]}'s tokenised exposure to ${instrument.companyName}${instrument.underlying.ticker ? ` (${instrument.underlying.ticker})` : ''}. It is not the share itself, and naming a company implies no relationship between Markov and that company.`
            : `${instrument.symbol} is ${ISSUER_LABELS[instrument.issuer]}'s pre-IPO exposure to ${instrument.companyName}. It is not equity in that company, carries the rights the issuer's terms grant and no others, and naming a company implies no relationship between Markov and that company.`}
        </Notice>
      </section>

      <section className="space-y-2" aria-labelledby="rights-heading" data-testid="rights-evidence">
        <h2 id="rights-heading" className="text-heading-sm font-semibold">
          Rights and evidence
        </h2>
        <p className="text-supporting">
          {instrument.kind === 'listed_stock'
            ? 'A listed-stock token tracks the issuer\u2019s exposure to the share; whether it carries dividends, voting or redemption rights is set by the issuer\u2019s terms, which the catalog does not carry.'
            : 'A pre-IPO exposure carries no shareholder rights of its own; what it does carry (backing, fees, redemption) is set by the issuer\u2019s terms, which the catalog does not carry.'}{' '}
          Evidence lives in source records: attach the issuer&apos;s terms, a legal document or a
          filing to a thesis (Research tab) and cite it; a claim about backing, rights, fees or
          redemption without such a source is refused.
          {website && instrument.metadata.website
            ? ' The issuer page linked above is the place to start.'
            : ''}
        </p>
      </section>

      <section className="space-y-2" aria-labelledby="price-heading">
        <h2 id="price-heading" className="text-heading-sm font-semibold">
          Reference price
        </h2>
        <p className="text-body">
          <PriceLine price={instrument.referencePrice} />
        </p>
        {instrument.referencePrice ? (
          <p className="text-caption text-text-muted">
            {priceKindLabel(instrument.referencePrice.kind)} from {instrument.referencePrice.source}
            , observed {formatInstant(instrument.referencePrice.observedAt)}. A reference price is
            not an executable quote and not the company&apos;s share price.
          </p>
        ) : (
          <p className="text-caption text-text-muted">
            The issuer feed carried no reference price for this instrument.
          </p>
        )}
        <div
          className="rounded-panel border border-dashed border-border/60 p-4 text-center text-supporting text-text-muted"
          data-testid="price-history"
        >
          History unavailable: no price series is stored yet, so no chart is drawn.
        </div>
      </section>

      <WhatYouCanDo instrument={instrument} personal={personal} returnTo={returnTo} />
      <LifecycleNotices instrument={instrument} actions={actions} />
    </div>
  );
}

function InstrumentTab({
  instrument,
  cluster,
}: {
  readonly instrument: InstrumentDetail;
  readonly cluster: SolanaCluster | null | undefined;
}) {
  const verification = instrument.latestMintVerification;
  const explorer = explorerAddressUrl(instrument.mint, cluster);
  const multipliers = useMultiplierHistory(
    instrument.instrumentId,
    instrument.kind === 'listed_stock',
  );
  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-labelledby="token-heading">
        <h2 id="token-heading" className="text-heading-sm font-semibold">
          Token identity
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-text-muted">Mint</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono" data-testid="mint-address">
              {instrument.mint}
            </code>
            <CopyButton value={instrument.mint} label="Copy the mint address" />
            {explorer ? (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                View on Solana Explorer
              </a>
            ) : null}
          </dd>
          <dt className="text-text-muted">Network</dt>
          <dd>
            {networkLabel(cluster)} · genesis{' '}
            <code className="break-all font-mono">{instrument.genesisHash}</code>
          </dd>
          <dt className="text-text-muted">Token program</dt>
          <dd>{instrument.tokenProgram}</dd>
          <dt className="text-text-muted">Decimals</dt>
          <dd>{instrument.decimals}</dd>
          <dt className="text-text-muted">Issuer product id</dt>
          <dd className="font-mono">{instrument.issuerProductId}</dd>
          <dt className="text-text-muted">Markov instrument id</dt>
          <dd className="font-mono break-all">{instrument.instrumentId}</dd>
          <dt className="text-text-muted">Status</dt>
          <dd>
            <StatusBadge tone={statusTone(instrument.status)}>
              {STATUS_LABELS[instrument.status]}
            </StatusBadge>
            {instrument.admittedAt ? ` admitted ${formatInstant(instrument.admittedAt)}` : ''}
            {instrument.statusReason ? ` · ${instrument.statusReason}` : ''}
          </dd>
        </dl>
      </section>

      <section className="space-y-2" aria-labelledby="verification-heading">
        <h2 id="verification-heading" className="text-heading-sm font-semibold">
          On-chain verification
        </h2>
        {verification ? (
          <dl className="grid gap-x-6 gap-y-2 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-text-muted">Result</dt>
            <dd>
              <StatusBadge tone={verification.result === 'verified' ? 'success' : 'error'}>
                {verification.result}
              </StatusBadge>{' '}
              at {formatInstant(verification.verifiedAt)} via {verification.rpcHost}
              {verification.slot !== null ? ` (slot ${verification.slot})` : ''}
            </dd>
            {verification.onChain ? (
              <>
                <dt className="text-text-muted">Supply</dt>
                <dd className="font-mono">{verification.onChain.supply} base units</dd>
                <dt className="text-text-muted">Authorities</dt>
                <dd>
                  mint {verification.onChain.mintAuthority ?? 'none'} · freeze{' '}
                  {verification.onChain.freezeAuthority ?? 'none'}
                </dd>
                <dt className="text-text-muted">Extensions</dt>
                <dd>
                  {verification.onChain.extensions.length > 0
                    ? verification.onChain.extensions.join(', ')
                    : 'none'}
                </dd>
              </>
            ) : null}
            {verification.compatibility ? (
              <>
                <dt className="text-text-muted">Extension policy</dt>
                <dd>
                  <StatusBadge
                    tone={
                      verification.compatibility.compatibility === 'supported'
                        ? 'success'
                        : verification.compatibility.compatibility === 'review_required'
                          ? 'attention'
                          : 'error'
                    }
                  >
                    {verification.compatibility.compatibility.replace('_', ' ')}
                  </StatusBadge>
                </dd>
              </>
            ) : null}
            {verification.mismatches.length > 0 ? (
              <>
                <dt className="text-text-muted">Mismatches</dt>
                <dd>{verification.mismatches.join('; ')}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-supporting text-text-muted">No verification recorded.</p>
        )}
      </section>

      {instrument.kind === 'listed_stock' ? (
        <section className="space-y-2" aria-labelledby="multiplier-heading">
          <h2 id="multiplier-heading" className="text-heading-sm font-semibold">
            Quantity multiplier
          </h2>
          <p className="text-supporting">
            {instrument.lifecycle.currentMultiplier === null
              ? 'No multiplier evidence yet: quantities cannot be shown in scaled units until operators record one.'
              : `Current multiplier ${instrument.lifecycle.currentMultiplier}${instrument.lifecycle.multiplierEffectiveAt ? ` since ${formatInstant(instrument.lifecycle.multiplierEffectiveAt)}` : ''}. Raw base units are the stored quantity; scaled amounts are derived and rounded explicitly.`}
          </p>
          {multipliers.data && multipliers.data.multipliers.length > 0 ? (
            <ul className="space-y-1 text-caption text-text-muted" aria-label="Multiplier history">
              {multipliers.data.multipliers.map((row) => (
                <li key={row.multiplierId}>
                  {row.multiplier} from {formatInstant(row.effectiveAt)} ·{' '}
                  {row.source.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Liquidity: every field the tab will carry, each shown as not observed rather than invented. */
function RouteObservations({ symbol }: { readonly symbol: string }) {
  const fields: readonly { readonly key: string; readonly label: string }[] = [
    { key: 'venue', label: 'Execution venue' },
    { key: 'route', label: 'Route (hops and programs)' },
    { key: 'depth', label: 'Depth at the reference price' },
    { key: 'spread', label: 'Observed spread' },
    { key: 'observedAt', label: 'Observed at' },
  ];
  return (
    <section
      className="space-y-3"
      aria-labelledby="liquidity-heading"
      data-testid="route-observations"
    >
      <h2 id="liquidity-heading" className="text-heading-sm font-semibold">
        Route observations
      </h2>
      <Notice tone="info" title="Route information unavailable">
        No pool or route has been observed for {symbol}. Markov does not observe pools yet; the
        route conditions for an actual budget (quote, minimum output, price impact) appear in a
        review, never here as a guess.
      </Notice>
      <dl className="grid gap-x-6 gap-y-2 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]">
        {fields.map((field) => (
          <div key={field.key} className="contents">
            <dt className="text-text-muted">{field.label}</dt>
            <dd>Not observed</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function MarketDetailView({ instrumentId }: { readonly instrumentId: string }) {
  const { state, platform } = useSession();
  const signedIn = state.status === 'signed-in';
  const instrument = useInstrument(instrumentId);
  const actions = useCorporateActions(instrumentId);
  const personal = useActionAvailability(instrumentId, signedIn);
  const returnTo = `/markets/${instrumentId}`;
  const now = useMemo(
    () => new Date(instrument.dataUpdatedAt || Date.now()),
    [instrument.dataUpdatedAt],
  );

  if (instrument.isPending) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading instrument"
        className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6"
      >
        <Skeleton className="h-8 w-2/3" />
        <SkeletonText lines={4} />
      </section>
    );
  }
  if (instrument.error) {
    const notFound = instrument.error instanceof WebApiError && instrument.error.status === 404;
    return (
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {notFound ? (
          <EmptyState
            title="No admitted instrument with that id"
            description="Only admitted or paused instruments have a public page. The id may be wrong, or the instrument was delisted."
            action={
              <Button asChild variant="secondary">
                <Link href="/explore">Back to Explore</Link>
              </Button>
            }
          />
        ) : (
          <ErrorBlock
            title="The instrument could not be read"
            message={
              instrument.error instanceof WebApiError
                ? instrument.error.message
                : 'Try again in a moment.'
            }
            onRetry={() => void instrument.refetch()}
          />
        )}
      </section>
    );
  }
  const detail = instrument.data;
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <p className="text-caption">
          <Link href="/explore" className="underline underline-offset-2">
            Explore
          </Link>{' '}
          <span className="text-text-muted">/ {detail.symbol}</span>
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <Monogram symbol={detail.symbol} className="size-12" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="text-heading-lg font-semibold leading-tight">
              {detail.name}{' '}
              <span className="font-mono text-heading-sm text-text-muted">{detail.symbol}</span>
            </h1>
            <InstrumentIdentity instrument={detail} cluster={clusterOf(platform)} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <KindLine instrument={detail} />
              <AvailabilityLine instrument={detail} />
            </div>
          </div>
          <WatchlistButton instrument={detail} returnTo={returnTo} size="md" />
        </div>
      </header>
      <Tabs defaultValue="overview">
        <TabsList aria-label="Instrument sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
          <TabsTrigger value="instrument">Instrument</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab
            instrument={detail}
            actions={actions.data}
            personal={personal}
            returnTo={returnTo}
          />
        </TabsContent>
        <TabsContent value="research">
          <InstrumentResearchTab instrument={detail} returnTo={returnTo} />
        </TabsContent>
        <TabsContent value="liquidity">
          <RouteObservations symbol={detail.symbol} />
        </TabsContent>
        <TabsContent value="instrument">
          <InstrumentTab instrument={detail} cluster={clusterOf(platform)} />
        </TabsContent>
      </Tabs>
      <p className="text-caption text-text-muted">
        Loaded {formatRelativeAge(now.toISOString(), now)}.
      </p>
    </section>
  );
}
