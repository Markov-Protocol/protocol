/**
 * @markov/accounting
 *
 * Accounting rules (B12): the balanced append-only quantity journal in raw
 * base units with one equation per asset, FIFO lot attribution as analytics
 * bookkeeping, attribution of fills to strategy instances without guessing,
 * reconciliation of the journal against chain balances with explicit
 * external flows, and canonical signed receipts with offline verification.
 * No HTTP, database or provider SDK lives here; the API, the worker and the
 * CLI wire it to the stores, the RPC client and the signing key.
 */
export * from './attribution.js';
export * from './journal.js';
export * from './lots.js';
export * from './projection.js';
export * from './receipts.js';
export * from './reconcile.js';
