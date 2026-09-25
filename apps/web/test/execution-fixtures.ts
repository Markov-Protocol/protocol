import type {
  ExecutionAttempt,
  ExecutionBatch,
  ExecutionFill,
  ExecutionStatus,
  PreparedTransaction,
} from '@markov/contracts';
import {
  GENESIS,
  HASH,
  INTENT_ID,
  MINT_A,
  MINT_B,
  OWNER,
  PLAN_ID,
  STABLECOIN,
} from './review-fixtures';

export const TX_ID = '88888888-8888-4888-8888-888888888888';
export const TX_ID_2 = '88888888-8888-4888-8888-888888888889';
export const ATTEMPT_ID = '99999999-9999-4999-8999-999999999999';
export const ATTEMPT_ID_2 = '99999999-9999-4999-8999-999999999998';
export const FILL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const SIGNATURE =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
export const SIGNATURE_2 =
  '2p3dYw9zTt7vWfXoC4GLdE8mU2KJb7vY1Q6kZ5rN8sHcA9eF3gLwMxPqRtSuVyBzD1nJ4hK6mC8oE2iG5aXbT7Yc';
export const MESSAGE_HASH = 'c0ffee00'.padEnd(64, '3');
export const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
/** The fixture wallet's associated accounts for mint A, mint B and the stablecoin: public addresses, not credentials. */
export const HOLDING_ACCOUNT_A = '3xTy1F5HCWVtRhF7jTz9hqQdi3F7Gv8tbeZMjaU1a7ge';
export const HOLDING_ACCOUNT_B = '6ZRCB7AAqGre182v4fbsXPLNPYZXBN9YnStfR9hUTv8N';
export const CASH_ACCOUNT = '9MJi3i9sxYALSb3uBuZQ2yaQYCiLK1hJTwEXjyQYeZdG';
/** A legacy wire transaction: one zeroed signature slot in front of a short message. */
export const UNSIGNED_BASE64 = Buffer.concat([
  Buffer.from([1]),
  Buffer.alloc(64),
  Buffer.from('markov-fixture-message', 'utf8'),
]).toString('base64');

export function attempt(overrides: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  return {
    attemptId: ATTEMPT_ID,
    transactionId: TX_ID,
    transactionIndex: 0,
    signature: SIGNATURE,
    state: 'submitted',
    reason: null,
    submittedAt: '2026-09-25T10:00:05.000Z',
    lastCheckedAt: '2026-09-25T10:00:07.000Z',
    confirmationStatus: null,
    slot: null,
    resendCount: 0,
    chainError: null,
    createdAt: '2026-09-25T10:00:05.000Z',
    updatedAt: '2026-09-25T10:00:07.000Z',
    ...overrides,
  };
}

export function fill(overrides: Partial<ExecutionFill> = {}): ExecutionFill {
  return {
    fillId: FILL_ID,
    intentId: INTENT_ID,
    planId: PLAN_ID,
    legIndex: 0,
    signature: SIGNATURE,
    slot: 4300,
    blockTime: '2026-09-25T10:00:09.000Z',
    side: 'buy',
    inputMint: STABLECOIN,
    outputMint: MINT_A,
    inputSpentRaw: '54000000',
    outputReceivedRaw: '5463013',
    feeLamports: '5000',
    lamportsSpent: '2044280',
    withinBounds: true,
    source: 'transaction_meta',
    observedAt: '2026-09-25T10:00:10.000Z',
    ...overrides,
  };
}

export function batch(overrides: Partial<ExecutionBatch> = {}): ExecutionBatch {
  return {
    batch: 0,
    legIndexes: [0],
    state: 'pending',
    transactionId: null,
    attemptId: null,
    signature: null,
    reason: null,
    ...overrides,
  };
}

export function prepared(overrides: Partial<PreparedTransaction> = {}): PreparedTransaction {
  return {
    transactionId: TX_ID,
    intentId: INTENT_ID,
    planId: PLAN_ID,
    planHash: HASH,
    transactionIndex: 0,
    batch: 0,
    legIndexes: [0],
    network: { cluster: 'devnet', genesisHash: GENESIS },
    version: 'legacy',
    unsignedTransaction: UNSIGNED_BASE64,
    messageHash: MESSAGE_HASH,
    feePayer: OWNER,
    expectedSigner: OWNER,
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: 4500,
    buildSource: 'fixture-venue',
    instructions: [
      {
        index: 0,
        programId: 'ComputeBudget111111111111111111111111111111',
        program: 'compute_budget',
        kind: 'compute_unit_limit',
        summary: 'Compute unit limit 200000',
      },
      {
        index: 1,
        programId: 'ComputeBudget111111111111111111111111111111',
        program: 'compute_budget',
        kind: 'compute_unit_price',
        summary: 'Compute unit price 1000 micro-lamports',
      },
      {
        index: 2,
        programId: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        program: 'associated_token',
        kind: 'ata_create',
        summary: 'Create the owner token account for FXAERO',
      },
      {
        index: 3,
        programId: 'Gb8BHynqtw8bVGTmRAuCD5iJqqBdRamwW9n4XR2cEvvq',
        program: 'fixture_route',
        kind: 'route_swap',
        summary: 'Swap 54000000 USDC for at least 5435698 FXAERO',
      },
    ],
    effects: {
      side: 'buy',
      inputMint: STABLECOIN,
      maxInputRaw: '54000000',
      legs: [
        {
          legIndex: 0,
          side: 'buy',
          inputMint: STABLECOIN,
          outputMint: MINT_A,
          maxInputRaw: '54000000',
          minimumOutputRaw: '5435698',
          sourceTokenAccount: CASH_ACCOUNT,
          destinationTokenAccount: HOLDING_ACCOUNT_A,
        },
      ],
      accountsCreated: [HOLDING_ACCOUNT_A],
      computeUnitLimit: 200000,
      computeUnitPriceMicroLamports: '1000',
      baseFeeLamports: '5000',
      priorityFeeMaxLamports: '200',
      rentLamports: '2039280',
      totalLamportsMax: '2044480',
      signers: [OWNER],
      routeProgramIds: ['Gb8BHynqtw8bVGTmRAuCD5iJqqBdRamwW9n4XR2cEvvq'],
    },
    simulation: {
      status: 'ok',
      unitsConsumed: 41000,
      err: null,
      logsHash: 'beefbeef'.padEnd(64, '4'),
      slot: 4290,
      observedAt: '2026-09-25T10:00:03.000Z',
    },
    state: 'prepared',
    attempt: null,
    createdAt: '2026-09-25T10:00:03.000Z',
    ...overrides,
  };
}

export function status(overrides: Partial<ExecutionStatus> = {}): ExecutionStatus {
  return {
    intentId: INTENT_ID,
    state: 'AUTHORIZED',
    stateReason: null,
    planId: PLAN_ID,
    planHash: HASH,
    batches: [batch()],
    transactions: [],
    attempts: [],
    fills: [],
    reconciliation: { lastCheckedAt: null, blockHeight: null, evidence: [], frozen: false },
    nextAction: 'build',
    updatedAt: '2026-09-25T10:00:02.000Z',
    ...overrides,
  };
}

/** A two-leg basket status: one atomic transaction carrying both legs. */
export function basketStatus(overrides: Partial<ExecutionStatus> = {}): ExecutionStatus {
  return status({
    batches: [batch({ legIndexes: [0, 1] })],
    ...overrides,
  });
}

export const secondLegFill = (): ExecutionFill =>
  fill({
    fillId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
    legIndex: 1,
    outputMint: MINT_B,
    inputSpentRaw: '36000000',
    outputReceivedRaw: '3641000',
    feeLamports: '0',
    lamportsSpent: '2039280',
  });
