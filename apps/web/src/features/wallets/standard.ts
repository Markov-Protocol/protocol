import {
  SOLANA_CHAINS,
  SOLANA_DEVNET_CHAIN,
  SOLANA_LOCALNET_CHAIN,
  SOLANA_MAINNET_CHAIN,
  SOLANA_TESTNET_CHAIN,
  type SolanaChain,
} from '@solana/wallet-standard-chains';
import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
  SolanaTransactionVersion,
} from '@solana/wallet-standard-features';
import { getWallets, type Wallets } from '@wallet-standard/app';
import type { ReadonlyUint8Array, Wallet, WalletAccount } from '@wallet-standard/base';

/**
 * Capability discovery over the Wallet Standard. Markov requests a
 * signature only through a feature the wallet declares; a wallet without
 * `solana:signMessage` cannot verify ownership and says so instead of
 * failing inside a popup.
 */
export interface WalletCapabilities {
  readonly connect: boolean;
  readonly disconnect: boolean;
  readonly events: boolean;
  readonly signMessage: boolean;
  readonly signTransaction: boolean;
  readonly signAndSendTransaction: boolean;
  /** Transaction versions the wallet declares for `solana:signTransaction` (empty when unsupported). */
  readonly transactionVersions: readonly SolanaTransactionVersion[];
}

export interface DiscoveredWallet {
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
  readonly capabilities: WalletCapabilities;
  readonly wallet: Wallet;
}

export interface DiscoveredAccount {
  readonly address: string;
  readonly publicKey: ReadonlyUint8Array;
  readonly chains: readonly string[];
  readonly label: string | null;
  readonly features: readonly string[];
  readonly account: WalletAccount;
}

export function chainForCluster(cluster: string | null): SolanaChain | null {
  switch (cluster) {
    case 'mainnet-beta':
      return SOLANA_MAINNET_CHAIN;
    case 'devnet':
      return SOLANA_DEVNET_CHAIN;
    case 'testnet':
      return SOLANA_TESTNET_CHAIN;
    case 'localnet':
      return SOLANA_LOCALNET_CHAIN;
    default:
      return null;
  }
}

export function clusterLabel(chain: string): string {
  return chain.startsWith('solana:') ? chain.slice('solana:'.length) : chain;
}

export function isSolanaWallet(wallet: Wallet): boolean {
  return wallet.chains.some((chain) => (SOLANA_CHAINS as readonly string[]).includes(chain));
}

export function capabilitiesOf(wallet: Wallet): WalletCapabilities {
  const features = wallet.features as Record<string, unknown>;
  const signTransaction = features['solana:signTransaction'] as
    | SolanaSignTransactionFeature['solana:signTransaction']
    | undefined;
  return {
    connect: 'standard:connect' in features,
    disconnect: 'standard:disconnect' in features,
    events: 'standard:events' in features,
    signMessage: 'solana:signMessage' in features,
    signTransaction: signTransaction !== undefined,
    signAndSendTransaction: 'solana:signAndSendTransaction' in features,
    transactionVersions: signTransaction ? [...signTransaction.supportedTransactionVersions] : [],
  };
}

export function describeWallet(wallet: Wallet): DiscoveredWallet {
  return {
    name: wallet.name,
    icon: wallet.icon,
    chains: wallet.chains,
    capabilities: capabilitiesOf(wallet),
    wallet,
  };
}

export function describeAccount(account: WalletAccount): DiscoveredAccount {
  return {
    address: account.address,
    publicKey: account.publicKey,
    chains: account.chains,
    label: account.label ?? null,
    features: account.features,
    account,
  };
}

export interface WalletRegistry {
  list(): readonly DiscoveredWallet[];
  subscribe(listener: () => void): () => void;
}

/** Solana wallets registered with the page, in registration order; nothing is selected here. */
export function createWalletRegistry(wallets: Wallets = getWallets()): WalletRegistry {
  let cached: readonly DiscoveredWallet[] | null = null;
  const refresh = () => {
    cached = wallets.get().filter(isSolanaWallet).map(describeWallet);
    return cached;
  };
  return {
    list: () => cached ?? refresh(),
    subscribe: (listener) => {
      const offRegister = wallets.on('register', () => {
        refresh();
        listener();
      });
      const offUnregister = wallets.on('unregister', () => {
        refresh();
        listener();
      });
      return () => {
        offRegister();
        offUnregister();
      };
    },
  };
}

export type SignMessageFeature = SolanaSignMessageFeature['solana:signMessage'];
export type SignAndSendFeature =
  SolanaSignAndSendTransactionFeature['solana:signAndSendTransaction'];

export function signMessageFeature(wallet: Wallet): SignMessageFeature | null {
  const feature = (wallet.features as Record<string, unknown>)['solana:signMessage'];
  return feature ? (feature as SignMessageFeature) : null;
}

export async function connectWallet(
  wallet: Wallet,
  options: { readonly silent: boolean } = { silent: false },
): Promise<readonly WalletAccount[]> {
  const feature = (wallet.features as Record<string, unknown>)['standard:connect'] as
    | { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> }
    | undefined;
  if (!feature) {
    throw new Error(`${wallet.name} does not support standard:connect`);
  }
  // Silent only to resume a wallet the person chose earlier; a new choice always shows the wallet's prompt.
  const result = await feature.connect({ silent: options.silent });
  return result.accounts;
}

export async function disconnectWallet(wallet: Wallet): Promise<void> {
  const feature = (wallet.features as Record<string, unknown>)['standard:disconnect'] as
    | { disconnect(): Promise<void> }
    | undefined;
  if (feature) {
    await feature.disconnect();
  }
}

export type WalletChangeListener = (properties: {
  readonly accounts?: readonly WalletAccount[];
  readonly chains?: readonly string[];
  readonly features?: unknown;
}) => void;

export function onWalletChange(wallet: Wallet, listener: WalletChangeListener): () => void {
  const feature = (wallet.features as Record<string, unknown>)['standard:events'] as
    | { on(event: 'change', listener: WalletChangeListener): () => void }
    | undefined;
  return feature ? feature.on('change', listener) : () => {};
}
