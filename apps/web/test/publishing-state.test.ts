import type { Maintenance, Publication, PublicVersion, StrategyVersion } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeFailure,
  describeMaintenance,
  diffIsEmpty,
  diffVersions,
  formatLamports,
  readRegistration,
  readStatusChange,
  recipeLegsOf,
} from '../src/features/publishing/publication-state';
import { publicationPollInterval } from '../src/features/publishing/queries';
import {
  base64ToBytes,
  bytesToBase64,
  checkSignedTransaction,
  parseWireTransaction,
  readCompactU16,
} from '../src/features/wallets/transaction-bytes';

const HOLD: Maintenance = { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null };

function publication(overrides: Partial<Publication>): Publication {
  return {
    publicationId: '99999999-9999-4999-8999-999999999999',
    strategyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    operation: 'register',
    state: 'awaiting_signature',
    programId: '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ',
    network: { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
    recordAddress: '4uFNLZ8GKBUywsX48vYhMeGjgpjdQC2iN6pQxo1JTG3X',
    publisher: {
      walletId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      address: 'EY3y13V2TYRa4FWBqpyD7D1ZbLZhGzEamNnDcY4fAFb5',
    },
    manifestHash: 'd'.repeat(64),
    contentDigest: '9'.repeat(64),
    transaction: null,
    signature: null,
    submittedAt: null,
    confirmationStatus: null,
    evidence: null,
    failure: null,
    preview: {} as Publication['preview'],
    lastCheckedAt: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('readRegistration', () => {
  it('maps every chain-derived state to one of the five displays and never registers from a database flag', () => {
    expect(readRegistration('unpublished', null)).toMatchObject({
      phase: 'saved',
      label: 'Saved privately',
    });
    expect(readRegistration('awaiting_signature', null).phase).toBe('publishing');
    expect(readRegistration('submitted', publication({ state: 'submitted' }))).toMatchObject({
      phase: 'publishing',
      label: 'Publishing',
    });
    expect(readRegistration('registered', null)).toMatchObject({
      phase: 'registered',
      label: 'Registered on-chain',
      tone: 'success',
    });
    expect(readRegistration('expired', publication({ state: 'expired' })).label).toBe('Expired');
    expect(readRegistration('unknown', publication({ state: 'unknown' })).label).toBe(
      'Status unknown',
    );
  });

  it('explains a failure from the program error the API reported', () => {
    const failed = publication({
      state: 'failed',
      failure: {
        code: 'program_error',
        programErrorCode: 6009,
        programError: 'WeightTotal',
        message: 'legs plus cash must equal 10000',
      },
    });
    const reading = readRegistration('failed', failed);
    expect(reading).toMatchObject({ phase: 'failed', label: 'Failed', tone: 'error' });
    expect(reading.detail).toBe(
      'The registry program refused the transaction (WeightTotal, code 6009): legs plus cash must equal 10000',
    );
    expect(
      describeFailure({
        code: 'rejected_by_node',
        programErrorCode: null,
        programError: null,
        message: 'blockhash not found',
      }),
    ).toBe('The node refused the transaction before it ran: blockhash not found');
  });

  it('keeps a registered version registered when the latest attempt is a status change', () => {
    const deprecation = publication({ operation: 'deprecate', state: 'failed' });
    expect(readRegistration('registered', deprecation).phase).toBe('registered');
    expect(readStatusChange(deprecation)).toMatchObject({
      label: 'Deprecation failed',
      tone: 'error',
    });
    expect(
      readStatusChange(publication({ operation: 'reactivate', state: 'awaiting_signature' })),
    ).toMatchObject({ label: 'Reactivation prepared', tone: 'pending' });
    expect(
      readStatusChange(
        publication({
          operation: 'deprecate',
          state: 'registered',
          evidence: {
            signature: '3'.repeat(64),
            slot: 5000,
            blockTime: null,
            recordAddress: '4uFNLZ8GKBUywsX48vYhMeGjgpjdQC2iN6pQxo1JTG3X',
            publisher: 'EY3y13V2TYRa4FWBqpyD7D1ZbLZhGzEamNnDcY4fAFb5',
            status: 'deprecated',
            transactionUrl: null,
            recordUrl: null,
          },
        }),
      ).detail,
    ).toContain('now reads deprecated');
  });

  it('polls only while the network has not decided', () => {
    expect(publicationPollInterval(null)).toBe(false);
    expect(publicationPollInterval(publication({ state: 'awaiting_signature' }))).toBe(false);
    expect(publicationPollInterval(publication({ state: 'submitted' }))).toBe(3000);
    expect(publicationPollInterval(publication({ state: 'unknown' }))).toBe(10_000);
    expect(publicationPollInterval(publication({ state: 'registered' }))).toBe(false);
  });
});

describe('formatLamports and maintenance', () => {
  it('shows SOL from lamports without floats', () => {
    expect(formatLamports(6_691_600)).toBe('0.0066916 SOL (6,691,600 lamports)');
    expect(formatLamports(5_000)).toBe('0.000005 SOL (5,000 lamports)');
    expect(formatLamports(0)).toBe('0 SOL (0 lamports)');
  });

  it('describes maintenance suggestions with their parameters', () => {
    expect(describeMaintenance(HOLD)).toBe('Hold');
    expect(
      describeMaintenance({
        suggestion: 'rebalance_on_drift',
        driftThresholdBps: 500,
        reviewEveryDays: null,
      }),
    ).toBe('Rebalance on drift beyond 500 bps');
    expect(
      describeMaintenance({
        suggestion: 'review_periodically',
        driftThresholdBps: null,
        reviewEveryDays: 1,
      }),
    ).toBe('Review periodically every 1 day');
  });
});

describe('diffVersions', () => {
  const base = {
    versionId: 'v1',
    title: 'Aerospace tilt',
    thesis: 'Launch cadence.',
    legs: [
      { instrumentId: 'a', symbol: 'FXAERO', weightBps: 6000 },
      { instrumentId: 'b', symbol: 'FXBIO', weightBps: 3000 },
    ],
    cashWeightBps: 1000,
    maintenance: HOLD,
    references: ['https://a.example'],
  };

  it('reports added, removed and changed legs, cash, text changes and one-sided turnover', () => {
    const diff = diffVersions(base, {
      ...base,
      versionId: 'v2',
      title: 'Aerospace tilt v2',
      legs: [
        { instrumentId: 'a', symbol: 'FXAERO', weightBps: 5000 },
        { instrumentId: 'c', symbol: 'AEROX', weightBps: 3000 },
      ],
      cashWeightBps: 2000,
      references: [],
    });
    expect(diff.legs.added).toEqual([{ instrumentId: 'c', symbol: 'AEROX', weightBps: 3000 }]);
    expect(diff.legs.removed).toEqual([{ instrumentId: 'b', symbol: 'FXBIO', weightBps: 3000 }]);
    expect(diff.legs.changed).toEqual([
      { instrumentId: 'a', symbol: 'FXAERO', fromBps: 6000, toBps: 5000 },
    ]);
    expect(diff.cashWeightBps).toEqual({ from: 1000, to: 2000 });
    expect(diff).toMatchObject({
      titleChanged: true,
      thesisChanged: false,
      maintenanceChanged: false,
      referencesChanged: true,
      // 3000 added + 3000 removed + 1000 moved + 1000 cash = 8000, one-sided 4000
      turnoverBps: 4000,
    });
    expect(diffIsEmpty(diff)).toBe(false);
  });

  it('is empty for an identical recipe whatever the reference order', () => {
    const diff = diffVersions(base, {
      ...base,
      versionId: 'v2',
      references: [...base.references].reverse(),
    });
    expect(diffIsEmpty(diff)).toBe(true);
    expect(diff.turnoverBps).toBe(0);
  });
});

describe('recipeLegsOf', () => {
  it('reads mints from the admission snapshot of an owner version and directly from a public one', () => {
    const own = {
      legs: [
        {
          instrumentId: 'a',
          weightBps: 6000,
          note: null,
          issuer: 'prestocks',
          symbol: 'FXAERO',
          companyName: 'Fixture Aerospace Inc',
          admission: {
            status: 'admitted',
            admittedAt: null,
            verificationId: null,
            verifiedAt: null,
            mint: '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv',
            tokenProgram: 'spl-token',
            decimals: 6,
            genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
          },
        },
      ],
    } as unknown as StrategyVersion;
    const pub = {
      legs: [
        {
          instrumentId: 'a',
          symbol: 'FXAERO',
          companyName: 'Fixture Aerospace Inc',
          issuer: 'prestocks',
          mint: '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv',
          tokenProgram: 'spl-token',
          weightBps: 6000,
        },
      ],
    } as unknown as PublicVersion;
    expect(recipeLegsOf(own)).toEqual(recipeLegsOf(pub));
    expect(recipeLegsOf(own)[0]).toMatchObject({
      mint: '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv',
      tokenProgram: 'spl-token',
    });
  });
});

describe('transaction bytes', () => {
  const message = Uint8Array.from({ length: 120 }, (_, index) => (index * 7) % 251);
  const unsigned = new Uint8Array(1 + 64 + message.length);
  unsigned[0] = 1;
  unsigned.set(message, 65);

  it('round-trips base64 and decodes compact-u16 prefixes', () => {
    expect(base64ToBytes(bytesToBase64(unsigned))).toEqual(unsigned);
    expect(readCompactU16(new Uint8Array([1]))).toEqual({ value: 1, size: 1 });
    expect(readCompactU16(new Uint8Array([0x80, 0x01]))).toEqual({ value: 128, size: 2 });
    expect(readCompactU16(new Uint8Array([0x80]))).toBeNull();
    expect(parseWireTransaction(unsigned)?.message).toEqual(message);
    expect(parseWireTransaction(new Uint8Array([0]))).toBeNull();
    expect(parseWireTransaction(new Uint8Array(65))).toBeNull();
  });

  it('accepts the prepared message with the fee-payer signature filled and refuses anything else', () => {
    const signed = new Uint8Array(unsigned);
    signed.fill(7, 1, 65);
    expect(checkSignedTransaction(unsigned, signed)).toEqual({ ok: true });
    expect(checkSignedTransaction(unsigned, unsigned)).toMatchObject({
      ok: false,
      reason: 'the fee-payer signature is missing',
    });
    const altered = new Uint8Array(signed);
    altered[altered.length - 1] = (altered[altered.length - 1] as number) ^ 1;
    expect(checkSignedTransaction(unsigned, altered)).toMatchObject({
      ok: false,
      reason: 'the wallet changed the message before signing it',
    });
    const extra = new Uint8Array(2 + 128 + message.length);
    extra[0] = 2;
    extra.set(message, 2 + 128);
    expect(checkSignedTransaction(unsigned, extra)).toMatchObject({
      ok: false,
      reason: 'the wallet changed the number of signatures',
    });
    expect(checkSignedTransaction(unsigned, new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
      reason: 'the wallet returned bytes that are not a transaction',
    });
  });
});
