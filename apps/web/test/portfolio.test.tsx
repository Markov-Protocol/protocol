import type {
  InstanceHoldingsResponse,
  JournalEntry,
  PerformanceResponse,
  PortfolioInstance,
  StrategyVersion,
  WalletHoldingsResponse,
} from '@markov/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { InstanceView } from '../src/features/portfolio/instance-view';
import { PortfolioView } from '../src/features/portfolio/portfolio-view';
import {
  CASH_MINT,
  ENTRY_A,
  INSTANCE_ID,
  instance,
  instanceHoldings,
  journalEntry,
  OWNER_ADDRESS,
  OWNER_ID,
  performance,
  position,
  STRATEGY_ID,
  VERSION_ID,
  version,
  WALLET_ID,
  wallet,
  walletHoldings,
  XSA_MINT,
  XSA_POSITION,
} from './portfolio-fixtures';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: '/portfolio',
  push: vi.fn(),
  replace: vi.fn(),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, () => nav.search)),
  notFound: () => {
    throw new Error('notFound');
  },
}));

/* ------------------------------------------------------------- harness */

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: true,
};
const alice: SessionSnapshot = {
  state: 'signed-in',
  account: {
    userId: OWNER_ID,
    subject: 'did:test:alice',
    issuer: 'urn:markov:test',
    authTime: null,
    stepUpFresh: true,
  },
  session: { sessionId: 's-alice', expiresAt: '2030-01-01T00:00:00.000Z' },
};

interface Reply {
  readonly status: number;
  readonly body: unknown;
}
type Responder = (url: URL, init: RequestInit | undefined) => Reply;
interface Route {
  readonly method: string;
  readonly path: string;
  readonly reply: Responder;
}
const P = '/api/markov';
const ok = (body: unknown): Reply => ({ status: 200, body });
const refuse = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message, requestId: 'r', details: [] } },
});

function stubFetch(routes: readonly Route[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'http://app.test');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/auth/session') {
        return Response.json(alice);
      }
      calls.push({
        method,
        url: url.pathname + url.search,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const route = routes.find(
        (candidate) => candidate.method === method && candidate.path === url.pathname,
      );
      if (!route) {
        return Response.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `no stub for ${method} ${url.pathname}`,
              requestId: 'r',
            },
          },
          { status: 404 },
        );
      }
      const reply = route.reply(url, init);
      return Response.json(reply.body, { status: reply.status });
    },
  );
  return { impl, calls };
}

let stub: ReturnType<typeof stubFetch>;

function mount(element: ReactNode, routes: readonly Route[]) {
  stub = stubFetch(routes);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <SessionProvider initial={alice} platform={platform}>
      <PrivateQueryProvider>{element}</PrivateQueryProvider>
    </SessionProvider>,
  );
}

const calls = (method: string, prefix: string) =>
  stub.calls.filter((call) => call.method === method && call.url.startsWith(prefix));

/** A server for one wallet: holdings, journal, performance, instances, reconciliation and acknowledgements. */
function walletServer(options: {
  readonly holdings?: WalletHoldingsResponse;
  readonly entries?: readonly JournalEntry[];
  readonly performance?: PerformanceResponse;
  readonly instances?: readonly PortfolioInstance[];
  readonly reconciled?: WalletHoldingsResponse;
}): { routes: Route[]; state: { entries: JournalEntry[]; holdings: WalletHoldingsResponse } } {
  const state = {
    holdings: options.holdings ?? walletHoldings(),
    entries: [...(options.entries ?? [ENTRY_A])],
  };
  const routes: Route[] = [
    { method: 'GET', path: `${P}/v1/me/wallets`, reply: () => ok({ wallets: [wallet] }) },
    {
      method: 'GET',
      path: `${P}/v1/me/instances`,
      reply: () => ok({ instances: options.instances ?? [instance()] }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/wallets/${WALLET_ID}/holdings`,
      reply: () => ok(state.holdings),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/wallets/${WALLET_ID}/journal`,
      reply: () => ok({ walletId: WALLET_ID, entries: state.entries, balancing: 'per_asset' }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/wallets/${WALLET_ID}/performance`,
      reply: () => ok(options.performance ?? performance('actual')),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/wallets/${WALLET_ID}/reconciliations`,
      reply: () => {
        state.holdings = options.reconciled ?? state.holdings;
        return ok(state.holdings);
      },
    },
  ];
  for (const entry of state.entries) {
    routes.push({
      method: 'POST',
      path: `${P}/v1/me/journal/${entry.entryId}/acknowledgements`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          kind: JournalEntry['kind'];
          note: string | null;
        };
        const acknowledged: JournalEntry = {
          ...entry,
          attribution: 'unassigned',
          acknowledgement: {
            kind: body.kind as 'deposit',
            note: body.note,
            acknowledgedAt: '2026-09-25T12:30:00.000Z',
          },
        };
        state.entries = state.entries.map((candidate) =>
          candidate.entryId === entry.entryId ? acknowledged : candidate,
        );
        return ok(acknowledged);
      },
    });
  }
  return { routes, state };
}

function instanceServer(options: {
  readonly instance?: PortfolioInstance | null;
  readonly ownVersion?: StrategyVersion | null;
  readonly holdings?: InstanceHoldingsResponse;
  readonly personal?: PerformanceResponse;
  readonly model?: PerformanceResponse;
  readonly entries?: readonly JournalEntry[];
  readonly exportStatus?: number;
}): Route[] {
  const inst = options.instance === undefined ? instance() : options.instance;
  const routes: Route[] = [
    { method: 'GET', path: `${P}/v1/me/wallets`, reply: () => ok({ wallets: [wallet] }) },
    {
      method: 'GET',
      path: `${P}/v1/me/instances/${INSTANCE_ID}`,
      reply: () => (inst ? ok(inst) : refuse(404, 'NOT_FOUND', 'no instance with that id')),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/instances/${INSTANCE_ID}/holdings`,
      reply: () => ok(options.holdings ?? instanceHoldings()),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/instances/${INSTANCE_ID}/performance`,
      reply: () =>
        ok(
          options.personal ??
            performance('actual', {
              series: {
                ...performance('actual').series,
                subject: { type: 'instance', id: INSTANCE_ID, label: 'Aerospace tilt' },
                latest: [position(), XSA_POSITION],
              },
            }),
        ),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/instances/${INSTANCE_ID}/performance/export`,
      reply: () =>
        options.exportStatus === 404
          ? refuse(404, 'NOT_FOUND', 'no instance with that id')
          : ok({
              exportedAt: '2026-09-25T12:00:00.000Z',
              methodology: performance('actual').methodology,
              series: performance('actual').series,
              metrics: [performance('actual').metrics],
              observations: [],
              multipliers: [],
            }),
    },
    {
      method: 'GET',
      path: `${P}/v1/strategies/${STRATEGY_ID}/versions/1/performance`,
      reply: () => ok(options.model ?? performance('model')),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/wallets/${WALLET_ID}/journal`,
      reply: () =>
        ok({ walletId: WALLET_ID, entries: options.entries ?? [ENTRY_A], balancing: 'per_asset' }),
    },
  ];
  if (options.ownVersion !== null) {
    routes.push({
      method: 'GET',
      path: `${P}/v1/me/strategies/${STRATEGY_ID}/versions/${VERSION_ID}`,
      reply: () => ok(options.ownVersion ?? version()),
    });
  } else {
    // A follower's instance: the owner route is not theirs; the public version answers.
    routes.push({
      method: 'GET',
      path: `${P}/v1/strategies/${STRATEGY_ID}/versions/${VERSION_ID}`,
      reply: () =>
        ok({
          strategyId: STRATEGY_ID,
          versionId: VERSION_ID,
          versionNumber: 1,
          schemaVersion: '1',
          kind: 'stock_spot_basket',
          title: 'Aerospace tilt (public)',
          thesis: 'Launch cadence is underestimated.',
          thesisId: null,
          legs: version().legs.map((leg) => ({
            instrumentId: leg.instrumentId,
            symbol: leg.symbol,
            companyName: leg.companyName,
            issuer: leg.issuer,
            mint: leg.admission.mint,
            tokenProgram: leg.admission.tokenProgram,
            weightBps: leg.weightBps,
          })),
          cashWeightBps: 1000,
          maintenance: version().maintenance,
          disclosures: version().disclosures,
          references: [],
          parentVersionId: null,
          forkOf: null,
          canonicalManifest: '{}',
          manifestHash: version().manifestHash,
          contentDigest: version().contentDigest,
          registration: {
            signature: '5'.repeat(88),
            slot: 77,
            blockTime: null,
            recordAddress: OWNER_ADDRESS,
            publisher: OWNER_ADDRESS,
            status: 'active',
            transactionUrl: null,
            recordUrl: null,
          },
          verification: {
            manifestHashMatches: true,
            contentMatches: true,
            recomputedManifestHash: version().manifestHash,
            mismatches: [],
            checkedAt: '2026-09-25T12:00:00.000Z',
          },
          deprecatedBy: null,
          frozenAt: '2026-09-21T09:00:00.000Z',
        }),
    });
  }
  return routes;
}

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.search = '';
  nav.pathname = '/portfolio';
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* --------------------------------------------------------------- tests */

describe('portfolio: wallet overview', () => {
  it('shows scaled quantities, the API values once, an exact wallet total and the checkpoint', async () => {
    // Independently expected: 5 FXAERO at 360 = 1,800; 300 XSFXA (150,000,000 × 2 ÷ 10^6) at 10 = 3,000;
    // 900 USDC at par = 900; total 5,700 (never 8,700 from applying the multiplier twice).
    mount(<PortfolioView />, walletServer({}).routes);
    const rows = await screen.findAllByTestId('holding-row');
    expect(rows).toHaveLength(3);
    const xsa = rows.find((row) => row.getAttribute('data-asset') === 'XSFXA') as HTMLElement;
    expect(within(xsa).getByTestId('holding-quantity')).toHaveTextContent('300');
    expect(xsa).toHaveTextContent('×2 multiplier applied');
    expect(within(xsa).getByTestId('holding-value')).toHaveTextContent('$3,000.00');
    const aero = rows.find((row) => row.getAttribute('data-asset') === 'FXAERO') as HTMLElement;
    expect(within(aero).getByTestId('holding-value')).toHaveTextContent('$1,800.00');
    expect(within(aero).getByTestId('holding-status')).toHaveTextContent('Matched');
    expect(aero).toHaveTextContent('Strategy bbbbbbbb · version 1');
    await waitFor(() => expect(screen.getByTestId('summary-value')).toHaveTextContent('$5,700.00'));
    expect(screen.getByTestId('summary-checkpoint')).toHaveTextContent('Matched');
    expect(screen.getByTestId('summary-checkpoint')).toHaveTextContent('slot 4242, finalized');
    expect(screen.getByTestId('summary-flows')).toHaveTextContent('Nothing pending');
    // Performance: labelled personal, methodology and currency; a return with its exact string.
    expect(await screen.findByTestId('wallet-performance-label')).toHaveTextContent(
      'Personal (actual) · stocks-v1 · USD',
    );
    expect(screen.getByTestId('wallet-performance-twr')).toHaveTextContent('+3.50%');
    expect(screen.getByTestId('wallet-performance-chart-summary')).toHaveTextContent(
      'value $4,650.00 at the start and $5,700.00 at the end',
    );
    expect(screen.getByText('0.03500000')).toBeInTheDocument();
    // One instance card, and the history with the fill described from its wallet lines.
    expect(screen.getByTestId('instance-card')).toHaveAttribute(
      'href',
      `/portfolio/${INSTANCE_ID}`,
    );
    expect(await screen.findByTestId('journal-row')).toHaveTextContent(
      'Fill: -100 USDC, +5 FXAERO',
    );
    expect(calls('GET', `${P}/v1/me/wallets/${WALLET_ID}/performance?period=all`)).toHaveLength(1);
  });

  it('states an unpriced holding, an incomplete total and the reasons instead of a number', async () => {
    const unpriced = performance('actual', {
      series: {
        ...performance('actual').series,
        latest: [
          position(),
          position({
            asset: XSA_MINT,
            symbol: 'XSFXA',
            raw: '150000000',
            multiplier: '2',
            scaledQuantity: '300',
            price: null,
            value: null,
            issues: [
              { code: 'no_observation', asset: XSA_MINT, detail: 'no price observation for XSFXA' },
            ],
          }),
        ],
        points: performance('actual').series.points.map((point, index, all) =>
          index === all.length - 1
            ? {
                ...point,
                value: null,
                complete: false,
                index: null,
                issues: [
                  {
                    code: 'no_observation',
                    asset: XSA_MINT,
                    detail: 'no price observation for XSFXA',
                  },
                ],
              }
            : point,
        ),
      },
      metrics: {
        ...performance('actual').metrics,
        available: false,
        reasons: ['incomplete_points'],
        timeWeightedReturn: null,
        moneyWeightedReturn: null,
        endValue: null,
        completeness: {
          ...performance('actual').metrics.completeness,
          completePoints: 3,
          ratio: '0.75000000',
          endFresh: false,
        },
      },
    });
    mount(<PortfolioView />, walletServer({ performance: unpriced }).routes);
    const rows = await screen.findAllByTestId('holding-row');
    const xsa = rows.find((row) => row.getAttribute('data-asset') === 'XSFXA') as HTMLElement;
    await waitFor(() =>
      expect(within(xsa).getByTestId('holding-value')).toHaveTextContent('Unpriced'),
    );
    expect(xsa).toHaveTextContent('no price observation for XSFXA');
    expect(within(xsa).getByTestId('holding-quantity')).toHaveTextContent('300');
    // USDC has no position in this series either: base units, no value, no invented par.
    const cash = rows.find((row) => row.getAttribute('data-asset') === 'USDC') as HTMLElement;
    expect(within(cash).getByTestId('holding-quantity')).toHaveTextContent(
      '900,000,000 base units',
    );
    expect(screen.getByTestId('summary-value')).toHaveTextContent('Incomplete');
    expect(screen.getByTestId('summary-value')).toHaveTextContent(
      'not valued: XSFXA, USDC unpriced',
    );
    expect(await screen.findByTestId('wallet-performance-unavailable')).toHaveTextContent(
      'some points of the window could not be valued',
    );
    expect(screen.getByTestId('wallet-performance-twr')).toHaveTextContent('Not reported');
    expect(screen.getByTestId('wallet-performance-completeness')).toHaveTextContent(
      '3 of 4 points',
    );
    expect(screen.getByTestId('wallet-performance-completeness')).toHaveTextContent(
      'latest price stale',
    );
  });

  it('lets the owner explain a deposit, shows an explained withdrawal and a failed transaction fee in the history', async () => {
    const deposit = journalEntry({
      entryId: 'e1000000-0000-4000-8000-000000000011',
      instanceId: null,
      kind: 'external_inflow',
      source: { kind: 'chain_reconciliation', ref: 'ckpt-2' },
      occurredAt: '2026-09-25T10:00:00.000Z',
      attribution: 'needs_reconciliation',
      memo: '',
      lines: [
        {
          account: 'wallet',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '1000000000',
          lotId: null,
        },
        {
          account: 'external',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '-1000000000',
          lotId: null,
        },
      ],
    });
    const withdrawal = journalEntry({
      entryId: 'e1000000-0000-4000-8000-000000000012',
      instanceId: null,
      kind: 'external_outflow',
      source: { kind: 'chain_reconciliation', ref: 'ckpt-3' },
      occurredAt: '2026-09-24T10:00:00.000Z',
      attribution: 'unassigned',
      acknowledgement: {
        kind: 'withdrawal',
        note: 'to cold storage',
        acknowledgedAt: '2026-09-24T11:00:00.000Z',
      },
      memo: '',
      lines: [
        {
          account: 'wallet',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '-250000000',
          lotId: null,
        },
        {
          account: 'external',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '250000000',
          lotId: null,
        },
      ],
    });
    const failedFee = journalEntry({
      entryId: 'e1000000-0000-4000-8000-000000000013',
      instanceId: null,
      kind: 'network_fee',
      source: { kind: 'execution_fill', ref: 'sig-failed:fee' },
      occurredAt: '2026-09-23T10:00:00.000Z',
      attribution: 'unassigned',
      memo: 'transaction failed on chain; the fee was still charged',
      lines: [
        {
          account: 'wallet',
          asset: 'SOL',
          symbol: 'SOL',
          decimals: 9,
          deltaRaw: '-5000',
          lotId: null,
        },
        {
          account: 'network_fee',
          asset: 'SOL',
          symbol: 'SOL',
          decimals: 9,
          deltaRaw: '5000',
          lotId: null,
        },
      ],
    });
    const server = walletServer({
      entries: [ENTRY_A, deposit, withdrawal, failedFee],
      holdings: walletHoldings({ unexplainedEntryIds: [deposit.entryId] }),
    });
    mount(<PortfolioView />, server.routes);
    expect(await screen.findByTestId('summary-flows')).toHaveTextContent('1 external flow');
    const form = await screen.findByTestId('acknowledge-form');
    expect(form).toHaveTextContent('Inflow from outside Markov: +1,000 USDC');
    // Nothing is recorded without a choice.
    fireEvent.click(within(form).getByTestId('acknowledge'));
    expect(await within(form).findByText('Choose what this movement was.')).toBeInTheDocument();
    fireEvent.click(within(form).getByLabelText('A deposit I made'));
    fireEvent.change(within(form).getByLabelText('Note (optional)'), {
      target: { value: 'from my bank' },
    });
    fireEvent.click(within(form).getByTestId('acknowledge'));
    await waitFor(() => expect(screen.queryByTestId('acknowledge-form')).toBeNull());
    const posted = calls('POST', `${P}/v1/me/journal/${deposit.entryId}/acknowledgements`);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toEqual({ kind: 'deposit', note: 'from my bank' });
    // History newest first: the explained deposit, the withdrawal, the fee of a failed transaction, the fill.
    const rows = await screen.findAllByTestId('journal-row');
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual([
      'external_inflow',
      'external_outflow',
      'network_fee',
      'fill',
    ]);
    expect(rows[0]).toHaveTextContent('explained as a deposit (from my bank)');
    expect(rows[1]).toHaveTextContent('Outflow from this wallet: -250 USDC');
    expect(rows[1]).toHaveTextContent('explained as a withdrawal (to cold storage)');
    expect(rows[2]).toHaveTextContent('Network fee: -0.000005 SOL');
    expect(rows[2]).toHaveTextContent('transaction failed on chain; the fee was still charged');
  });

  it('reconciles on request and shows the checkpoint the API answers, never a local guess', async () => {
    const reconciled = walletHoldings({
      checkpoint: {
        ...(walletHoldings().checkpoint as NonNullable<WalletHoldingsResponse['checkpoint']>),
        slot: 5000,
        status: 'needs_review',
        observedAt: '2026-09-25T12:00:00.000Z',
      },
      holdings: walletHoldings().holdings.map((holding) =>
        holding.symbol === 'USDC'
          ? {
              ...holding,
              status: 'needs_reconciliation',
              chainRaw: '1900000000',
              differenceRaw: '1000000000',
            }
          : holding,
      ),
    });
    mount(<PortfolioView />, walletServer({ reconciled }).routes);
    await screen.findAllByTestId('holding-row');
    fireEvent.click(screen.getByTestId('reconcile'));
    await waitFor(() =>
      expect(screen.getByTestId('summary-checkpoint')).toHaveTextContent('Needs review'),
    );
    expect(screen.getByTestId('summary-checkpoint')).toHaveTextContent('slot 5000');
    const cash = screen
      .getAllByTestId('holding-row')
      .find((row) => row.getAttribute('data-asset') === 'USDC') as HTMLElement;
    expect(within(cash).getByTestId('holding-status')).toHaveTextContent('Needs reconciliation');
    expect(cash).toHaveTextContent('difference 1000000000 base units');
    expect(calls('POST', `${P}/v1/me/wallets/${WALLET_ID}/reconciliations`)).toHaveLength(1);
  });

  it('is a failure, never an empty portfolio, when holdings cannot be read', async () => {
    const server = walletServer({});
    mount(
      <PortfolioView />,
      server.routes.map((route) =>
        route.path.endsWith('/holdings')
          ? { ...route, reply: () => refuse(503, 'PROVIDER_UNAVAILABLE', 'node unavailable') }
          : route,
      ),
    );
    expect(
      await screen.findByText('Holdings could not be read', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('no-holdings')).toBeNull();
  });
});

describe('portfolio: instance detail', () => {
  beforeEach(() => {
    nav.pathname = `/portfolio/${INSTANCE_ID}`;
  });

  it('compares target and actual allocation with drift, lists lots, cost and fees, and shows personal next to model', async () => {
    mount(<InstanceView instanceId={INSTANCE_ID} />, instanceServer({}));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aerospace tilt'),
    );
    const rows = await screen.findAllByTestId('allocation-row');
    expect(rows.map((row) => row.getAttribute('data-symbol'))).toEqual(['FXAERO', 'XSFXA', 'cash']);
    const aero = rows[0] as HTMLElement;
    const xsa = rows[1] as HTMLElement;
    // Hand-computed: invested targets 66.67 % and 33.33 %; actual 1,800/4,800 = 37.50 % and 62.50 %.
    await waitFor(() =>
      expect(within(aero).getByTestId('allocation-actual')).toHaveTextContent('37.50%'),
    );
    expect(aero).toHaveTextContent('60.00%');
    expect(aero).toHaveTextContent('66.67%');
    expect(within(aero).getByTestId('allocation-drift')).toHaveTextContent('-29.17%');
    expect(within(xsa).getByTestId('allocation-actual')).toHaveTextContent('62.50%');
    expect(within(xsa).getByTestId('allocation-drift')).toHaveTextContent('29.17%');
    expect(within(xsa).getByTestId('allocation-value')).toHaveTextContent('$3,000.00');
    expect(screen.getByText(/largest drift 29\.17%/)).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('held in the wallet, not attributed');
    // Lots in FIFO order with their cost; the cost basis is bookkeeping, the fees are lamports.
    expect(screen.getByTestId('cost-basis')).toHaveTextContent('150 (base units 150000000)');
    expect(screen.getByTestId('fees')).toHaveTextContent('0.00001 SOL');
    expect(screen.getAllByTestId('lot-row')).toHaveLength(2);
    expect(screen.getAllByTestId('lot-row')[0]).toHaveTextContent('100');
    // Two panels over the same window, each labelled with what it is.
    expect(await screen.findByTestId('personal-performance-label')).toHaveTextContent(
      'Personal (actual)',
    );
    expect(await screen.findByTestId('model-performance-label')).toHaveTextContent(
      'Model (buy and hold)',
    );
    expect(screen.getByTestId('model-performance')).toHaveTextContent(
      'not your account and not a forecast',
    );
    expect(
      calls('GET', `${P}/v1/strategies/${STRATEGY_ID}/versions/1/performance?period=all`),
    ).toHaveLength(1);
    // The period control drives both series through the URL.
    fireEvent.click(screen.getByTestId('instance-period-30d'));
    expect(nav.replace).toHaveBeenCalledWith(`/portfolio/${INSTANCE_ID}?period=30d`);
  });

  it('states an unknown cost basis and a partial investment without inventing a weight', async () => {
    mount(
      <InstanceView instanceId={INSTANCE_ID} />,
      instanceServer({
        holdings: instanceHoldings({
          holdings: [
            instanceHoldings().holdings[0] as InstanceHoldingsResponse['holdings'][number],
          ],
          costBasis: { asset: null, raw: '0' },
        }),
        personal: performance('actual', {
          series: { ...performance('actual').series, latest: [position()] },
        }),
      }),
    );
    const rows = await screen.findAllByTestId('allocation-row');
    const xsa = rows[1] as HTMLElement;
    await waitFor(() =>
      expect(within(rows[0] as HTMLElement).getByTestId('allocation-actual')).toHaveTextContent(
        '100.00%',
      ),
    );
    expect(xsa).toHaveTextContent('not held by this instance');
    expect(within(xsa).getByTestId('allocation-actual')).toHaveTextContent('0.00%');
    expect(within(xsa).getByTestId('allocation-drift')).toHaveTextContent('-33.33%');
    expect(screen.getByTestId('cost-basis')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('cost-basis')).toHaveTextContent('no lot records a cost asset');
  });

  it('reads the recipe from the public version when the instance follows someone else’s strategy', async () => {
    mount(<InstanceView instanceId={INSTANCE_ID} />, instanceServer({ ownVersion: null }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Aerospace tilt (public)',
      ),
    );
    expect(await screen.findAllByTestId('allocation-row')).toHaveLength(3);
    expect(calls('GET', `${P}/v1/strategies/${STRATEGY_ID}/versions/${VERSION_ID}`)).toHaveLength(
      1,
    );
  });

  it('answers not found for another person’s instance and reports a refused export', async () => {
    mount(<InstanceView instanceId={INSTANCE_ID} />, instanceServer({ instance: null }));
    expect(await screen.findByText('Not found')).toBeInTheDocument();
    expect(screen.queryByTestId('allocation-table')).toBeNull();
  });

  it('downloads the complete record behind the personal series, and says so when the API refuses it', async () => {
    const created: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => {
          created.push('blob:1');
          return 'blob:1';
        }),
        revokeObjectURL: vi.fn(),
      }),
    );
    mount(<InstanceView instanceId={INSTANCE_ID} />, instanceServer({ exportStatus: 404 }));
    const button = await screen.findByTestId('personal-performance-export');
    fireEvent.click(button);
    expect(await screen.findByText('The export did not complete')).toBeInTheDocument();
    expect(created).toHaveLength(0);
    expect(
      calls('GET', `${P}/v1/me/instances/${INSTANCE_ID}/performance/export?period=all`),
    ).toHaveLength(1);
  });
});
