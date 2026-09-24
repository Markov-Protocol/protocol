/**
 * @markov/auth
 *
 * Pure identity and credential logic: identity-token verification behind a
 * provider-neutral adapter, a nonproduction test issuer, wallet ownership
 * challenges with Ed25519 verification, hashed opaque credentials, principal
 * classes, scopes and step-up freshness. No database, no HTTP.
 */
export * from './credentials.js';
export * from './identity.js';
export * from './principal.js';
export * from './test-issuer.js';
export * from './wallet.js';
