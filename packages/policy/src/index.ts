/**
 * @markov/policy
 *
 * Deterministic eligibility, limits, capability states and trading policy.
 * Pure functions over recorded evidence: no storage, no HTTP, no provider.
 * The backend records decisions; it never invents a legal rule.
 */
export * from './capabilities.js';
export * from './eligibility.js';
export * from './evaluate.js';
export * from './limits.js';
