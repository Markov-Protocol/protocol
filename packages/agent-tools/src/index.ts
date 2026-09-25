/**
 * @markov/agent-tools
 *
 * Pure agent tool rules (B15): the typed tool catalog with its scope
 * matrix, input validation, canonical digests and redacted provenance
 * summaries, budget accounting, owner-facing denial explanations and the
 * bounded companion model adapter contract with its deterministic fixture.
 * No network, no storage, no provider, no authority: every call runs in the
 * API with the caller's own principal.
 */
export * from './catalog.js';
export * from './companion.js';
export * from './explain.js';
export * from './provenance.js';
