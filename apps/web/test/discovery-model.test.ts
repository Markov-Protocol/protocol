import type { Completeness, FollowListResponse } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  allocationText,
  completenessText,
  describeIneligibility,
  followedStrategyIds,
  historyText,
  issuerMixText,
  listingSourceLine,
  proposalDiff,
  summarizePerformance,
  universeText,
} from '../src/features/discovery/discovery-model';
import { version } from './portfolio-fixtures';

/**
 * Expected strings below were written by hand from the contract values,
 * not derived from the code under test: a fraction of 0.035 is +3.50%,
 * a drawdown of 0.0125 is -1.25%, a weight move of 1,000 bps on one leg
 * and 1,000 bps of cash is a one-sided turnover of 1,000 bps.
 */
describe('discovery model', () => {
  it('phrases why an entry is unranked in the methodology’s words', () => {
    expect(describeIneligibility(['insufficient_history'], 30)).toBe(
      'less than 30 days of complete history',
    );
    expect(describeIneligibility(['incomplete_window', 'stale_end'], 30)).toBe(
      'a day in the window has no usable price; the latest price is older than the freshness rule',
    );
    expect(describeIneligibility([], 30)).toBe('not ranked');
  });

  it('summarises a ranked entry with its return and drawdown, never a number for an unranked one', () => {
    expect(
      summarizePerformance(
        {
          rank: 1,
          timeWeightedReturn: '0.03500000',
          maxDrawdown: '0.01250000',
          historyDays: 31,
          reasons: [],
        },
        30,
      ),
    ).toEqual({
      kind: 'ranked',
      rank: 1,
      returnText: '+3.50%',
      drawdownText: '-1.25% max drawdown',
      historyText: '31 days of history',
    });
    expect(
      summarizePerformance(
        {
          rank: 2,
          timeWeightedReturn: '-0.01000000',
          maxDrawdown: '0.00000000',
          historyDays: 45,
          reasons: [],
        },
        30,
      ),
    ).toMatchObject({ kind: 'ranked', returnText: '-1.00%', drawdownText: 'no drawdown' });
    expect(
      summarizePerformance(
        {
          rank: null,
          timeWeightedReturn: null,
          maxDrawdown: null,
          historyDays: 0,
          reasons: ['insufficient_history'],
        },
        30,
      ),
    ).toEqual({
      kind: 'unranked',
      reasonText: 'less than 30 days of complete history',
      historyText: 'no history yet',
    });
    // A rank without a return is not shown as ranked: the return column stays honest.
    expect(
      summarizePerformance(
        { rank: 3, timeWeightedReturn: null, maxDrawdown: null, historyDays: 1, reasons: [] },
        30,
      ),
    ).toEqual({ kind: 'unranked', reasonText: 'not ranked', historyText: '1 day of history' });
  });

  it('labels the issuer mix, the universe and the allocation without inventing a claim', () => {
    expect(issuerMixText(['prestocks', 'xstocks'])).toBe('PreStocks · xStocks');
    expect(issuerMixText([])).toBe('no constituents');
    expect(universeText(['prestocks'])).toBe('Pre-IPO exposure');
    expect(universeText(['xstocks'])).toBe('Listed stocks');
    expect(universeText(['prestocks', 'xstocks'])).toBe('Mixed exposure');
    expect(universeText([])).toBe('No constituents');
    expect(allocationText({ legCount: 2, cashWeightBps: 1000 })).toBe('2 assets · 10.00% cash');
    expect(allocationText({ legCount: 1, cashWeightBps: 0 })).toBe('1 asset · fully invested');
    expect(historyText(1)).toBe('1 day of history');
  });

  it('reports completeness as counts and followed ids only from the private list', () => {
    const completeness: Completeness = {
      expectedPoints: 32,
      completePoints: 31,
      ratio: '0.96875000',
      missing: [],
      historyDays: 31,
      endFresh: true,
    };
    expect(completenessText(completeness)).toBe('31 of 32 points valued');
    expect(completenessText(null)).toBe('no points valued');
    expect(followedStrategyIds(undefined).size).toBe(0);
    const follows: FollowListResponse = {
      follows: [
        {
          strategyId: '44444444-4444-4444-8444-444444444444',
          followedAt: '2026-09-24T12:00:00.000Z',
          latestVersion: null,
        },
      ],
    };
    expect([...followedStrategyIds(follows)]).toEqual(['44444444-4444-4444-8444-444444444444']);
  });

  it('computes the proposal diff with the backend’s one-sided turnover', () => {
    const v1 = version();
    const v2 = version({
      versionId: '55555555-5555-4555-8555-555555555555',
      versionNumber: 2,
      cashWeightBps: 2000,
      legs: v1.legs.map((leg) =>
        leg.symbol === 'FXAERO' ? { ...leg, weightBps: leg.weightBps - 1000 } : leg,
      ),
    });
    const diff = proposalDiff(v1, v2);
    expect(diff.legs.added).toEqual([]);
    expect(diff.legs.removed).toEqual([]);
    expect(diff.legs.changed.map((leg) => [leg.symbol, leg.fromBps, leg.toBps])).toEqual([
      ['FXAERO', 6000, 5000],
    ]);
    expect(diff.cashWeightBps).toEqual({ from: 1000, to: 2000 });
    expect(diff.turnoverBps).toBe(1000);
  });

  it('states the source and the read time of a listing', () => {
    expect(
      listingSourceLine({
        asOf: '2026-09-25T11:00:00.000Z',
        methodologyVersion: 'stocks-v1',
        minHistoryDays: 30,
      }),
    ).toBe(
      'Registered on chain, listed by Markov · model series under stocks-v1, ranked after 30 days of complete history · read Sep 25, 2026, 11:00 AM UTC',
    );
  });
});
