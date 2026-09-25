import type {
  ExecutionPlan,
  InstrumentDetail,
  Intent,
  PublicStrategy,
  StrategyDetail,
  StrategyVersion,
} from '@markov/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { ReviewView } from '../src/features/review/review-view';
import { StartReviewView } from '../src/features/review/start-review-view';
import { describeWallet, type WalletRegistry } from '../src/features/wallets/standard';
import { useWallet, WalletProvider } from '../src/features/wallets/wallet-context';
import { batch, status as executionStatus } from './execution-fixtures';
import {
  AERO,
  GENESIS,
  HASH,
  HASH_2,
  INTENT_ID,
  intent,
  MINT_A,
  OTHER,
  OWNER,
  PLAN_ID,
  PLAN_ID_2,
  plan,
  S1,
  STABLECOIN,
  singlePlan,
  V1,
  WALLET_ID,
  XSA,
} from './review-fixtures';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: `/review/${INTENT_ID}`,
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

/* ------------------------------------------------------------- fixtures */

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: false,
};
const ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW_ISO = '2026-09-25T10:00:00.000Z';
const alice: SessionSnapshot = {
  state: 'signed-in',
  account: {
    userId: ALICE_ID,
    subject: 'did:test:alice',
    issuer: 'urn:markov:test',
    authTime: null,
    stepUpFresh: true,
  },
  session: { sessionId: 's-alice', expiresAt: '2030-01-01T00:00:00.000Z' },
};

const wallets = {
  wallets: [
    {
      walletId: WALLET_ID,
      chain: 'solana',
      genesisHash: GENESIS,
      address: OWNER,
      verifiedAt: NOW_ISO,
    },
  ],
};
const funding = {
  walletId: WALLET_ID,
  chain: 'solana',
  cluster: 'devnet',
  genesisHash: GENESIS,
  address: OWNER,
  observedAt: NOW_ISO,
  slot: 4242,
  commitment: 'confirmed',
  source: 'rpc',
  sol: { lamports: '50000000', sufficientForFees: true },
  stablecoin: {
    symbol: 'USDC',
    mint: STABLECOIN,
    decimals: 6,
    raw: '2500000000',
    tokenAccounts: 1,
  },
  stablecoinUnavailableReason: null,
  requirements: {
    rentExemptTokenAccountLamports: '2039280',
    baseFeeLamportsPerSignature: '5000',
    assumedSignatures: 2,
    requiredLamports: '10000',
    explanation: '2 signatures at the base fee of 5000 lamports each.',
  },
  readiness: 'funded',
};
const limits = {
  effective: {
    maxOrderNotionalUsdcRaw: '1000000000',
    maxDailyNotionalUsdcRaw: '5000000000',
    maxAccountNotionalUsdcRaw: '25000000000',
    maxIssuerConcentrationBps: 5000,
    maxCompanyConcentrationBps: 3000,
    maxSlippageBps: 100,
    maxQuoteAgeSeconds: 60,
    cashReserveBps: 0,
    allowedVenues: ['jupiter'],
  },
  owner: null,
  ceiling: {
    maxOrderNotionalUsdcRaw: '1000000000',
    maxDailyNotionalUsdcRaw: '5000000000',
    maxAccountNotionalUsdcRaw: '25000000000',
    maxIssuerConcentrationBps: 5000,
    maxCompanyConcentrationBps: 3000,
    maxSlippageBps: 100,
    maxQuoteAgeSeconds: 60,
    cashReserveBps: 0,
    allowedVenues: ['jupiter'],
  },
  ceilingSource: 'policy_defaults',
  updatedAt: null,
};
const eligibility = {
  capability: 'trade_stocks',
  outcome: 'eligible',
  decision: null,
  policyVersion: '2026-09-24',
  terms: { required: [], acknowledged: [], complete: true },
  steps: [],
  summary: 'Eligible under the fixture policy.',
};

const HOLD = { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null } as const;
function ownVersion(): StrategyVersion {
  const admission = (mint: string, tokenProgram: 'spl-token' | 'token-2022', decimals: number) => ({
    status: 'admitted' as const,
    admittedAt: NOW_ISO,
    verificationId: 1,
    verifiedAt: NOW_ISO,
    mint,
    tokenProgram,
    decimals,
    genesisHash: GENESIS,
  });
  return {
    versionId: V1,
    strategyId: S1,
    versionNumber: 1,
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    authorPrincipal: `user:${ALICE_ID}`,
    publisherWallet: null,
    parentVersionId: null,
    forkOf: null,
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    legs: [
      {
        instrumentId: AERO,
        weightBps: 6000,
        note: null,
        issuer: 'prestocks',
        symbol: 'FXAERO',
        companyName: 'Fixture Aerospace Inc',
        admission: admission(MINT_A, 'spl-token', 6),
      },
      {
        instrumentId: XSA,
        weightBps: 3000,
        note: null,
        issuer: 'xstocks',
        symbol: 'XSFXA',
        companyName: 'Fixture Alpha AG',
        admission: admission('A8GviP6cWZxAKfpCoKfQCvtSejyPh975CoLjsVVqmumh', 'token-2022', 8),
      },
    ],
    cashWeightBps: 1000,
    maintenance: HOLD,
    disclosures: { issuers: [], companies: [] },
    references: [],
    manifestHash: '9f9f9f9f'.padEnd(64, '2'),
    contentDigest: '8e8e8e8e'.padEnd(64, '3'),
    publication: 'unpublished',
    moderation: 'none',
    deprecatedBy: null,
    frozenAt: NOW_ISO,
  };
}

function strategyDetail(versionNumbers: readonly number[]): StrategyDetail {
  return {
    strategy: {
      strategyId: S1,
      ownerUserId: ALICE_ID,
      status: 'active',
      forkOf: null,
      currentVersion: null,
      draftRevision: 3,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    draft: {
      strategyId: S1,
      revision: 3,
      content: {
        title: 'Aerospace tilt',
        thesis: 'x',
        thesisId: null,
        kind: 'stock_spot_basket',
        legs: [{ instrumentId: AERO, weightBps: 9000, note: null }],
        cashWeightBps: 1000,
        maintenance: HOLD,
        references: [],
      },
      validation: {
        valid: true,
        issues: [],
        totals: { legsBps: 9000, cashBps: 1000, totalBps: 10_000 },
        limits: {
          schemaVersion: '1',
          kinds: ['stock_spot_basket'],
          totalBps: 10_000,
          maxLegs: 10,
          maxIssuerConcentrationBps: 10_000,
          maxCompanyConcentrationBps: 10_000,
          ceilingSource: 'policy_defaults',
        },
        evaluatedAt: NOW_ISO,
      },
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    versions: versionNumbers.map((versionNumber) => ({
      versionId: versionNumber === 1 ? V1 : `cccccccc-cccc-4ccc-8ccc-ccccccccccc${versionNumber}`,
      strategyId: S1,
      versionNumber,
      title: 'Aerospace tilt',
      manifestHash: '9f9f9f9f'.padEnd(64, '2'),
      publication: 'unpublished',
      deprecatedBy: null,
      frozenAt: NOW_ISO,
    })),
  };
}

const instrument: InstrumentDetail = {
  instrumentId: AERO,
  issuer: 'prestocks',
  issuerProductId: 'fx-aero-001',
  symbol: 'FXAERO',
  name: 'Fixture Aerospace pre-IPO exposure',
  companyName: 'Fixture Aerospace Inc',
  kind: 'pre_ipo_exposure',
  chain: 'solana',
  genesisHash: GENESIS,
  mint: MINT_A,
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
    multiplierEffectiveAt: '2026-09-01T00:00:00.000Z',
  },
  availability: { research: true, strategy: true, trade: false, reasons: [] },
  admittedAt: NOW_ISO,
  updatedAt: NOW_ISO,
  latestMintVerification: null,
};

/** Plans with validity relative to the real clock, since the review counts down with it. */
function livePlan(overrides: Partial<ExecutionPlan> = {}, secondsValid = 120): ExecutionPlan {
  const expires = new Date(Date.now() + secondsValid * 1000).toISOString();
  const base = plan();
  return plan({
    validity: { ...base.validity, quotesExpireAt: expires, expiresAt: expires },
    ...overrides,
  });
}

/* ---------------------------------------------------------- fake wallet */

function fakeWallet(address = OWNER, chains: readonly string[] = ['solana:devnet']) {
  const account = {
    address,
    publicKey: new Uint8Array(32),
    chains,
    features: ['solana:signMessage', 'solana:signTransaction'],
  } as unknown as WalletAccount;
  const state: { accounts: WalletAccount[] } = { accounts: [] };
  return {
    version: '1.0.0',
    name: 'Fixture Wallet',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains,
    get accounts() {
      return state.accounts;
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          state.accounts = [account];
          return { accounts: [account] };
        },
      },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => undefined },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
      'solana:signMessage': { version: '1.1.0', signMessage: async () => [] },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async () => [],
      },
    },
  } as unknown as Wallet;
}

function registryOf(...items: Wallet[]): WalletRegistry {
  const described = items.map(describeWallet);
  return { list: () => described, subscribe: () => () => {} };
}

/* ------------------------------------------------------------ fetch stub */

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
const ok =
  (body: unknown, status = 200): Responder =>
  () => ({ status, body });
const refuse = (status: number, code: string, message: string, details: unknown[] = []): Reply => ({
  status,
  body: { error: { code, message, requestId: 'r', details } },
});

function stubFetch(routes: readonly Route[], snapshot: SessionSnapshot) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, 'http://app.test');
      const method = init?.method ?? 'GET';
      if (url.pathname === '/api/auth/session') {
        return Response.json(snapshot);
      }
      calls.push({
        method,
        url: url.pathname,
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

/** A server holding one intent whose plan builds answer from a queue, exactly like the API's state changes. */
function reviewServer(
  options: {
    readonly intent?: Partial<Intent>;
    readonly builds?: readonly (ExecutionPlan | Reply)[];
    readonly versions?: readonly number[];
    readonly publicStrategy?: PublicStrategy | null;
  } = {},
) {
  const state = {
    intent: intent(options.intent ?? {}),
    plans: new Map<string, ExecutionPlan>(),
    builds: [...(options.builds ?? [livePlan()])],
    acknowledgements: 0,
  };
  const routes: Route[] = [
    { method: 'GET', path: `${P}/v1/me/wallets`, reply: ok(wallets) },
    { method: 'GET', path: `${P}/v1/me/wallets/${WALLET_ID}/funding`, reply: ok(funding) },
    { method: 'GET', path: `${P}/v1/me/limits`, reply: ok(limits) },
    { method: 'GET', path: `${P}/v1/me/eligibility`, reply: ok(eligibility) },
    { method: 'GET', path: `${P}/v1/me/strategies/${S1}/versions/${V1}`, reply: ok(ownVersion()) },
    { method: 'GET', path: `${P}/v1/catalog/instruments/${AERO}`, reply: ok(instrument) },
    {
      method: 'GET',
      path: `${P}/v1/me/strategies/${S1}`,
      reply: () =>
        options.publicStrategy
          ? refuse(404, 'NOT_FOUND', 'no strategy')
          : { status: 200, body: strategyDetail(options.versions ?? [1]) },
    },
    {
      method: 'GET',
      path: `${P}/v1/strategies/${S1}`,
      reply: () =>
        options.publicStrategy
          ? { status: 200, body: options.publicStrategy }
          : refuse(404, 'NOT_FOUND', 'no public strategy'),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}`,
      reply: () => ({ status: 200, body: state.intent }),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/plans`,
      reply: () => {
        const next = state.builds.shift();
        if (!next) {
          return refuse(503, 'PROVIDER_UNAVAILABLE', 'no more fixture plans');
        }
        if ('status' in next && 'body' in next) {
          return next;
        }
        const built = next as ExecutionPlan;
        for (const [id, existing] of state.plans) {
          if (existing.status === 'valid') {
            state.plans.set(id, { ...existing, status: 'superseded' });
          }
        }
        state.plans.set(built.planId, built);
        state.intent = {
          ...state.intent,
          state: 'QUOTED',
          latestPlanId: built.planId,
          latestPlanHash: built.planHash,
        };
        return { status: 201, body: built };
      },
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/cancel`,
      reply: () => {
        state.intent = {
          ...state.intent,
          state: 'CANCELLED',
          stateReason: 'cancelled by the owner before any signature',
        };
        return { status: 200, body: state.intent };
      },
    },
    {
      // F10: the execution status the panel reads once the plan is acknowledged; nothing is built here.
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/execution`,
      reply: () => {
        const current = state.intent.latestPlanId
          ? (state.plans.get(state.intent.latestPlanId) ?? null)
          : null;
        if (current === null || current.review.acknowledgedHash !== current.planHash) {
          return refuse(409, 'INVALID_STATE', 'the plan is not acknowledged');
        }
        const live =
          state.intent.state === 'AWAITING_APPROVAL' || state.intent.state === 'AUTHORIZED';
        return {
          status: 200,
          body: executionStatus({
            state: state.intent.state,
            stateReason: state.intent.stateReason,
            planId: current.planId,
            planHash: current.planHash,
            batches: current.grouping.batches.map((entry) =>
              batch({
                batch: entry.batch,
                legIndexes: entry.legIndexes,
                state: live ? 'pending' : 'cancelled',
              }),
            ),
            nextAction: live ? 'build' : 'none',
          }),
        };
      },
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/receipts`,
      reply: () => ({ status: 200, body: { receipts: [] } }),
    },
  ];
  for (const planId of [PLAN_ID, PLAN_ID_2]) {
    routes.push({
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/plans/${planId}`,
      reply: () => {
        const found = state.plans.get(planId);
        return found ? { status: 200, body: found } : refuse(404, 'NOT_FOUND', 'no plan');
      },
    });
    routes.push({
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/plans/${planId}/acknowledgements`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          planHash: string;
          stagedAcknowledged: boolean;
        };
        const found = state.plans.get(planId);
        if (!found) {
          return refuse(404, 'NOT_FOUND', 'no plan');
        }
        if (found.status !== 'valid') {
          return refuse(409, 'PLAN_CHANGED', 'a newer plan exists for this intent');
        }
        if (body.planHash !== found.planHash) {
          return refuse(409, 'PLAN_CHANGED', 'the hash you reviewed is not the hash of this plan');
        }
        if (found.grouping.acknowledgementRequired && !body.stagedAcknowledged) {
          return refuse(400, 'VALIDATION_FAILED', 'this plan is staged', [
            { path: 'stagedAcknowledged', message: 'set stagedAcknowledged' },
          ]);
        }
        state.acknowledgements += 1;
        const reviewed = {
          ...found,
          review: {
            acknowledgedAt: new Date().toISOString(),
            acknowledgedHash: found.planHash,
            stagedAcknowledged: body.stagedAcknowledged,
          },
        };
        state.plans.set(planId, reviewed);
        state.intent = { ...state.intent, state: 'AWAITING_APPROVAL' };
        return { status: 200, body: reviewed };
      },
    });
  }
  return { state, routes };
}

/* -------------------------------------------------------------- harness */

function ConnectProbe() {
  const wallet = useWallet();
  return (
    <button type="button" onClick={() => void wallet.select('Fixture Wallet')}>
      Connect fixture
    </button>
  );
}

let stub: ReturnType<typeof stubFetch>;

function mount(
  element: ReactNode,
  routes: readonly Route[],
  snapshot: SessionSnapshot = alice,
  wallet: Wallet = fakeWallet(),
) {
  stub = stubFetch(routes, snapshot);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <SessionProvider initial={snapshot} platform={platform}>
      <WalletProvider registry={registryOf(wallet)}>
        <PrivateQueryProvider>
          <ConnectProbe />
          {element}
        </PrivateQueryProvider>
      </WalletProvider>
    </SessionProvider>,
  );
}

const calls = (method: string, suffix: string) =>
  stub.calls.filter((call) => call.method === method && call.url.endsWith(suffix));

beforeEach(() => {
  nav.push.mockClear();
  nav.search = '';
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe('start a review', () => {
  it('names the target, derives slippage from policy, carries the wallet and budget over and creates one intent', async () => {
    nav.search = `?strategyId=${S1}&versionId=${V1}&walletId=${WALLET_ID}&budget=1000000000`;
    const server = reviewServer();
    server.routes.push({
      method: 'POST',
      path: `${P}/v1/me/intents`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return { status: 201, body: intent({ idempotencyKey: String(body['idempotencyKey']) }) };
      },
    });
    mount(<StartReviewView />, server.routes);
    expect(await screen.findByTestId('review-target')).toHaveTextContent(
      'Aerospace tilt · version 1',
    );
    expect(screen.getByTestId('review-target')).toHaveTextContent('60.00%');
    expect(screen.getByTestId('review-target')).toHaveTextContent('XSFXA · xStocks');
    expect(await screen.findByTestId('funding-line')).toHaveTextContent('2,500 USDC');
    expect(await screen.findByText(/within your limit of 1.00%/)).toBeInTheDocument();
    expect(screen.getByTestId('slippage-line')).toHaveTextContent('0.50% slippage');
    expect(await screen.findByTestId('eligibility-line')).toHaveTextContent('eligible');
    expect(screen.getByLabelText(/^Budget \(USDC\)/)).toHaveValue('1,000');
    // The per-order cap applies to the largest constituent's share, not to the whole budget.
    fireEvent.change(screen.getByLabelText(/^Budget \(USDC\)/), { target: { value: '1500' } });
    expect(screen.queryByText(/per-order limit/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Budget \(USDC\)/), { target: { value: '3000' } });
    expect(
      screen.getByText(
        'The largest constituent (60.00% of the budget) would exceed your per-order limit of 1,000 USDC; the plan will be refused.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Budget \(USDC\)/), { target: { value: '1000' } });
    const create = screen.getByTestId('create-intent');
    await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(create);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/review/${INTENT_ID}`));
    const posted = calls('POST', '/v1/me/intents');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({
      kind: 'basket_investment',
      strategyVersionId: V1,
      instrumentId: null,
      walletId: WALLET_ID,
      budget: { rawAmount: '1000000000' },
      budgetMode: 'all_in_stablecoin',
      slippageBps: null,
    });
    const created = posted[0]?.body as { idempotencyKey: string } | undefined;
    expect(created?.idempotencyKey).toMatch(/^web-/);
  });

  it('refuses a slippage above the policy limit and a missing target, and shows a refused creation', async () => {
    // Radix select is not a native control in jsdom; the wallet is chosen through the query prefill instead.
    nav.search = `?instrumentId=${AERO}&walletId=${WALLET_ID}`;
    const server = reviewServer();
    server.routes.push({
      method: 'POST',
      path: `${P}/v1/me/intents`,
      reply: () =>
        refuse(
          409,
          'ASSET_NOT_ADMITTED',
          'FXAERO is paused; only admitted instruments can be planned',
        ),
    });
    mount(<StartReviewView />, server.routes);
    expect(await screen.findByTestId('review-target')).toHaveTextContent(
      'FXAERO · Fixture Aerospace Inc',
    );
    expect(await screen.findByTestId('funding-line')).toHaveTextContent('2,500 USDC');
    fireEvent.change(screen.getByLabelText(/^Budget \(/), { target: { value: '1001' } });
    expect(
      screen.getByText('Above your per-order limit of 1,000 USDC; the plan will be refused.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Budget \(/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Slippage limit'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByText('Above your policy limit.')).toBeInTheDocument());
    expect(screen.getByTestId('create-intent')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(screen.getByLabelText('Slippage limit'), { target: { value: '0.25' } });
    expect(screen.getByTestId('slippage-line')).toHaveTextContent('0.25% slippage');
  });
});

describe('the review', () => {
  it('quotes a staged basket, shows every term, requires the staged acknowledgement and binds the approval to the hash', async () => {
    const server = reviewServer();
    mount(<ReviewView intentId={INTENT_ID} />, server.routes);
    expect(await screen.findByTestId('plan-hash')).toHaveTextContent('a1b2c3d4');
    expect(calls('POST', '/plans')).toHaveLength(1);
    expect(calls('POST', '/plans')[0]?.body).toEqual({});
    expect(screen.getByTestId('intent-state')).toHaveTextContent('Quoted, awaiting your review');
    expect(screen.getAllByText('Fixture quotes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('review-context')).toHaveTextContent(
      '1,000 USDC · slippage limit 0.50%',
    );

    const legs = screen.getAllByTestId('leg-row');
    expect(legs).toHaveLength(2);
    expect(legs[0]).toHaveTextContent('FXAERO');
    expect(legs[0]).toHaveTextContent('600 USDC');
    expect(legs[0]).toHaveTextContent('32.77726 FXAERO');
    expect(legs[0]).toHaveTextContent('32.613373 FXAERO');
    expect(legs[0]).toHaveTextContent('Transaction 1 of 2');
    expect(legs[1]).toHaveTextContent('2.95566574 XSFXA');
    expect(screen.getByTestId('cash-remainder')).toHaveTextContent('100 USDC');
    expect(screen.getByTestId('total-spend')).toHaveTextContent('1,000 USDC');
    expect(screen.getByTestId('fees-table')).toHaveTextContent('0.00428856 SOL');
    expect(screen.getByTestId('fees-table')).toHaveTextContent('0 USDC');
    expect(screen.getByTestId('fee-payer')).toHaveTextContent('EY3y…AFb5');
    expect(screen.getByTestId('transaction-count')).toHaveTextContent(
      '2 signatures across 2 transactions',
    );
    expect(screen.getByTestId('grouping-staged')).toHaveTextContent('land one by one');
    expect(screen.getByTestId('policy-evidence')).toHaveTextContent('2026-09-24');
    expect(screen.getByTestId('valid-until')).toHaveTextContent(/left/);
    expect(screen.getByTestId('funds-observed')).toHaveTextContent(
      '2,500 USDC and 0.05 SOL at slot 4242',
    );
    expect(screen.getAllByTestId('plan-warning')).toHaveLength(2);
    expect(screen.getByTestId('context-not_connected')).toBeInTheDocument();

    const approve = screen.getByTestId('approve');
    expect(approve).toHaveTextContent('Approve staged plan');
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Confirm that you understand staged execution/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('staged-checkbox'));
    await waitFor(() => expect(screen.getByTestId('approve')).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(screen.getByTestId('approve'));
    expect(await screen.findByTestId('approved')).toHaveTextContent(
      'staged execution acknowledged',
    );
    const acknowledged = calls('POST', '/acknowledgements');
    expect(acknowledged).toHaveLength(1);
    expect(acknowledged[0]?.body).toEqual({ planHash: HASH, stagedAcknowledged: true });
    await waitFor(() =>
      expect(screen.getByTestId('intent-state')).toHaveTextContent(
        'Approved, awaiting your signature',
      ),
    );
    // F10: the execution panel takes over; the first step builds on the API, nothing is signed yet.
    expect(await screen.findByTestId('build-cta')).toHaveTextContent('Build transaction 1 of 2');
    expect(screen.getByTestId('execution-state')).toHaveTextContent('Approved; nothing built yet');
    expect(screen.queryByTestId('sign-cta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approve')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('confirm-cancel')).toHaveLength(0);
    expect(calls('POST', '/transactions')).toHaveLength(0);
  });

  it('never enables approval behind changed terms: a refreshed plan shows the difference first', async () => {
    const refreshed = livePlan({
      planId: PLAN_ID_2,
      planHash: HASH_2,
      legs: plan().legs.map((leg, index) =>
        index === 0
          ? {
              ...leg,
              expectedOutputRaw: '32000000',
              minimumOutputRaw: '31840000',
              priceImpactBps: 120,
            }
          : leg,
      ),
      fees: { ...plan().fees, network: { ...plan().fees.network, totalLamportsMax: '4388560' } },
    });
    const server = reviewServer({ builds: [livePlan(), refreshed] });
    mount(<ReviewView intentId={INTENT_ID} />, server.routes);
    expect(await screen.findByTestId('plan-hash')).toHaveTextContent('a1b2c3d4');
    fireEvent.click(screen.getByTestId('staged-checkbox'));
    await waitFor(() => expect(screen.getByTestId('approve')).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(screen.getByTestId('refresh-terms'));
    const difference = await screen.findByTestId('plan-difference');
    expect(difference).toHaveTextContent(
      'Total SOL needed, at most: 0.00428856 SOL → 0.00438856 SOL',
    );
    expect(difference).toHaveTextContent('FXAERO expected output: 32.77726 FXAERO → 32 FXAERO');
    expect(difference).toHaveTextContent('FXAERO price impact: 0.00% → 1.20%');
    expect(screen.getByTestId('plan-hash')).toHaveTextContent('e5f6a7b8');
    expect(screen.getByTestId('approve')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Read the changed terms first.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('accept-new-terms'));
    await waitFor(() => expect(screen.queryByTestId('plan-difference')).not.toBeInTheDocument());
    // Accepting new terms resets the staged acknowledgement: the person confirms it for the new plan.
    expect(screen.getByTestId('approve')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('staged-checkbox'));
    await waitFor(() => expect(screen.getByTestId('approve')).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(screen.getByTestId('approve'));
    await screen.findByTestId('approved');
    expect(calls('POST', '/acknowledgements')[0]?.body).toEqual({
      planHash: HASH_2,
      stagedAcknowledged: true,
    });
  });

  it('shows expired terms as expired, offers a refresh, and reads the old plan as superseded', async () => {
    const server = reviewServer({
      builds: [livePlan({}, -5), livePlan({ planId: PLAN_ID_2, planHash: HASH_2 })],
    });
    mount(<ReviewView intentId={INTENT_ID} />, server.routes);
    expect(await screen.findByTestId('terms-expired')).toBeInTheDocument();
    expect(screen.getByTestId('valid-until')).toHaveTextContent('expired');
    expect(screen.getByTestId('approve')).toHaveTextContent('Refresh terms');
    expect(screen.queryByTestId('staged-checkbox')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('refresh-terms'));
    await waitFor(() => expect(screen.getByTestId('plan-hash')).toHaveTextContent('e5f6a7b8'));
    // The new validity is itself a changed term: it is shown and must be read before approving.
    const difference = screen.getByTestId('plan-difference');
    expect(difference).toHaveTextContent('Valid until:');
    expect(screen.queryByTestId('terms-expired')).not.toBeInTheDocument();
    expect(screen.getByTestId('approve')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('accept-new-terms'));
    fireEvent.click(screen.getByTestId('staged-checkbox'));
    await waitFor(() => expect(screen.getByTestId('approve')).not.toHaveAttribute('aria-disabled'));
    expect(server.state.plans.get(PLAN_ID)?.status).toBe('superseded');
  });

  it('turns refusals into actions: insufficient funds, a policy denial, a budget below the route minimum and no output', async () => {
    const server = reviewServer({
      builds: [
        refuse(409, 'INSUFFICIENT_FUNDS', 'the wallet cannot fund this plan', [
          {
            path: 'funds.stablecoin',
            message: 'the plan spends up to 1000000000 raw USDC; the wallet holds 0',
          },
          {
            path: 'funds.sol',
            message: 'network fees and rent need up to 4288560 lamports; the wallet holds 0',
          },
        ]),
        refuse(403, 'POLICY_DENIED', 'policy denied the FXAERO leg', [
          {
            path: 'legs[0]',
            message: 'ORDER_CAP_EXCEEDED: the order would exceed the per-order cap',
          },
        ]),
        refuse(
          400,
          'VALIDATION_FAILED',
          'the budget is below the route minimum of 1 constituent; the weights were not changed',
          [
            {
              path: 'budget.rawAmount',
              message: 'the smallest workable budget is 2222223 raw USDC',
            },
          ],
        ),
        refuse(
          503,
          'PROVIDER_UNAVAILABLE',
          'the venue quote for FXAERO failed 1 check and was refused',
          [{ path: 'legs[0]', message: 'ZERO_OUTPUT: the quote delivers nothing' }],
        ),
        livePlan(),
      ],
    });
    mount(<ReviewView intentId={INTENT_ID} />, server.routes);
    const funds = await screen.findByTestId('plan-refusal');
    expect(funds).toHaveTextContent('The wallet cannot fund this plan');
    expect(funds).toHaveTextContent('the wallet holds 0');
    expect(within(funds).getByRole('link', { name: 'Add funds' })).toHaveAttribute(
      'href',
      '/settings/wallets',
    );
    expect(screen.queryByTestId('approve')).not.toBeInTheDocument();
    expect(screen.getByTestId('intent-state')).toHaveTextContent('Not quoted yet');

    fireEvent.click(within(funds).getByRole('button', { name: 'Check again' }));
    await waitFor(() =>
      expect(screen.getByTestId('plan-refusal')).toHaveTextContent('Policy refused this plan'),
    );
    expect(screen.getByTestId('plan-refusal')).toHaveTextContent('ORDER_CAP_EXCEEDED');
    expect(screen.getByRole('link', { name: 'Start over with another budget' })).toHaveAttribute(
      'href',
      `/review/new?strategyId=${S1}&versionId=${V1}&walletId=${WALLET_ID}`,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Get quotes again' }));
    await waitFor(() =>
      expect(screen.getByTestId('plan-refusal')).toHaveTextContent('too small for the route'),
    );
    expect(screen.getByTestId('plan-refusal')).toHaveTextContent(
      'Smallest workable budget: 2.222223 USDC',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Get quotes again' }));
    await waitFor(() =>
      expect(screen.getByTestId('plan-refusal')).toHaveTextContent(
        'Quotes are unavailable right now',
      ),
    );
    expect(screen.getByTestId('plan-refusal')).toHaveTextContent('ZERO_OUTPUT');
    fireEvent.click(
      within(screen.getByTestId('plan-refusal')).getByRole('button', { name: 'Try again' }),
    );
    expect(await screen.findByTestId('plan-hash')).toHaveTextContent('a1b2c3d4');
    expect(screen.queryByTestId('plan-refusal')).not.toBeInTheDocument();
    expect(calls('POST', '/plans')).toHaveLength(5);
  });

  it('warns when the connected wallet or the strategy version differ from what the plan is bound to', async () => {
    const server = reviewServer({ versions: [1, 2] });
    mount(<ReviewView intentId={INTENT_ID} />, server.routes, alice, fakeWallet(OTHER));
    expect(await screen.findByTestId('plan-hash')).toBeInTheDocument();
    expect(await screen.findByTestId('context-newer_version')).toHaveTextContent(
      'Version 2 of this strategy exists; this plan invests in version 1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    expect(await screen.findByTestId('context-wallet_differs')).toHaveTextContent(
      'is not the plan’s wallet'.replace('’', "'"),
    );
    expect(screen.queryByTestId('context-not_connected')).not.toBeInTheDocument();
    // The plan itself is untouched: same hash, same wallet, still approvable once acknowledged.
    expect(screen.getByTestId('plan-hash')).toHaveTextContent('a1b2c3d4');
    expect(screen.getByTestId('review-context')).toHaveTextContent('EY3y…AFb5');
    fireEvent.click(screen.getByTestId('staged-checkbox'));
    await waitFor(() => expect(screen.getByTestId('approve')).not.toHaveAttribute('aria-disabled'));
  });

  it('reviews a single buy as one atomic transaction, restores an approved plan on reload and cancels before any signature', async () => {
    const approvedPlan: ExecutionPlan = {
      ...singlePlan(),
      validity: {
        ...singlePlan().validity,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        quotesExpireAt: new Date(Date.now() + 120_000).toISOString(),
      },
      review: { acknowledgedAt: NOW_ISO, acknowledgedHash: HASH, stagedAcknowledged: false },
    };
    const server = reviewServer({
      intent: {
        kind: 'single_buy',
        strategy: null,
        instrumentId: AERO,
        state: 'AWAITING_APPROVAL',
        latestPlanId: PLAN_ID,
        latestPlanHash: HASH,
        budget: { mint: STABLECOIN, symbol: 'USDC', decimals: 6, rawAmount: '100000000' },
      },
    });
    server.state.plans.set(PLAN_ID, approvedPlan);
    mount(<ReviewView intentId={INTENT_ID} />, server.routes);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Buy FXAERO'),
    );
    expect(calls('POST', '/plans')).toHaveLength(0);
    expect(screen.getByTestId('grouping-atomic')).toHaveTextContent('all or nothing');
    expect(screen.getByTestId('transaction-count')).toHaveTextContent(
      '1 signature across 1 transaction',
    );
    expect(screen.getByTestId('approved')).toBeInTheDocument();
    expect(await screen.findByTestId('build-cta')).toHaveTextContent('Build transaction 1 of 1');
    expect(screen.queryByTestId('sign-cta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('staged-checkbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-review'));
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    await waitFor(() => expect(screen.getByTestId('intent-state')).toHaveTextContent('Cancelled'));
    expect(screen.getByTestId('state-reason')).toHaveTextContent('cancelled by the owner');
    expect(calls('POST', '/cancel')).toHaveLength(1);
    expect(screen.queryByTestId('cancel-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('refresh-terms')).not.toBeInTheDocument();
  });

  it('answers not found for another person’s review and never invents a plan', async () => {
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/me/wallets`, reply: ok(wallets) },
      {
        method: 'GET',
        path: `${P}/v1/me/intents/${INTENT_ID}`,
        reply: () => refuse(404, 'NOT_FOUND', 'no intent with that id'),
      },
    ];
    mount(<ReviewView intentId={INTENT_ID} />, routes);
    expect(await screen.findByText('No review with that id')).toBeInTheDocument();
    expect(calls('POST', '/plans')).toHaveLength(0);
  });
});
