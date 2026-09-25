/**
 * @markov/solana-codec
 *
 * SDK-free Solana primitives shared by the registry SDK, the execution
 * validator and the fixtures: byte helpers, public keys and program-derived
 * addresses, token accounts and associated token addresses, legacy and
 * versioned message and transaction codecs with Ed25519 verification, and
 * the in-memory fixture chain that executes registered program semantics
 * for tests. Nothing here talks to a network.
 */
export * from './bytes.js';
export * from './chain.js';
export * from './pubkey.js';
export * from './token.js';
export * from './transaction.js';
