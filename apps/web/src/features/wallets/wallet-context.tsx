'use client';

import type { SolanaChain } from '@solana/wallet-standard-chains';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSession } from '../auth/session-context';
import {
  chainForCluster,
  connectWallet,
  createWalletRegistry,
  type DiscoveredAccount,
  type DiscoveredWallet,
  describeAccount,
  disconnectWallet,
  onWalletChange,
  signMessageFeature,
  type WalletCapabilities,
  type WalletRegistry,
} from './standard';

/**
 * Explicit wallet connection states. A connected wallet is not a verified
 * owner and not a signed-in account: those are separate facts kept in
 * separate places. Nothing here selects a wallet or an account on the
 * person's behalf, and nothing is persisted.
 */
export type WalletConnection =
  | { readonly status: 'none' }
  | { readonly status: 'connecting'; readonly walletName: string }
  | {
      readonly status: 'choose-account';
      readonly walletName: string;
      readonly accounts: readonly DiscoveredAccount[];
    }
  | {
      readonly status: 'connected';
      readonly walletName: string;
      readonly account: DiscoveredAccount;
      readonly capabilities: WalletCapabilities;
      readonly chains: readonly string[];
    }
  | { readonly status: 'declined'; readonly walletName: string; readonly message: string };

export type SigningFailure =
  | 'not-connected'
  | 'unsupported'
  | 'declined'
  | 'altered'
  | 'context-changed';

export class WalletSigningError extends Error {
  override readonly name = 'WalletSigningError';
  readonly reason: SigningFailure;
  constructor(reason: SigningFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface SignedMessage {
  readonly signature: Uint8Array;
  readonly signedMessage: Uint8Array;
  readonly generation: number;
}

export interface WalletContextValue {
  readonly wallets: readonly DiscoveredWallet[];
  readonly connection: WalletConnection;
  /** Increments whenever the wallet, account, chain or session changes; anything signed under an older value is discarded. */
  readonly generation: number;
  readonly expectedChain: SolanaChain | null;
  /** Null until a wallet is connected; then whether the account can act on the platform's cluster. */
  readonly chainMatches: boolean | null;
  /** Last context change worth telling the person about (accounts changed, session changed). */
  readonly notice: string | null;
  select(walletName: string): Promise<void>;
  chooseAccount(address: string): void;
  disconnect(): Promise<void>;
  signMessage(message: string): Promise<SignedMessage>;
  dismissNotice(): void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Per-viewer convenience: the wallet the person chose last, resumed silently after a reload; never the first wallet found. */
export const PREFERRED_WALLET_KEY = 'markov.wallet.preferred';

function readPreferredWallet(): string | null {
  try {
    return window.localStorage.getItem(PREFERRED_WALLET_KEY);
  } catch {
    return null;
  }
}

function writePreferredWallet(name: string | null): void {
  try {
    if (name === null) {
      window.localStorage.removeItem(PREFERRED_WALLET_KEY);
    } else {
      window.localStorage.setItem(PREFERRED_WALLET_KEY, name);
    }
  } catch {
    // a per-viewer convenience only
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 200) : fallback;
}

export interface WalletProviderProps {
  readonly children: ReactNode;
  /** Test seam; defaults to the page's Wallet Standard registry. */
  readonly registry?: WalletRegistry;
}

export function WalletProvider({ children, registry }: WalletProviderProps) {
  const { epoch, platform } = useSession();
  const registryRef = useRef<WalletRegistry | null>(registry ?? null);
  if (registryRef.current === null) {
    registryRef.current = createWalletRegistry();
  }
  const wallets = useSyncExternalStore(
    registryRef.current.subscribe,
    registryRef.current.list,
    () => [] as readonly DiscoveredWallet[],
  );
  const [connection, setConnection] = useState<WalletConnection>({ status: 'none' });
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const generationRef = useRef(0);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const unsubscribeRef = useRef<() => void>(() => {});

  const bump = useCallback(() => {
    generationRef.current += 1;
    setGeneration(generationRef.current);
  }, []);

  const clear = useCallback(
    (next: WalletConnection, reason: string | null) => {
      unsubscribeRef.current();
      unsubscribeRef.current = () => {};
      setConnection(next);
      bump();
      if (reason) {
        setNotice(reason);
      }
    },
    [bump],
  );

  // A different person (or no person) must choose a wallet explicitly.
  const firstEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch !== firstEpoch.current) {
      firstEpoch.current = epoch;
      if (connectionRef.current.status !== 'none') {
        clear(
          { status: 'none' },
          'The signed-in account changed, so the wallet was disconnected. Choose it again if you still want it.',
        );
      } else {
        bump();
      }
    }
  }, [epoch, clear, bump]);

  const watch = useCallback(
    (discovered: DiscoveredWallet, selectedAddress: string) => {
      unsubscribeRef.current();
      unsubscribeRef.current = onWalletChange(discovered.wallet, (properties) => {
        if (!properties.accounts) {
          bump();
          return;
        }
        const still = properties.accounts.find((account) => account.address === selectedAddress);
        if (!still) {
          clear(
            { status: 'none' },
            `${discovered.name} changed its accounts; choose the wallet again.`,
          );
          return;
        }
        bump();
      });
    },
    [bump, clear],
  );

  const connectTo = useCallback(
    async (discovered: DiscoveredWallet, silent: boolean) => {
      const walletName = discovered.name;
      clear({ status: 'connecting', walletName }, null);
      const startedIn = generationRef.current;
      let accounts: readonly DiscoveredAccount[];
      try {
        accounts = (await connectWallet(discovered.wallet, { silent })).map(describeAccount);
      } catch (error) {
        if (startedIn === generationRef.current) {
          setConnection(
            silent
              ? { status: 'none' }
              : {
                  status: 'declined',
                  walletName,
                  message: errorMessage(error, 'the wallet declined the connection'),
                },
          );
        }
        return;
      }
      if (startedIn !== generationRef.current) {
        return;
      }
      if (accounts.length === 0) {
        setConnection(
          silent
            ? { status: 'none' }
            : { status: 'declined', walletName, message: 'the wallet exposed no account' },
        );
        return;
      }
      const [only] = accounts;
      if (accounts.length === 1 && only) {
        setConnection({
          status: 'connected',
          walletName,
          account: only,
          capabilities: discovered.capabilities,
          chains: discovered.chains,
        });
        watch(discovered, only.address);
        return;
      }
      // Several accounts: the person picks, even when resuming.
      setConnection({ status: 'choose-account', walletName, accounts });
    },
    [clear, watch],
  );

  const select = useCallback(
    async (walletName: string) => {
      const discovered = wallets.find((candidate) => candidate.name === walletName);
      if (!discovered) {
        return;
      }
      writePreferredWallet(walletName);
      await connectTo(discovered, false);
    },
    [wallets, connectTo],
  );

  // Resume the wallet the person chose earlier (silently, so no prompt appears on every reload).
  const sessionStatus = useSession().state.status;
  const resumedRef = useRef(false);
  useEffect(() => {
    if (
      resumedRef.current ||
      sessionStatus !== 'signed-in' ||
      connectionRef.current.status !== 'none'
    ) {
      return;
    }
    const preferred = readPreferredWallet();
    const discovered =
      preferred === null ? undefined : wallets.find((candidate) => candidate.name === preferred);
    if (!discovered) {
      return;
    }
    resumedRef.current = true;
    void connectTo(discovered, true);
  }, [wallets, sessionStatus, connectTo]);

  const chooseAccount = useCallback(
    (address: string) => {
      const current = connectionRef.current;
      if (current.status !== 'choose-account') {
        return;
      }
      const account = current.accounts.find((candidate) => candidate.address === address);
      const discovered = wallets.find((candidate) => candidate.name === current.walletName);
      if (!account || !discovered) {
        return;
      }
      setConnection({
        status: 'connected',
        walletName: current.walletName,
        account,
        capabilities: discovered.capabilities,
        chains: discovered.chains,
      });
      bump();
      watch(discovered, account.address);
    },
    [wallets, bump, watch],
  );

  const disconnect = useCallback(async () => {
    const current = connectionRef.current;
    writePreferredWallet(null);
    clear({ status: 'none' }, null);
    if (current.status === 'connected') {
      const discovered = wallets.find((candidate) => candidate.name === current.walletName);
      if (discovered) {
        await disconnectWallet(discovered.wallet).catch(() => undefined);
      }
    }
  }, [wallets, clear]);

  const signMessage = useCallback(
    async (message: string): Promise<SignedMessage> => {
      const current = connectionRef.current;
      if (current.status !== 'connected') {
        throw new WalletSigningError('not-connected', 'connect a wallet first');
      }
      const discovered = wallets.find((candidate) => candidate.name === current.walletName);
      const feature = discovered ? signMessageFeature(discovered.wallet) : null;
      if (!feature) {
        throw new WalletSigningError('unsupported', `${current.walletName} cannot sign messages`);
      }
      const startedIn = generationRef.current;
      const bytes = new TextEncoder().encode(message);
      let outputs: Awaited<ReturnType<typeof feature.signMessage>>;
      try {
        outputs = await feature.signMessage({ account: current.account.account, message: bytes });
      } catch (error) {
        throw new WalletSigningError(
          'declined',
          errorMessage(error, 'the wallet declined to sign'),
        );
      }
      if (startedIn !== generationRef.current) {
        throw new WalletSigningError(
          'context-changed',
          'the wallet or account changed while the signature was pending',
        );
      }
      const [output] = outputs;
      if (!output || outputs.length !== 1) {
        throw new WalletSigningError(
          'altered',
          'the wallet returned an unexpected number of signatures',
        );
      }
      if (!sameBytes(output.signedMessage, bytes)) {
        throw new WalletSigningError('altered', 'the wallet changed the message before signing it');
      }
      if (output.signature.length !== 64) {
        throw new WalletSigningError('altered', 'the signature is not an Ed25519 signature');
      }
      return {
        signature: output.signature,
        signedMessage: output.signedMessage,
        generation: startedIn,
      };
    },
    [wallets],
  );

  useEffect(() => () => unsubscribeRef.current(), []);

  const expectedChain = chainForCluster(
    platform.state === 'connected' ? platform.solanaCluster : null,
  );
  const chainMatches =
    connection.status === 'connected'
      ? expectedChain !== null &&
        (connection.account.chains.includes(expectedChain) ||
          connection.chains.includes(expectedChain))
      : null;

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      connection,
      generation,
      expectedChain,
      chainMatches,
      notice,
      select,
      chooseAccount,
      disconnect,
      signMessage,
      dismissNotice: () => setNotice(null),
    }),
    [
      wallets,
      connection,
      generation,
      expectedChain,
      chainMatches,
      notice,
      select,
      chooseAccount,
      disconnect,
      signMessage,
    ],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (value === null) {
    throw new Error('useWallet must be used inside WalletProvider');
  }
  return value;
}
