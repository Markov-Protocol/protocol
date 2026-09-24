/**
 * @markov/strategy
 *
 * Pure strategy rules: exact draft validation, frozen legs with admission
 * snapshots, disclosures, the canonical manifest and its domain-separated
 * hash, and version diffs. No storage, no network.
 */
export * from './diff.js';
export * from './freeze.js';
export * from './manifest.js';
export * from './validate.js';
