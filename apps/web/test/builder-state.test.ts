import type { StrategyDraftContent } from '@markov/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addLeg,
  diffContent,
  equalWeights,
  fillCashRemainder,
  localIssues,
  moveLeg,
  parseStage,
  removeLeg,
  setLegWeight,
  splitBudget,
  totalsOf,
} from '../src/features/builder/draft-state';
import {
  clearLocalBasketCopy,
  localBasketKey,
  purgeLocalBasketCopies,
  readLocalBasketCopy,
  writeLocalBasketCopy,
} from '../src/features/builder/local-copy';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function content(overrides: Partial<StrategyDraftContent> = {}): StrategyDraftContent {
  return {
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: A, weightBps: 6000, note: null },
      { instrumentId: B, weightBps: 3000, note: null },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
    ...overrides,
  };
}

describe('basket arithmetic', () => {
  it('sums exact basis points and reports 9,999, 10,000 and 10,001 without rounding', () => {
    expect(totalsOf(content())).toEqual({
      legsBps: 9000,
      cashBps: 1000,
      totalBps: 10_000,
      remainingBps: 0,
    });
    expect(totalsOf(content({ cashWeightBps: 999 })).remainingBps).toBe(1);
    expect(totalsOf(content({ cashWeightBps: 1001 })).remainingBps).toBe(-1);
    expect(localIssues(content(), { maxLegs: 10 })).toEqual([]);
    expect(
      localIssues(content({ cashWeightBps: 999 }), null).map((issue) => [
        issue.code,
        issue.observed,
      ]),
    ).toEqual([['WEIGHTS_TOTAL', 9999]]);
    expect(localIssues(content({ cashWeightBps: 1001 }), null)[0]?.message).toContain(
      'exceed 100.00% by 0.01%',
    );
  });

  it('never redistributes on removal, refuses duplicates, and makes equal weights an explicit action with the remainder as cash', () => {
    const removed = removeLeg(content(), B);
    expect(removed.legs).toEqual([{ instrumentId: A, weightBps: 6000, note: null }]);
    expect(totalsOf(removed).remainingBps).toBe(3000);
    const base = content();
    expect(addLeg(base, A)).toBe(base);
    const three = addLeg(content(), C);
    expect(three.legs[2]).toEqual({ instrumentId: C, weightBps: 0, note: null });
    const equal = equalWeights(three);
    expect(equal.legs.map((leg) => leg.weightBps)).toEqual([3333, 3333, 3333]);
    expect(equal.cashWeightBps).toBe(1);
    expect(totalsOf(equal).totalBps).toBe(10_000);
    expect(fillCashRemainder(setLegWeight(three, C, 500)).cashWeightBps).toBe(500);
    expect(fillCashRemainder(setLegWeight(three, C, 5000)).cashWeightBps).toBe(0);
    expect(moveLeg(three, C, -1).legs.map((leg) => leg.instrumentId)).toEqual([A, C, B]);
    expect(moveLeg(three, A, -1)).toBe(three);
  });

  it('flags empty, cash-only, duplicate and over-cap drafts locally', () => {
    expect(
      localIssues(content({ legs: [], cashWeightBps: 10_000 }), { maxLegs: 10 }).map(
        (issue) => issue.code,
      ),
    ).toEqual(['NO_LEGS']);
    expect(
      localIssues(
        content({
          legs: [...content().legs, { instrumentId: A, weightBps: 1000, note: null }],
          cashWeightBps: 0,
        }),
        { maxLegs: 2 },
      ).map((issue) => issue.code),
    ).toEqual(['TOO_MANY_LEGS', 'DUPLICATE_INSTRUMENT']);
  });

  it('describes what differs between two drafts for the conflict view', () => {
    const theirs = content({
      title: 'Renamed',
      legs: [
        { instrumentId: A, weightBps: 5000, note: null },
        { instrumentId: C, weightBps: 4000, note: null },
      ],
      cashWeightBps: 1000,
    });
    const diff = diffContent(content(), theirs);
    expect(diff.legs.added.map((leg) => leg.instrumentId)).toEqual([B]);
    expect(diff.legs.removed.map((leg) => leg.instrumentId)).toEqual([C]);
    expect(diff.legs.changed).toEqual([{ instrumentId: A, fromBps: 5000, toBps: 6000 }]);
    expect(diff.cash).toBeNull();
    expect(diff.titleChanged).toBe(true);
    expect(diff.same).toBe(false);
    expect(diffContent(content(), content()).same).toBe(true);
  });

  it('splits a budget exactly in raw units with the remainder as cash', () => {
    const split = splitBudget(1_000_000n, content().legs);
    expect(split.perLeg.map((leg) => leg.raw)).toEqual([600_000n, 300_000n]);
    expect(split.cashRaw).toBe(100_000n);
    const odd = splitBudget(1n, [
      { instrumentId: A, weightBps: 3333 },
      { instrumentId: B, weightBps: 3333 },
    ]);
    expect(odd.perLeg.map((leg) => leg.raw)).toEqual([0n, 0n]);
    expect(odd.cashRaw).toBe(1n);
    expect(parseStage('rules')).toBe('rules');
    expect(parseStage('deploy')).toBe('assemble');
  });
});

describe('local basket copies', () => {
  afterEach(() => window.sessionStorage.clear());

  it('keeps an account-scoped, versioned, short-lived copy and purges other accounts’ copies', () => {
    const key = localBasketKey('user:alice', 'strategy-1');
    writeLocalBasketCopy(
      key,
      { baseRevision: 3, content: content() },
      new Date('2026-09-24T12:00:00Z'),
    );
    expect(readLocalBasketCopy(key, Date.parse('2026-09-24T13:00:00Z'))?.baseRevision).toBe(3);
    expect(readLocalBasketCopy(key, Date.parse('2026-09-26T12:00:00Z'))).toBeNull();
    writeLocalBasketCopy(key, { baseRevision: 3, content: content() });
    writeLocalBasketCopy(localBasketKey('user:bob', 'strategy-2'), {
      baseRevision: 1,
      content: content(),
    });
    purgeLocalBasketCopies('user:alice');
    expect(readLocalBasketCopy(key)).not.toBeNull();
    expect(readLocalBasketCopy(localBasketKey('user:bob', 'strategy-2'))).toBeNull();
    purgeLocalBasketCopies('anonymous');
    expect(readLocalBasketCopy(key)).toBeNull();
    window.sessionStorage.setItem(key, '{"garbage":true}');
    expect(readLocalBasketCopy(key)).toBeNull();
    clearLocalBasketCopy(key);
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });
});
