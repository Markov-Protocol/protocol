import type { Instrument, InstrumentDetail, Watchlist } from '@markov/contracts';
import { PRICE_KIND_LABELS } from '@markov/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { ExploreView } from '../src/features/markets/explore-view';
import { MarketDetailView } from '../src/features/markets/market-detail-view';
import { discoveryResponse } from './discovery-fixtures';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: '/explore',
  replace: vi.fn((url: string) => {
    nav.search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    for (const listener of listeners) {
      listener();
    }
  }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  // Subscribing here re-renders every reader when the fake router changes the URL, as the app router does.
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, () => nav.search)),
  notFound: () => {
    throw new Error('notFound');
  },
}));

/** Radix tabs activate on pointer down (or focus), not on click. */
function activateTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}

/* ------------------------------------------------------------- fixtures */

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: false,
};
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MINT = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const AERO = '11111111-1111-4111-8111-111111111111';
const XAERO = '22222222-2222-4222-8222-222222222222';
const BIO = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-24T12:00:00.000Z';

const anonymous: SessionSnapshot = { state: 'signed-out' };
const alice: SessionSnapshot = {
  state: 'signed-in',
  account: {
    userId: 'user-alice',
    subject: 'did:test:alice',
    issuer: 'urn:markov:test',
    authTime: null,
    stepUpFresh: true,
  },
  session: { sessionId: 's1', expiresAt: '2030-01-01T00:00:00.000Z' },
};

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    instrumentId: AERO,
    issuer: 'prestocks',
    issuerProductId: 'fx-aero-001',
    symbol: 'FXAERO',
    name: 'Fixture Aerospace pre-IPO exposure',
    companyName: 'Fixture Aerospace Inc',
    kind: 'pre_ipo_exposure',
    chain: 'solana',
    genesisHash: GENESIS,
    mint: MINT,
    decimals: 6,
    tokenProgram: 'spl-token',
    status: 'admitted',
    statusReason: null,
    metadata: { website: 'https://example.com/fixture-aerospace', description: null },
    referencePrice: {
      value: '18.25',
      unit: 'USD',
      kind: 'issuer_mark',
      observedAt: '2026-09-24T09:00:00.000Z',
      source: 'prestocks-fixture',
      stale: false,
      expiresAt: null,
    },
    underlying: { ticker: null, exchange: null },
    lifecycle: {
      halted: false,
      haltedReason: null,
      pendingActions: [],
      migration: null,
      sunsetAt: null,
      currentMultiplier: '1',
      multiplierEffectiveAt: '2026-09-01T00:00:00.000Z',
    },
    availability: {
      research: true,
      strategy: true,
      trade: false,
      reasons: ['EXECUTION_NOT_ENABLED'],
    },
    admittedAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-24T11:00:00.000Z',
    ...overrides,
  };
}

function detail(overrides: Partial<InstrumentDetail> = {}): InstrumentDetail {
  return {
    ...instrument(),
    latestMintVerification: {
      verificationId: 1,
      instrumentId: AERO,
      verifiedAt: '2026-09-23T00:00:00.000Z',
      rpcHost: 'rpc.test',
      slot: 4242,
      result: 'verified',
      onChain: {
        tokenProgram: 'spl-token',
        decimals: 6,
        supply: '1000000',
        mintAuthority: null,
        freezeAuthority: null,
        isInitialized: true,
        extensions: [],
        unknownExtensionTypes: [],
      },
      mismatches: [],
      compatibility: null,
    },
    ...overrides,
  };
}

const xAero = instrument({
  instrumentId: XAERO,
  issuer: 'xstocks',
  issuerProductId: 'xs-aero',
  symbol: 'AEROX',
  name: 'Fixture Aerospace xStock',
  kind: 'listed_stock',
  tokenProgram: 'token-2022',
  underlying: { ticker: 'FXAE', exchange: 'FIXTURE' },
  referencePrice: null,
});
const bio = instrument({
  instrumentId: BIO,
  issuerProductId: 'fx-bio-002',
  symbol: 'FXBIO',
  name: 'Fixture Biotech pre-IPO exposure',
  companyName: 'Fixture Biotech Ltd',
  status: 'paused',
  statusReason: 'issuer review',
  referencePrice: {
    value: '4.10',
    unit: 'USD',
    kind: 'implied_valuation',
    observedAt: '2026-09-01T09:00:00.000Z',
    source: 'prestocks-fixture',
    stale: true,
    expiresAt: null,
  },
  availability: {
    research: true,
    strategy: false,
    trade: false,
    reasons: ['INSTRUMENT_PAUSED', 'EXECUTION_NOT_ENABLED'],
  },
});

function watchlist(items: Instrument[], version = items.length): Watchlist {
  return {
    contractVersion: 1,
    version,
    updatedAt: items.length > 0 ? NOW : null,
    items: items.map((row) => ({
      instrumentId: row.instrumentId,
      note: null,
      addedAt: NOW,
      instrument: row,
    })),
  };
}

/* ------------------------------------------------------------ fetch stub */

interface Reply {
  readonly status: number;
  readonly body: unknown;
}
type Responder = (url: URL, init: RequestInit | undefined) => Reply | Promise<Reply>;
interface Route {
  readonly method: string;
  readonly path: string | RegExp;
  readonly reply: Responder;
}

function stubFetch(routes: Route[], session: SessionSnapshot) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'http://app.test');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/auth/session') {
        return Response.json(session);
      }
      calls.push({
        method,
        url: `${url.pathname}${url.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const route = routes.find(
        (candidate) =>
          candidate.method === method &&
          (typeof candidate.path === 'string'
            ? candidate.path === url.pathname
            : candidate.path.test(url.pathname)),
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
      const reply = await route.reply(url, init);
      return Response.json(reply.body, { status: reply.status });
    },
  );
  return { impl, calls };
}

const listReply =
  (rows: Instrument[], nextCursor: string | null = null): Responder =>
  () => ({ status: 200, body: { instruments: rows, nextCursor } });

function envelope(status: number, code: string, message = code): Reply {
  return { status, body: { error: { code, message, requestId: 'r' } } };
}

/* -------------------------------------------------------------- harness */

function Harness({
  session,
  children,
}: {
  readonly session: SessionSnapshot;
  readonly children: ReactNode;
}) {
  return (
    <SessionProvider initial={session} platform={platform}>
      <PrivateQueryProvider>{children}</PrivateQueryProvider>
    </SessionProvider>
  );
}

let stub: ReturnType<typeof stubFetch>;

function mountExplore(
  routes: Route[],
  session: SessionSnapshot = anonymous,
  search = '?tab=instruments',
) {
  nav.search = search;
  nav.pathname = '/explore';
  stub = stubFetch(routes, session);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <Harness session={session}>
      <ExploreView />
    </Harness>,
  );
}

function mountDetail(routes: Route[], session: SessionSnapshot = anonymous, id = AERO) {
  nav.search = '';
  nav.pathname = `/markets/${id}`;
  stub = stubFetch(routes, session);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <Harness session={session}>
      <MarketDetailView instrumentId={id} />
    </Harness>,
  );
}

beforeEach(() => {
  nav.search = '';
  nav.replace.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const LIST = { method: 'GET', path: '/api/markov/v1/catalog/instruments' } as const;

describe('Explore instruments', () => {
  it('lists admitted instruments with company, issuer and network, typed prices and exact detail links', async () => {
    mountExplore([{ ...LIST, reply: listReply([instrument(), xAero, bio]) }]);
    const rows = await screen.findAllByTestId('instrument-row');
    expect(rows).toHaveLength(3);
    expect(stub.calls[0]?.url).toBe('/api/markov/v1/catalog/instruments?limit=25');

    const aero = rows[0] as HTMLElement;
    expect(
      within(aero).getByRole('link', {
        name: /Fixture Aerospace pre-IPO exposure \(FXAERO\), PreStocks/,
      }),
    ).toHaveAttribute('href', `/markets/${AERO}`);
    expect(within(aero).getByText('Fixture Aerospace Inc')).toBeInTheDocument();
    expect(within(aero).getByText('PreStocks')).toBeInTheDocument();
    expect(within(aero).getByText('Solana devnet')).toBeInTheDocument();
    expect(within(aero).getByText('Pre-IPO exposure')).toBeInTheDocument();
    expect(within(aero).getByText('18.25 USD')).toBeInTheDocument();
    expect(within(aero).getByText(PRICE_KIND_LABELS.issuer_mark)).toBeInTheDocument();
    expect(within(aero).getByText('Research and strategy building')).toBeInTheDocument();
    expect(
      within(aero).getByText(/Catalog updated .* from the PreStocks feed/),
    ).toBeInTheDocument();
    expect(within(aero).getByRole('link', { name: 'Sign in to save FXAERO' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fexplore%3Ftab%3Dinstruments',
    );

    // Two exposures to the same company are told apart by issuer, symbol and category.
    const twin = rows[1] as HTMLElement;
    expect(twin.dataset['issuer']).toBe('xstocks');
    expect(within(twin).getByText('Fixture Aerospace Inc')).toBeInTheDocument();
    expect(within(twin).getByText('xStocks')).toBeInTheDocument();
    expect(within(twin).getByText('Listed stock · FXAE on FIXTURE')).toBeInTheDocument();
    expect(within(twin).getByText('Unpriced')).toBeInTheDocument();
    expect(
      within(twin).getByRole('link', { name: /Fixture Aerospace xStock \(AEROX\), xStocks/ }),
    ).toHaveAttribute('href', `/markets/${XAERO}`);

    // A paused instrument says so and a stale price is flagged, not hidden.
    const paused = rows[2] as HTMLElement;
    expect(within(paused).getByText('Paused')).toBeInTheDocument();
    expect(within(paused).getByText('Stale')).toBeInTheDocument();
    expect(within(paused).getByText('Research only')).toBeInTheDocument();
    expect(within(paused).getByText('(paused by Markov operators)')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 instruments');
  });

  it('keeps validated filter state in the URL and debounces search', async () => {
    mountExplore([{ ...LIST, reply: listReply([instrument()]) }]);
    await screen.findAllByTestId('instrument-row');
    fireEvent.click(screen.getByRole('button', { name: 'PreStocks collection' }));
    expect(nav.replace).toHaveBeenLastCalledWith('/explore?tab=instruments&issuer=prestocks', {
      scroll: false,
    });
    await waitFor(() =>
      expect(stub.calls.at(-1)?.url).toBe(
        '/api/markov/v1/catalog/instruments?issuer=prestocks&limit=25',
      ),
    );
    expect(screen.getByRole('button', { name: 'PreStocks collection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: '  Aero <b>' },
    });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(nav.replace).toHaveBeenLastCalledWith(
        '/explore?tab=instruments&q=Aero+%3Cb%3E&issuer=prestocks',
        {
          scroll: false,
        },
      ),
    );
    await waitFor(() =>
      expect(stub.calls.at(-1)?.url).toBe(
        '/api/markov/v1/catalog/instruments?q=Aero+%3Cb%3E&issuer=prestocks&limit=25',
      ),
    );
  });

  it('ignores unknown filter values from the URL and never forwards them', async () => {
    mountExplore(
      [{ ...LIST, reply: listReply([instrument()]) }],
      anonymous,
      '?tab=instruments&issuer=evil&kind=unknown&q=fx',
    );
    await screen.findAllByTestId('instrument-row');
    expect(stub.calls[0]?.url).toBe('/api/markov/v1/catalog/instruments?q=fx&limit=25');
  });

  it('never lets a late answer to an older search replace newer results', async () => {
    let resolveFirst: ((reply: Reply) => void) | null = null;
    const first = new Promise<Reply>((resolve) => {
      resolveFirst = resolve;
    });
    mountExplore([
      {
        ...LIST,
        reply: (url) =>
          url.searchParams.get('q') === 'Aero'
            ? { status: 200, body: { instruments: [instrument()], nextCursor: null } }
            : first,
      },
    ]);
    expect(await screen.findByRole('status', { name: 'Loading instruments' })).toBeInTheDocument();
    act(() => nav.replace('/explore?tab=instruments&q=Aero'));
    expect((await screen.findAllByTestId('instrument-row')).length).toBe(1);
    await act(async () => {
      (resolveFirst as unknown as (reply: Reply) => void)({
        status: 200,
        body: { instruments: [instrument(), xAero, bio], nextCursor: null },
      });
      await Promise.resolve();
    });
    expect(screen.getAllByTestId('instrument-row')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 instrument');
  });

  it('shows schema drift and provider outages as failures with retry, never as an empty catalog', async () => {
    let attempt = 0;
    mountExplore([
      {
        ...LIST,
        reply: () => {
          attempt += 1;
          if (attempt === 1) {
            return {
              status: 200,
              body: { instruments: [{ instrumentId: AERO, symbol: 'FXAERO' }], nextCursor: null },
            };
          }
          if (attempt === 2) {
            return envelope(503, 'PROVIDER_UNAVAILABLE', 'issuer source failed');
          }
          return { status: 200, body: { instruments: [instrument()], nextCursor: null } };
        },
      },
    ]);
    expect(await screen.findByText('Markov answered in an unexpected shape')).toBeInTheDocument();
    expect(screen.queryByText('No admitted instrument matches')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findByText('The catalog cannot be reached right now')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findAllByTestId('instrument-row')).toHaveLength(1);
  });

  it('bounds pagination with a cursor and a page cap', async () => {
    mountExplore([
      {
        ...LIST,
        reply: (url) => ({
          status: 200,
          body: {
            instruments: [
              instrument({ instrumentId: url.searchParams.get('cursor') ? XAERO : AERO }),
            ],
            nextCursor: url.searchParams.get('cursor') ? null : 'next-1',
          },
        }),
      },
    ]);
    await screen.findAllByTestId('instrument-row');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByTestId('instrument-row')).toHaveLength(2));
    expect(stub.calls.at(-1)?.url).toBe(
      '/api/markov/v1/catalog/instruments?limit=25&cursor=next-1',
    );
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('saves and removes instruments for a signed-in person with the list version, and reports a conflict', async () => {
    let list = watchlist([]);
    mountExplore(
      [
        { ...LIST, reply: listReply([instrument(), bio]) },
        {
          method: 'GET',
          path: '/api/markov/v1/me/watchlist',
          reply: () => ({ status: 200, body: list }),
        },
        {
          method: 'PUT',
          path: `/api/markov/v1/me/watchlist/items/${AERO}`,
          reply: () => {
            list = watchlist([instrument()], 1);
            return { status: 200, body: list };
          },
        },
        {
          method: 'DELETE',
          path: `/api/markov/v1/me/watchlist/items/${AERO}`,
          reply: (url) =>
            url.searchParams.get('ifVersion') === '1'
              ? {
                  status: 409,
                  body: {
                    error: {
                      code: 'IDEMPOTENCY_CONFLICT',
                      message: 'changed',
                      requestId: 'r',
                      details: [{ path: 'ifVersion', message: 'the current version is 2' }],
                    },
                  },
                }
              : (() => {
                  list = watchlist([], 3);
                  return { status: 200, body: list };
                })(),
        },
      ],
      alice,
    );
    // The button re-mounts once the watchlist is known (its disabled reason disappears), so re-query it.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save FXAERO to your watchlist' }),
      ).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save FXAERO to your watchlist' }));
    expect(
      await screen.findByRole('button', { name: 'Remove FXAERO from your watchlist' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const put = stub.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({ ifVersion: 0 });

    // The watchlist tab shows the saved instrument with its current status and removes with the version.
    activateTab('Watchlist');
    const row = await screen.findByTestId('watchlist-row');
    expect(within(row).getByText('FXAERO')).toBeInTheDocument();
    expect(within(row).getByText('Admitted')).toBeInTheDocument();
    // Another device moved the list to version 2 meanwhile: the stale removal conflicts, the list is refreshed.
    list = watchlist([instrument()], 2);
    fireEvent.click(within(row).getByRole('button', { name: 'Remove FXAERO from your watchlist' }));
    expect(await screen.findByText(/changed on another device/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('list version 2'));
    fireEvent.click(
      within(screen.getByTestId('watchlist-row')).getByRole('button', {
        name: 'Remove FXAERO from your watchlist',
      }),
    );
    expect(await screen.findByText('Nothing saved yet')).toBeInTheDocument();
  });

  it('shows a delisted saved instrument as delisted and keeps the anonymous watchlist honest', async () => {
    const delisted = instrument({
      status: 'delisted',
      availability: {
        research: false,
        strategy: false,
        trade: false,
        reasons: ['INSTRUMENT_DELISTED', 'EXECUTION_NOT_ENABLED'],
      },
    });
    mountExplore(
      [
        { ...LIST, reply: listReply([]) },
        {
          method: 'GET',
          path: '/api/markov/v1/me/watchlist',
          reply: () => ({ status: 200, body: watchlist([delisted], 4) }),
        },
      ],
      alice,
      '?tab=watchlist',
    );
    const row = await screen.findByTestId('watchlist-row');
    expect(within(row).getAllByText('Delisted').length).toBeGreaterThan(0);
    expect(within(row).getByText('(delisted)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove FXAERO from your watchlist' }),
    ).toBeInTheDocument();
  });

  it('offers sign-in instead of a watchlist to anonymous people and lands on strategies by default', async () => {
    mountExplore(
      [
        { ...LIST, reply: listReply([]) },
        {
          method: 'GET',
          path: '/api/markov/v1/strategies',
          reply: () => ({ status: 200, body: discoveryResponse([]) }),
        },
      ],
      anonymous,
      '?tab=watchlist',
    );
    expect(await screen.findByText('Sign in to keep a watchlist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fexplore%3Ftab%3Dwatchlist',
    );
    activateTab('Strategies');
    expect(nav.replace).toHaveBeenLastCalledWith('/explore', { scroll: false });
    expect(await screen.findByText('No public strategy matches')).toBeInTheDocument();
    activateTab('Stocks');
    expect(nav.replace).toHaveBeenLastCalledWith('/explore?tab=instruments', { scroll: false });
    expect(await screen.findByText('No admitted instrument matches')).toBeInTheDocument();
  });
});

describe('Market detail', () => {
  const DETAIL = { method: 'GET', path: `/api/markov/v1/catalog/instruments/${AERO}` } as const;
  const ACTIONS = {
    method: 'GET',
    path: `/api/markov/v1/catalog/instruments/${AERO}/corporate-actions`,
  } as const;

  it('shows the exact instrument with identity, sanitised description, price basis, evidence and honest actions', async () => {
    mountDetail([
      {
        ...DETAIL,
        reply: () => ({
          status: 200,
          body: detail({
            metadata: {
              website: 'https://example.com/fixture-aerospace',
              description: 'Synthetic <b>instrument</b> used by tests.',
            },
          }),
        }),
      },
      { ...ACTIONS, reply: () => ({ status: 200, body: { actions: [] } }) },
    ]);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Fixture Aerospace pre-IPO exposure FXAERO',
    );
    expect(screen.getByText('Fixture Aerospace Inc')).toBeInTheDocument();
    expect(screen.getByText('PreStocks')).toBeInTheDocument();
    expect(screen.getByText('Solana devnet')).toBeInTheDocument();
    expect(screen.getByText('Admitted')).toBeInTheDocument();
    // Provider text is data: the tags stay literal, no element is created.
    const description = screen.getByTestId('issuer-description');
    expect(description.textContent).toBe('Synthetic <b>instrument</b> used by tests.');
    expect(description.querySelector('b')).toBeNull();
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
      'rel',
      'noreferrer noopener',
    );
    expect(screen.getByText('18.25 USD')).toBeInTheDocument();
    expect(
      screen.getByText(/observed .*A reference price is not an executable quote/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('price-history')).toHaveTextContent('History unavailable');
    expect(screen.getByText('What this token is')).toBeInTheDocument();
    expect(screen.getByText(/naming a company implies no relationship/)).toBeInTheDocument();
    const actions =
      screen.getByRole('list', { name: '' }).closest('section') ??
      screen.getByText('What you can do now').closest('section');
    expect(actions).not.toBeNull();
    expect(
      within(actions as HTMLElement).getAllByText('Not available').length,
    ).toBeGreaterThanOrEqual(3);
    expect(within(actions as HTMLElement).getByText(/sign in to review a buy/)).toBeInTheDocument();
    expect(
      within(actions as HTMLElement).getByText(/selling is not offered in the app yet/),
    ).toBeInTheDocument();
    expect(within(actions as HTMLElement).queryByTestId('review-buy')).not.toBeInTheDocument();
    expect(within(actions as HTMLElement).getByText(/never through Markov/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/sign-in?next=%2Fmarkets%2F${AERO}`,
    );

    activateTab('Instrument');
    expect(await screen.findByTestId('mint-address')).toHaveTextContent(MINT);
    expect(screen.getByRole('link', { name: 'View on Solana Explorer' })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/address/${MINT}?cluster=devnet`,
    );
    expect(screen.getByText('verified')).toBeInTheDocument();
    expect(screen.getByText('1000000 base units')).toBeInTheDocument();
    activateTab('Liquidity');
    expect(await screen.findByText('Route information unavailable')).toBeInTheDocument();
    activateTab('Research');
    expect(await screen.findByText('Sign in to research this exposure')).toBeInTheDocument();
  });

  it('refines availability with the person’s capability states and lists lifecycle notices', async () => {
    mountDetail(
      [
        {
          ...DETAIL,
          reply: () => ({
            status: 200,
            body: detail({
              status: 'paused',
              statusReason: 'issuer review',
              lifecycle: {
                halted: true,
                haltedReason: 'trading halt announced by the issuer',
                pendingActions: [
                  {
                    actionId: '44444444-4444-4444-8444-444444444444',
                    type: 'split',
                    effectiveAt: '2026-10-01T00:00:00.000Z',
                  },
                ],
                migration: null,
                sunsetAt: null,
                currentMultiplier: '1',
                multiplierEffectiveAt: null,
              },
              availability: {
                research: true,
                strategy: false,
                trade: false,
                reasons: ['INSTRUMENT_PAUSED', 'ISSUER_HALTED', 'EXECUTION_NOT_ENABLED'],
              },
            }),
          }),
        },
        {
          ...ACTIONS,
          reply: () => ({
            status: 200,
            body: {
              actions: [
                {
                  actionId: '44444444-4444-4444-8444-444444444444',
                  instrumentId: AERO,
                  issuer: 'prestocks',
                  externalId: 'ev-1',
                  type: 'split',
                  status: 'pending',
                  announcedAt: '2026-09-20T00:00:00.000Z',
                  effectiveAt: '2026-10-01T00:00:00.000Z',
                  summary: '2-for-1 split announced by the issuer.',
                  details: {
                    ratio: { numerator: 2, denominator: 1 },
                    newMultiplier: null,
                    distribution: null,
                    migration: null,
                    sunsetAt: null,
                    reference: null,
                  },
                  appliedAt: null,
                  appliedBy: null,
                  statusReason: null,
                  sourceSnapshotId: '55555555-5555-4555-8555-555555555555',
                  createdAt: '2026-09-20T00:00:00.000Z',
                },
              ],
            },
          }),
        },
        {
          method: 'GET',
          path: `/api/markov/v1/me/instruments/${AERO}/availability`,
          reply: () => ({
            status: 200,
            body: {
              instrumentId: AERO,
              capabilities: {
                discoverable: true,
                researchable: true,
                quoteable: false,
                buyable: false,
                sellable: false,
                redeemable: false,
                transferable: true,
              },
              conditions: ['eligibility_unknown', 'execution_disabled'],
              reasons: ['Declare where you live to get an eligibility decision.'],
              evaluatedAt: NOW,
              policyVersion: null,
            },
          }),
        },
        {
          method: 'GET',
          path: '/api/markov/v1/me/watchlist',
          reply: () => ({ status: 200, body: watchlist([]) }),
        },
      ],
      alice,
    );
    expect(await screen.findByText('Halted by the issuer')).toBeInTheDocument();
    expect(screen.getByText('trading halt announced by the issuer')).toBeInTheDocument();
    expect(screen.getByText('Pending split')).toBeInTheDocument();
    expect(screen.getByText('Paused by Markov operators')).toBeInTheDocument();
    expect(screen.getByText('2-for-1 split announced by the issuer.')).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Evaluated for you .* with no published policy\. Declare where you live/,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/your eligibility is unknown/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Save FXAERO to your watchlist' }),
    ).toBeInTheDocument();
  });

  it('answers an unknown or unadmitted id honestly', async () => {
    mountDetail([{ ...DETAIL, reply: () => envelope(404, 'NOT_FOUND', 'instrument not found') }]);
    expect(await screen.findByText('No admitted instrument with that id')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute(
      'href',
      '/explore',
    );
  });
});
