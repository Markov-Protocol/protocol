import type { FollowListResponse } from '@markov/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { CreatorView } from '../src/features/discovery/creator-view';
import { ProposalPanel } from '../src/features/discovery/proposal-panel';
import { RankingsView } from '../src/features/discovery/rankings-view';
import { ExploreView } from '../src/features/markets/explore-view';
import { StrategyView } from '../src/features/publishing/strategy-view';
import {
  creatorProfile,
  discoveryResponse,
  discoveryRow,
  METHODOLOGY,
  OTHER_PUBLISHER,
  PUBLISHER,
  publicStrategy,
  publicVersion,
  RANKED_ROW,
  rankingEntry,
  rankingResponse,
  STRATEGY_A,
  STRATEGY_B,
  UNRANKED_ENTRY,
} from './discovery-fixtures';
import { INSTANCE_ID, instance, STRATEGY_ID, VERSION_ID } from './portfolio-fixtures';

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
  push: vi.fn(),
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

/* ------------------------------------------------------------- fixtures */

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: false,
};
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
const PROPOSED = '88888888-8888-4888-8888-888888888888';
const P = '/api/markov';

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
const ok =
  (body: unknown): Responder =>
  () => ({ status: 200, body });
function envelope(status: number, code: string, message = code): Reply {
  return { status, body: { error: { code, message, requestId: 'r' } } };
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

function mount(
  view: ReactNode,
  routes: Route[],
  session: SessionSnapshot,
  location: { readonly pathname: string; readonly search?: string },
) {
  nav.pathname = location.pathname;
  nav.search = location.search ?? '';
  stub = stubFetch(routes, session);
  vi.stubGlobal('fetch', stub.impl);
  return render(<Harness session={session}>{view}</Harness>);
}

const STRATEGIES: Route = {
  method: 'GET',
  path: `${P}/v1/strategies`,
  reply: ok(discoveryResponse([RANKED_ROW, discoveryRow()])),
};
const FOLLOWS: Route = {
  method: 'GET',
  path: `${P}/v1/me/follows`,
  reply: ok({
    follows: [
      {
        strategyId: STRATEGY_A,
        followedAt: '2026-09-25T10:30:00.000Z',
        latestVersion: {
          versionId: discoveryRow().latestVersion.versionId,
          versionNumber: 1,
          title: 'Aerospace tilt',
          status: 'active',
          registeredAt: '2026-09-25T10:00:00.000Z',
        },
      },
    ],
  } satisfies FollowListResponse),
};

beforeEach(() => {
  nav.replace.mockClear();
  nav.push.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe('Explore, Strategies tab', () => {
  it('lists ranked and young strategies from a public read, never a return next to an unranked one', async () => {
    mount(<ExploreView />, [STRATEGIES], anonymous, { pathname: '/explore' });
    const rows = await screen.findAllByTestId('strategy-row');
    expect(rows.map((row) => row.getAttribute('data-strategy-id'))).toEqual([
      STRATEGY_B,
      STRATEGY_A,
    ]);
    const ranked = rows[0] as HTMLElement;
    const young = rows[1] as HTMLElement;
    expect(within(ranked).getByTestId('strategy-performance')).toHaveTextContent(
      '#1 +3.50% model series · -1.25% max drawdown · 31 days of history',
    );
    expect(within(ranked).getByTestId('strategy-followers')).toHaveTextContent('3 followers');
    expect(within(young).getByTestId('strategy-performance')).toHaveTextContent(
      'Unranked · less than 30 days of complete history · no history yet',
    );
    expect(within(young).getByTestId('strategy-performance').textContent).not.toContain('%');
    expect(
      within(young).getByRole('link', { name: 'View thesis: Aerospace tilt' }),
    ).toHaveAttribute('href', `/strategies/${STRATEGY_A}`);
    expect(within(young).getByRole('link', { name: /4uFN/ })).toHaveAttribute(
      'href',
      `/creators/${PUBLISHER}`,
    );
    expect(
      within(young).getByText(/Pre-IPO exposure · PreStocks · 2 assets · 10.00% cash/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('strategies-source')).toHaveTextContent(
      'read Sep 25, 2026, 11:00 AM UTC',
    );
    expect(screen.getByTestId('build-your-own')).toBeInTheDocument();
    expect(screen.getByTestId('strategies-rail')).toHaveTextContent('Review before execution');
    // Public rows come from one public read with nothing about the reader in it.
    expect(stub.calls.map((call) => call.url)).toEqual([`${P}/v1/strategies?limit=25`]);
    expect(screen.queryByTestId('strategy-following')).toBeNull();
    expect(screen.queryByTestId('following-section')).toBeNull();
  });

  it('composes the followed state from the private list and keeps filters in the URL', async () => {
    mount(<ExploreView />, [STRATEGIES, FOLLOWS], alice, {
      pathname: '/explore',
      search: '?issuer=prestocks&period=90d&sort=followers',
    });
    const rows = await screen.findAllByTestId('strategy-row');
    const young = rows.find(
      (row) => row.getAttribute('data-strategy-id') === STRATEGY_A,
    ) as HTMLElement;
    const ranked = rows.find(
      (row) => row.getAttribute('data-strategy-id') === STRATEGY_B,
    ) as HTMLElement;
    expect(await within(young).findByTestId('strategy-following')).toHaveTextContent('Following');
    expect(within(ranked).queryByTestId('strategy-following')).toBeNull();
    expect(screen.getByTestId('following-section')).toHaveTextContent('Aerospace tilt · version 1');
    // The public read carries the filters and nothing about the person; the follows read is separate.
    expect(stub.calls.map((call) => call.url).sort()).toEqual([
      `${P}/v1/me/follows`,
      `${P}/v1/strategies?issuer=prestocks&period=90d&sort=followers&limit=25`,
    ]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: '  tilt ' },
    });
    await waitFor(() =>
      expect(nav.replace).toHaveBeenLastCalledWith(
        '/explore?q=tilt&issuer=prestocks&period=90d&sort=followers',
        { scroll: false },
      ),
    );
  });

  it('shows a rate limit, contract drift and an expired page as failures, never as an empty list', async () => {
    mount(
      <ExploreView />,
      [{ ...STRATEGIES, reply: () => envelope(429, 'RATE_LIMITED', 'too many requests') }],
      anonymous,
      { pathname: '/explore' },
    );
    expect(await screen.findByText('Too many reads')).toBeInTheDocument();
    mount(
      <ExploreView />,
      [{ ...STRATEGIES, reply: ok({ strategies: [{ title: 'shape drift' }] }) }],
      anonymous,
      { pathname: '/explore' },
    );
    expect(
      await screen.findByText('Markov answered in an unexpected shape', {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    mount(
      <ExploreView />,
      [{ ...STRATEGIES, reply: () => envelope(400, 'VALIDATION_FAILED', 'cursor invalid') }],
      anonymous,
      { pathname: '/explore', search: '?cursor=stale' },
    );
    expect(await screen.findByText('This page is no longer valid')).toBeInTheDocument();
    expect(screen.queryByText('No public strategy matches')).toBeNull();
  });
});

describe('Rankings', () => {
  it('ranks one cohort at a time with the methodology beside it and a reason for every unranked entry', async () => {
    mount(
      <RankingsView />,
      [
        {
          method: 'GET',
          path: `${P}/v1/rankings/model`,
          reply: ok(rankingResponse([rankingEntry(), UNRANKED_ENTRY])),
        },
        { method: 'GET', path: `${P}/v1/performance/methodology`, reply: ok(METHODOLOGY) },
      ],
      anonymous,
      { pathname: '/rankings' },
    );
    const rows = await screen.findAllByTestId('ranking-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByTestId('ranking-return')).toHaveTextContent(
      '+3.50%',
    );
    expect(within(rows[0] as HTMLElement).getByText('32 of 32 points valued')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByTestId('ranking-unranked')).toHaveTextContent(
      'Unranked: less than 30 days of complete history',
    );
    expect(screen.getByTestId('rankings-summary')).toHaveTextContent(
      '1 ranked, 1 listed without a rank · last 30 days · stocks-v1',
    );
    expect(await screen.findByTestId('methodology-panel')).toHaveTextContent(
      'Methodology stocks-v1',
    );
    expect(screen.getByTestId('methodology-panel')).toHaveTextContent(
      'Bought once at the first priced point',
    );
    expect(screen.getByTestId('methodology-panel')).toHaveTextContent('no account is ranked');
    expect(stub.calls[0]?.url).toBe(`${P}/v1/rankings/model?period=30d&limit=200`);
    fireEvent.click(screen.getByTestId('rankings-period-90d'));
    expect(nav.replace).toHaveBeenLastCalledWith('/rankings?period=90d', { scroll: false });
  });
});

describe('Creator page', () => {
  it('shows chain-record provenance and an honest not-found for a wallet that registered nothing', async () => {
    mount(
      <CreatorView publisherWallet={OTHER_PUBLISHER} />,
      [{ method: 'GET', path: `${P}/v1/creators/${OTHER_PUBLISHER}`, reply: ok(creatorProfile()) }],
      anonymous,
      { pathname: `/creators/${OTHER_PUBLISHER}` },
    );
    expect(await screen.findByTestId('creator-facts')).toHaveTextContent('Listed strategies1');
    expect(screen.getByTestId('creator-facts')).toHaveTextContent('Followers across them3');
    expect(screen.getByTestId('creator-facts')).toHaveTextContent(
      'First registrationAug 25, 2026, 10:00 AM UTC',
    );
    expect(screen.getAllByTestId('strategy-row')).toHaveLength(1);
    expect(screen.getByTestId('creator-note')).toHaveTextContent(
      'wallet that signed a registration',
    );
    expect(stub.calls[0]?.url).toBe(`${P}/v1/creators/${OTHER_PUBLISHER}?period=30d`);

    mount(
      <CreatorView publisherWallet={PUBLISHER} />,
      [
        {
          method: 'GET',
          path: `${P}/v1/creators/${PUBLISHER}`,
          reply: () => envelope(404, 'NOT_FOUND'),
        },
      ],
      anonymous,
      { pathname: `/creators/${PUBLISHER}` },
    );
    expect(
      await screen.findByText('No listed strategy was registered by this wallet'),
    ).toBeInTheDocument();
  });
});

describe('Public strategy page provenance', () => {
  it('names the registering wallet and the honest ranking line of the newest version', async () => {
    mount(
      <StrategyView strategyId={STRATEGY_ID} />,
      [
        { method: 'GET', path: `${P}/v1/strategies/${STRATEGY_ID}`, reply: ok(publicStrategy()) },
        {
          method: 'GET',
          path: `${P}/v1/strategies/${STRATEGY_ID}/versions/${VERSION_ID}`,
          reply: ok(publicVersion()),
        },
        {
          method: 'GET',
          path: `${P}/v1/rankings/model`,
          reply: ok(
            rankingResponse([
              rankingEntry({
                rank: null,
                strategyId: STRATEGY_ID,
                versionId: VERSION_ID,
                timeWeightedReturn: null,
                maxDrawdown: null,
                historyDays: 2,
                completeness: null,
                eligible: false,
                reasons: ['insufficient_history', 'stale_end'],
              }),
            ]),
          ),
        },
      ],
      anonymous,
      { pathname: `/strategies/${STRATEGY_ID}` },
    );
    expect(await screen.findByTestId('creator-link')).toHaveAttribute(
      'href',
      `/creators/${PUBLISHER}`,
    );
    expect(await screen.findByTestId('strategy-ranking')).toHaveTextContent(
      'Unranked · less than 30 days of complete history; the latest price is older than the freshness rule · 2 days of history',
    );
    expect(screen.getByTestId('strategy-ranking')).toHaveTextContent('never an account');
  });
});

describe('Proposed version acceptance', () => {
  const pinned = publicVersion();
  const proposedVersion = publicVersion({
    versionId: PROPOSED,
    versionNumber: 2,
    cashWeightBps: 2000,
    legs: pinned.legs.map((leg) =>
      leg.symbol === 'FXAERO' ? { ...leg, weightBps: leg.weightBps - 1000 } : leg,
    ),
    parentVersionId: VERSION_ID,
  });
  const offered = instance({
    strategyId: STRATEGY_ID,
    pinnedVersionId: VERSION_ID,
    pinnedVersionNumber: 1,
    proposedVersionId: PROPOSED,
  });

  it('shows the exact difference and moves the pin only on an explicit acceptance', async () => {
    mount(
      <ProposalPanel instance={offered} pinned={pinned} />,
      [
        {
          method: 'GET',
          path: `${P}/v1/strategies/${STRATEGY_ID}/versions/${PROPOSED}`,
          reply: ok(proposedVersion),
        },
        {
          method: 'POST',
          path: `${P}/v1/me/instances/${INSTANCE_ID}/pin`,
          reply: ok(
            instance({
              pinnedVersionId: PROPOSED,
              pinnedVersionNumber: 2,
              proposedVersionId: null,
            }),
          ),
        },
      ],
      alice,
      { pathname: `/portfolio/${INSTANCE_ID}` },
    );
    const diff = await screen.findByTestId('version-diff');
    expect(diff).toHaveTextContent('FXAERO: 60.00% → 50.00%.');
    expect(diff).toHaveTextContent('Cash: 10.00% → 20.00%.');
    expect(diff).toHaveTextContent('Turnover to move from version 1 to 2: 10.00% of the portfolio');
    expect(screen.getByText(/Nothing is bought or sold/)).toBeInTheDocument();
    expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-version'));
    });
    await waitFor(() =>
      expect(stub.calls.filter((call) => call.method === 'POST')).toEqual([
        {
          method: 'POST',
          url: `${P}/v1/me/instances/${INSTANCE_ID}/pin`,
          body: { versionId: PROPOSED },
        },
      ]),
    );
  });

  it('cannot accept a proposed version that is no longer publicly readable', async () => {
    mount(
      <ProposalPanel instance={offered} pinned={pinned} />,
      [
        {
          method: 'GET',
          path: `${P}/v1/strategies/${STRATEGY_ID}/versions/${PROPOSED}`,
          reply: () => envelope(404, 'NOT_FOUND', 'withheld'),
        },
      ],
      alice,
      { pathname: `/portfolio/${INSTANCE_ID}` },
    );
    expect(await screen.findByTestId('proposal-unavailable')).toHaveTextContent(
      'not publicly readable',
    );
    expect(screen.getByTestId('accept-version')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('accept-version'));
    expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});
