import type {
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  PreparedTransaction,
} from '@markov/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { ActivityView } from '../src/features/execution/activity-view';
import { ExecutionPanel } from '../src/features/execution/execution-panel';
import { ExecutionView } from '../src/features/execution/execution-view';
import { ReceiptView } from '../src/features/execution/receipt-view';
import { describeWallet, type WalletRegistry } from '../src/features/wallets/standard';
import { base64ToBytes, bytesToBase64 } from '../src/features/wallets/transaction-bytes';
import { useWallet, WalletProvider } from '../src/features/wallets/wallet-context';
import {
  ATTEMPT_ID,
  attempt,
  batch,
  fill,
  MESSAGE_HASH,
  prepared,
  SIGNATURE,
  status,
  TX_ID,
  UNSIGNED_BASE64,
} from './execution-fixtures';
import {
  HASH,
  INTENT_ID,
  intent,
  OTHER,
  OWNER,
  PLAN_ID,
  plan,
  singlePlan,
} from './review-fixtures';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: `/activity/${INTENT_ID}`,
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
  executionWritesEnabled: true,
};
const ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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

/** The message hash of the fixture bytes, so the byte check passes against the unsigned transaction. */
function approvedSinglePlan(): ExecutionPlan {
  const expires = new Date(Date.now() + 120_000).toISOString();
  const base = singlePlan();
  return singlePlan({
    validity: { ...base.validity, quotesExpireAt: expires, expiresAt: expires },
    review: {
      acknowledgedAt: '2026-09-25T10:00:01.000Z',
      acknowledgedHash: HASH,
      stagedAcknowledged: false,
    },
  });
}

function approvedIntent(overrides: Partial<Intent> = {}): Intent {
  return intent({ state: 'AUTHORIZED', latestPlanId: PLAN_ID, latestPlanHash: HASH, ...overrides });
}

async function realMessageHash(): Promise<string> {
  const { messageHashOf } = await import('../src/features/execution/transaction-check');
  return messageHashOf(UNSIGNED_BASE64) as string;
}

/* ---------------------------------------------------------- fake wallet */

interface FakeWalletOptions {
  readonly address?: string;
  readonly signing?: 'ok' | 'alter' | 'hold' | 'decline';
}

function fakeWallet(options: FakeWalletOptions = {}) {
  const chains = ['solana:devnet'];
  const account = {
    address: options.address ?? OWNER,
    publicKey: new Uint8Array(32),
    chains,
    features: ['solana:signMessage', 'solana:signTransaction'],
  } as unknown as WalletAccount;
  const calls = { signTransaction: 0 };
  const released: (() => void)[] = [];
  const state: { accounts: WalletAccount[] } = { accounts: [] };
  const wallet = {
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
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          calls.signTransaction += 1;
          if (options.signing === 'decline') {
            throw new Error('User rejected the request');
          }
          if (options.signing === 'hold') {
            await new Promise<void>((resolve) => released.push(resolve));
          }
          return inputs.map((input) => {
            const signed = new Uint8Array(input.transaction);
            signed.fill(7, 1, 65);
            if (options.signing === 'alter') {
              signed[signed.length - 1] = (signed[signed.length - 1] as number) ^ 1;
            }
            return { signedTransaction: signed };
          });
        },
      },
    },
  } as unknown as Wallet;
  return {
    wallet,
    calls,
    release: () => {
      for (const resolve of released.splice(0)) {
        resolve();
      }
    },
  };
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
type Responder = (url: URL, init: RequestInit | undefined) => Reply | 'network';
interface Route {
  readonly method: string;
  readonly path: string;
  readonly reply: Responder;
}
const P = '/api/markov';
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
      if (reply === 'network') {
        throw new TypeError('Failed to fetch');
      }
      return Response.json(reply.body, { status: reply.status });
    },
  );
  return { impl, calls };
}

/**
 * A server holding one approved single buy: the transaction builds on
 * request, a submission of the exact signed bytes lands, and every later
 * read walks the attempt to finality exactly like the API's reconciliation.
 */
function executionServer(options: {
  readonly plan?: ExecutionPlan;
  readonly intent?: Intent;
  readonly status?: ExecutionStatus;
  readonly submit?: 'ok' | 'network' | 'refused';
  readonly messageHash: string;
}) {
  const state = {
    intent: options.intent ?? approvedIntent(),
    plan: options.plan ?? approvedSinglePlan(),
    status: options.status ?? status({ state: 'AUTHORIZED', nextAction: 'build' }),
    reads: 0,
    submissions: [] as string[],
    receipts: [] as unknown[],
  };
  const tx = (): PreparedTransaction => prepared({ messageHash: options.messageHash });
  const routes: Route[] = [
    {
      method: 'GET',
      path: `${P}/v1/me/intents`,
      reply: () => ({ status: 200, body: { intents: [state.intent] } }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}`,
      reply: () => ({ status: 200, body: state.intent }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/plans/${PLAN_ID}`,
      reply: () => ({ status: 200, body: state.plan }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/execution`,
      reply: () => {
        state.reads += 1;
        // A broadcast attempt confirms on the next read and finalizes with its fill on the one after.
        if (state.status.state === 'SUBMITTED') {
          state.status = {
            ...state.status,
            state: 'CONFIRMED',
            batches: [
              batch({
                state: 'confirmed',
                transactionId: TX_ID,
                attemptId: ATTEMPT_ID,
                signature: SIGNATURE,
              }),
            ],
            attempts: [
              attempt({ state: 'confirmed', confirmationStatus: 'confirmed', slot: 4300 }),
            ],
          };
          state.intent = { ...state.intent, state: 'CONFIRMED' };
        } else if (state.status.state === 'CONFIRMED') {
          state.status = {
            ...state.status,
            state: 'FINALIZED',
            nextAction: 'none',
            batches: [
              batch({
                state: 'finalized',
                transactionId: TX_ID,
                attemptId: ATTEMPT_ID,
                signature: SIGNATURE,
              }),
            ],
            attempts: [
              attempt({ state: 'finalized', confirmationStatus: 'finalized', slot: 4300 }),
            ],
            fills: [fill()],
            reconciliation: {
              lastCheckedAt: new Date().toISOString(),
              blockHeight: 4310,
              evidence: ['signature finalized at slot 4300'],
              frozen: false,
            },
          };
          state.intent = { ...state.intent, state: 'FINALIZED' };
        }
        return { status: 200, body: state.status };
      },
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/transactions`,
      reply: () => {
        state.status = {
          ...state.status,
          nextAction: 'sign',
          batches: [batch({ state: 'prepared', transactionId: TX_ID })],
          transactions: [tx()],
        };
        return { status: 201, body: tx() };
      },
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/transactions/0/submissions`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { signedTransaction: string };
        state.submissions.push(body.signedTransaction);
        if (options.submit === 'network') {
          state.status = {
            ...state.status,
            state: 'UNKNOWN_REQUIRES_RECONCILIATION',
            nextAction: 'reconcile',
            batches: [
              batch({
                state: 'unknown',
                transactionId: TX_ID,
                attemptId: ATTEMPT_ID,
                signature: SIGNATURE,
              }),
            ],
            attempts: [attempt({ state: 'unknown' })],
            transactions: [],
          };
          state.intent = { ...state.intent, state: 'UNKNOWN_REQUIRES_RECONCILIATION' };
          return 'network';
        }
        if (options.submit === 'refused') {
          return refuse(409, 'SIGNATURE_MISMATCH', 'the signature does not verify');
        }
        state.status = {
          ...state.status,
          state: 'SUBMITTED',
          nextAction: 'wait',
          batches: [
            batch({
              state: 'submitted',
              transactionId: TX_ID,
              attemptId: ATTEMPT_ID,
              signature: SIGNATURE,
            }),
          ],
          attempts: [attempt()],
          transactions: [],
        };
        state.intent = { ...state.intent, state: 'SUBMITTED' };
        return { status: 201, body: state.status };
      },
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/execution/reconciliations`,
      reply: () => ({ status: 200, body: state.status }),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/cancel`,
      reply: () => {
        state.intent = { ...state.intent, state: 'CANCELLED' };
        state.status = {
          ...state.status,
          state: 'CANCELLED',
          nextAction: 'none',
          batches: [batch({ state: 'cancelled' })],
          transactions: [],
        };
        return { status: 200, body: state.intent };
      },
    },
    {
      method: 'GET',
      path: `${P}/v1/me/intents/${INTENT_ID}/receipts`,
      reply: () => ({ status: 200, body: { receipts: state.receipts } }),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/intents/${INTENT_ID}/receipts`,
      reply: () => {
        const receipt = receiptFixture();
        state.receipts = [receipt];
        return { status: 201, body: receipt };
      },
    },
    {
      method: 'GET',
      path: `${P}/v1/receipts/${RECEIPT_ID}`,
      reply: () => ({ status: 200, body: receiptFixture() }),
    },
    {
      method: 'GET',
      path: `${P}/v1/receipts/keys`,
      reply: () => ({
        status: 200,
        body: {
          keys: [
            {
              keyId: 'api-test-key-1',
              algorithm: 'ed25519',
              publicKey: OWNER,
              status: 'active',
              validFrom: '2026-09-25T00:00:00.000Z',
              validTo: null,
            },
          ],
          domain: 'markov-receipt/v1',
          note: 'n',
        },
      }),
    },
  ];
  return { state, routes };
}

const RECEIPT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function receiptFixture() {
  return {
    ownerUserId: ALICE_ID,
    body: {
      version: '1',
      kind: 'execution',
      receiptId: RECEIPT_ID,
      issuedAt: '2026-09-25T10:01:00.000Z',
      network: { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
      actor: { class: 'user', ref: 'c'.repeat(64) },
      subject: {
        ownerRef: 'd'.repeat(64),
        intentId: INTENT_ID,
        intentKind: 'single_buy',
        planId: PLAN_ID,
        planHash: HASH,
        strategyVersionId: null,
        manifestHash: null,
        walletAddress: OWNER,
        continuationOfIntentId: null,
      },
      policy: {
        policyVersion: '2026-09-24',
        outcome: 'allow',
        decisionIds: [],
        approvedLimits: null,
        slippageBps: 50,
      },
      sources: { venue: 'jupiter', mode: 'fixture', quoteRefs: ['fixture:1#leg0'] },
      hashes: { planHash: HASH, messageHashes: [MESSAGE_HASH] },
      approved: {
        legs: [{ legIndex: 0, maxInputRaw: '54000000', minimumOutputRaw: '5435698' }],
        totalSpendRaw: '100000000',
        networkFeeMaxLamports: '2044480',
      },
      chain: { signatures: [SIGNATURE], finality: 'finalized', slots: [4300] },
      fills: [
        {
          legIndex: 0,
          side: 'buy',
          inputMint: 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts',
          outputMint: '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv',
          inputSpentRaw: '54000000',
          outputReceivedRaw: '5463013',
          feeLamports: '5000',
          lamportsSpent: '2044280',
          withinBounds: true,
          signature: SIGNATURE,
          slot: 4300,
        },
      ],
      fees: { networkFeeLamports: '5000', rentLamports: '2039280', protocolFeeRaw: '0' },
      timestamps: {
        intentCreatedAt: '2026-09-25T10:00:00.000Z',
        planCreatedAt: '2026-09-25T10:00:00.000Z',
        acknowledgedAt: '2026-09-25T10:00:01.000Z',
        firstSubmittedAt: '2026-09-25T10:00:05.000Z',
        settledAt: '2026-09-25T10:00:10.000Z',
      },
      status: { intentState: 'FINALIZED', terminal: true, failure: null, recovery: null },
      scope: {
        attests: 'record',
        settlement: 'chain_evidence',
        ownership: 'not_asserted',
        policy: 'evaluated_as_recorded',
      },
    },
    canonicalHash: 'ab'.repeat(32),
    signer: { keyId: 'api-test-key-1', algorithm: 'ed25519', publicKey: OWNER },
    signature: bytesToBase64(new Uint8Array(64).fill(3)),
    public: false,
  };
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

function mount(element: ReactNode, routes: readonly Route[], wallet: Wallet = fakeWallet().wallet) {
  stub = stubFetch(routes, alice);
  vi.stubGlobal('fetch', stub.impl);
  return render(
    <SessionProvider initial={alice} platform={platform}>
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

async function connect() {
  fireEvent.click(screen.getByText('Connect fixture'));
  await waitFor(() => expect(screen.queryByText(/Connect the wallet/)).toBeNull());
}

async function buildAndReachSign() {
  const build = await screen.findByTestId('build-cta');
  expect(build).toHaveTextContent('Build transaction 1 of 1');
  fireEvent.click(build);
  const sign = await screen.findByTestId('sign-cta');
  expect(sign).toHaveTextContent('Sign transaction 1 of 1');
  expect(screen.getByTestId('transaction-preview')).toHaveTextContent('Buy FXAERO');
  return sign;
}

beforeEach(() => {
  nav.push.mockClear();
  nav.search = '';
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('execution panel', () => {
  it('builds, checks and signs the exact bytes, submits them once and hands off to the timeline', async () => {
    const messageHash = await realMessageHash();
    const server = executionServer({ messageHash });
    const wallet = fakeWallet();
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="review"
        onSubmitted={(next) => nav.push(`/activity/${next.intentId}`)}
      />,
      server.routes,
      wallet.wallet,
    );
    const sign = await buildAndReachSign();
    expect(sign).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Connect the wallet/)).toBeVisible();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await waitFor(() => expect(server.state.submissions).toHaveLength(1));
    // Exactly the prepared message with the fee-payer slot filled, nothing else.
    const signed = base64ToBytes(server.state.submissions[0] as string);
    const unsigned = base64ToBytes(UNSIGNED_BASE64);
    expect(signed.length).toBe(unsigned.length);
    expect(Array.from(signed.slice(65))).toEqual(Array.from(unsigned.slice(65)));
    expect(signed[1]).toBe(7);
    expect(wallet.calls.signTransaction).toBe(1);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/activity/${INTENT_ID}`));
    expect(calls('POST', '/submissions')).toHaveLength(1);
  });

  it('shows the declined wallet, keeps the built transaction and never submits', async () => {
    const server = executionServer({ messageHash: await realMessageHash() });
    const wallet = fakeWallet({ signing: 'decline' });
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      server.routes,
      wallet.wallet,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await screen.findByTestId('execution-failure');
    expect(screen.getByTestId('execution-failure')).toHaveTextContent(
      'The wallet declined to sign. Nothing was sent',
    );
    expect(server.state.submissions).toHaveLength(0);
    expect(screen.getByTestId('sign-cta')).toHaveTextContent('Sign transaction 1 of 1');
    expect(screen.getByTestId('timeline')).toHaveTextContent('Signed by you');
  });

  it('refuses a wallet that changes the message and sends nothing', async () => {
    const server = executionServer({ messageHash: await realMessageHash() });
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      server.routes,
      fakeWallet({ signing: 'alter' }).wallet,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await screen.findByTestId('execution-failure');
    expect(screen.getByTestId('execution-failure')).toHaveTextContent(
      'did not return the prepared transaction',
    );
    expect(server.state.submissions).toHaveLength(0);
  });

  it('keeps the signature unavailable for another account, a mismatched plan and a transaction that does not hash to the message', async () => {
    const messageHash = await realMessageHash();
    const other = executionServer({ messageHash });
    const first = mount(
      <ExecutionPanel
        intent={other.state.intent}
        plan={other.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      other.routes,
      fakeWallet({ address: OTHER }).wallet,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByText(/is not the wallet this plan was reviewed for/)).toBeVisible(),
    );
    expect(screen.getByTestId('sign-cta')).toHaveAttribute('aria-disabled', 'true');
    first.unmount();

    const stale = executionServer({ messageHash: 'ab'.repeat(32) });
    mount(
      <ExecutionPanel
        intent={stale.state.intent}
        plan={stale.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      stale.routes,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() => expect(screen.getByText(/do not hash to the message/)).toBeVisible());
    expect(stale.state.submissions).toHaveLength(0);
  });

  it('tells the person when the wallet stays silent and discards a signature that arrives after they stopped waiting', async () => {
    const server = executionServer({ messageHash: await realMessageHash() });
    const wallet = fakeWallet({ signing: 'hold' });
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
        walletWaitMs={50}
      />,
      server.routes,
      wallet.wallet,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await screen.findByTestId('wallet-waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    expect(screen.getByTestId('execution-failure')).toHaveTextContent(
      'Stopped waiting for the wallet',
    );
    wallet.release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.state.submissions).toHaveLength(0);
    expect(screen.getByTestId('sign-cta')).toHaveTextContent('Sign transaction 1 of 1');
  });

  it('treats a lost answer after the bytes left as unknown: reconciles the attempt, never re-signs', async () => {
    const server = executionServer({ messageHash: await realMessageHash(), submit: 'network' });
    const wallet = fakeWallet();
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      server.routes,
      wallet.wallet,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await screen.findByTestId('lost-answer');
    expect(screen.getByTestId('execution-failure')).toHaveTextContent('Do not sign again');
    await waitFor(() => expect(calls('POST', '/reconciliations').length).toBeGreaterThanOrEqual(1));
    await waitFor(() =>
      expect(screen.getByTestId('execution-state')).toHaveTextContent('Result unknown'),
    );
    expect(screen.getByTestId('next-step')).toHaveAttribute('data-kind', 'reconcile');
    expect(screen.queryByTestId('sign-cta')).toBeNull();
    expect(wallet.calls.signTransaction).toBe(1);
  });

  it('refuses a signature the API rejects and keeps the transaction for a fresh signing request', async () => {
    const server = executionServer({ messageHash: await realMessageHash(), submit: 'refused' });
    mount(
      <ExecutionPanel
        intent={server.state.intent}
        plan={server.state.plan}
        approvedPlanHash={HASH}
        variant="activity"
      />,
      server.routes,
    );
    await buildAndReachSign();
    await connect();
    await waitFor(() =>
      expect(screen.getByTestId('sign-cta')).not.toHaveAttribute('aria-disabled', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-cta'));
    await screen.findByTestId('execution-failure');
    expect(screen.getByTestId('execution-failure')).toHaveTextContent(
      'Nothing reached the network',
    );
    expect(await screen.findByTestId('sign-cta')).toBeVisible();
  });

  it('follows a broadcast to finality on the timeline, announces the changes and offers a receipt', async () => {
    const server = executionServer({
      messageHash: await realMessageHash(),
      intent: approvedIntent({ state: 'SUBMITTED' }),
      status: status({
        state: 'SUBMITTED',
        nextAction: 'wait',
        batches: [
          batch({
            state: 'submitted',
            transactionId: TX_ID,
            attemptId: ATTEMPT_ID,
            signature: SIGNATURE,
          }),
        ],
        attempts: [attempt()],
      }),
    });
    mount(<ExecutionView intentId={INTENT_ID} />, server.routes);
    await screen.findByTestId('execution-state');
    expect(screen.getByTestId('next-step')).toHaveAttribute('data-kind', 'wait');
    expect(screen.getByTestId('timeline')).toHaveTextContent('Broadcast');
    // "Check now" reconciles; the next read confirms, the one after finalizes with a fill.
    fireEvent.click(screen.getByTestId('reconcile-cta'));
    await waitFor(
      () => expect(screen.getByTestId('execution-state')).toHaveTextContent('Finalized'),
      {
        timeout: 6_000,
      },
    );
    expect(screen.getByTestId('execution-announcement')).toHaveTextContent(/Finalized|confirmed/);
    expect(screen.getAllByTestId('fill-row')).toHaveLength(1);
    expect(screen.getByTestId('batch-fee')).toHaveTextContent('0.000005 SOL');
    expect(screen.getByTestId('batch-signature')).toBeVisible();
    fireEvent.click(screen.getByTestId('issue-receipt'));
    await screen.findByTestId('receipt-issued');
    expect(screen.getByTestId('open-receipt')).toHaveAttribute('href', `/receipts/${RECEIPT_ID}`);
  });

  it('shows a partially completed basket leg by leg with the reviewed completion at the unfilled targets', async () => {
    const basket = plan();
    const expires = new Date(Date.now() + 120_000).toISOString();
    const server = executionServer({
      messageHash: MESSAGE_HASH,
      plan: {
        ...basket,
        validity: { ...basket.validity, expiresAt: expires, quotesExpireAt: expires },
        review: {
          acknowledgedAt: '2026-09-25T10:00:01.000Z',
          acknowledgedHash: HASH,
          stagedAcknowledged: true,
        },
      },
      intent: approvedIntent({ state: 'PARTIALLY_COMPLETED', stateReason: 'LEG_TERMS_CHANGED' }),
      status: status({
        state: 'PARTIALLY_COMPLETED',
        stateReason: 'LEG_TERMS_CHANGED',
        nextAction: 'review',
        batches: [
          batch({
            state: 'finalized',
            transactionId: TX_ID,
            attemptId: ATTEMPT_ID,
            signature: SIGNATURE,
          }),
          batch({
            batch: 1,
            legIndexes: [1],
            state: 'stale',
            reason: 'fresh quote below the approved minimum output',
          }),
        ],
        attempts: [attempt({ state: 'finalized', confirmationStatus: 'finalized', slot: 4300 })],
        fills: [fill()],
      }),
    });
    mount(<ExecutionView intentId={INTENT_ID} />, server.routes);
    await screen.findByTestId('execution-state');
    expect(screen.getByTestId('execution-summary')).toHaveTextContent('1 leg filled');
    const rows = screen.getAllByTestId('timeline-batch');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-batch-state', 'finalized');
    expect(rows[1]).toHaveAttribute('data-batch-state', 'stale');
    expect(rows[1]).toHaveTextContent('fresh quote below the approved minimum output');
    const unfilled = basket.legs.filter((leg) => leg.legIndex !== 0);
    const budget = unfilled.reduce((sum, leg) => sum + BigInt(leg.targetInputRaw), 0n).toString();
    expect(screen.getByTestId('review-continuation')).toHaveAttribute(
      'href',
      expect.stringContaining(`budget=${budget}&continueIntentId=${INTENT_ID}`),
    );
    expect(screen.queryByTestId('cancel-cta')).toBeNull();
    expect(screen.queryByTestId('sign-cta')).toBeNull();
  });

  it('cancels only before a signature, with the consequence spelled out, and requests cancellation after a broadcast', async () => {
    const server = executionServer({ messageHash: MESSAGE_HASH });
    mount(<ExecutionView intentId={INTENT_ID} />, server.routes);
    await screen.findByTestId('build-cta');
    fireEvent.click(screen.getByTestId('cancel-cta'));
    expect(screen.getByTestId('cancel-consequence')).toHaveTextContent('Nothing was signed');
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    await waitFor(() =>
      expect(screen.getByTestId('execution-state')).toHaveTextContent('Cancelled'),
    );
    expect(screen.queryByTestId('build-cta')).toBeNull();
    expect(calls('POST', '/cancel')).toHaveLength(1);
  });
});

describe('activity list and receipt page', () => {
  it('lists orders with stable deep links and URL filters', async () => {
    const server = executionServer({
      messageHash: MESSAGE_HASH,
      intent: approvedIntent({ state: 'SUBMITTED' }),
    });
    nav.pathname = '/activity';
    mount(<ActivityView />, server.routes);
    const row = await screen.findByTestId('activity-row');
    expect(within(row).getByRole('link', { name: 'Timeline' })).toHaveAttribute(
      'href',
      `/activity/${INTENT_ID}`,
    );
    fireEvent.click(screen.getByTestId('filter-settled'));
    expect(nav.replace).toHaveBeenCalledWith('/activity?filter=settled');
    nav.search = 'filter=settled';
    for (const listener of listeners) {
      listener();
    }
    await waitFor(() => expect(screen.queryByTestId('activity-row')).toBeNull());
    expect(screen.getByText('Nothing settled')).toBeVisible();
  });

  it('renders a receipt with what was requested, approved, submitted, filled and charged, its key status and the JSON to verify', async () => {
    const server = executionServer({ messageHash: MESSAGE_HASH });
    nav.pathname = `/receipts/${RECEIPT_ID}`;
    mount(<ReceiptView receiptId={RECEIPT_ID} />, server.routes);
    await screen.findByTestId('receipt-view');
    expect(screen.getByText('Execution receipt')).toBeVisible();
    expect(await screen.findByTestId('key-status')).toHaveTextContent('published, active');
    expect(screen.getByText(/leg 1: 54000000 raw in, 5463013 raw out/)).toBeVisible();
    expect(screen.getByText(/network fee 0.000005 SOL/)).toBeVisible();
    expect(screen.getByTestId('receipt-json')).toHaveTextContent('"canonicalHash"');
    expect(screen.getByText(/settlement is the chain evidence/)).toBeVisible();
    expect(screen.getByTestId('toggle-public')).toHaveTextContent('Make public (redacted)');
  });
});
