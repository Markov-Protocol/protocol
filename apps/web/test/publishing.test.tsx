import type {
  Publication,
  PublicStrategy,
  PublicVersion,
  RegistryRecord,
  RegistryStatus,
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
import { StrategyView } from '../src/features/publishing/strategy-view';
import { VersionView } from '../src/features/publishing/version-view';
import { describeWallet, type WalletRegistry } from '../src/features/wallets/standard';
import {
  base64ToBytes,
  bytesToBase64,
  checkSignedTransaction,
} from '../src/features/wallets/transaction-bytes';
import { useWallet, WalletProvider } from '../src/features/wallets/wallet-context';

/* ------------------------------------------------------------ navigation */

const listeners = new Set<() => void>();
const nav = {
  search: '',
  pathname: '/strategies/x',
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
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const MINT_B = '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL';
const PUBLISHER = 'EY3y13V2TYRa4FWBqpyD7D1ZbLZhGzEamNnDcY4fAFb5';
const RECORD = '4uFNLZ8GKBUywsX48vYhMeGjgpjdQC2iN6pQxo1JTG3X';
const SIGNATURE =
  '3d3S9ejp7MVwroTwbRVQHDBTkRugmeDarEChQA8rAS7k23Q4HgUA4qCWMcNtJpAa1kJPYNf9cyhBmTUApv3acuUF';
const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';
const S1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const V1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WALLET_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ALICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PUB_ID = '99999999-9999-4999-8999-999999999999';
const CHANGE_ID = '88888888-8888-4888-8888-888888888888';
const NEW_S = 'abababab-abab-4bab-8bab-abababababab';
const HASH = 'd324b072'.padEnd(64, '1');
const HASH_V2 = 'e1e1e1e1'.padEnd(64, '2');
const DIGEST = '910207cf'.padEnd(64, '3');
const NOW = '2026-09-25T00:00:00.000Z';
const HOLD = { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null } as const;

const MESSAGE = Uint8Array.from({ length: 140 }, (_, index) => (index * 13 + 5) % 251);
const UNSIGNED = new Uint8Array(1 + 64 + MESSAGE.length);
UNSIGNED[0] = 1;
UNSIGNED.set(MESSAGE, 65);
const UNSIGNED_B64 = bytesToBase64(UNSIGNED);

function session(userId: string, subject: string): SessionSnapshot {
  return {
    state: 'signed-in',
    account: { userId, subject, issuer: 'urn:markov:test', authTime: null, stepUpFresh: true },
    session: { sessionId: `s-${subject}`, expiresAt: '2030-01-01T00:00:00.000Z' },
  };
}
const alice = session(ALICE_ID, 'did:test:alice');
const bob = session(BOB_ID, 'did:test:bob');
const anonymous: SessionSnapshot = { state: 'signed-out' };

const registryStatus: RegistryStatus = {
  publicationEnabled: true,
  disabledReason: null,
  programId: PROGRAM,
  network: { cluster: 'devnet', genesisHash: GENESIS },
  schemaVersion: '1',
  recordSpace: 832,
  maxLegs: 10,
  indexer: { lastRunAt: null, lastObservedSlot: null, recordsIndexed: 0 },
};

const wallets = {
  wallets: [
    {
      walletId: WALLET_ID,
      chain: 'solana',
      genesisHash: GENESIS,
      address: PUBLISHER,
      verifiedAt: NOW,
    },
  ],
};

function ownVersion(overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  const admission = (mint: string) => ({
    status: 'admitted' as const,
    admittedAt: NOW,
    verificationId: 1,
    verifiedAt: NOW,
    mint,
    tokenProgram: 'spl-token' as const,
    decimals: 6,
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
        admission: admission(MINT_A),
      },
      {
        instrumentId: BIO,
        weightBps: 3000,
        note: null,
        issuer: 'prestocks',
        symbol: 'FXBIO',
        companyName: 'Fixture Biotech Ltd',
        admission: admission(MINT_B),
      },
    ],
    cashWeightBps: 1000,
    maintenance: HOLD,
    disclosures: {
      issuers: [{ issuer: 'prestocks', weightBps: 9000 }],
      companies: [
        {
          companyKey: 'fixture-aerospace',
          companyName: 'Fixture Aerospace Inc',
          weightBps: 6000,
          instrumentIds: [AERO],
        },
        {
          companyKey: 'fixture-biotech',
          companyName: 'Fixture Biotech Ltd',
          weightBps: 3000,
          instrumentIds: [BIO],
        },
      ],
    },
    references: [],
    manifestHash: HASH,
    contentDigest: DIGEST,
    publication: 'unpublished',
    moderation: 'none',
    deprecatedBy: null,
    frozenAt: NOW,
    ...overrides,
  };
}

const evidence = (status: 'active' | 'deprecated' = 'active') => ({
  signature: SIGNATURE,
  slot: 4242,
  blockTime: NOW,
  recordAddress: RECORD,
  publisher: PUBLISHER,
  status,
  transactionUrl: `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
  recordUrl: `https://explorer.solana.com/address/${RECORD}?cluster=devnet`,
});

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    publicationId: PUB_ID,
    strategyId: S1,
    versionId: V1,
    operation: 'register',
    state: 'awaiting_signature',
    programId: PROGRAM,
    network: { cluster: 'devnet', genesisHash: GENESIS },
    recordAddress: RECORD,
    publisher: { walletId: WALLET_ID, address: PUBLISHER },
    manifestHash: HASH,
    contentDigest: DIGEST,
    transaction: {
      unsignedTransaction: UNSIGNED_B64,
      message: bytesToBase64(MESSAGE),
      recentBlockhash: GENESIS,
      lastValidBlockHeight: 150,
      feePayer: PUBLISHER,
      estimatedCostLamports: 6_686_600,
    },
    signature: null,
    submittedAt: null,
    confirmationStatus: null,
    evidence: null,
    failure: null,
    preview: {
      manifest: {
        schemaVersion: '1',
        kind: 'stock_spot_basket',
        network: { cluster: 'devnet', genesisHash: GENESIS },
        strategyId: S1,
        versionNumber: 1,
        parentVersionId: null,
        forkOf: null,
        title: 'Aerospace tilt',
        thesis: 'Launch cadence is underestimated.',
        thesisId: null,
        legs: [
          {
            instrumentId: AERO,
            symbol: 'FXAERO',
            issuer: 'prestocks',
            mint: MINT_A,
            tokenProgram: 'spl-token',
            weightBps: 6000,
          },
          {
            instrumentId: BIO,
            symbol: 'FXBIO',
            issuer: 'prestocks',
            mint: MINT_B,
            tokenProgram: 'spl-token',
            weightBps: 3000,
          },
        ],
        cashWeightBps: 1000,
        maintenance: HOLD,
        references: [],
        manifestHash: HASH,
        contentDigest: DIGEST,
      },
      onChain: {
        recordAddress: RECORD,
        publisher: PUBLISHER,
        legs: [
          { mint: MINT_A, tokenProgram: 'spl-token', weightBps: 6000 },
          { mint: MINT_B, tokenProgram: 'spl-token', weightBps: 3000 },
        ],
        cashWeightBps: 1000,
        manifestHash: HASH,
        contentDigest: DIGEST,
        relation: 'none',
        parentManifestHash: null,
        parentRecordAddress: null,
      },
      neverPublished: [
        'your Markov account, email and sign-in identity',
        'budgets, wallet balances, holdings and orders',
      ],
      permanence:
        'A registered record can never be edited or deleted; only its status marker can change.',
    },
    lastCheckedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function publicVersion(overrides: Partial<PublicVersion> = {}): PublicVersion {
  const own = ownVersion();
  return {
    strategyId: S1,
    versionId: V1,
    versionNumber: 1,
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    title: own.title,
    thesis: own.thesis,
    thesisId: null,
    legs: own.legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      symbol: leg.symbol,
      companyName: leg.companyName,
      issuer: leg.issuer,
      mint: leg.admission.mint,
      tokenProgram: leg.admission.tokenProgram,
      weightBps: leg.weightBps,
    })),
    cashWeightBps: 1000,
    maintenance: HOLD,
    disclosures: own.disclosures,
    references: [],
    parentVersionId: null,
    forkOf: null,
    canonicalManifest: `{"cashWeightBps":1000,"kind":"stock_spot_basket","legs":[{"mint":"${MINT_A}"}]}`,
    manifestHash: HASH,
    contentDigest: DIGEST,
    registration: evidence(),
    verification: {
      manifestHashMatches: true,
      contentMatches: true,
      recomputedManifestHash: HASH,
      mismatches: [],
      checkedAt: NOW,
    },
    deprecatedBy: null,
    frozenAt: NOW,
    ...overrides,
  };
}

const record: RegistryRecord = {
  address: RECORD,
  programId: PROGRAM,
  network: { cluster: 'devnet', genesisHash: GENESIS },
  publisher: PUBLISHER,
  status: 'active',
  layoutVersion: 1,
  schemaVersion: 1,
  relation: 'none',
  parentManifestHash: null,
  manifestHash: HASH,
  contentDigest: DIGEST,
  cashWeightBps: 1000,
  legs: [
    { mint: MINT_A, tokenProgram: 'spl-token', weightBps: 6000 },
    { mint: MINT_B, tokenProgram: 'spl-token', weightBps: 3000 },
  ],
  registeredSlot: 4242,
  registeredAt: NOW,
  statusUpdatedSlot: 4242,
  version: { strategyId: S1, versionId: V1, versionNumber: 1 },
  observedSlot: 4300,
  observedAt: NOW,
  explorerUrl: `https://explorer.solana.com/address/${RECORD}?cluster=devnet`,
};

const publicStrategy: PublicStrategy = {
  strategyId: S1,
  title: 'Aerospace tilt',
  forkOf: null,
  followerCount: 3,
  versions: [
    {
      versionId: V1,
      versionNumber: 1,
      title: 'Aerospace tilt',
      manifestHash: HASH,
      recordAddress: RECORD,
      status: 'active',
      registeredAt: NOW,
      frozenAt: NOW,
    },
  ],
};

function detail(versions: StrategyDetail['versions']): StrategyDetail {
  return {
    strategy: {
      strategyId: S1,
      ownerUserId: ALICE_ID,
      status: 'active',
      forkOf: null,
      currentVersion: null,
      draftRevision: 3,
      createdAt: NOW,
      updatedAt: NOW,
    },
    draft: {
      strategyId: S1,
      revision: 3,
      content: {
        title: 'Aerospace tilt (draft)',
        thesis: 'Launch cadence is underestimated.',
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
        evaluatedAt: NOW,
      },
      createdAt: NOW,
      updatedAt: NOW,
    },
    versions,
  };
}

/* ---------------------------------------------------------- fake wallet */

interface FakeWalletOptions {
  readonly address?: string;
  readonly chains?: readonly string[];
  /** 'ok' fills the fee-payer slot; 'alter' also flips a message byte; 'hold' waits for release(). */
  readonly signing?: 'ok' | 'alter' | 'hold';
  readonly versions?: readonly ('legacy' | 0)[];
}

function fakeWallet(options: FakeWalletOptions = {}) {
  const chains = options.chains ?? ['solana:devnet'];
  const account = {
    address: options.address ?? PUBLISHER,
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
      'solana:signMessage': {
        version: '1.1.0',
        signMessage: async () => [],
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: options.versions ?? ['legacy', 0],
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          calls.signTransaction += 1;
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
const notFound: Responder = () => ({
  status: 404,
  body: { error: { code: 'NOT_FOUND', message: 'no such thing', requestId: 'r' } },
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

/** A server holding one frozen version: prepare, submit and finalize move the state exactly as the API does. */
function publishingServer(
  options: {
    readonly publication?: Publication | null;
    readonly version?: Partial<StrategyVersion>;
    readonly statusChange?: Publication | null;
    readonly publicVersion?: PublicVersion | null;
  } = {},
) {
  const state = {
    version: ownVersion(options.version ?? {}),
    publication: options.publication ?? null,
    statusChange: options.statusChange ?? null,
    publicVersion: options.publicVersion ?? null,
    signed: null as Uint8Array | null,
    submits: 0,
  };
  if (
    state.publication &&
    state.publication.operation === 'register' &&
    state.version.publication === 'unpublished'
  ) {
    state.version = { ...state.version, publication: state.publication.state };
  }
  const routes: Route[] = [
    { method: 'GET', path: `${P}/v1/registry`, reply: ok(registryStatus) },
    { method: 'GET', path: `${P}/v1/me/wallets`, reply: ok(wallets) },
    { method: 'GET', path: `${P}/v1/me/follows`, reply: ok({ follows: [] }) },
    {
      method: 'GET',
      path: `${P}/v1/me/strategies/${S1}/versions/${V1}`,
      reply: () => ({ status: 200, body: state.version }),
    },
    {
      method: 'GET',
      path: `${P}/v1/me/strategies/${S1}/versions/${V1}/publication`,
      reply: (url, init) =>
        state.publication ? { status: 200, body: state.publication } : notFound(url, init),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/strategies/${S1}/versions/${V1}/publication`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { walletId: string };
        if (body.walletId !== WALLET_ID) {
          return {
            status: 404,
            body: {
              error: {
                code: 'NOT_FOUND',
                message: 'no verified wallet with that id',
                requestId: 'r',
              },
            },
          };
        }
        state.publication = publication();
        state.version = { ...state.version, publication: 'awaiting_signature' };
        return { status: 201, body: state.publication };
      },
    },
    {
      method: 'POST',
      path: `${P}/v1/me/publications/${PUB_ID}/submit`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { signedTransaction: string };
        state.submits += 1;
        state.signed = base64ToBytes(body.signedTransaction);
        state.publication = {
          ...publication(),
          state: 'submitted',
          transaction: null,
          signature: SIGNATURE,
          submittedAt: NOW,
          confirmationStatus: 'processed',
        };
        state.version = { ...state.version, publication: 'submitted' };
        return { status: 200, body: state.publication };
      },
    },
    {
      method: 'GET',
      path: `${P}/v1/me/strategies/${S1}/versions/${V1}/status-changes`,
      reply: (url, init) =>
        state.statusChange ? { status: 200, body: state.statusChange } : notFound(url, init),
    },
    {
      method: 'POST',
      path: `${P}/v1/me/publications/${CHANGE_ID}/submit`,
      reply: (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { signedTransaction: string };
        state.submits += 1;
        state.signed = base64ToBytes(body.signedTransaction);
        state.statusChange = {
          ...(state.statusChange as Publication),
          state: 'submitted',
          transaction: null,
          signature: SIGNATURE,
          submittedAt: NOW,
          confirmationStatus: 'processed',
        };
        return { status: 200, body: state.statusChange };
      },
    },
    {
      method: 'GET',
      path: `${P}/v1/strategies/${S1}/versions/${V1}`,
      reply: (url, init) =>
        state.publicVersion ? { status: 200, body: state.publicVersion } : notFound(url, init),
    },
    { method: 'GET', path: `${P}/v1/registry/records/${RECORD}`, reply: ok(record) },
  ];
  return {
    state,
    routes,
    finalizeChange() {
      state.statusChange = {
        ...(state.statusChange as Publication),
        state: 'registered',
        confirmationStatus: 'finalized',
        evidence: evidence('deprecated'),
      };
      state.publicVersion = publicVersion({ registration: evidence('deprecated') });
    },
    finalize() {
      state.publication = {
        ...publication(),
        state: 'registered',
        transaction: null,
        signature: SIGNATURE,
        submittedAt: NOW,
        confirmationStatus: 'finalized',
        evidence: evidence(),
      };
      state.version = { ...state.version, publication: 'registered', publisherWallet: PUBLISHER };
      state.publicVersion = publicVersion();
    },
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

function mount(
  element: ReactNode,
  routes: readonly Route[],
  snapshot: SessionSnapshot,
  wallet: Wallet = fakeWallet().wallet,
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
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe('publishing a frozen version', () => {
  it('reviews what becomes public, signs with the publisher wallet, submits once and shows only chain-derived states', async () => {
    const server = publishingServer();
    const wallet = fakeWallet();
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice, wallet.wallet);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Saved privately');
    expect(screen.getByTestId('version-state')).toHaveTextContent('Saved privately');
    expect(await screen.findAllByTestId('recipe-leg')).toHaveLength(2);
    expect(screen.getByTestId('manifest-hash')).toHaveTextContent(HASH);

    // Prepare with the verified wallet that is connected.
    expect(await screen.findByTestId('prepare-button')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    await waitFor(() =>
      expect(screen.getByTestId('prepare-button')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(screen.getByTestId('prepare-button'));
    const preview = await screen.findByTestId('publish-preview');
    expect(screen.getByTestId('publication-state')).toHaveTextContent('Publishing');
    expect(within(preview).getAllByTestId('preview-leg')).toHaveLength(2);
    expect(preview).toHaveTextContent('62DE…xnfv');
    expect(preview).toHaveTextContent(HASH);
    expect(preview).toHaveTextContent(PUBLISHER);
    expect(preview).toHaveTextContent('budgets, wallet balances, holdings and orders');
    expect(screen.getByTestId('permanence')).toHaveTextContent('never be edited or deleted');
    expect(screen.getByTestId('estimated-cost')).toHaveTextContent(
      '0.0066866 SOL (6,686,600 lamports)',
    );

    // Nothing is signed before the permanence statement is confirmed.
    expect(screen.getByTestId('sign-button')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Confirm the statement above first.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('permanence-checkbox'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-button')).not.toHaveAttribute('aria-disabled'),
    );
    expect(screen.getByTestId('sign-button')).toHaveTextContent('Sign with Fixture Wallet');
    fireEvent.click(screen.getByTestId('sign-button'));
    await waitFor(() => expect(server.state.submits).toBe(1));
    expect(wallet.calls.signTransaction).toBe(1);
    const signed = server.state.signed as Uint8Array;
    expect(checkSignedTransaction(UNSIGNED, signed)).toEqual({ ok: true });
    expect(signed[1]).toBe(7);
    expect(await screen.findByTestId('submitted-block')).toBeInTheDocument();
    expect(screen.getByTestId('publication-state')).toHaveTextContent('Publishing');
    expect(screen.getByTestId('submitted-signature')).toHaveTextContent('3d3S9ejp');
    expect(screen.queryByRole('link', { name: /on Solana Explorer/ })).not.toBeInTheDocument();

    // Finality is read back from the API, never assumed after the send.
    server.finalize();
    fireEvent.click(screen.getByTestId('recheck-button'));
    await waitFor(() =>
      expect(screen.getByTestId('publication-state')).toHaveTextContent('Registered on-chain'),
    );
    const evidenceView = await screen.findByTestId('registration-evidence');
    expect(
      within(evidenceView).getByRole('link', { name: 'Record on Solana Explorer' }),
    ).toHaveAttribute('href', `https://explorer.solana.com/address/${RECORD}?cluster=devnet`);
    expect(
      within(evidenceView).getByRole('link', { name: 'Transaction on Solana Explorer' }),
    ).toHaveAttribute('href', `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);
    expect(within(evidenceView).getByTestId('verification')).toHaveTextContent(
      'Verified against the chain',
    );
    expect(screen.getByTestId('version-state')).toHaveTextContent('Registered on-chain');
    expect(await screen.findByTestId('status-change-button')).toHaveTextContent(
      'Deprecate this version',
    );
  });

  it('refuses to ask for a signature on the wrong network and when the connected wallet is not the publisher', async () => {
    const server = publishingServer({ publication: publication() });
    const wallet = fakeWallet({ chains: ['solana:mainnet'] });
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice, wallet.wallet);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Publishing');
    const sign = await screen.findByTestId('sign-button');
    fireEvent.click(screen.getByTestId('permanence-checkbox'));
    expect(sign).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Connect the publisher wallet EY3y…AFb5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    await waitFor(() =>
      expect(
        screen.getByText(/on another network. Switch it to Solana devnet/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(sign);
    expect(wallet.calls.signTransaction).toBe(0);
    expect(server.state.submits).toBe(0);
  });

  it('submits nothing when the wallet returns a different message', async () => {
    const server = publishingServer({ publication: publication() });
    const wallet = fakeWallet({ signing: 'alter' });
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice, wallet.wallet);
    await screen.findByTestId('sign-button');
    fireEvent.click(screen.getByTestId('permanence-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    await waitFor(() =>
      expect(screen.getByTestId('sign-button')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(await screen.findByTestId('sign-failure')).toHaveTextContent(
      'the wallet changed the message before signing it',
    );
    expect(wallet.calls.signTransaction).toBe(1);
    expect(server.state.submits).toBe(0);
    expect(screen.getByTestId('publication-state')).toHaveTextContent('Publishing');
  });

  it('submits once even when the sign button is clicked twice while the wallet is open', async () => {
    const server = publishingServer({ publication: publication() });
    const wallet = fakeWallet({ signing: 'hold' });
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice, wallet.wallet);
    await screen.findByTestId('sign-button');
    fireEvent.click(screen.getByTestId('permanence-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    await waitFor(() =>
      expect(screen.getByTestId('sign-button')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(screen.getByTestId('sign-button'));
    await waitFor(() =>
      expect(screen.getByTestId('sign-button')).toHaveAttribute('aria-busy', 'true'),
    );
    fireEvent.click(screen.getByTestId('sign-button'));
    fireEvent.click(screen.getByTestId('sign-button'));
    wallet.release();
    await waitFor(() => expect(server.state.submits).toBe(1));
    expect(wallet.calls.signTransaction).toBe(1);
  });

  it('restores the state a reload finds: submitted, failed, expired and unknown are distinct and never registered', async () => {
    const submitted = publishingServer({
      publication: publication({
        state: 'submitted',
        transaction: null,
        signature: SIGNATURE,
        confirmationStatus: 'confirmed',
      }),
    });
    const first = mount(<VersionView strategyId={S1} versionId={V1} />, submitted.routes, alice);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Publishing');
    expect(await screen.findByTestId('submitted-signature')).toHaveTextContent('3d3S9ejp');
    expect(screen.queryByTestId('sign-button')).not.toBeInTheDocument();
    first.unmount();

    const failed = publishingServer({
      publication: publication({
        state: 'failed',
        transaction: null,
        signature: SIGNATURE,
        failure: {
          code: 'transaction_error',
          programErrorCode: null,
          programError: null,
          message: 'insufficient funds for rent',
        },
      }),
    });
    const second = mount(<VersionView strategyId={S1} versionId={V1} />, failed.routes, alice);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Failed');
    await waitFor(() =>
      expect(screen.getByTestId('publication-detail')).toHaveTextContent(
        'The transaction failed on chain: insufficient funds for rent',
      ),
    );
    expect(await screen.findByText('Try again')).toBeInTheDocument();
    expect(screen.getByTestId('prepare-button')).toBeInTheDocument();
    second.unmount();

    const expired = publishingServer({
      publication: publication({ state: 'expired', transaction: null }),
    });
    const third = mount(<VersionView strategyId={S1} versionId={V1} />, expired.routes, alice);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Expired');
    expect(await screen.findByTestId('prepare-button')).toBeInTheDocument();
    third.unmount();

    const unknown = publishingServer({
      publication: publication({ state: 'unknown', transaction: null, signature: SIGNATURE }),
    });
    mount(<VersionView strategyId={S1} versionId={V1} />, unknown.routes, alice);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Status unknown');
    expect(await screen.findByTestId('recheck-button')).toBeInTheDocument();
    expect(screen.queryByTestId('registration-evidence')).not.toBeInTheDocument();
  });

  it('restores an in-flight deprecation after a reload, signs it with the publisher wallet and reads the new marker from the chain', async () => {
    const server = publishingServer({
      version: { publication: 'registered', publisherWallet: PUBLISHER },
      publication: publication({
        state: 'registered',
        transaction: null,
        signature: SIGNATURE,
        evidence: evidence(),
      }),
      statusChange: publication({ publicationId: CHANGE_ID, operation: 'deprecate' }),
      publicVersion: publicVersion(),
    });
    const wallet = fakeWallet();
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice, wallet.wallet);
    expect(await screen.findByTestId('publication-state')).toHaveTextContent('Registered on-chain');
    expect(await screen.findByTestId('status-change-state')).toHaveTextContent(
      'Deprecation prepared',
    );
    expect(screen.getByText('Sign the deprecation')).toBeInTheDocument();
    expect(screen.queryByTestId('status-change-button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('permanence-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    await waitFor(() =>
      expect(screen.getByTestId('sign-button')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(screen.getByTestId('sign-button'));
    await waitFor(() => expect(server.state.submits).toBe(1));
    expect(calls('POST', `/v1/me/publications/${CHANGE_ID}/submit`)).toHaveLength(1);
    expect(await screen.findByTestId('status-change-state')).toHaveTextContent('Deprecation sent');
    server.finalizeChange();
    fireEvent.click(screen.getByTestId('recheck-button'));
    await waitFor(() =>
      expect(screen.getByTestId('status-change-state')).toHaveTextContent('Deprecation registered'),
    );
    expect(screen.getByTestId('publication-state')).toHaveTextContent('Registered on-chain');
    await waitFor(() =>
      expect(screen.getByTestId('status-change-button')).toHaveTextContent(
        'Reactivate this version',
      ),
    );
    expect(screen.getByTestId('registration-evidence')).toHaveTextContent('Deprecated');
  });

  it('keeps registration unavailable when the deployment has no program', async () => {
    const server = publishingServer();
    server.routes[0] = {
      method: 'GET',
      path: `${P}/v1/registry`,
      reply: ok({
        ...registryStatus,
        publicationEnabled: false,
        disabledReason: 'no registry program configured',
        programId: null,
      }),
    };
    mount(<VersionView strategyId={S1} versionId={V1} />, server.routes, alice);
    expect(
      await screen.findByText('Registration is not available in this deployment'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('prepare-button')).not.toBeInTheDocument();
  });
});

describe('public strategy and version pages', () => {
  it('shows a stranger the registered projection with follow and fork, never the owner controls', async () => {
    const forks: unknown[] = [];
    const follows = {
      list: [] as { strategyId: string; followedAt: string; latestVersion: null }[],
    };
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/me/strategies/${S1}`, reply: notFound },
      {
        method: 'GET',
        path: `${P}/v1/strategies/${S1}`,
        reply: () => ({
          status: 200,
          body: { ...publicStrategy, followerCount: 3 + follows.list.length },
        }),
      },
      {
        method: 'GET',
        path: `${P}/v1/me/follows`,
        reply: () => ({ status: 200, body: { follows: follows.list } }),
      },
      {
        method: 'PUT',
        path: `${P}/v1/me/follows/${S1}`,
        reply: () => {
          follows.list = [{ strategyId: S1, followedAt: NOW, latestVersion: null }];
          return { status: 201, body: { follows: follows.list } };
        },
      },
      {
        method: 'DELETE',
        path: `${P}/v1/me/follows/${S1}`,
        reply: () => {
          follows.list = [];
          return { status: 200, body: { follows: [] } };
        },
      },
      {
        method: 'POST',
        path: `${P}/v1/me/strategies/${S1}/forks`,
        reply: (_url, init) => {
          forks.push(JSON.parse(String(init?.body)));
          const forked = detail([]);
          return {
            status: 201,
            body: {
              ...forked,
              strategy: {
                ...forked.strategy,
                strategyId: NEW_S,
                ownerUserId: BOB_ID,
                forkOf: { strategyId: S1, versionId: V1 },
              },
            },
          };
        },
      },
    ];
    mount(<StrategyView strategyId={S1} />, routes, bob);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Aerospace tilt');
    expect(screen.getByTestId('follower-count')).toHaveTextContent('3 followers');
    expect(screen.getAllByTestId('public-version-row')).toHaveLength(1);
    expect(screen.queryByTestId('freeze-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('publish-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review investment' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const follow = await screen.findByTestId('follow-button');
    await waitFor(() => expect(follow).not.toHaveAttribute('aria-disabled'));
    expect(follow).toHaveTextContent('Follow');
    fireEvent.click(follow);
    await waitFor(() => expect(follow).toHaveTextContent('Following'));
    expect(calls('PUT', `/v1/me/follows/${S1}`)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByTestId('follower-count')).toHaveTextContent('4 followers'),
    );
    fireEvent.click(follow);
    await waitFor(() => expect(follow).toHaveTextContent('Follow'));
    expect(calls('DELETE', `/v1/me/follows/${S1}`)).toHaveLength(1);

    fireEvent.click(screen.getByTestId('fork-button'));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(`/strategies/${NEW_S}/edit?stage=assemble`),
    );
    expect(forks).toEqual([{ versionId: V1 }]);
  });

  it('shows anonymous readers the verified evidence, canonical bytes, indexed record and the difference from the previous public version', async () => {
    const v2 = publicVersion({
      versionId: V2,
      versionNumber: 2,
      parentVersionId: V1,
      manifestHash: HASH_V2,
      legs: [
        {
          instrumentId: AERO,
          symbol: 'FXAERO',
          companyName: 'Fixture Aerospace Inc',
          issuer: 'prestocks',
          mint: MINT_A,
          tokenProgram: 'spl-token',
          weightBps: 5000,
        },
        {
          instrumentId: BIO,
          symbol: 'FXBIO',
          companyName: 'Fixture Biotech Ltd',
          issuer: 'prestocks',
          mint: MINT_B,
          tokenProgram: 'spl-token',
          weightBps: 3000,
        },
      ],
      cashWeightBps: 2000,
      verification: {
        manifestHashMatches: true,
        contentMatches: true,
        recomputedManifestHash: HASH_V2,
        mismatches: [],
        checkedAt: NOW,
      },
    });
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/registry`, reply: ok(registryStatus) },
      { method: 'GET', path: `${P}/v1/strategies/${S1}/versions/${V2}`, reply: ok(v2) },
      {
        method: 'GET',
        path: `${P}/v1/strategies/${S1}/versions/${V1}`,
        reply: ok(publicVersion()),
      },
      { method: 'GET', path: `${P}/v1/registry/records/${RECORD}`, reply: ok(record) },
    ];
    mount(<VersionView strategyId={S1} versionId={V2} />, routes, anonymous);
    expect(await screen.findByTestId('version-state')).toHaveTextContent('Registered on-chain');
    expect(screen.getByTestId('verification')).toHaveTextContent('Verified against the chain');
    expect(screen.getByTestId('record-address')).toHaveTextContent(RECORD);
    expect(screen.getByRole('link', { name: 'Transaction on Solana Explorer' })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
    );
    expect(screen.getByTestId('canonical-manifest')).toHaveTextContent('"cashWeightBps":1000');
    expect(screen.getByTestId('manifest-hash')).toHaveTextContent(HASH_V2);
    const diff = await screen.findByTestId('version-diff');
    expect(diff).toHaveTextContent('FXAERO: 60.00% → 50.00%');
    expect(diff).toHaveTextContent('Cash: 10.00% → 20.00%');
    expect(diff).toHaveTextContent('Turnover to move from version 1 to 2: 10.00%');
    expect(await screen.findByTestId('registry-record')).toHaveTextContent('slot 4,242');
    expect(screen.getByRole('link', { name: 'Sign in to fork' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to follow' })).toBeInTheDocument();
    expect(screen.queryByTestId('publish-panel')).not.toBeInTheDocument();
    expect(stub.calls.every((call) => !call.url.includes('/v1/me/'))).toBe(true);
  });

  it('warns loudly when the public projection does not match the chain', async () => {
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/registry`, reply: ok(registryStatus) },
      {
        method: 'GET',
        path: `${P}/v1/strategies/${S1}/versions/${V1}`,
        reply: ok(
          publicVersion({
            verification: {
              manifestHashMatches: false,
              contentMatches: true,
              recomputedManifestHash: HASH_V2,
              mismatches: ['manifest hash: record carries d324…, recomputed e1e1…'],
              checkedAt: NOW,
            },
          }),
        ),
      },
      { method: 'GET', path: `${P}/v1/registry/records/${RECORD}`, reply: ok(record) },
    ];
    mount(<VersionView strategyId={S1} versionId={V1} />, routes, anonymous);
    const verification = await screen.findByTestId('verification');
    expect(verification).toHaveTextContent('Does not match the chain');
    expect(verification).toHaveTextContent('manifest hash: record carries d324…, recomputed e1e1…');
  });

  it('answers "not found" for a private version whoever asks, without hinting at the owner', async () => {
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/me/strategies/${S1}/versions/${V1}`, reply: notFound },
      { method: 'GET', path: `${P}/v1/strategies/${S1}/versions/${V1}`, reply: notFound },
    ];
    mount(<VersionView strategyId={S1} versionId={V1} />, routes, bob);
    expect(await screen.findByText('No public version with that id')).toBeInTheDocument();
    expect(screen.queryByTestId('publish-panel')).not.toBeInTheDocument();
  });
});

describe('owner strategy page', () => {
  it('lists versions with their chain-derived states, freezes the draft into a new version and shows what others see', async () => {
    const versions: StrategyDetail['versions'] = [
      {
        versionId: V1,
        strategyId: S1,
        versionNumber: 1,
        title: 'Aerospace tilt',
        manifestHash: HASH,
        publication: 'registered',
        deprecatedBy: V2,
        frozenAt: NOW,
      },
      {
        versionId: V2,
        strategyId: S1,
        versionNumber: 2,
        title: 'Aerospace tilt v2',
        manifestHash: HASH_V2,
        publication: 'unpublished',
        deprecatedBy: null,
        frozenAt: NOW,
      },
    ];
    const freezes: unknown[] = [];
    const routes: Route[] = [
      { method: 'GET', path: `${P}/v1/me/strategies/${S1}`, reply: ok(detail(versions)) },
      { method: 'GET', path: `${P}/v1/strategies/${S1}`, reply: ok(publicStrategy) },
      {
        method: 'POST',
        path: `${P}/v1/me/strategies/${S1}/versions`,
        reply: (_url, init) => {
          freezes.push(JSON.parse(String(init?.body)));
          return {
            status: 201,
            body: ownVersion({
              versionId: '77777777-7777-4777-8777-777777777777',
              versionNumber: 3,
              title: 'Aerospace tilt (draft)',
            }),
          };
        },
      },
    ];
    mount(<StrategyView strategyId={S1} />, routes, alice);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Aerospace tilt (draft)',
    );
    const rows = screen.getAllByTestId('version-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Version 2 · Aerospace tilt v2');
    expect(rows[0]).toHaveTextContent('Saved privately');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Publish' })).toHaveAttribute(
      'href',
      `/strategies/${S1}/versions/${V2}`,
    );
    expect(rows[1]).toHaveTextContent('Registered on-chain');
    expect(rows[1]).toHaveTextContent('Superseded by a later version');
    expect(await screen.findByTestId('public-summary')).toHaveTextContent(
      '1 registered version and 3 followers',
    );
    fireEvent.click(screen.getByTestId('freeze-button'));
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(
        `/strategies/${S1}/versions/77777777-7777-4777-8777-777777777777`,
      ),
    );
    expect(freezes).toEqual([{ ifRevision: 3 }]);
  });

  it('keeps freezing unavailable for an invalid draft and explains why', async () => {
    const invalid = detail([]);
    const routes: Route[] = [
      {
        method: 'GET',
        path: `${P}/v1/me/strategies/${S1}`,
        reply: ok({
          ...invalid,
          draft: { ...invalid.draft, validation: { ...invalid.draft.validation, valid: false } },
        }),
      },
    ];
    mount(<StrategyView strategyId={S1} />, routes, alice);
    const freeze = await screen.findByTestId('freeze-button');
    expect(freeze).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Fix the rule violations in the editor before freezing.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No frozen version yet')).toBeInTheDocument();
    expect(screen.getByTestId('public-summary')).toHaveTextContent('Nothing yet');
  });
});
