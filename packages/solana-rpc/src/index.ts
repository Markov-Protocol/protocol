/**
 * @markov/solana-rpc
 *
 * A minimal, bounded JSON-RPC client for the Solana reads the platform needs
 * at boot and for readiness. It deliberately avoids provider SDKs: the
 * chain adapter decision is recorded in docs/markov/open-decisions.md and
 * will be made with compatibility tests, not by importing a large SDK here.
 */
export * from './client.js';
export * from './verify.js';
