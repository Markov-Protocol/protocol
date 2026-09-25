import type {
  InstrumentDetail,
  PublicThesis,
  ResearchRun,
  SourceRecord,
  StrategyDetail,
  ThesisDetail,
  ThesisRevision,
} from '@markov/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { MarketDetailView } from '../src/features/markets/market-detail-view';
import { ThesisView } from '../src/features/research/thesis-view';
import { WorkspaceView } from '../src/features/research/workspace-view';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: '/research',
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
const BIO = '22222222-2222-4222-8222-222222222222';
const XAERO = '33333333-3333-4333-8333-333333333333';
const T1 = '55555555-5555-4555-8555-555555555555';
const R1 = '66666666-6666-4666-8666-666666666666';
const SRC_OK = '77777777-7777-4777-8777-777777777777';
const SRC_BLOCKED = '88888888-8888-4888-8888-888888888888';
const SRC_FAILED = '99999999-9999-4999-8999-999999999999';
const RUN1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-09-24T12:00:00.000Z';
const ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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
const bob: SessionSnapshot = {
  state: 'signed-in',
  account: {
    userId: 'user-bob',
    subject: 'did:test:bob',
    issuer: 'urn:markov:test',
    authTime: null,
    stepUpFresh: true,
  },
  session: { sessionId: 's2', expiresAt: '2030-01-01T00:00:00.000Z' },
};

function instrumentDetail(overrides: Partial<InstrumentDetail> = {}): InstrumentDetail {
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
    metadata: { website: 'https://example.com/fixture-aerospace', description: 'Rockets.' },
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

const fetchedSource: SourceRecord = {
  sourceId: SRC_OK,
  thesisId: T1,
  role: 'issuer',
  url: 'https://issuer.example/terms',
  finalUrl: 'https://issuer.example/terms',
  title: 'Issuer terms',
  status: 'fetched',
  blockedReason: null,
  contentType: 'text/html',
  byteLength: 2048,
  contentHash: 'c'.repeat(64),
  excerpt: 'Holders have no voting rights <b>bold</b> and no redemption right.',
  publishedAt: '2026-09-01T00:00:00.000Z',
  observedAt: null,
  retrievedAt: NOW,
  redirects: [],
};
const blockedSource: SourceRecord = {
  ...fetchedSource,
  sourceId: SRC_BLOCKED,
  role: 'other',
  url: ['javascript', 'alert(1)'].join(':'),
  finalUrl: null,
  title: null,
  status: 'blocked',
  blockedReason: 'only https URLs are retrieved',
  contentType: null,
  byteLength: null,
  contentHash: null,
  excerpt: null,
  publishedAt: null,
};
const failedSource: SourceRecord = {
  ...fetchedSource,
  sourceId: SRC_FAILED,
  role: 'news',
  url: 'https://news.example/story',
  finalUrl: 'https://news.example/story',
  title: null,
  status: 'failed',
  blockedReason: 'HTTP 500',
  excerpt: null,
  contentHash: null,
  byteLength: null,
  contentType: null,
  publishedAt: null,
};

function revision(overrides: Partial<ThesisRevision> = {}): ThesisRevision {
  return {
    revisionId: R1,
    thesisId: T1,
    revisionNumber: 1,
    title: 'Aerospace thesis',
    claim: 'Launch cadence is underestimated.',
    statements: [
      {
        statementId: 'op-1',
        kind: 'user_opinion',
        topic: 'general',
        text: 'I think the launch cadence is underestimated.',
        sourceIds: [],
        runId: null,
      },
      {
        statementId: 'ia-1',
        kind: 'issuer_assertion',
        topic: 'rights',
        text: 'The issuer states that holders have no voting rights.',
        sourceIds: [SRC_OK],
        runId: null,
      },
    ],
    counterarguments: ['Marks are stale.'],
    instruments: [{ instrumentId: AERO, note: 'core exposure' }],
    subjects: [{ name: 'Unknown Rocket Co', note: null }],
    privateNotes: 'Budget: 5k, do not publish',
    authorPrincipal: `user:${ALICE_ID}`,
    contentHash: 'a'.repeat(64),
    createdAt: NOW,
    ...overrides,
  };
}

function thesisDetail(overrides: Partial<ThesisDetail> = {}): ThesisDetail {
  return {
    thesis: {
      thesisId: T1,
      ownerUserId: ALICE_ID,
      visibility: 'private',
      status: 'draft',
      currentRevisionNumber: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    revision: revision(),
    sources: [fetchedSource, blockedSource, failedSource],
    ...overrides,
  };
}

const publicThesis: PublicThesis = {
  thesisId: T1,
  revisionNumber: 3,
  contentHash: 'd'.repeat(64),
  title: 'Aerospace thesis',
  claim: 'Launch cadence is underestimated.',
  statements: [
    ...revision().statements,
    {
      statementId: 'run-aaaaaaaa-1',
      kind: 'model_inference',
      topic: 'general',
      text: 'According to the issuer source, holders have no voting rights.',
      sourceIds: [SRC_OK],
      runId: RUN1,
    },
  ],
  counterarguments: ['Marks are stale.'],
  instruments: [{ instrumentId: AERO, note: 'core exposure' }],
  subjects: [{ name: 'Unknown Rocket Co', note: null }],
  sources: [{ ...fetchedSource }].map(({ thesisId: _t, ...rest }) => rest),
  publishedAt: NOW,
};

function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    runId: RUN1,
    thesisId: T1,
    ownerUserId: ALICE_ID,
    status: 'running',
    question: 'What rights do holders have?',
    sourceIds: [SRC_OK],
    budget: { maxOutputChars: 4000, maxStatements: 8 },
    provenance: null,
    output: null,
    error: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

const limits = {
  schemaVersion: '1',
  kinds: ['stock_spot_basket'],
  totalBps: 10_000,
  maxLegs: 10,
  maxIssuerConcentrationBps: 5000,
  maxCompanyConcentrationBps: 3000,
  ceilingSource: 'policy_defaults',
};

function strategyDetail(
  legs: readonly { instrumentId: string; weightBps: number }[],
  cashWeightBps: number,
): StrategyDetail {
  const legsBps = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  return {
    strategy: {
      strategyId: S1,
      ownerUserId: ALICE_ID,
      status: 'active',
      forkOf: null,
      currentVersion: null,
      draftRevision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    },
    draft: {
      strategyId: S1,
      revision: 1,
      content: {
        title: 'Aerospace thesis',
        thesis: 'Launch cadence is underestimated.',
        thesisId: T1,
        kind: 'stock_spot_basket',
        legs: legs.map((leg) => ({ ...leg, note: null })),
        cashWeightBps,
        maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
        references: [],
      },
      validation: {
        valid: true,
        issues: [],
        totals: { legsBps, cashBps: cashWeightBps, totalBps: legsBps + cashWeightBps },
        limits,
        evaluatedAt: NOW,
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    versions: [],
  } as StrategyDetail;
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

const ok =
  (body: unknown, status = 200): Responder =>
  () => ({ status, body });
function envelope(status: number, code: string, message = code, details: unknown[] = []): Reply {
  return { status, body: { error: { code, message, requestId: 'r', details } } };
}

const P = '/api/markov';
const ownerRoutes = (detail = thesisDetail()): Route[] => [
  { method: 'GET', path: `${P}/v1/me/theses/${T1}`, reply: ok(detail) },
  {
    method: 'GET',
    path: `${P}/v1/me/theses/${T1}/revisions`,
    reply: ok({ revisions: [detail.revision] }),
  },
  { method: 'GET', path: `${P}/v1/me/research/runs`, reply: ok({ runs: [] }) },
  { method: 'GET', path: `${P}/v1/catalog/instruments/${AERO}`, reply: ok(instrumentDetail()) },
  {
    method: 'GET',
    path: `${P}/v1/catalog/instruments/${BIO}`,
    reply: ok(
      instrumentDetail({ instrumentId: BIO, symbol: 'FXBIO', companyName: 'Fixture Biotech Ltd' }),
    ),
  },
  {
    method: 'GET',
    path: `${P}/v1/catalog/instruments/${XAERO}`,
    reply: ok(
      instrumentDetail({
        instrumentId: XAERO,
        symbol: 'AEROX',
        issuer: 'xstocks',
        kind: 'listed_stock',
      }),
    ),
  },
  { method: 'GET', path: `${P}/v1/strategies/limits`, reply: ok(limits) },
];

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

function mount(routes: Route[], session: SessionSnapshot, pathname: string, element: ReactNode) {
  nav.search = '';
  nav.pathname = pathname;
  stub = stubFetch(routes, session);
  vi.stubGlobal('fetch', stub.impl);
  return render(<Harness session={session}>{element}</Harness>);
}

beforeEach(() => {
  nav.search = '';
  nav.push.mockClear();
  nav.replace.mockClear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe('Research workspace', () => {
  it('lists the person’s theses and starts a private one that opens in the editor', async () => {
    mount(
      [
        {
          method: 'GET',
          path: `${P}/v1/me/theses`,
          reply: ok({
            theses: [
              {
                ...thesisDetail().thesis,
                title: 'Aerospace thesis',
                claim: 'Launch cadence is underestimated.',
                instrumentIds: [AERO],
              },
            ],
          }),
        },
        { method: 'POST', path: `${P}/v1/me/theses`, reply: ok(thesisDetail(), 201) },
      ],
      alice,
      '/research',
      <WorkspaceView />,
    );
    const row = await screen.findByTestId('thesis-row');
    expect(within(row).getByRole('link', { name: 'Aerospace thesis' })).toHaveAttribute(
      'href',
      `/research/${T1}`,
    );
    expect(within(row).getByText('Private')).toBeInTheDocument();
    expect(within(row).getByText(/Revision 1 · 1 instrument/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'New idea' } });
    fireEvent.change(screen.getByLabelText(/^Claim/), { target: { value: 'A <b>claim</b>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create private thesis' }));
    expect(
      await screen.findByText('Markup (< or >) is not allowed; write plain text.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Claim/), { target: { value: 'A plain claim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create private thesis' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/research/${T1}`));
    const create = stub.calls.find((call) => call.method === 'POST');
    expect(create?.body).toMatchObject({
      visibility: 'private',
      revision: { title: 'New idea', claim: 'A plain claim', instruments: [], privateNotes: null },
    });
  });
});

describe('Thesis editor', () => {
  it('renders sources as data with safe links only, keeps private notes private and saves an immutable revision', async () => {
    let saved: ThesisRevision | null = null;
    const { container } = mount(
      [
        ...ownerRoutes(),
        {
          method: 'POST',
          path: `${P}/v1/me/theses/${T1}/revisions`,
          reply: (_url, init) => {
            const body = JSON.parse(String(init?.body)) as { title: string };
            saved = revision({
              revisionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              revisionNumber: 2,
              title: body.title,
            });
            return { status: 201, body: saved };
          },
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    expect(await screen.findByLabelText(/^Title/)).toHaveValue('Aerospace thesis');
    expect(screen.getByTestId('private-notes')).toHaveValue('Budget: 5k, do not publish');
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();

    // Source records: excerpt as text (markup never rendered), a javascript: URL never linked, refusals stated.
    const cards = screen.getAllByTestId('source-card');
    expect(cards).toHaveLength(3);
    expect(screen.getByTestId('source-excerpt')).toHaveTextContent(
      'Holders have no voting rights <b>bold</b>',
    );
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByText(/link withheld: not an https destination/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://issuer.example/terms' })).toHaveAttribute(
      'rel',
      'noreferrer noopener',
    );
    expect(
      screen.getByText(/Markov refused to retrieve this URL: only https URLs are retrieved/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The retrieval failed: HTTP 500/)).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText(/^Published .*Fetched/)).toBeInTheDocument();

    // Statements keep their kinds; the issuer assertion cites the fetched source.
    const rows = screen.getAllByTestId('statement-row');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[1] as HTMLElement).getByRole('checkbox', { name: /Issuer terms/ }),
    ).toBeChecked();

    // Editing marks the form dirty; saving appends revision 2 and reports it.
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Aerospace thesis, revised' },
    });
    expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('Saved as revision 2'),
    );
    const post = stub.calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      title: 'Aerospace thesis, revised',
      privateNotes: 'Budget: 5k, do not publish',
      instruments: [{ instrumentId: AERO, note: 'core exposure' }],
    });
    expect(saved).not.toBeNull();
    expect(screen.getByText(/Revision 2 saved/)).toBeInTheDocument();
  });

  it('keeps the edits when a save is refused and maps the API’s rule to the statement', async () => {
    mount(
      [
        ...ownerRoutes(),
        {
          method: 'POST',
          path: `${P}/v1/me/theses/${T1}/revisions`,
          reply: () =>
            envelope(400, 'VALIDATION_FAILED', 'the revision breaks a research rule', [
              {
                path: 'statements/1',
                message:
                  'an issuer assertion about rights must cite an issuer, legal or filing source',
              },
            ]),
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Claim/), {
      target: { value: 'Edited claim that must survive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('The API refused this revision'),
    );
    expect(screen.getByText(/an issuer assertion about rights must cite/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Claim/)).toHaveValue('Edited claim that must survive');

    // A local rule stops the round trip: a fact without a citation.
    fireEvent.click(screen.getByRole('button', { name: 'Add a statement' }));
    const rows = screen.getAllByTestId('statement-row');
    const added = rows[rows.length - 1] as HTMLElement;
    fireEvent.change(within(added).getByLabelText(/^Text/), { target: { value: 'Something' } });
    const before = stub.calls.filter((call) => call.method === 'POST').length;
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(before);
  });

  it('shows run progress, cancels a run, and says when no model provider exists', async () => {
    let status: ResearchRun['status'] = 'running';
    mount(
      [
        ...ownerRoutes(),
        { method: 'POST', path: `${P}/v1/me/research/runs`, reply: ok(run(), 201) },
        {
          method: 'GET',
          path: `${P}/v1/me/research/runs/${RUN1}`,
          reply: () => ({ status: 200, body: run({ status }) }),
        },
        {
          method: 'POST',
          path: `${P}/v1/me/research/runs/${RUN1}/cancel`,
          reply: () => {
            status = 'cancelled';
            return { status: 200, body: run({ status, finishedAt: NOW }) };
          },
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Question/), {
      target: { value: 'What rights do holders have?' },
    });
    const runForm = screen.getByRole('form', { name: 'Start a research run' });
    fireEvent.click(within(runForm).getByRole('checkbox', { name: /Issuer terms/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    const active = await screen.findByTestId('active-run');
    expect(within(active).getByText('running')).toBeInTheDocument();
    fireEvent.click(within(active).getByRole('button', { name: 'Cancel run' }));
    expect(await within(active).findByText('Cancelled')).toBeInTheDocument();
    expect(
      stub.calls.find((call) => call.method === 'POST' && call.url.endsWith('/runs'))?.body,
    ).toMatchObject({
      thesisId: T1,
      sourceIds: [SRC_OK],
    });
  });

  it('reports an absent model provider instead of pretending to run', async () => {
    mount(
      [
        ...ownerRoutes(),
        {
          method: 'POST',
          path: `${P}/v1/me/research/runs`,
          reply: () => envelope(503, 'PROVIDER_UNAVAILABLE', 'no model provider is configured'),
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Question/), { target: { value: 'Anything?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(
      await screen.findByText('Runs are not available in this deployment'),
    ).toBeInTheDocument();
  });

  it('adopts a finished run’s output only as labelled model interpretations and confirmed instruments', async () => {
    const finishedRun = run({
      status: 'succeeded',
      finishedAt: NOW,
      provenance: {
        provider: 'fixture',
        model: 'fixture-research',
        modelVersion: '2026-09-24',
        promptHash: 'e'.repeat(64),
        toolCalls: [],
        budgetUsed: { outputChars: 60, statements: 1 },
      },
      output: {
        draft: [
          {
            statementId: 'run-aaaaaaaa-1',
            kind: 'model_inference',
            topic: 'general',
            text: 'According to the issuer source, holders have no voting rights.',
            sourceIds: [SRC_OK],
            runId: RUN1,
          },
        ],
        suggestedInstrumentIds: [BIO],
        unmatchedCompanies: ['Unknown Rocket Co', 'Mystery Motors Inc'],
        rejected: ['instrument 12345678-1234-4123-8123-123456789012'],
      },
    });
    mount(
      [
        ...ownerRoutes(),
        {
          method: 'POST',
          path: `${P}/v1/me/research/runs`,
          reply: ok(finishedRun, 201),
        },
        {
          method: 'GET',
          path: `${P}/v1/me/research/runs/${RUN1}`,
          reply: ok(finishedRun),
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    await screen.findByLabelText(/^Title/);
    fireEvent.change(screen.getByLabelText(/^Question/), {
      target: { value: 'What rights do holders have?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    const output = await screen.findByTestId('run-output');
    expect(
      within(output).getByText('Model interpretation, not an issuer fact'),
    ).toBeInTheDocument();
    expect(
      within(output).getByText(/Dropped by validation: instrument 12345678/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('run-provenance')).toHaveTextContent(
      'fixture / fixture-research 2026-09-24',
    );
    fireEvent.click(
      within(output).getByRole('button', {
        name: 'Add these to the thesis as model interpretations',
      }),
    );
    const rows = screen.getAllByTestId('statement-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[2] as HTMLElement).getByText('Model interpretation')).toBeInTheDocument();
    fireEvent.click(await within(output).findByRole('button', { name: 'Add to shortlist' }));
    await waitFor(() => expect(screen.getAllByTestId('shortlist-row')).toHaveLength(2));
    fireEvent.click(
      within(output).getAllByRole('button', { name: 'Add as research subject' })[1] as HTMLElement,
    );
    expect(
      within(screen.getByRole('list', { name: 'Research subjects' })).getByText(
        'Mystery Motors Inc',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Unsaved changes');
  });

  it('starts a basket draft from the saved shortlist with equal weights and the exact cash remainder', async () => {
    const detail = thesisDetail({
      revision: revision({
        instruments: [
          { instrumentId: AERO, note: null },
          { instrumentId: BIO, note: null },
          { instrumentId: XAERO, note: null },
        ],
      }),
    });
    mount(
      [
        ...ownerRoutes(detail),
        {
          method: 'POST',
          path: `${P}/v1/me/strategies`,
          reply: (_url, init) => {
            const body = JSON.parse(String(init?.body)) as {
              content: {
                legs: { instrumentId: string; weightBps: number }[];
                cashWeightBps: number;
              };
            };
            return {
              status: 201,
              body: strategyDetail(body.content.legs, body.content.cashWeightBps),
            };
          },
        },
      ],
      alice,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    await screen.findByLabelText(/^Title/);
    expect(
      await screen.findByText(/Starts a basket draft with 3 constituents/),
    ).toBeInTheDocument();
    expect(screen.getByText('33.33%')).toBeInTheDocument();
    expect(screen.getByText('0.01%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a basket draft' }));
    expect(await screen.findByText('Basket draft saved')).toBeInTheDocument();
    const post = stub.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/strategies'),
    );
    expect(post?.body).toEqual({
      content: {
        title: 'Aerospace thesis',
        thesis: 'Launch cadence is underestimated.',
        thesisId: T1,
        kind: 'stock_spot_basket',
        legs: [
          { instrumentId: AERO, weightBps: 3333, note: null },
          { instrumentId: BIO, weightBps: 3333, note: null },
          { instrumentId: XAERO, weightBps: 3333, note: null },
        ],
        cashWeightBps: 1,
        maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
        references: [],
      },
    });
    expect(screen.getByTestId('basket-validation')).toHaveTextContent('total 100.00%');
    expect(screen.getByRole('link', { name: 'Open in Build' })).toHaveAttribute(
      'href',
      `/strategies/${S1}/edit`,
    );
  });
});

describe('Thesis access', () => {
  it('answers "not found or private" to another signed-in person and shows the published projection to anyone', async () => {
    mount(
      [
        {
          method: 'GET',
          path: `${P}/v1/me/theses/${T1}`,
          reply: () => envelope(404, 'NOT_FOUND', 'no thesis with that id'),
        },
        {
          method: 'GET',
          path: `${P}/v1/research/theses/${T1}`,
          reply: () => envelope(404, 'NOT_FOUND', 'no published thesis with that id'),
        },
      ],
      bob,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    expect(await screen.findByText('No thesis with that id, or it is private')).toBeInTheDocument();
    expect(screen.queryByText(/Budget: 5k/)).toBeNull();
  });

  it('renders the public projection without private notes and with model output labelled', async () => {
    const { container } = mount(
      [
        { method: 'GET', path: `${P}/v1/research/theses/${T1}`, reply: ok(publicThesis) },
        {
          method: 'GET',
          path: `${P}/v1/catalog/instruments/${AERO}`,
          reply: ok(instrumentDetail()),
        },
      ],
      anonymous,
      `/research/${T1}`,
      <ThesisView thesisId={T1} />,
    );
    expect(await screen.findByTestId('public-thesis')).toBeInTheDocument();
    expect(screen.getByText('Published projection')).toBeInTheDocument();
    expect(screen.getAllByTestId('public-statement')).toHaveLength(3);
    expect(screen.getByText('Model interpretation')).toBeInTheDocument();
    expect(screen.getByText('Research subject, not tradable')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Budget: 5k');
    expect(container.textContent).not.toContain('Private notes');
    expect(screen.getAllByRole('link', { name: '[1]' })[0]).toHaveAttribute(
      'href',
      `#source-${SRC_OK}`,
    );
    expect(
      await screen.findByRole('link', { name: 'FXAERO · Fixture Aerospace Inc' }),
    ).toHaveAttribute('href', `/markets/${AERO}`);
    expect(stub.calls.some((call) => call.url.includes('/v1/me/'))).toBe(false);
  });
});

describe('Market detail research integration', () => {
  it('lists theses mentioning the instrument, starts one, states the evidence rules and route information honestly, and adds to a basket', async () => {
    mount(
      [
        {
          method: 'GET',
          path: `${P}/v1/catalog/instruments/${AERO}`,
          reply: ok(instrumentDetail()),
        },
        {
          method: 'GET',
          path: `${P}/v1/catalog/instruments/${AERO}/corporate-actions`,
          reply: ok({ actions: [] }),
        },
        {
          method: 'GET',
          path: `${P}/v1/me/instruments/${AERO}/availability`,
          reply: () => envelope(503, 'PROVIDER_UNAVAILABLE'),
        },
        {
          method: 'GET',
          path: `${P}/v1/me/theses`,
          reply: (url) => ({
            status: 200,
            body: {
              theses:
                url.searchParams.get('instrumentId') === AERO
                  ? [
                      {
                        ...thesisDetail().thesis,
                        title: 'Aerospace thesis',
                        claim: 'c',
                        instrumentIds: [AERO],
                      },
                    ]
                  : [],
            },
          }),
        },
        { method: 'POST', path: `${P}/v1/me/theses`, reply: ok(thesisDetail(), 201) },
        {
          method: 'POST',
          path: `${P}/v1/me/strategies`,
          reply: (_url, init) => {
            const body = JSON.parse(String(init?.body)) as {
              content: {
                legs: { instrumentId: string; weightBps: number }[];
                cashWeightBps: number;
              };
            };
            return {
              status: 201,
              body: strategyDetail(body.content.legs, body.content.cashWeightBps),
            };
          },
        },
      ],
      alice,
      `/markets/${AERO}`,
      <MarketDetailView instrumentId={AERO} />,
    );
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Fixture Aerospace pre-IPO exposure',
    );
    expect(screen.getByTestId('rights-evidence')).toHaveTextContent(
      'carries no shareholder rights of its own',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to a new basket draft' }));
    expect(await screen.findByText(/Basket draft saved \(revision 1\)/)).toBeInTheDocument();
    const basket = stub.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/strategies'),
    );
    expect(basket?.body).toMatchObject({
      content: {
        legs: [{ instrumentId: AERO, weightBps: 10_000 }],
        cashWeightBps: 0,
        thesisId: null,
      },
    });

    activateTab('Research');
    const row = await screen.findByTestId('instrument-thesis-row');
    expect(within(row).getByRole('link', { name: 'Aerospace thesis' })).toHaveAttribute(
      'href',
      `/research/${T1}`,
    );
    expect(stub.calls.some((call) => call.url === `${P}/v1/me/theses?instrumentId=${AERO}`)).toBe(
      true,
    );
    expect(
      screen.getByText(/Claims about backing, rights, fees or redemption must cite/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Claim/), {
      target: { value: 'Worth a small position.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create private thesis' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/research/${T1}`));
    expect(
      stub.calls.find((call) => call.method === 'POST' && call.url.endsWith('/theses'))?.body,
    ).toMatchObject({
      revision: {
        instruments: [{ instrumentId: AERO, note: null }],
        claim: 'Worth a small position.',
      },
    });

    activateTab('Liquidity');
    const routes = await screen.findByTestId('route-observations');
    expect(within(routes).getByText('Route information unavailable')).toBeInTheDocument();
    expect(within(routes).getAllByText('Not observed')).toHaveLength(5);
  });

  it('asks anonymous people to sign in before researching, without touching private routes', async () => {
    mount(
      [
        {
          method: 'GET',
          path: `${P}/v1/catalog/instruments/${AERO}`,
          reply: ok(instrumentDetail()),
        },
        {
          method: 'GET',
          path: `${P}/v1/catalog/instruments/${AERO}/corporate-actions`,
          reply: ok({ actions: [] }),
        },
      ],
      anonymous,
      `/markets/${AERO}`,
      <MarketDetailView instrumentId={AERO} />,
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Available after sign-in')).toBeInTheDocument();
    activateTab('Research');
    expect(await screen.findByText('Sign in to research this exposure')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent(`/markets/${AERO}`)}`,
    );
    expect(stub.calls.some((call) => call.url.includes('/v1/me/'))).toBe(false);
  });
});
