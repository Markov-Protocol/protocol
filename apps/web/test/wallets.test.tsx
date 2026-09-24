import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivateQueryProvider } from '../src/features/auth/private-query-provider';
import { SessionProvider, useSession } from '../src/features/auth/session-context';
import type { PlatformSnapshot, SessionSnapshot } from '../src/features/auth/session-types';
import { FundingPanel } from '../src/features/funding/funding-panel';
import type { WalletRegistry } from '../src/features/wallets/standard';
import { describeWallet } from '../src/features/wallets/standard';
import { useWallet, WalletProvider } from '../src/features/wallets/wallet-context';
import { WalletsView } from '../src/features/wallets/wallets-view';

const platform: PlatformSnapshot = {
  state: 'connected',
  markovEnv: 'test',
  solanaCluster: 'devnet',
  identityProvider: 'test',
  executionWritesEnabled: false,
};
const ALICE = 'user-alice';
const ADDRESS_A = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const ADDRESS_B = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const WALLET_ID = '11111111-1111-4111-8111-111111111111';
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

function snapshotFor(subject: string, sessionId: string, stepUpFresh = true): SessionSnapshot {
  return {
    state: 'signed-in',
    account: {
      userId: `user-${subject}`,
      subject,
      issuer: 'urn:markov:test',
      authTime: null,
      stepUpFresh,
    },
    session: { sessionId, expiresAt: '2030-01-01T00:00:00.000Z' },
  };
}

interface FakeWalletOptions {
  name?: string;
  chains?: string[];
  accounts?: { address: string; label?: string; chains?: string[] }[];
  signMessage?: boolean;
  /** Return a signedMessage that differs from the input. */
  alter?: boolean;
  /** Hold every signature until the test releases it. */
  holdSignatures?: boolean;
  /** Answer a silent (resume) connect instead of refusing it. */
  allowSilent?: boolean;
}

function fakeWallet(options: FakeWalletOptions = {}) {
  const chains = options.chains ?? ['solana:devnet'];
  const accounts = (options.accounts ?? [{ address: ADDRESS_A }]).map((account) => ({
    address: account.address,
    publicKey: new Uint8Array(32),
    chains: account.chains ?? chains,
    features: ['solana:signMessage'],
    ...(account.label ? { label: account.label } : {}),
  })) as unknown as WalletAccount[];
  const changeListeners = new Set<(properties: { accounts?: readonly WalletAccount[] }) => void>();
  const released: (() => void)[] = [];
  const calls = { connect: 0, disconnect: 0, sign: 0, silent: 0 };
  const state: { accounts: WalletAccount[] } = { accounts: [] };
  const walletObject: Record<string, unknown> = {
    version: '1.0.0',
    name: options.name ?? 'Fixture Wallet',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    chains,
    get accounts() {
      return state.accounts;
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async (input?: { silent?: boolean }) => {
          calls.connect += 1;
          if (input?.silent) {
            calls.silent += 1;
            if (!options.allowSilent) {
              throw new Error('silent connect refused');
            }
          }
          state.accounts = accounts;
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          calls.disconnect += 1;
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (
          _event: 'change',
          listener: (properties: { accounts?: readonly WalletAccount[] }) => void,
        ) => {
          changeListeners.add(listener);
          return () => changeListeners.delete(listener);
        },
      },
      ...(options.signMessage === false
        ? {}
        : {
            'solana:signMessage': {
              version: '1.1.0',
              signMessage: async (...inputs: { account: WalletAccount; message: Uint8Array }[]) => {
                calls.sign += 1;
                if (options.holdSignatures) {
                  await new Promise<void>((resolve) => released.push(resolve));
                }
                return inputs.map((input) => ({
                  signedMessage: options.alter
                    ? new Uint8Array([...input.message, 33])
                    : input.message,
                  signature: new Uint8Array(64).fill(7),
                }));
              },
            },
          }),
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async () => [],
      },
    },
  };
  const wallet = walletObject as unknown as Wallet;
  return {
    wallet,
    calls,
    emitChange: (next: readonly WalletAccount[]) => {
      for (const listener of changeListeners) {
        listener({ accounts: next });
      }
    },
    release: () => {
      for (const resolve of released.splice(0)) {
        resolve();
      }
    },
  };
}

function registryOf(...wallets: Wallet[]): WalletRegistry {
  const described = wallets.map(describeWallet);
  return { list: () => described, subscribe: () => () => {} };
}

interface ApiAnswer {
  status: number;
  body: unknown;
}

/** Fake app origin: session route from `sessionAnswers`, proxy calls from `answers` in order, recorded in `calls`. */
function fakeFetch(answers: Record<string, ApiAnswer[]>) {
  const sessionAnswers: SessionSnapshot[] = [];
  const calls: { method: string; url: string; body: unknown }[] = [];
  const impl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/api/auth/session')) {
        return Response.json(sessionAnswers.shift() ?? { state: 'signed-out' });
      }
      if (url.endsWith('/api/auth/sign-out')) {
        return Response.json({ ok: true, revoked: true });
      }
      const method = init?.method ?? 'GET';
      const key = `${method} ${url}`;
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const queue = answers[key];
      const answer = queue?.shift() ??
        queue?.at(-1) ?? {
          status: 404,
          body: {
            error: { code: 'NOT_FOUND', message: `no fake answer for ${key}`, requestId: 'r' },
          },
        };
      if (answer.status === 204) {
        return new Response(null, { status: 204 });
      }
      return Response.json(answer.body, { status: answer.status });
    },
  );
  return { impl, sessionAnswers, calls };
}

const link = (address: string) => ({
  walletId: WALLET_ID,
  chain: 'solana',
  genesisHash: GENESIS,
  address,
  verifiedAt: '2026-09-24T12:00:00.000Z',
});
const challenge = (address: string) => ({
  challengeId: '22222222-2222-4222-8222-222222222222',
  address,
  message: `markov.pet wants you to prove that you own this Solana wallet for your Markov account.\n\nAddress: ${address}\nChain: solana:${GENESIS}\nAccount: ${ALICE}\nNonce: abc\nIssued At: 2026-09-24T12:00:00.000Z\nExpiration Time: 2026-09-24T12:10:00.000Z\n\nSigning links the wallet to your account. It approves no transaction and costs nothing.`,
  expiresAt: '2026-09-24T12:10:00.000Z',
});
const eligibilityBody = {
  capability: 'trade_stocks',
  outcome: 'unknown',
  decision: null,
  policyVersion: null,
  terms: { required: [], acknowledged: [], complete: true },
  steps: ['declare_jurisdiction', 'verify_wallet'],
  summary: 'Declare where you live.',
};

function Harness({
  registry,
  initial,
  children,
}: {
  registry: WalletRegistry;
  initial: SessionSnapshot;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider initial={initial} platform={platform}>
      <WalletProvider registry={registry}>
        <PrivateQueryProvider>{children}</PrivateQueryProvider>
      </WalletProvider>
    </SessionProvider>
  );
}

function ConnectionProbe() {
  const { connection, generation, chainMatches } = useWallet();
  const { epoch } = useSession();
  return (
    <output data-testid="connection">
      {connection.status}|{connection.status === 'connected' ? connection.account.address : '-'}|gen
      {generation}|epoch{epoch}|chain{String(chainMatches)}
    </output>
  );
}

let fetchControl: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(
  registry: WalletRegistry,
  answers: Record<string, ApiAnswer[]>,
  initial = snapshotFor('alice', 's1'),
) {
  fetchControl = fakeFetch(answers);
  vi.stubGlobal('fetch', fetchControl.impl);
  return render(
    <Harness registry={registry} initial={initial}>
      <ConnectionProbe />
      <WalletsView />
    </Harness>,
  );
}

const baseAnswers = () => ({
  'GET /api/markov/v1/me/wallets': [{ status: 200, body: { wallets: [] } }],
  'GET /api/markov/v1/me/eligibility': [{ status: 200, body: eligibilityBody }],
});

describe('wallet selection and capability discovery', () => {
  it('lists detected wallets with capabilities and never connects until the person chooses', async () => {
    const fixture = fakeWallet();
    const noSigning = fakeWallet({ name: 'Viewer Wallet', signMessage: false });
    mount(registryOf(fixture.wallet, noSigning.wallet), baseAnswers());
    await screen.findByText(
      'No wallet is connected. Choose one below; Markov never picks one for you.',
    );
    expect(fixture.calls.connect).toBe(0);
    const viewer = screen.getByLabelText('Viewer Wallet capabilities');
    expect(within(viewer).getByText('No message signing')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Fixture Wallet capabilities')).getByText(
        'Signs transactions (legacy, v0)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Markov-managed (embedded) wallet')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent(`connected|${ADDRESS_A}`),
    );
    expect(fixture.calls.connect).toBe(1);
    expect(screen.getByTestId('connection')).toHaveTextContent('chaintrue');
    expect(screen.getByText('Ownership not verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connected' })).toBeInTheDocument();
  });

  it('asks which account to use when the wallet exposes several', async () => {
    const fixture = fakeWallet({
      accounts: [
        { address: ADDRESS_A, label: 'Main' },
        { address: ADDRESS_B, label: 'Savings' },
      ],
    });
    mount(registryOf(fixture.wallet), baseAnswers());
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await screen.findByText(
      'Fixture Wallet exposes several accounts. Choose the one that will sign:',
    );
    expect(screen.getByTestId('connection')).toHaveTextContent('choose-account|-');
    fireEvent.click(screen.getByRole('button', { name: /Savings/ }));
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent(`connected|${ADDRESS_B}`),
    );
  });

  it('refuses to ask for a signature on the wrong network and explains what to do', async () => {
    const fixture = fakeWallet({ chains: ['solana:mainnet'] });
    mount(registryOf(fixture.wallet), baseAnswers());
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await screen.findByText('This wallet account is on another network');
    expect(screen.getByTestId('connection')).toHaveTextContent('chainfalse');
    expect(screen.getByText('Network mismatch')).toBeInTheDocument();
    expect(screen.getByTestId('verify-ownership')).toBeDisabled();
    expect(fixture.calls.sign).toBe(0);
    expect(fetchControl.calls.filter((call) => call.url.includes('challenges'))).toHaveLength(0);
  });

  it('disconnecting forgets the wallet but keeps the session; a session change forgets the wallet', async () => {
    const fixture = fakeWallet();
    mount(registryOf(fixture.wallet), baseAnswers());
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('none|-|gen'));
    expect(fixture.calls.disconnect).toBe(1);
    expect(screen.getByTestId('connection')).toHaveTextContent('epoch0');

    fireEvent.click(screen.getByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    // Another person signs in (for example in another tab): the wallet is no longer selected for them.
    fetchControl.sessionAnswers.push(snapshotFor('bob', 's2'));
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('none|-'));
    expect(screen.getByTestId('connection')).toHaveTextContent('epoch1');
    expect(screen.getByText('Wallet context changed')).toBeInTheDocument();
  });
});

describe('resuming a chosen wallet', () => {
  it('resumes only the wallet the person chose earlier, silently, and forgets it on disconnect', async () => {
    const fixture = fakeWallet({ allowSilent: true });
    const other = fakeWallet({ name: 'Other Wallet', allowSilent: true });
    window.localStorage.setItem('markov.wallet.preferred', 'Fixture Wallet');
    mount(registryOf(other.wallet, fixture.wallet), baseAnswers());
    await waitFor(() =>
      expect(screen.getByTestId('connection')).toHaveTextContent(`connected|${ADDRESS_A}`),
    );
    expect(fixture.calls.silent).toBe(1);
    expect(other.calls.connect).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('none|-'));
    expect(window.localStorage.getItem('markov.wallet.preferred')).toBeNull();
  });

  it('stays disconnected when nothing was chosen before or the wallet refuses a silent connect', async () => {
    const fixture = fakeWallet();
    const { unmount } = mount(registryOf(fixture.wallet), baseAnswers());
    await screen.findByText(
      'No wallet is connected. Choose one below; Markov never picks one for you.',
    );
    expect(fixture.calls.connect).toBe(0);
    unmount();
    window.localStorage.setItem('markov.wallet.preferred', 'Fixture Wallet');
    const refusing = fakeWallet();
    mount(registryOf(refusing.wallet), baseAnswers());
    await waitFor(() => expect(refusing.calls.silent).toBe(1));
    await screen.findByText(
      'No wallet is connected. Choose one below; Markov never picks one for you.',
    );
    expect(screen.queryByText(/did not connect/)).toBeNull();
  });
});

describe('ownership verification', () => {
  it('shows the exact challenge, presents the signature once and maps replay and already-linked answers', async () => {
    const fixture = fakeWallet();
    mount(registryOf(fixture.wallet), {
      ...baseAnswers(),
      'POST /api/markov/v1/me/wallets/challenges': [
        { status: 201, body: challenge(ADDRESS_A) },
        { status: 201, body: challenge(ADDRESS_A) },
        { status: 201, body: challenge(ADDRESS_A) },
      ],
      'POST /api/markov/v1/me/wallets': [
        { status: 201, body: link(ADDRESS_A) },
        {
          status: 409,
          body: { error: { code: 'CHALLENGE_INVALID', message: 'consumed', requestId: 'r' } },
        },
        {
          status: 409,
          body: { error: { code: 'WALLET_ALREADY_LINKED', message: 'elsewhere', requestId: 'r' } },
        },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    fireEvent.click(screen.getByTestId('verify-ownership'));
    await screen.findByText('Wallet verified');
    expect(fixture.calls.sign).toBe(1);
    const linkCall = fetchControl.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/v1/me/wallets'),
    );
    expect(linkCall?.body).toMatchObject({
      challengeId: '22222222-2222-4222-8222-222222222222',
      address: ADDRESS_A,
    });
    expect(typeof (linkCall?.body as { signature?: unknown } | undefined)?.signature).toBe(
      'string',
    );
    expect(screen.queryByTestId('challenge-message')).toBeNull();

    // The wallets list is refreshed after linking; simulate the API now knowing the wallet.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByTestId('verify-ownership'));
    await screen.findByText(
      'The ownership challenge expired, was already used or does not match this wallet.',
    );
    expect(
      screen.getByText('Start again to get a fresh challenge. Signatures are never reused.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await screen.findByText('This wallet is already verified on another Markov account.');
    expect(
      screen.getByText(/Markov never moves a wallet between accounts on its own/),
    ).toBeInTheDocument();
  });

  it('never submits a signature obtained under a previous account or after the wallet changed', async () => {
    const fixture = fakeWallet({ holdSignatures: true });
    mount(registryOf(fixture.wallet), {
      ...baseAnswers(),
      'POST /api/markov/v1/me/wallets/challenges': [
        { status: 201, body: challenge(ADDRESS_A) },
        { status: 201, body: challenge(ADDRESS_A) },
      ],
      'POST /api/markov/v1/me/wallets': [{ status: 201, body: link(ADDRESS_A) }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    fireEvent.click(screen.getByTestId('verify-ownership'));
    await screen.findByTestId('challenge-message');
    expect(screen.getByTestId('challenge-message')).toHaveTextContent(`Address: ${ADDRESS_A}`);
    // The account switches while the wallet popup is open.
    fetchControl.sessionAnswers.push(snapshotFor('bob', 's2'));
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('epoch1'));
    await act(async () => {
      fixture.release();
    });
    await waitFor(() => expect(fixture.calls.sign).toBe(1));
    expect(
      fetchControl.calls.filter(
        (call) => call.method === 'POST' && call.url.endsWith('/v1/me/wallets'),
      ),
    ).toHaveLength(0);

    // Same guard for a wallet account change during signing.
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    fireEvent.click(screen.getByTestId('verify-ownership'));
    await screen.findByTestId('challenge-message');
    await act(async () => {
      fixture.emitChange([
        {
          address: ADDRESS_B,
          publicKey: new Uint8Array(32),
          chains: ['solana:devnet'],
          features: ['solana:signMessage'],
        },
      ]);
    });
    await act(async () => {
      fixture.release();
    });
    await screen.findByText(
      'The wallet or account changed while the signature was pending. Nothing was linked.',
    );
    expect(
      fetchControl.calls.filter(
        (call) => call.method === 'POST' && call.url.endsWith('/v1/me/wallets'),
      ),
    ).toHaveLength(0);
  });

  it('rejects a wallet that alters the message and needs a recent sign-in', async () => {
    const altering = fakeWallet({ name: 'Altering Wallet', alter: true });
    mount(registryOf(altering.wallet), {
      ...baseAnswers(),
      'POST /api/markov/v1/me/wallets/challenges': [{ status: 201, body: challenge(ADDRESS_A) }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Altering Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    fireEvent.click(screen.getByTestId('verify-ownership'));
    await screen.findByText(/did not sign the exact message/);
    expect(
      fetchControl.calls.filter(
        (call) => call.method === 'POST' && call.url.endsWith('/v1/me/wallets'),
      ),
    ).toHaveLength(0);
  });

  it('keeps linking behind a recent sign-in', async () => {
    const fixture = fakeWallet();
    mount(registryOf(fixture.wallet), baseAnswers(), snapshotFor('alice', 's1', false));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose Fixture Wallet' }));
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('connected'));
    expect(screen.getByTestId('verify-ownership')).toBeDisabled();
    expect(screen.getByText(/Linking and unlinking need a recent sign-in/)).toBeInTheDocument();
  });
});

describe('funding panel', () => {
  const funding = (overrides: Record<string, unknown>) => ({
    walletId: WALLET_ID,
    chain: 'solana',
    cluster: 'devnet',
    genesisHash: GENESIS,
    address: ADDRESS_A,
    observedAt: new Date().toISOString(),
    slot: 4242,
    commitment: 'confirmed',
    source: 'rpc',
    sol: { lamports: '9000', sufficientForFees: false },
    stablecoin: {
      symbol: 'USDC',
      mint: 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts',
      decimals: 6,
      raw: '250000000',
      tokenAccounts: 1,
    },
    stablecoinUnavailableReason: null,
    requirements: {
      rentExemptTokenAccountLamports: '2039280',
      baseFeeLamportsPerSignature: '5000',
      assumedSignatures: 2,
      requiredLamports: '10000',
      explanation:
        '2 signatures at the base fee of 5000 lamports each. A strategy plan states its exact fee payer.',
    },
    readiness: 'needs_sol',
    ...overrides,
  });

  it('shows the person’s own address with copy and QR, observed balances and the fee requirement', async () => {
    fetchControl = fakeFetch({
      [`GET /api/markov/v1/me/wallets/${WALLET_ID}/funding`]: [{ status: 200, body: funding({}) }],
    });
    vi.stubGlobal('fetch', fetchControl.impl);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <Harness registry={registryOf()} initial={snapshotFor('alice', 's1')}>
        <FundingPanel walletId={WALLET_ID} />
      </Harness>,
    );
    await screen.findByText('Needs SOL for fees');
    expect(screen.getByTestId('receive-address')).toHaveTextContent(ADDRESS_A);
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
    expect(screen.getByTestId('sol-balance')).toHaveTextContent('0.000009 SOL');
    expect(screen.getByTestId('stablecoin-balance')).toHaveTextContent('250 USDC');
    expect(screen.getByTestId('required-lamports')).toHaveTextContent('0.00001 SOL (not covered)');
    expect(screen.getByText(/never gives you a pooled deposit address/)).toBeInTheDocument();
    expect(
      screen.getByText(/Bridges, fiat onramps and fee sponsorship are not integrated/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy wallet address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS_A));
  });

  it('reports unknown balances as unknown when the endpoint cannot be read', async () => {
    fetchControl = fakeFetch({
      [`GET /api/markov/v1/me/wallets/${WALLET_ID}/funding`]: [
        {
          status: 503,
          body: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'rpc down', requestId: 'r' } },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchControl.impl);
    render(
      <Harness registry={registryOf()} initial={snapshotFor('alice', 's1')}>
        <FundingPanel walletId={WALLET_ID} />
      </Harness>,
    );
    await screen.findByText('Balances unknown right now');
    expect(screen.queryByText(/0 SOL/)).not.toBeInTheDocument();
  });
});
