import type { SolanaCluster } from '@markov/contracts';

/**
 * Explorer deep links for validated results only. Public clusters map to
 * explorer.solana.com; a local cluster has no public explorer, so callers
 * get null rather than a link that would resolve to the wrong chain.
 */
export function explorerUrl(
  cluster: SolanaCluster,
  kind: 'tx' | 'address',
  value: string,
): string | null {
  const base = `https://explorer.solana.com/${kind}/${encodeURIComponent(value)}`;
  switch (cluster) {
    case 'mainnet-beta':
      return base;
    case 'devnet':
    case 'testnet':
      return `${base}?cluster=${cluster}`;
    default:
      return null;
  }
}
