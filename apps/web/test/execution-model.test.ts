import { describe, expect, it } from 'vitest';
import {
  announcementFor,
  cancelRule,
  describeState,
  nextExecutionAction,
  pollingPlan,
  signingIssues,
  stagesOf,
  timelineOf,
  transactionTotal,
  walletChainFor,
} from '../src/features/execution/execution-model';
import {
  ATTEMPT_ID,
  attempt,
  basketStatus,
  batch,
  fill,
  MESSAGE_HASH,
  prepared,
  SIGNATURE,
  secondLegFill,
  status,
} from './execution-fixtures';
import { GENESIS, HASH, HASH_2, intent, OTHER, OWNER, plan, singlePlan } from './review-fixtures';

const network = { cluster: 'devnet', genesisHash: GENESIS };
const now = new Date('2026-09-25T10:00:10.000Z');

const okContext = () => ({
  intent: intent({ latestPlanId: prepared().planId, latestPlanHash: HASH }),
  approvedPlanHash: HASH,
  transaction: prepared(),
  connectedAddress: OWNER,
  connectedChain: 'solana:devnet',
  walletCanSign: true,
  network,
  messageHashOfBytes: MESSAGE_HASH,
  planExpiresAt: '2026-09-25T10:00:30.000Z',
  now,
});

describe('signing preconditions', () => {
  it('passes only when the signer, chain, bytes, intent, plan and expiry all match', () => {
    expect(signingIssues(okContext())).toEqual([]);
  });

  it('refuses another account, no wallet, another chain and another network', () => {
    expect(signingIssues({ ...okContext(), connectedAddress: OTHER }).map((i) => i.code)).toEqual([
      'SIGNER_MISMATCH',
    ]);
    expect(signingIssues({ ...okContext(), connectedAddress: null }).map((i) => i.code)).toEqual([
      'NO_WALLET',
    ]);
    expect(
      signingIssues({ ...okContext(), connectedChain: 'solana:mainnet' }).map((i) => i.code),
    ).toEqual(['WALLET_CHAIN_MISMATCH']);
    expect(
      signingIssues({
        ...okContext(),
        transaction: prepared({
          network: {
            cluster: 'testnet',
            genesisHash: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
          },
        }),
      }).map((i) => i.code),
    ).toEqual(['NETWORK_MISMATCH', 'WALLET_CHAIN_MISMATCH']);
  });

  it('refuses a transaction from another plan, another intent, an expired plan, mutated bytes or a failed simulation', () => {
    expect(
      signingIssues({ ...okContext(), transaction: prepared({ planHash: HASH_2 }) }).map(
        (i) => i.code,
      ),
    ).toEqual(['PLAN_MISMATCH']);
    expect(signingIssues({ ...okContext(), approvedPlanHash: HASH_2 }).map((i) => i.code)).toEqual([
      'PLAN_MISMATCH',
    ]);
    expect(
      signingIssues({
        ...okContext(),
        transaction: prepared({ intentId: '00000000-0000-4000-8000-000000000000' }),
      }).map((i) => i.code),
    ).toEqual(['INTENT_MISMATCH']);
    expect(
      signingIssues({ ...okContext(), now: new Date('2026-09-25T10:00:30.000Z') }).map(
        (i) => i.code,
      ),
    ).toEqual(['PLAN_EXPIRED']);
    expect(
      signingIssues({ ...okContext(), messageHashOfBytes: 'ab'.repeat(32) }).map((i) => i.code),
    ).toEqual(['MESSAGE_HASH_MISMATCH']);
    expect(signingIssues({ ...okContext(), messageHashOfBytes: null }).map((i) => i.code)).toEqual([
      'MESSAGE_HASH_MISMATCH',
    ]);
    expect(
      signingIssues({
        ...okContext(),
        transaction: prepared({
          simulation: { ...prepared().simulation, status: 'failed', err: 'custom program error' },
        }),
      }).map((i) => i.code),
    ).toEqual(['SIMULATION_NOT_OK']);
  });

  it('refuses a transaction that was already submitted or a fee payer that is not the owner', () => {
    expect(
      signingIssues({
        ...okContext(),
        transaction: prepared({ state: 'submitted', attempt: attempt() }),
      }).map((i) => i.code),
    ).toEqual(['ALREADY_SUBMITTED']);
    expect(
      signingIssues({ ...okContext(), transaction: prepared({ feePayer: OTHER }) }).map(
        (i) => i.code,
      ),
    ).toEqual(['FEE_PAYER_MISMATCH']);
    expect(signingIssues({ ...okContext(), transaction: null }).map((i) => i.code)).toEqual([
      'NO_TRANSACTION',
    ]);
    expect(signingIssues({ ...okContext(), walletCanSign: false }).map((i) => i.code)).toEqual([
      'WALLET_CANNOT_SIGN',
    ]);
  });

  it('maps clusters to Wallet Standard chain identifiers', () => {
    expect(walletChainFor('devnet')).toBe('solana:devnet');
    expect(walletChainFor('mainnet-beta')).toBe('solana:mainnet');
  });
});

describe('next action and cancel rule', () => {
  it('names the transaction the action concerns', () => {
    expect(nextExecutionAction(status())).toMatchObject({
      kind: 'build',
      label: 'Build transaction 1 of 1',
    });
    const staged = status({
      nextAction: 'sign',
      batches: [
        batch({ state: 'finalized', signature: SIGNATURE }),
        batch({ batch: 1, legIndexes: [1], state: 'prepared' }),
      ],
    });
    expect(nextExecutionAction(staged)).toMatchObject({
      kind: 'sign',
      batch: 1,
      label: 'Sign transaction 2 of 2',
    });
    expect(nextExecutionAction(status({ nextAction: 'wait', state: 'SUBMITTED' })).kind).toBe(
      'wait',
    );
    expect(
      nextExecutionAction(
        status({ nextAction: 'reconcile', state: 'UNKNOWN_REQUIRES_RECONCILIATION' }),
      ).kind,
    ).toBe('reconcile');
    expect(
      nextExecutionAction(status({ nextAction: 'review', state: 'PARTIALLY_COMPLETED' })).kind,
    ).toBe('review');
    expect(
      nextExecutionAction(status({ nextAction: 'none', state: 'FINALIZED', fills: [fill()] })).kind,
    ).toBe('receipt');
    expect(nextExecutionAction(status({ nextAction: 'none', state: 'CANCELLED' })).kind).toBe(
      'none',
    );
  });

  it('allows cancelling only before a signature and says what it does', () => {
    expect(cancelRule({ state: 'AUTHORIZED' }, status())).toMatchObject({
      allowed: true,
      label: 'Cancel',
    });
    expect(cancelRule({ state: 'AUTHORIZED' }, status({ fills: [fill()] }))).toMatchObject({
      allowed: true,
      label: 'Stop here',
    });
    expect(cancelRule({ state: 'SUBMITTED' }, status({ state: 'SUBMITTED' }))).toMatchObject({
      allowed: true,
      label: 'Request cancellation',
    });
    expect(cancelRule({ state: 'UNKNOWN_REQUIRES_RECONCILIATION' }, null).allowed).toBe(true);
    expect(cancelRule({ state: 'CONFIRMED' }, null).allowed).toBe(false);
    expect(cancelRule({ state: 'CANCEL_REQUESTED' }, null).allowed).toBe(false);
    expect(cancelRule({ state: 'FINALIZED' }, null).allowed).toBe(false);
    expect(cancelRule({ state: 'AWAITING_APPROVAL' }, null).allowed).toBe(true);
  });
});

describe('polling', () => {
  it('watches live states, slows down over time and in hidden tabs, and stops when the person or the chain is done', () => {
    expect(pollingPlan({ status: null, hidden: false, watchedForMs: 0 }).intervalMs).toBeNull();
    expect(
      pollingPlan({
        status: status({ state: 'SUBMITTED', nextAction: 'wait' }),
        hidden: false,
        watchedForMs: 0,
      }).intervalMs,
    ).toBe(2000);
    expect(
      pollingPlan({
        status: status({ state: 'SUBMITTED', nextAction: 'wait' }),
        hidden: false,
        watchedForMs: 31000,
      }).intervalMs,
    ).toBe(5000);
    expect(
      pollingPlan({
        status: status({ state: 'SUBMITTED', nextAction: 'wait' }),
        hidden: true,
        watchedForMs: 0,
      }).intervalMs,
    ).toBe(15000);
    expect(
      pollingPlan({
        status: status({ state: 'AUTHORIZED', nextAction: 'sign' }),
        hidden: false,
        watchedForMs: 0,
      }).intervalMs,
    ).toBeNull();
    expect(
      pollingPlan({
        status: status({ state: 'FINALIZED', nextAction: 'none' }),
        hidden: false,
        watchedForMs: 0,
      }).intervalMs,
    ).toBeNull();
    expect(
      pollingPlan({
        status: status({ state: 'UNKNOWN_REQUIRES_RECONCILIATION', nextAction: 'reconcile' }),
        hidden: false,
        watchedForMs: 0,
      }).intervalMs,
    ).toBe(2000);
  });
});

describe('timeline', () => {
  it('renders one row per batch with leg labels, stages, fills and the fee actually paid', () => {
    const settled = basketStatus({
      state: 'FINALIZED',
      nextAction: 'none',
      batches: [
        batch({
          legIndexes: [0, 1],
          state: 'finalized',
          attemptId: ATTEMPT_ID,
          signature: SIGNATURE,
        }),
      ],
      attempts: [attempt({ state: 'finalized', confirmationStatus: 'finalized', slot: 4300 })],
      fills: [fill(), secondLegFill()],
    });
    const rows = timelineOf(settled, plan());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Transaction',
      legs: [
        { legIndex: 0, label: 'Buy FXAERO' },
        { legIndex: 1, label: 'Buy XSFXA' },
      ],
      state: 'finalized',
      signature: SIGNATURE,
      feeLamports: '5000',
    });
    expect(rows[0]?.stages.map((stage) => [stage.key, stage.state])).toEqual([
      ['built', 'done'],
      ['signed', 'done'],
      ['broadcast', 'done'],
      ['confirmed', 'done'],
      ['finalized', 'done'],
      ['recorded', 'done'],
    ]);
    expect(rows[0]?.stages[4]?.detail).toContain('slot 4300');
    expect(rows[0]?.stages[5]?.detail).toContain('2 fills');
  });

  it('shows a staged basket leg by leg: one finalized, one stale, the run partially completed', () => {
    const partial = status({
      state: 'PARTIALLY_COMPLETED',
      stateReason: 'LEG_TERMS_CHANGED',
      nextAction: 'review',
      batches: [
        batch({ state: 'finalized', attemptId: ATTEMPT_ID, signature: SIGNATURE }),
        batch({
          batch: 1,
          legIndexes: [1],
          state: 'stale',
          reason: 'fresh quote below the approved minimum output',
        }),
      ],
      attempts: [attempt({ state: 'finalized', confirmationStatus: 'finalized', slot: 4300 })],
      fills: [fill()],
    });
    const rows = timelineOf(partial, plan());
    expect(rows.map((row) => row.title)).toEqual(['Transaction 1 of 2', 'Transaction 2 of 2']);
    expect(rows[1]?.stages[0]).toMatchObject({
      key: 'built',
      label: 'Not built',
      state: 'skipped',
    });
    expect(rows[1]?.stages[0]?.detail).toContain('fresh quote');
    expect(rows[1]?.feeLamports).toBeNull();
    expect(describeState(partial)).toContain('1 leg filled');
  });

  it('marks unknown, failed and expired attempts honestly and never as done', () => {
    const unknown = stagesOf(
      batch({ state: 'unknown', attemptId: ATTEMPT_ID }),
      attempt({ state: 'unknown' }),
      [],
    );
    expect(unknown.find((stage) => stage.key === 'broadcast')).toMatchObject({ state: 'unknown' });
    expect(unknown.find((stage) => stage.key === 'broadcast')?.detail).toContain(
      'never by sending a new transaction',
    );
    const failed = stagesOf(
      batch({ state: 'failed', attemptId: ATTEMPT_ID }),
      attempt({ state: 'failed', chainError: 'custom program error: 0x1' }),
      [],
    );
    expect(failed.find((stage) => stage.key === 'confirmed')).toMatchObject({
      state: 'failed',
      detail: 'custom program error: 0x1',
    });
    expect(failed.every((stage) => stage.state !== 'active')).toBe(true);
    const expired = stagesOf(batch({ state: 'expired' }), null, []);
    expect(expired.find((stage) => stage.key === 'signed')?.state).toBe('skipped');
    expect(expired.find((stage) => stage.key === 'confirmed')?.state).toBe('failed');
  });

  it('counts the plan transactions before any status exists', () => {
    expect(transactionTotal(plan())).toBe(2);
    expect(transactionTotal(singlePlan())).toBe(1);
    expect(transactionTotal(null)).toBe(1);
  });
});

describe('announcements', () => {
  it('announces state changes and batch changes, never every poll', () => {
    const before = status({
      state: 'SUBMITTED',
      nextAction: 'wait',
      batches: [batch({ state: 'submitted' })],
    });
    expect(announcementFor(null, before)).toBeNull();
    expect(announcementFor(before, before)).toBeNull();
    expect(
      announcementFor(
        before,
        status({
          state: 'SUBMITTED',
          nextAction: 'wait',
          batches: [batch({ state: 'confirmed' })],
        }),
      ),
    ).toBe('Transaction 1 of 1 is confirmed.');
    expect(
      announcementFor(
        before,
        status({
          state: 'FINALIZED',
          nextAction: 'none',
          fills: [fill()],
          batches: [batch({ state: 'finalized' })],
        }),
      ),
    ).toContain('Finalized.');
  });
});
