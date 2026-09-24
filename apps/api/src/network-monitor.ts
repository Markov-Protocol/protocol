import type { Logger } from '@markov/observability';
import {
  type NetworkIdentityResult,
  type SolanaRpcClient,
  verifyNetworkIdentity,
} from '@markov/solana-rpc';

export type NetworkIdentityStatus = 'verified' | 'mismatch' | 'unavailable' | 'unverified';

export interface NetworkIdentitySnapshot {
  readonly status: NetworkIdentityStatus;
  readonly observedGenesisHash: string | null;
  readonly detail: string;
  readonly checkedAt: string | null;
  readonly durationMs: number | null;
}

export interface NetworkIdentitySource {
  snapshot(): NetworkIdentitySnapshot;
}

export interface NetworkIdentityMonitor extends NetworkIdentitySource {
  verifyNow(): Promise<NetworkIdentityResult>;
  start(): void;
  stop(): void;
}

export interface NetworkIdentityMonitorOptions {
  readonly clients: readonly SolanaRpcClient[];
  readonly expectedGenesisHash: string | null;
  readonly intervalMs: number;
  readonly logger: Logger;
  /** Invoked on every mismatch after boot; the process is expected to stop serving. */
  readonly onMismatch?: (result: NetworkIdentityResult) => void;
}

/**
 * Periodically re-verifies that every configured RPC endpoint still reports
 * the bound genesis hash. A provider silently swapping networks after boot
 * must surface as a readiness failure, not as mispriced data.
 */
export function createNetworkIdentityMonitor(
  options: NetworkIdentityMonitorOptions,
): NetworkIdentityMonitor {
  let snapshot: NetworkIdentitySnapshot = {
    status: 'unverified',
    observedGenesisHash: null,
    detail: 'no verification has completed yet',
    checkedAt: null,
    durationMs: null,
  };
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<NetworkIdentityResult> | null = null;

  async function verifyNow(): Promise<NetworkIdentityResult> {
    if (inFlight) {
      return inFlight;
    }
    const started = Date.now();
    inFlight = verifyNetworkIdentity(options.clients, options.expectedGenesisHash)
      .then((result) => {
        const detail = result.endpoints
          .map((endpoint) => `${endpoint.host}: ${endpoint.detail}`)
          .join(' | ');
        snapshot = {
          status: result.status,
          observedGenesisHash: result.observedGenesisHash,
          detail,
          checkedAt: result.checkedAt,
          durationMs: Date.now() - started,
        };
        if (result.status === 'mismatch') {
          options.logger.fatal({ endpoints: result.endpoints }, 'solana network identity mismatch');
          options.onMismatch?.(result);
        } else if (result.status === 'unavailable') {
          options.logger.warn(
            { endpoints: result.endpoints },
            'solana network identity could not be verified',
          );
        } else {
          options.logger.debug(
            { observedGenesisHash: result.observedGenesisHash },
            'solana network identity verified',
          );
        }
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    snapshot: () => snapshot,
    verifyNow,
    start() {
      if (timer === null) {
        timer = setInterval(() => {
          void verifyNow();
        }, options.intervalMs);
        timer.unref();
      }
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
