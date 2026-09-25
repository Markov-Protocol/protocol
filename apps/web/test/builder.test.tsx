import type {
  DraftIssue,
  InstrumentDetail,
  StrategyDetail,
  StrategyDraft,
  StrategyDraftContent,
  StrategyLimits,
} from '@markov/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { BuilderView } from '../src/features/builder/builder-view';
import { localBasketKey } from '../src/features/builder/local-copy';
import { NewBasketView } from '../src/features/builder/new-basket-view';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: '/strategies/new',
  push: vi.fn(),
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
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MINT = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';
const XAERO = '33333333-3333-4333-8333-333333333333';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = '2026-09-24T12:00:00.000Z';
const LONG_NAME = `${'Fixture Aerospace and Orbital Logistics Holdings International pre-IPO exposure '.repeat(2)}series B`;

const alice: SessionSnapshot = {
  state: 'signed-in',
  account: {
    userId: ALICE_ID,
    subject: 'did:test:alice',
    issuer: 'urn:markov:test',
    authTime: null,
    stepUpFresh: true,
  },
  session: { sessionId: 's1', expiresAt: '2030-01-01T00:00:00.000Z' },
};

function instrumentDetail(overrides: Partial<InstrumentDetail> = {}): InstrumentDetail {
  return {
    instrumentId: AERO,
    issuer: 'prestocks',
    issuerProductId: 'fx-aero-001',
    symbol: 'FXAERO',
    name: LONG_NAME,
    companyName: 'Fixture Aerospace Inc',
    kind: 'pre_ipo_exposure',
    chain: 'solana',
    genesisHash: GENESIS,
    mint: MINT,
    decimals: 6,
    tokenProgram: 'spl-token',
    status: 'admitted',
    statusReason: null,
    metadata: { website: null, description: null },
    referencePrice: null,
    underlying: { ticker: null, exchange: null },
    lifecycle: {
      halted: false,
      haltedReason: null,
      pendingActions: [],
      migration: null,
      sunsetAt: null,
      currentMultiplier: '1',
      multiplierEffectiveAt: null,
    },
    availability: {
      research: true,
      strategy: true,
      trade: false,
      reasons: ['EXECUTION_NOT_ENABLED'],
    },
    admittedAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-24T11:00:00.000Z',
    latestMintVerification: null,
    ...overrides,
  };
}
const bio = instrumentDetail({
  instrumentId: BIO,
  symbol: 'FXBIO',
  companyName: 'Fixture Biotech Ltd',
  name: 'Fixture Biotech pre-IPO exposure',
  issuerProductId: 'fx-bio',
});
const xAero = instrumentDetail({
  instrumentId: XAERO,
  symbol: 'AEROX',
  issuer: 'xstocks',
  kind: 'listed_stock',
  name: 'Fixture Aerospace xStock',
  issuerProductId: 'xs-aero',
  tokenProgram: 'token-2022',
});

const limits: StrategyLimits = {
  schemaVersion: '1',
  kinds: ['stock_spot_basket'],
  totalBps: 10_000,
  maxLegs: 10,
  maxIssuerConcentrationBps: 5000,
  maxCompanyConcentrationBps: 3000,
  ceilingSource: 'policy_defaults',
};

function content(overrides: Partial<StrategyDraftContent> = {}): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: AERO, weightBps: 6000, note: null },
      { instrumentId: BIO, weightBps: 3000, note: 'biotech hedge' },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
    ...overrides,
  };
}

/** A stand-in for the backend validator: the totals rule, no legs and zero weights. */
function validate(draft: StrategyDraftContent): StrategyDraft['validation'] {
  const issues: DraftIssue[] = [];
  const legsBps = draft.legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  const totalBps = legsBps + draft.cashWeightBps;
  if (draft.legs.length === 0) {
    issues.push({
      code: 'NO_LEGS',
      severity: 'error',
      path: 'legs',
      message: 'a recipe needs at least one admitted instrument; cash alone is not a strategy',
      limit: null,
      observed: null,
    });
  }
  draft.legs.forEach((leg, index) => {
    if (leg.weightBps === 0) {
      issues.push({
        code: 'ZERO_WEIGHT',
        severity: 'error',
        path: `legs/${index}`,
        message: 'a constituent needs a weight above zero; give it one or remove it',
        limit: 1,
        observed: 0,
      });
    }
  });
  if (totalBps !== 10_000) {
    issues.push({
      code: 'WEIGHTS_TOTAL',
      severity: 'error',
      path: 'cashWeightBps',
      message: `legs plus cash must equal exactly 10000 basis points (${legsBps} in legs, ${draft.cashWeightBps} cash)`,
      limit: 10_000,
      observed: totalBps,
    });
  }
  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
    totals: { legsBps, cashBps: draft.cashWeightBps, totalBps },
    limits,
    evaluatedAt: NOW,
  };
}

function draftOf(draft: StrategyDraftContent, revision: number): StrategyDraft {
  return {
    strategyId: S1,
    revision,
    content: draft,
    validation: validate(draft),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function detailOf(
  draft: StrategyDraftContent,
  revision = 1,
  status: 'active' | 'archived' = 'active',
): StrategyDetail {
  return {
    strategy: {
      strategyId: S1,
      ownerUserId: ALICE_ID,
      status,
      forkOf: null,
      currentVersion: null,
      draftRevision: revision,
      createdAt: NOW,
      updatedAt: NOW,
    },
    draft: draftOf(draft, revision),
    versions: [],
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

function stubFetch(
  routes: Route[],
  session: SessionSnapshot,
  options: { readonly offline?: () => boolean } = {},
) {
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
      if (options.offline?.() && method !== 'GET') {
        throw new TypeError('fetch failed');
      }
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

const ok =
  (body: unknown, status = 200): Responder =>
  () => ({ status, body });
const P = '/api/markov';

/** A server holding one draft: GET answers the current revision, PUT applies a revision-checked save. */
function server(initial: StrategyDraftContent, revision = 1) {
  const state = { draft: draftOf(initial, revision), status: 'active' as 'active' | 'archived' };
  const routes: Route[] = [
    {
      method: 'GET',
      path: `${P}/v1/me/strategies/${S1}`,
      reply: () => ({
        status: 200,
        body: {
          ...detailOf(state.draft.content, state.draft.revision, state.status),
          draft: state.draft,
        },
      }),
    },
    {
      method: 'PUT',
      path: `${P}/v1/me/strategies/${S1}/draft`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          content: StrategyDraftContent;
          ifRevision?: number;
        };
        if (body.ifRevision !== undefined && body.ifRevision !== state.draft.revision) {
          return {
            status: 409,
            body: {
              error: {
                code: 'IDEMPOTENCY_CONFLICT',
                message: 'the draft changed elsewhere; reload it before saving',
                requestId: 'r',
                details: [
                  {
                    path: 'ifRevision',
                    message: `the current revision is ${state.draft.revision}`,
                  },
                ],
              },
            },
          };
        }
        state.draft = draftOf(body.content, state.draft.revision + 1);
        return { status: 200, body: state.draft };
      },
    },
    { method: 'GET', path: `${P}/v1/catalog/instruments/${AERO}`, reply: ok(instrumentDetail()) },
    { method: 'GET', path: `${P}/v1/catalog/instruments/${BIO}`, reply: ok(bio) },
    { method: 'GET', path: `${P}/v1/catalog/instruments/${XAERO}`, reply: ok(xAero) },
    {
      method: 'GET',
      path: `${P}/v1/catalog/instruments`,
      reply: (url) => ({
        status: 200,
        body: {
          instruments: [instrumentDetail(), bio, xAero].filter((row) =>
            row.symbol.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase()),
          ),
          nextCursor: null,
        },
      }),
    },
    { method: 'GET', path: `${P}/v1/me/theses`, reply: ok({ theses: [] }) },
  ];
  return { state, routes };
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

function mountBuilder(
  routes: Route[],
  search = '?stage=assemble',
  options: { readonly offline?: () => boolean } = {},
) {
  nav.search = search;
  nav.pathname = `/strategies/${S1}/edit`;
  stub = stubFetch(routes, alice, options);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <Harness session={alice}>
      <BuilderView strategyId={S1} />
    </Harness>,
  );
}

const weightOf = (symbol: string) =>
  screen.findByLabelText(new RegExp(`^Weight of ${symbol}`)) as Promise<HTMLInputElement>;
const lastPut = () => [...stub.calls].reverse().find((call) => call.method === 'PUT');
const SAVE_WAIT = { timeout: 5000 } as const;

beforeEach(() => {
  nav.search = '';
  nav.push.mockClear();
  nav.replace.mockClear();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe('Basket builder', () => {
  it('loads one draft identity, edits exact weights, autosaves with the revision and shows the backend’s verdict', async () => {
    const api = server(content());
    mountBuilder(api.routes);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Aerospace tilt');
    expect(screen.getByRole('button', { name: /02 Assemble/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const rows = await screen.findAllByTestId('leg-row');
    expect(rows).toHaveLength(2);
    expect(
      await within(rows[0] as HTMLElement).findByText(/FXAERO · Fixture Aerospace Inc/),
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getAllByTitle(LONG_NAME).length).toBeGreaterThan(0);
    expect(await weightOf('FXAERO')).toHaveValue('60.00');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('100.00%');
    expect(screen.getByTestId('validation-summary')).toHaveTextContent('Backend: valid recipe');

    // 59.99 + 30 + 10 = 99.99: the remainder is shown exactly and the backend reports WEIGHTS_TOTAL after the save.
    fireEvent.change(await weightOf('FXAERO'), { target: { value: '59.99' } });
    expect(screen.getByTestId('summary-total')).toHaveTextContent('99.99%');
    expect(screen.getByTestId('summary-remaining')).toHaveTextContent('0.01% unallocated');
    expect(screen.getByTestId('save-status')).toHaveTextContent('Editing');
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision 2'),
      SAVE_WAIT,
    );
    expect(lastPut()?.body).toMatchObject({ ifRevision: 1, content: { cashWeightBps: 1000 } });
    expect(lastPut()?.body).toMatchObject({
      content: {
        legs: expect.arrayContaining([{ instrumentId: AERO, weightBps: 5999, note: null }]),
      },
    });
    expect(screen.getByTestId('validation-summary')).toHaveTextContent('Backend: 1 rule broken');
    expect(screen.getByTestId('validation-summary')).toHaveTextContent('Total is not 100.00%');

    // 60.01: over by 0.01%, still exact.
    fireEvent.change(await weightOf('FXAERO'), { target: { value: '60.01' } });
    expect(screen.getByTestId('summary-remaining')).toHaveTextContent('0.01% over');
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision 3'),
      SAVE_WAIT,
    );
    expect(lastPut()?.body).toMatchObject({ ifRevision: 2 });
    expect(lastPut()?.body).toMatchObject({
      content: {
        legs: expect.arrayContaining([
          expect.objectContaining({ instrumentId: AERO, weightBps: 6001 }),
        ]),
      },
    });

    // Three decimals are refused, never rounded; the previous weight stays.
    fireEvent.change(await weightOf('FXAERO'), { target: { value: '60.001' } });
    expect(
      screen.getByText('At most two decimals; weights are exact basis points.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('summary-total')).toHaveTextContent('100.01%');
  });

  it('adjusts by keyboard buttons, never redistributes on removal, refuses duplicates, and makes equal weights explicit', async () => {
    const api = server(content());
    mountBuilder(api.routes);
    await screen.findAllByTestId('leg-row');
    fireEvent.click(await screen.findByRole('button', { name: 'Increase FXAERO by 1%' }));
    expect(await weightOf('FXAERO')).toHaveValue('61.00');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease FXAERO by 1%' }));
    expect(await weightOf('FXAERO')).toHaveValue('60.00');

    fireEvent.click(screen.getByRole('button', { name: 'Remove FXBIO' }));
    expect(screen.getAllByTestId('leg-row')).toHaveLength(1);
    expect(await weightOf('FXAERO')).toHaveValue('60.00');
    expect(screen.getByTestId('summary-remaining')).toHaveTextContent('30.00% unallocated');
    expect(screen.getByTestId('remaining-line')).toHaveTextContent('30.00% still unallocated');

    // The picker searches the admitted catalog; an instrument already in the basket cannot be added twice.
    fireEvent.change(screen.getByLabelText('Search admitted instruments to add'), {
      target: { value: 'x' },
    });
    const addBio = await screen.findByRole('button', { name: 'Add FXBIO' }, { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Add FXAERO' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(addBio);
    fireEvent.click(screen.getByRole('button', { name: 'Add AEROX' }));
    expect(screen.getAllByTestId('leg-row')).toHaveLength(3);
    expect(await weightOf('FXBIO')).toHaveValue('0.00');

    fireEvent.click(screen.getByRole('button', { name: 'Set equal weights' }));
    expect(await weightOf('FXAERO')).toHaveValue('33.33');
    expect(await weightOf('AEROX')).toHaveValue('33.33');
    expect(screen.getByTestId('summary-cash')).toHaveTextContent('0.01%');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('100.00%');
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision'),
      SAVE_WAIT,
    );
    await waitFor(
      () =>
        expect(lastPut()?.body).toMatchObject({
          content: {
            legs: [{ weightBps: 3333 }, { weightBps: 3333 }, { weightBps: 3333 }],
            cashWeightBps: 1,
          },
        }),
      SAVE_WAIT,
    );

    // Putting the remainder in cash is explicit too.
    fireEvent.change(await weightOf('AEROX'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Put the remainder in cash' }));
    expect(screen.getByTestId('summary-cash')).toHaveTextContent('13.34%');
    expect(screen.getByTestId('summary-total')).toHaveTextContent('100.00%');
  });

  it('reports an empty or cash-only draft by the backend’s rules', async () => {
    const api = server(content({ legs: [], cashWeightBps: 10_000 }));
    mountBuilder(api.routes);
    expect(await screen.findByTestId('no-legs')).toBeInTheDocument();
    expect(screen.getByTestId('validation-summary')).toHaveTextContent('No constituent');
    expect(screen.getByTestId('validation-summary')).toHaveTextContent(
      'cash alone is not a strategy',
    );
    expect(screen.getByRole('button', { name: 'Set equal weights' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('detects a draft saved in another tab, compares both revisions and keeps the chosen edits', async () => {
    const api = server(content());
    mountBuilder(api.routes);
    await screen.findAllByTestId('leg-row');
    // Another tab saves revision 2 with a different recipe.
    api.state.draft = draftOf(
      content({
        legs: [
          { instrumentId: AERO, weightBps: 5000, note: null },
          { instrumentId: XAERO, weightBps: 4000, note: null },
        ],
        cashWeightBps: 1000,
        title: 'Renamed elsewhere',
      }),
      2,
    );
    fireEvent.change(await weightOf('FXAERO'), { target: { value: '55' } });
    const panel = await screen.findByTestId('conflict-panel', {}, SAVE_WAIT);
    expect(screen.getByTestId('save-status')).toHaveTextContent('Conflict');
    expect(
      within(panel).getByText(/FXAERO: 50.00% on the server, 55.00% here/),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/You added FXBIO at 30.00%/)).toBeInTheDocument();
    expect(
      await within(panel).findByText(/The server revision has AEROX at 40.00%; yours does not/),
    ).toBeInTheDocument();
    expect(within(panel).getByText('The title differs.')).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Keep my edits (save as revision 3)' }),
    );
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision 3'),
      SAVE_WAIT,
    );
    expect(lastPut()?.body).toMatchObject({
      ifRevision: 2,
      content: {
        legs: [
          { instrumentId: AERO, weightBps: 5500 },
          { instrumentId: BIO, weightBps: 3000 },
        ],
      },
    });
    expect(screen.queryByTestId('conflict-panel')).toBeNull();
  });

  it('keeps offline edits on this device, scoped to the account, and saves them on retry', async () => {
    const api = server(content());
    let offline = true;
    mountBuilder(api.routes, '?stage=assemble', { offline: () => offline });
    await screen.findAllByTestId('leg-row');
    fireEvent.change(await weightOf('FXAERO'), { target: { value: '50' } });
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Offline changes'),
      SAVE_WAIT,
    );
    const stored =
      window.sessionStorage.getItem(localBasketKey(`${ALICE_ID}:s1`, S1)) ??
      window.sessionStorage.getItem(
        Object.keys(window.sessionStorage).find((key) => key.startsWith('markov.basket.')) ?? '',
      );
    expect(stored).not.toBeNull();
    const copy = JSON.parse(stored ?? '{}') as {
      baseRevision: number;
      content: StrategyDraftContent;
    };
    expect(copy.baseRevision).toBe(1);
    expect(copy.content.legs[0]?.weightBps).toBe(5000);
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision 2'),
      SAVE_WAIT,
    );
    expect(
      Object.keys(window.sessionStorage).filter((key) => key.startsWith('markov.basket.')),
    ).toEqual([]);
  });

  it('restores offline edits kept from an earlier visit only on request', async () => {
    const api = server(content(), 1);
    const key = localBasketKey(`${ALICE_ID}:s1`, S1);
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        baseRevision: 1,
        content: content({
          legs: [
            { instrumentId: AERO, weightBps: 7000, note: null },
            { instrumentId: BIO, weightBps: 2000, note: null },
          ],
        }),
        savedAt: new Date().toISOString(),
      }),
    );
    mountBuilder(api.routes);
    expect(await screen.findByText('Unsaved edits from this device')).toBeInTheDocument();
    expect(await weightOf('FXAERO')).toHaveValue('60.00');
    fireEvent.click(screen.getByRole('button', { name: 'Restore them' }));
    expect(await weightOf('FXAERO')).toHaveValue('70.00');
    await waitFor(
      () => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved as revision 2'),
      SAVE_WAIT,
    );
  });

  it('keeps the wallet and budget apart from the recipe and estimates the split exactly, without a review path', async () => {
    const api = server(content());
    mountBuilder(
      [
        ...api.routes,
        { method: 'GET', path: `${P}/v1/me/wallets`, reply: ok({ wallets: [] }) },
        {
          method: 'GET',
          path: `${P}/v1/me/limits`,
          reply: ok({
            effective: {
              maxOrderNotionalUsdcRaw: '500000000',
              maxDailyNotionalUsdcRaw: '2000000000',
              maxAccountNotionalUsdcRaw: '5000000000',
              maxIssuerConcentrationBps: 5000,
              maxCompanyConcentrationBps: 3000,
              maxSlippageBps: 50,
              maxQuoteAgeSeconds: 30,
              cashReserveBps: 200,
              allowedVenues: ['jupiter'],
            },
            owner: null,
            ceiling: {
              maxOrderNotionalUsdcRaw: '500000000',
              maxDailyNotionalUsdcRaw: '2000000000',
              maxAccountNotionalUsdcRaw: '5000000000',
              maxIssuerConcentrationBps: 5000,
              maxCompanyConcentrationBps: 3000,
              maxSlippageBps: 50,
              maxQuoteAgeSeconds: 30,
              cashReserveBps: 200,
              allowedVenues: ['jupiter'],
            },
            ceilingSource: 'policy_defaults',
            updatedAt: null,
          }),
        },
        {
          method: 'GET',
          path: `${P}/v1/me/eligibility`,
          reply: ok({
            capability: 'trade',
            outcome: 'eligible',
            decision: null,
            policyVersion: 'fixture-1',
            terms: { required: [], acknowledged: [], complete: true },
            steps: [],
            summary: 'Eligible under the fixture rule set.',
          }),
        },
        {
          method: 'GET',
          path: new RegExp(`${P}/v1/me/instruments/[0-9a-f-]+/availability`),
          reply: (url) => ({
            status: 200,
            body: {
              instrumentId: url.pathname.split('/')[6],
              capabilities: {
                discoverable: true,
                researchable: true,
                quoteable: false,
                buyable: false,
                sellable: false,
                redeemable: false,
                transferable: true,
              },
              conditions: ['execution_disabled'],
              reasons: [],
              evaluatedAt: NOW,
              policyVersion: 'fixture-1',
            },
          }),
        },
      ],
      '?stage=activate',
    );
    expect(await screen.findByText('No verified wallet yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verify a wallet' })).toHaveAttribute(
      'href',
      '/settings/wallets',
    );
    fireEvent.change(screen.getByLabelText(/^Budget \(/), { target: { value: '1000' } });
    const rows = await screen.findAllByTestId('estimate-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/600(\.0+)? stablecoin/);
    expect(rows[1]).toHaveTextContent(/300(\.0+)? stablecoin/);
    expect(screen.getByTestId('cash-estimate')).toHaveTextContent(/100(\.0+)? stablecoin/);
    expect(
      await screen.findByText('Above your per-order limit; the review will refuse or split it.'),
    ).toBeInTheDocument();
    expect(await within(rows[0] as HTMLElement).findByText('Not buyable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review investment' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/Freeze a version first/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Budget \(/), { target: { value: '0.000001' } });
    expect((await screen.findAllByText('too small to buy anything')).length).toBe(2);
    // Sending a plan never touches the recipe.
    expect(stub.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('opens an archived draft read-only and a foreign id as not found', async () => {
    const api = server(content());
    api.state.status = 'archived';
    mountBuilder(api.routes);
    expect(
      await screen.findByText(
        'An archived draft takes no edits; restore it to continue. Nothing was deleted.',
      ),
    ).toBeInTheDocument();
    expect(await weightOf('FXAERO')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove FXAERO' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    mountBuilder([
      {
        method: 'GET',
        path: `${P}/v1/me/strategies/${S1}`,
        reply: () => ({
          status: 404,
          body: {
            error: { code: 'NOT_FOUND', message: 'no strategy with that id', requestId: 'r' },
          },
        }),
      },
    ]);
    expect(await screen.findByText('No basket draft with that id')).toBeInTheDocument();
  });
});

describe('Start a basket', () => {
  it('creates a server draft and opens the editor; an older strategyId link is redirected', async () => {
    nav.search = '';
    nav.pathname = '/strategies/new';
    stub = stubFetch(
      [
        {
          method: 'GET',
          path: `${P}/v1/me/strategies`,
          reply: ok({ strategies: [{ ...detailOf(content()).strategy, title: 'Aerospace tilt' }] }),
        },
        {
          method: 'POST',
          path: `${P}/v1/me/strategies`,
          reply: ok(detailOf(content({ legs: [], cashWeightBps: 0 })), 201),
        },
      ],
      alice,
    );
    vi.stubGlobal('fetch', stub.impl);
    render(
      <Harness session={alice}>
        <NewBasketView />
      </Harness>,
    );
    const row = await screen.findByTestId('basket-draft-row');
    expect(within(row).getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      `/strategies/${S1}/edit`,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'New basket' } });
    fireEvent.change(screen.getByLabelText(/^Thesis in your words/), {
      target: { value: 'A reason.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(`/strategies/${S1}/edit?stage=assemble`),
    );
    expect(stub.calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      content: { title: 'New basket', legs: [], cashWeightBps: 0 },
    });

    nav.search = `?strategyId=${S1}`;
    render(
      <Harness session={alice}>
        <NewBasketView />
      </Harness>,
    );
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/strategies/${S1}/edit`));
  });
});
