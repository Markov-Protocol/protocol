import { type SolanaRpcClient, SolanaRpcError } from './client.js';

export type GenesisVerificationStatus = 'verified' | 'mismatch' | 'unavailable';

export interface EndpointGenesisResult {
  readonly host: string;
  readonly status: GenesisVerificationStatus;
  readonly observedGenesisHash: string | null;
  readonly detail: string;
  readonly durationMs: number;
}

export interface NetworkIdentityResult {
  /** `mismatch` if any endpoint contradicts the expectation; `verified` if at least one agrees and none contradict. */
  readonly status: GenesisVerificationStatus;
  readonly expectedGenesisHash: string | null;
  readonly observedGenesisHash: string | null;
  readonly endpoints: readonly EndpointGenesisResult[];
  readonly checkedAt: string;
}

export async function verifyEndpointGenesis(
  client: SolanaRpcClient,
  expectedGenesisHash: string | null,
): Promise<EndpointGenesisResult> {
  const started = Date.now();
  try {
    const observed = await client.getGenesisHash();
    const durationMs = Date.now() - started;
    if (expectedGenesisHash === null) {
      return {
        host: client.host,
        status: 'verified',
        observedGenesisHash: observed,
        detail: 'no expectation configured; observed genesis recorded',
        durationMs,
      };
    }
    if (observed === expectedGenesisHash) {
      return {
        host: client.host,
        status: 'verified',
        observedGenesisHash: observed,
        detail: 'genesis hash matches',
        durationMs,
      };
    }
    return {
      host: client.host,
      status: 'mismatch',
      observedGenesisHash: observed,
      detail: `endpoint reports genesis ${observed}, expected ${expectedGenesisHash}`,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail =
      error instanceof SolanaRpcError
        ? `${error.kind}: ${error.message}`
        : 'unexpected error during genesis check';
    return {
      host: client.host,
      status: 'unavailable',
      observedGenesisHash: null,
      detail,
      durationMs,
    };
  }
}

/**
 * Verify the network identity across every configured endpoint. Fail closed:
 * a single contradicting endpoint makes the whole result a mismatch, because
 * a process must never straddle two chains.
 */
export async function verifyNetworkIdentity(
  clients: readonly SolanaRpcClient[],
  expectedGenesisHash: string | null,
): Promise<NetworkIdentityResult> {
  const endpoints = await Promise.all(
    clients.map((client) => verifyEndpointGenesis(client, expectedGenesisHash)),
  );
  const observedHashes = new Set(
    endpoints.flatMap((endpoint) =>
      endpoint.observedGenesisHash === null ? [] : [endpoint.observedGenesisHash],
    ),
  );
  let status: GenesisVerificationStatus;
  if (endpoints.some((endpoint) => endpoint.status === 'mismatch') || observedHashes.size > 1) {
    status = 'mismatch';
  } else if (endpoints.some((endpoint) => endpoint.status === 'verified')) {
    status = 'verified';
  } else {
    status = 'unavailable';
  }
  const [observedGenesisHash = null] = [...observedHashes];
  return {
    status,
    expectedGenesisHash,
    observedGenesisHash: status === 'mismatch' ? null : observedGenesisHash,
    endpoints,
    checkedAt: new Date().toISOString(),
  };
}
