import { generateKeyPairSync } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

/**
 * A Wallet Standard wallet injected into the page before any script runs.
 * It registers through the standard's events, signs with WebCrypto Ed25519
 * and approves every request without a popup. Keys live only in memory for
 * the duration of one test run; nothing is written to disk.
 */
export interface FixtureWalletKeys {
  readonly publicKeyRaw: string;
  readonly privateKeyPkcs8: string;
}

export function generateFixtureKeys(): FixtureWalletKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return {
    publicKeyRaw: spki.subarray(spki.length - 32).toString('base64'),
    privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

export interface FixtureWalletOptions {
  readonly name?: string;
  readonly chains?: readonly string[];
  readonly keys: FixtureWalletKeys;
  /** Hold every signature until the test calls `window.__releaseSignature()`. */
  readonly holdSignatures?: boolean;
}

export async function installFixtureWallet(
  context: BrowserContext,
  options: FixtureWalletOptions,
): Promise<void> {
  await context.addInitScript(
    (config: {
      name: string;
      chains: string[];
      publicKeyRaw: string;
      privateKeyPkcs8: string;
      holdSignatures: boolean;
    }) => {
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const fromBase64 = (text: string) =>
        Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
      const toBase58 = (bytes: Uint8Array) => {
        let value = 0n;
        for (const byte of bytes) {
          value = value * 256n + BigInt(byte);
        }
        let out = '';
        while (value > 0n) {
          out = ALPHABET[Number(value % 58n)] + out;
          value /= 58n;
        }
        for (const byte of bytes) {
          if (byte !== 0) {
            break;
          }
          out = `1${out}`;
        }
        return out;
      };
      const publicKey = fromBase64(config.publicKeyRaw);
      const address = toBase58(publicKey);
      const keyPromise = crypto.subtle.importKey(
        'pkcs8',
        fromBase64(config.privateKeyPkcs8),
        { name: 'Ed25519' },
        false,
        ['sign'],
      );
      const account = {
        address,
        publicKey,
        chains: config.chains,
        features: ['solana:signMessage', 'solana:signTransaction'],
        label: 'Fixture account',
      };
      const listeners = new Set<(properties: { accounts?: unknown[] }) => void>();
      type FixtureWindow = Window & {
        __releaseSignature?: () => void;
        __fixtureWalletAddress?: string;
        __fixtureWalletCalls?: { connect: number; sign: number };
        __fixtureWalletChangeAccounts?: (next: unknown[]) => void;
      };
      const fixtureWindow = window as FixtureWindow;
      let release: (() => void) | null = null;
      fixtureWindow.__releaseSignature = () => {
        release?.();
        release = null;
      };
      fixtureWindow.__fixtureWalletAddress = address;
      const calls = { connect: 0, sign: 0, signTransaction: 0 };
      fixtureWindow.__fixtureWalletCalls = calls;
      const wallet = {
        version: '1.0.0',
        name: config.name,
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMyIgZmlsbD0iIzMzNiIvPjwvc3ZnPg==',
        chains: config.chains,
        accounts: [] as unknown[],
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: async () => {
              calls.connect += 1;
              wallet.accounts = [account];
              return { accounts: [account] };
            },
          },
          'standard:disconnect': {
            version: '1.0.0',
            disconnect: async () => {
              wallet.accounts = [];
            },
          },
          'standard:events': {
            version: '1.0.0',
            on: (_event: string, listener: (properties: { accounts?: unknown[] }) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          'solana:signMessage': {
            version: '1.1.0',
            signMessage: async (...inputs: { account: unknown; message: Uint8Array }[]) => {
              calls.sign += 1;
              if (config.holdSignatures) {
                await new Promise<void>((resolve) => {
                  release = resolve;
                });
              }
              const key = await keyPromise;
              const outputs = [];
              for (const input of inputs) {
                const signature = new Uint8Array(
                  await crypto.subtle.sign('Ed25519', key, input.message as BufferSource),
                );
                outputs.push({ signedMessage: input.message, signature, signatureType: 'ed25519' });
              }
              return outputs;
            },
          },
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            // Legacy wire transactions only: [signature count][64-byte slots][message]; the fixture
            // account is the fee payer, so its signature fills the first slot and nothing else moves.
            signTransaction: async (...inputs: { account: unknown; transaction: Uint8Array }[]) => {
              calls.signTransaction += 1;
              if (config.holdSignatures) {
                await new Promise<void>((resolve) => {
                  release = resolve;
                });
              }
              const key = await keyPromise;
              const outputs = [];
              for (const input of inputs) {
                const bytes = input.transaction;
                const count = bytes[0] ?? 0;
                const message = bytes.slice(1 + 64 * count);
                const signature = new Uint8Array(
                  await crypto.subtle.sign('Ed25519', key, message as BufferSource),
                );
                const signed = new Uint8Array(bytes.length);
                signed.set(bytes);
                signed.set(signature, 1);
                outputs.push({ signedTransaction: signed });
              }
              return outputs;
            },
          },
        },
      };
      fixtureWindow.__fixtureWalletChangeAccounts = (next: unknown[]) => {
        wallet.accounts = next;
        for (const listener of listeners) {
          listener({ accounts: next });
        }
      };
      // No class fields here: the function is serialised into the page, where transpiler helpers do not exist.
      const registerEvent = (
        callback: (api: { register: (...wallets: unknown[]) => () => void }) => void,
      ) => {
        const event = new Event('wallet-standard:register-wallet', {
          bubbles: false,
          cancelable: false,
          composed: false,
        });
        Object.defineProperty(event, 'detail', { value: callback, enumerable: true });
        return event;
      };
      const callback = ({ register }: { register: (...wallets: unknown[]) => () => void }) =>
        register(wallet);
      window.dispatchEvent(registerEvent(callback));
      window.addEventListener('wallet-standard:app-ready', ((
        event: Event & { detail: { register: (...wallets: unknown[]) => () => void } },
      ) => callback(event.detail)) as unknown as EventListener);
    },
    {
      name: options.name ?? 'Fixture Wallet',
      chains: [...(options.chains ?? ['solana:devnet'])],
      publicKeyRaw: options.keys.publicKeyRaw,
      privateKeyPkcs8: options.keys.privateKeyPkcs8,
      holdSignatures: options.holdSignatures ?? false,
    },
  );
}
