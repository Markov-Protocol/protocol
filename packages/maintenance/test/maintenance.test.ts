import type { Cadence, InstanceAllocation, Mandate, MandateAction } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  decideDrift,
  dueOccurrences,
  evaluateMandate,
  firstOccurrenceAtOrAfter,
  isKnownTimeZone,
  localTimeOf,
  nextDueAfter,
  occurrenceDedupKey,
  occurrencesFrom,
  previewOccurrences,
  sizeRebalanceLegs,
  utcOffsetMinutes,
  zonedTimeToUtc,
} from '../src/index.js';

const daily = (timeOfDay: string, timeZone: string, interval = 1): Cadence => ({
  unit: 'day',
  interval,
  timeOfDay,
  weekday: null,
  dayOfMonth: null,
  timeZone,
});

function take(cadence: Cadence, startAt: Date, count: number): string[] {
  const out: string[] = [];
  for (const dueAt of occurrencesFrom(cadence, startAt)) {
    out.push(dueAt.toISOString());
    if (out.length >= count) {
      break;
    }
  }
  return out;
}

describe('cadence in a time zone', () => {
  it('knows real zones and refuses made-up ones', () => {
    expect(isKnownTimeZone('America/New_York')).toBe(true);
    expect(isKnownTimeZone('Europe/Berlin')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
  });

  it('keeps the wall-clock time across the spring change (America/New_York, 2026-03-08)', () => {
    expect(take(daily('09:00', 'America/New_York'), new Date('2026-03-06T00:00:00Z'), 4)).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
    expect(utcOffsetMinutes(new Date('2026-03-07T14:00:00Z'), 'America/New_York')).toBe(-300);
    expect(utcOffsetMinutes(new Date('2026-03-08T13:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('moves a wall-clock time inside the spring gap forward by the gap', () => {
    // 02:30 does not exist on 2026-03-08 in New York: clocks jump from 02:00 EST to 03:00 EDT.
    expect(take(daily('02:30', 'America/New_York'), new Date('2026-03-07T00:00:00Z'), 3)).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:30:00.000Z', // 03:30 EDT
      '2026-03-09T06:30:00.000Z', // 02:30 EDT
    ]);
    expect(
      localTimeOf(
        zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York'),
        'America/New_York',
      ),
    ).toMatchObject({ hour: 3, minute: 30 });
  });

  it('fires once, at the first instant, on an ambiguous autumn wall clock', () => {
    // 01:30 happens twice on 2026-11-01 in New York (EDT, then EST).
    expect(take(daily('01:30', 'America/New_York'), new Date('2026-10-31T00:00:00Z'), 3)).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z', // 01:30 EDT, the first instance
      '2026-11-02T06:30:00.000Z', // 01:30 EST
    ]);
    // Southern hemisphere: 02:30 on 2026-04-05 in Sydney happens first at +11 (AEDT).
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 4, day: 5, hour: 2, minute: 30 },
        'Australia/Sydney',
      ).toISOString(),
    ).toBe('2026-04-04T15:30:00.000Z');
    // And the Sydney spring gap (02:30 on 2026-10-04) moves forward to 03:30 AEDT.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 4, hour: 2, minute: 30 },
        'Australia/Sydney',
      ).toISOString(),
    ).toBe('2026-10-03T16:30:00.000Z');
  });

  it('clamps a monthly day the month lacks and follows the zone offset', () => {
    const monthly: Cadence = {
      unit: 'month',
      interval: 1,
      timeOfDay: '09:00',
      weekday: null,
      dayOfMonth: 31,
      timeZone: 'Europe/Berlin',
    };
    expect(take(monthly, new Date('2026-01-01T00:00:00Z'), 4)).toEqual([
      '2026-01-31T08:00:00.000Z',
      '2026-02-28T08:00:00.000Z',
      '2026-03-31T07:00:00.000Z', // CEST from 2026-03-29
      '2026-04-30T07:00:00.000Z',
    ]);
  });

  it('places weekly occurrences on the wanted weekday and respects the interval', () => {
    const weekly: Cadence = {
      unit: 'week',
      interval: 1,
      timeOfDay: '09:00',
      weekday: 1,
      dayOfMonth: null,
      timeZone: 'UTC',
    };
    // 2026-01-07 is a Wednesday; the first Monday after it is 2026-01-12.
    expect(take(weekly, new Date('2026-01-07T00:00:00Z'), 2)).toEqual([
      '2026-01-12T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
    ]);
    expect(take({ ...weekly, interval: 2 }, new Date('2026-01-07T00:00:00Z'), 2)).toEqual([
      '2026-01-12T09:00:00.000Z',
      '2026-01-26T09:00:00.000Z',
    ]);
    // Starting on a Monday after 09:00: that Monday is over, the next one counts.
    expect(take(weekly, new Date('2026-01-05T10:00:00Z'), 1)).toEqual(['2026-01-12T09:00:00.000Z']);
  });

  it('counts every second day from the start and previews with sequences', () => {
    const cadence = daily('09:00', 'UTC', 2);
    const startAt = new Date('2026-01-01T00:00:00Z');
    expect(take(cadence, startAt, 3)).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-01-03T09:00:00.000Z',
      '2026-01-05T09:00:00.000Z',
    ]);
    expect(
      firstOccurrenceAtOrAfter(cadence, startAt, new Date('2026-01-04T00:00:00Z'))?.toISOString(),
    ).toBe('2026-01-05T09:00:00.000Z');
    const preview = previewOccurrences(cadence, startAt, new Date('2026-01-04T00:00:00Z'), 2);
    expect(
      preview.map((entry) => [entry.sequence, entry.dueAt.toISOString(), entry.localTime]),
    ).toEqual([
      [3, '2026-01-05T09:00:00.000Z', '2026-01-05 09:00'],
      [4, '2026-01-07T09:00:00.000Z', '2026-01-07 09:00'],
    ]);
    expect(
      previewOccurrences(cadence, startAt, startAt, 5, new Date('2026-01-04T00:00:00Z')),
    ).toHaveLength(2);
  });
});

describe('due occurrences under the missed-run policy', () => {
  const cadence = daily('09:00', 'UTC');
  const startAt = new Date('2026-01-01T09:00:00Z');
  const now = new Date('2026-01-05T10:00:00Z');

  it('skips every missed occurrence by default and proposes the live one', () => {
    const due = dueOccurrences({
      cadence,
      startAt,
      endAt: null,
      lastSequence: 0,
      reviewWindowHours: 24,
      missedRunPolicy: 'skip',
      now,
    });
    expect(due.map((entry) => [entry.sequence, entry.decision, entry.reason])).toEqual([
      [1, 'skip', 'missed_window'],
      [2, 'skip', 'missed_window'],
      [3, 'skip', 'missed_window'],
      [4, 'skip', 'missed_window'],
      [5, 'propose', null],
    ]);
    expect(due[4]?.windowEndsAt.toISOString()).toBe('2026-01-06T09:00:00.000Z');
  });

  it('catches up only the most recent missed occurrence when asked', () => {
    const due = dueOccurrences({
      cadence,
      startAt,
      endAt: null,
      lastSequence: 0,
      reviewWindowHours: 24,
      missedRunPolicy: 'catch_up_latest',
      now,
    });
    expect(due.map((entry) => [entry.sequence, entry.decision, entry.reason])).toEqual([
      [1, 'skip', 'superseded_by_catch_up'],
      [2, 'skip', 'superseded_by_catch_up'],
      [3, 'skip', 'superseded_by_catch_up'],
      [4, 'propose', null],
      [5, 'propose', null],
    ]);
  });

  it('starts after the last decided sequence, stops at the end and bounds a pass', () => {
    expect(
      dueOccurrences({
        cadence,
        startAt,
        endAt: null,
        lastSequence: 4,
        reviewWindowHours: 24,
        missedRunPolicy: 'skip',
        now,
      }).map((entry) => entry.sequence),
    ).toEqual([5]);
    expect(
      dueOccurrences({
        cadence,
        startAt,
        endAt: new Date('2026-01-03T00:00:00Z'),
        lastSequence: 0,
        reviewWindowHours: 24,
        missedRunPolicy: 'skip',
        now,
      }).map((entry) => entry.sequence),
    ).toEqual([1, 2]);
    expect(
      dueOccurrences({
        cadence,
        startAt,
        endAt: null,
        lastSequence: 0,
        reviewWindowHours: 24,
        missedRunPolicy: 'skip',
        now,
        limit: 2,
      }).map((entry) => entry.sequence),
    ).toEqual([1, 2]);
    expect(nextDueAfter(cadence, startAt, null, 5)?.toISOString()).toBe('2026-01-06T09:00:00.000Z');
    expect(nextDueAfter(cadence, startAt, new Date('2026-01-05T12:00:00Z'), 5)).toBeNull();
    expect(occurrenceDedupKey('s1', 7)).toBe('schedule:s1:7');
  });
});

const row = (
  partial: Partial<InstanceAllocation['rows'][number]> & { symbol: string },
): InstanceAllocation['rows'][number] => ({
  instrumentId: '00000000-0000-4000-8000-00000000000a',
  asset: { kind: 'instrument', instrumentId: '00000000-0000-4000-8000-00000000000a' } as never,
  decimals: 6,
  weightBps: 6000,
  investedTargetBps: 6000,
  attributedRaw: '7000000',
  scaledQuantity: '7',
  price: null,
  value: '700',
  actualBps: 7000,
  driftBps: 1000,
  issues: [],
  caveats: [],
  ...partial,
});

const allocation = (rows: InstanceAllocation['rows'], complete = true): InstanceAllocation => ({
  instanceId: '00000000-0000-4000-8000-000000000001',
  walletId: '00000000-0000-4000-8000-000000000002',
  strategyId: '00000000-0000-4000-8000-000000000003',
  versionId: '00000000-0000-4000-8000-000000000004',
  versionNumber: 1,
  cashWeightBps: 0,
  rows,
  currency: 'USD',
  totalValue: complete ? '1000' : null,
  complete,
  stale: false,
  largestDriftBps: complete ? 1000 : null,
  driftThresholdBps: 500,
  exceedsThreshold: complete,
  asOf: '2026-01-05T10:00:00.000Z',
  note: 'test',
});

describe('drift decisions and rebalance sizing', () => {
  const now = new Date('2026-01-05T10:00:00Z');
  const rows = [
    row({ symbol: 'A' }),
    row({
      symbol: 'B',
      instrumentId: '00000000-0000-4000-8000-00000000000b',
      investedTargetBps: 4000,
      weightBps: 4000,
      attributedRaw: '3000000',
      value: '300',
      actualBps: 3000,
      driftBps: -1000,
    }),
  ];

  it('proposes only above the threshold, outside the interval and without an open proposal', () => {
    const base = {
      allocation: allocation(rows),
      thresholdBps: null,
      lastProposalAt: null,
      minIntervalHours: 168,
      openProposalExists: false,
      now,
    };
    expect(decideDrift(base)).toMatchObject({ propose: true, reason: null, thresholdBps: 500 });
    expect(decideDrift({ ...base, thresholdBps: 1500 })).toMatchObject({
      propose: false,
      reason: 'no_drift',
    });
    expect(decideDrift({ ...base, openProposalExists: true }).reason).toBe('open_proposal_exists');
    expect(decideDrift({ ...base, lastProposalAt: new Date('2026-01-04T10:00:00Z') }).reason).toBe(
      'within_min_interval',
    );
    expect(decideDrift({ ...base, lastProposalAt: new Date('2025-12-01T10:00:00Z') }).propose).toBe(
      true,
    );
    expect(decideDrift({ ...base, allocation: allocation(rows, false) }).reason).toBe(
      'target_unavailable',
    );
    expect(
      decideDrift({ ...base, allocation: { ...allocation(rows), driftThresholdBps: null } }).reason,
    ).toBe('threshold_unset');
  });

  it('sizes sells from the excess share of the holding and buys from the shortfall, sells first', () => {
    const legs = sizeRebalanceLegs(allocation(rows), { stablecoinDecimals: 6 });
    expect(legs).toEqual([
      {
        instrumentId: '00000000-0000-4000-8000-00000000000a',
        symbol: 'A',
        side: 'sell',
        driftBps: 1000,
        rawAmount: '1000000', // 7,000,000 raw × 100 / 700
        value: '100',
      },
      {
        instrumentId: '00000000-0000-4000-8000-00000000000b',
        symbol: 'B',
        side: 'buy',
        driftBps: -1000,
        rawAmount: '100000000', // 100 USD in 6-decimal raw units
        value: '100',
      },
    ]);
  });

  it('leaves dust and unnamed rows alone and sizes nothing for an incomplete allocation', () => {
    const nearlyOnTarget = [
      row({ symbol: 'A', value: '601', actualBps: 6010, driftBps: 10 }),
      row({
        symbol: 'B',
        instrumentId: '00000000-0000-4000-8000-00000000000b',
        investedTargetBps: 4000,
        value: '399',
        actualBps: 3990,
        driftBps: -10,
      }),
      row({ symbol: 'X', instrumentId: null, investedTargetBps: 0, weightBps: 0, value: '5' }),
    ];
    expect(sizeRebalanceLegs(allocation(nearlyOnTarget), { stablecoinDecimals: 6 })).toEqual([]);
    expect(sizeRebalanceLegs(allocation(rows, false), { stablecoinDecimals: 6 })).toEqual([]);
  });
});

describe('mandate dry run', () => {
  const owner = '00000000-0000-4000-8000-000000000011';
  const wallet = '00000000-0000-4000-8000-000000000012';
  const version = '00000000-0000-4000-8000-000000000013';
  const aero = '00000000-0000-4000-8000-00000000001a';
  const bio = '00000000-0000-4000-8000-00000000001b';
  const chain = { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
  const mandate: Mandate = {
    schemaVersion: '1',
    mandateId: '00000000-0000-4000-8000-000000000010',
    ownerUserId: owner,
    walletId: wallet,
    strategyVersionId: version,
    chain,
    allowedInstrumentIds: [aero, bio],
    allowedVenues: ['jupiter'],
    actions: ['buy', 'sell', 'rebalance'],
    destinations: { inputWalletId: wallet, outputWalletId: wallet },
    perOrderBudgetRaw: '100000000',
    periodBudget: { windowDays: 30, rawAmount: '300000000' },
    cumulativeTurnoverRaw: '1000000000',
    maxFeeBps: 50,
    maintenance: { allowBuys: true, allowSells: true, reduceOnly: false, maxSlippageBps: 100 },
    expiresAt: '2026-12-31T00:00:00.000Z',
    nonce: 3,
    revokedAt: null,
  };
  const action: MandateAction = {
    kind: 'buy',
    ownerUserId: owner,
    walletId: wallet,
    strategyVersionId: version,
    chain,
    venue: 'jupiter',
    instrumentIds: [aero],
    sides: ['buy'],
    notionalRaw: '50000000',
    feeBps: 25,
    slippageBps: 50,
    destinations: { inputWalletId: wallet, outputWalletId: wallet },
    nonce: 3,
    at: '2026-06-01T00:00:00.000Z',
  };
  const usage = { periodSpentRaw: '0', cumulativeTurnoverRaw: '0' };
  const failing = (m: Mandate, a: MandateAction, u = usage) =>
    evaluateMandate(m, a, u)
      .checks.filter((check) => !check.ok)
      .map((check) => check.code);

  it('allows an action inside every bound and reports every check', () => {
    const result = evaluateMandate(mandate, action, usage);
    expect(result.outcome).toBe('allow');
    expect(result.checks).toHaveLength(17);
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('refuses the attack fixtures one bound at a time', () => {
    expect(
      failing(mandate, { ...action, strategyVersionId: '00000000-0000-4000-8000-000000000099' }),
    ).toEqual(['VERSION_BOUND']);
    expect(
      failing({ ...mandate, maintenance: { ...mandate.maintenance, reduceOnly: true } }, action),
    ).toEqual(['SIDES_PERMITTED']);
    expect(
      failing(
        { ...mandate, maintenance: { ...mandate.maintenance, reduceOnly: true } },
        { ...action, kind: 'rebalance', sides: ['sell', 'buy'], instrumentIds: [aero, bio] },
      ),
    ).toEqual(['SIDES_PERMITTED']);
    expect(
      failing(mandate, {
        ...action,
        destinations: {
          inputWalletId: wallet,
          outputWalletId: '00000000-0000-4000-8000-000000000077',
        },
      }),
    ).toEqual(['DESTINATIONS_OWN_WALLET']);
    expect(failing(mandate, { ...action, at: '2027-01-01T00:00:00.000Z' })).toEqual([
      'NOT_EXPIRED',
    ]);
    expect(failing({ ...mandate, revokedAt: '2026-05-01T00:00:00.000Z' }, action)).toEqual([
      'NOT_REVOKED',
    ]);
    expect(failing(mandate, { ...action, nonce: 2 })).toEqual(['NONCE_CURRENT']);
    expect(
      failing(mandate, { ...action, ownerUserId: '00000000-0000-4000-8000-000000000066' }),
    ).toEqual(['OWNER_MATCHES']);
    expect(failing(mandate, { ...action, chain: { ...chain, cluster: 'mainnet-beta' } })).toEqual([
      'CHAIN_MATCHES',
    ]);
    expect(
      failing(mandate, {
        ...action,
        instrumentIds: [aero, '00000000-0000-4000-8000-00000000001c'],
      }),
    ).toEqual(['INSTRUMENTS_ALLOWED']);
    expect(
      failing({ ...mandate, allowedVenues: ['jupiter'] }, { ...action, venue: 'meteora' as never }),
    ).toEqual(['VENUE_ALLOWED']);
    expect(failing({ ...mandate, actions: ['sell'] }, action)).toEqual(['ACTION_PERMITTED']);
    expect(failing(mandate, { ...action, notionalRaw: '100000001' })).toEqual(['PER_ORDER_BUDGET']);
    expect(
      failing(mandate, action, { periodSpentRaw: '260000000', cumulativeTurnoverRaw: '0' }),
    ).toEqual(['PERIOD_BUDGET']);
    expect(
      failing(mandate, action, { periodSpentRaw: '0', cumulativeTurnoverRaw: '960000000' }),
    ).toEqual(['CUMULATIVE_TURNOVER']);
    expect(failing(mandate, { ...action, feeBps: 51 })).toEqual(['FEE_BOUND']);
    expect(failing(mandate, { ...action, slippageBps: 101 })).toEqual(['SLIPPAGE_BOUND']);
    expect(
      failing({ ...mandate, maintenance: { ...mandate.maintenance, allowBuys: false } }, action),
    ).toEqual(['SIDES_PERMITTED']);
  });
});
