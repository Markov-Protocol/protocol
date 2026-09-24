import type { GenesisHash, SolanaCluster } from '@markov/contracts';

/**
 * Genesis hashes of the public Solana clusters.
 *
 * Provenance: verified live on 2026-09-24 with `getGenesisHash` through a
 * read-only QuickNode RPC session for mainnet-beta, devnet and testnet, and
 * corroborated by Helius and Anza documentation (docs/markov/source-register.md,
 * entry SR-SOL-01). Every service still verifies the live value at boot and
 * refuses to run on a mismatch: these constants guard against
 * misconfiguration, they do not replace the live check.
 */
export const KNOWN_GENESIS_HASHES: Readonly<
  Record<Exclude<SolanaCluster, 'localnet'>, GenesisHash>
> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export function knownGenesisHash(cluster: SolanaCluster): GenesisHash | null {
  return cluster === 'localnet' ? null : KNOWN_GENESIS_HASHES[cluster];
}
