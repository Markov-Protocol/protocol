/**
 * @markov/config
 *
 * Strict, fail-closed configuration for every Markov process. Configuration
 * is parsed once at boot from environment variables, validated against the
 * runtime-mode matrix in docs/markov/architecture.md, and then treated as an
 * immutable value. Secrets never appear in error messages or summaries.
 */
export * from './errors.js';
export * from './known-genesis.js';
export * from './load.js';
export * from './redact.js';
export * from './schema.js';
