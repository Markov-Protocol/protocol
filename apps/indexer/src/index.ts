/**
 * @markov/indexer
 *
 * The registry indexer: follows every submitted publication to its finalized
 * outcome and mirrors every record the registry program owns into the
 * database. It writes only what the chain reported; a row here is evidence
 * of an observation, never a registration by itself.
 */
export * from './boot.js';
export * from './indexer.js';
