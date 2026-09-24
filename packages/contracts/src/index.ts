/**
 * @markov/contracts
 *
 * Pure, dependency-light schemas shared by every Markov service, the SDK and
 * the CLI. This package must never import databases, HTTP frameworks,
 * provider SDKs or other Markov packages: it is the bottom of the dependency
 * graph (see docs/markov/architecture.md).
 *
 * Every schema here is a proposed Markov contract. Nothing in this file is a
 * claim about a third-party API.
 */
export * from './capabilities.js';
export * from './catalog.js';
export * from './codec.js';
export * from './errors.js';
export * from './health.js';
export * from './identity.js';
export * from './platform.js';
export * from './policy.js';
export * from './price.js';
