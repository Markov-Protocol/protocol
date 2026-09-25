import type {
  Holding,
  JournalEntry,
  PerformanceSeries,
  ReceiptBody,
  ValuationPosition,
  WindowMetrics,
} from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDecimals,
  allocationSummary,
  chartSummary,
  describeEntry,
  displayQuantity,
  formatBps,
  formatReturn,
  formatValue,
  holdingRows,
  journalRows,
  metricLines,
  parseScaled,
  pendingFlows,
  quantityDisplay,
  receiptFeeSummary,
  receiptLegRows,
  scaledToDecimal,
  sparkline,
  valuedTotal,
} from '../src/features/portfolio/portfolio-model';
import { AERO_MINT, CASH_MINT, ENTRY_A, INSTANCE_ID, XSA_MINT } from './portfolio-fixtures';

/**
 * Expected outcomes below were worked out by hand from the fixture numbers
 * before the model was written, so a wrong rule cannot agree with itself:
 *   XSFXA: 150,000,000 base units, 6 decimals, multiplier 2 → 300 tokens;
 *          at 10 USD → 3,000 (the API's value; never 6,000).
 *   FXAERO: 5,000,000 base units, 6 decimals, multiplier 1 → 5 tokens;
 *          at 360 USD → 1,800.
 *   Recipe 60 % FXAERO, 30 % XSFXA, 10 % cash → invested targets
 *          6000/9000 = 66.67 % (6667 bps), 3000/9000 = 33.33 % (3333 bps);
 *          actual FXAERO 1,800/4,800 = 37.5 % (3750 bps), XSFXA 62.5 % (6250);
 *          drift −2917 and +2917 bps.
 */

function position(overrides: Partial<ValuationPosition>): ValuationPosition {
  return {
    asset: AERO_MINT,
    symbol: 'FXAERO',
    decimals: 6,
    raw: '5000000',
    multiplier: '1',
    scaledQuantity: '5',
    price: {
      value: '360',
      unit: 'USD',
      kind: 'issuer_mark',
      observedAt: '2026-09-25T00:00:00.000Z',
      source: 'fixture',
      ageMs: 3_600_000,
    },
    value: '1800.000000',
    issues: [],
    caveats: [],
    ...overrides,
  };
}

const xsaPosition = position({
  asset: XSA_MINT,
  symbol: 'XSFXA',
  raw: '150000000',
  multiplier: '2',
  scaledQuantity: '300',
  price: {
    value: '10',
    unit: 'USD',
    kind: 'secondary_market',
    observedAt: '2026-09-25T00:00:00.000Z',
    source: 'fixture',
    ageMs: 60_000,
  },
  value: '3000.000000',
});

function holding(overrides: Partial<Holding>): Holding {
  return {
    asset: AERO_MINT,
    symbol: 'FXAERO',
    decimals: 6,
    unit: 'raw',
    ledgerRaw: '5000000',
    chainRaw: '5000000',
    observedAt: '2026-09-25T01:00:00.000Z',
    status: 'matched',
    differenceRaw: '0',
    attribution: [{ instanceId: INSTANCE_ID, attribution: 'instance', raw: '5000000' }],
    ...overrides,
  };
}

describe('exact decimals', () => {
  it('parses and prints at a fixed scale without rounding', () => {
    expect(parseScaled('5007.500000', 6)).toBe(5_007_500_000n);
    expect(parseScaled('-12.5', 6)).toBe(-12_500_000n);
    expect(parseScaled('0', 6)).toBe(0n);
    expect(scaledToDecimal(5_007_500_000n, 6)).toBe('5007.500000');
    expect(scaledToDecimal(-1n, 6)).toBe('-0.000001');
    expect(() => parseScaled('1.2345678', 6)).toThrow(RangeError);
    expect(() => parseScaled('abc', 6)).toThrow(TypeError);
  });

  it('adds valuations exactly and refuses to sum an unknown', () => {
    expect(addDecimals(['1800.000000', '3000.000000'])).toBe('4800.000000');
    expect(addDecimals(['0.5', '0.25'])).toBe('0.750000');
    expect(addDecimals(['1800.000000', null])).toBeNull();
    expect(addDecimals([])).toBe('0.000000');
  });

  it('applies a multiplier to base units exactly and claims nothing when it is unknown', () => {
    expect(displayQuantity('150000000', 6, '2')).toBe('300');
    expect(displayQuantity('150000000', 6, '0.5')).toBe('75');
    expect(displayQuantity('1234567', 6, '1')).toBe('1.234567');
    expect(displayQuantity('-5000000', 6, '1')).toBe('-5');
    expect(displayQuantity('1', 6, '1.5')).toBe('0.0000015');
    expect(displayQuantity('1234567', 6, null)).toBeNull();
  });

  it('formats money and returns with two fraction digits, half-up, sign kept', () => {
    expect(formatValue('5007.500000')).toBe('$5,007.50');
    expect(formatValue('5007.505000')).toBe('$5,007.51');
    expect(formatValue('-12.5')).toBe('-$12.50');
    expect(formatValue(null)).toBe('Unpriced');
    expect(formatReturn('0.03500000')).toBe('+3.50%');
    expect(formatReturn('-0.12345678')).toBe('-12.35%');
    expect(formatReturn('0')).toBe('+0.00%');
    expect(formatReturn(null)).toBe('Not reported');
    expect(formatBps(6667)).toBe('66.67%');
    expect(formatBps(-2917)).toBe('-29.17%');
    expect(formatBps(0)).toBe('0.00%');
  });
});

describe('holding rows', () => {
  it('shows the scaled quantity and the API value once, never the value times the multiplier again', () => {
    const rows = holdingRows(
      [
        holding({
          asset: XSA_MINT,
          symbol: 'XSFXA',
          ledgerRaw: '150000000',
          chainRaw: '150000000',
        }),
      ],
      [xsaPosition],
    );
    expect(rows).toHaveLength(1);
    const [row] = rows as [(typeof rows)[number]];
    expect(row.quantity).toEqual({
      text: '300',
      scaled: true,
      multiplier: '2',
      note: '×2 multiplier applied',
    });
    expect(row.value).toBe('3000.000000');
    expect(formatValue(row.value)).toBe('$3,000.00');
    expect(row.price?.kind).toBe('secondary_market');
  });

  it('states an unpriced holding and a missing multiplier as such', () => {
    const unpriced = position({
      asset: XSA_MINT,
      symbol: 'XSFXA',
      raw: '150000000',
      multiplier: null,
      scaledQuantity: null,
      price: null,
      value: null,
      issues: [
        { code: 'no_observation', asset: XSA_MINT, detail: 'no price observation for XSFXA' },
      ],
    });
    const rows = holdingRows(
      [
        holding({
          asset: XSA_MINT,
          symbol: 'XSFXA',
          ledgerRaw: '150000000',
          chainRaw: '150000000',
        }),
        holding({ status: 'unobserved', chainRaw: null, observedAt: null, differenceRaw: null }),
      ],
      [unpriced],
    );
    expect(rows[0]?.quantity).toEqual({
      text: '150,000,000 base units',
      scaled: false,
      multiplier: null,
      note: 'multiplier unknown at this point; base units shown',
    });
    expect(rows[0]?.value).toBeNull();
    expect(rows[0]?.valueNote).toBe('no price observation for XSFXA');
    // FXAERO has no valuation position at all: base units, no value, and the reason says so.
    expect(rows[1]?.quantity.scaled).toBe(false);
    expect(rows[1]?.valueNote).toBe('not valued: no valuation point covers this asset');
    expect(rows[1]?.statusLabel).toBe('Not yet observed');
    expect(valuedTotal(rows)).toEqual({ value: null, unpriced: ['XSFXA', 'FXAERO'] });
  });

  it('sums the wallet total from the API values and keeps attribution labels separate', () => {
    const labels = new Map([[INSTANCE_ID, 'Aerospace tilt']]);
    const rows = holdingRows(
      [
        holding({
          attribution: [
            { instanceId: INSTANCE_ID, attribution: 'instance', raw: '3000000' },
            { instanceId: null, attribution: 'unassigned', raw: '2000000' },
          ],
        }),
        holding({
          asset: XSA_MINT,
          symbol: 'XSFXA',
          ledgerRaw: '150000000',
          chainRaw: '150000000',
        }),
      ],
      [position({}), xsaPosition],
      labels,
    );
    expect(valuedTotal(rows)).toEqual({ value: '4800.000000', unpriced: [] });
    expect(rows[0]?.attribution.map((share) => share.label)).toEqual([
      'Aerospace tilt',
      'Wallet (no strategy)',
    ]);
  });
});

describe('allocation summary', () => {
  const legs = [
    { instrumentId: 'aero', symbol: 'FXAERO', mint: AERO_MINT, weightBps: 6000 },
    { instrumentId: 'xsa', symbol: 'XSFXA', mint: XSA_MINT, weightBps: 3000 },
  ];
  const holdings = [
    {
      asset: AERO_MINT,
      symbol: 'FXAERO',
      decimals: 6,
      unit: 'raw' as const,
      attributedRaw: '5000000',
      lots: [],
    },
    {
      asset: XSA_MINT,
      symbol: 'XSFXA',
      decimals: 6,
      unit: 'raw' as const,
      attributedRaw: '150000000',
      lots: [],
    },
  ];

  it('compares invested targets with actual shares of the instance value and reports drift in bps', () => {
    const summary = allocationSummary({
      legs,
      cashWeightBps: 1000,
      holdings,
      positions: [position({}), xsaPosition],
    });
    expect(summary.complete).toBe(true);
    expect(summary.totalValue).toBe('4800.000000');
    expect(summary.cashBps).toBe(1000);
    expect(
      summary.rows.map((row) => [
        row.symbol,
        row.targetBps,
        row.investedTargetBps,
        row.actualBps,
        row.driftBps,
      ]),
    ).toEqual([
      ['FXAERO', 6000, 6667, 3750, -2917],
      ['XSFXA', 3000, 3333, 6250, 2917],
    ]);
    expect(summary.largestDriftBps).toBe(2917);
    expect(summary.rows[1]?.quantity.text).toBe('300');
  });

  it('reports no actual weight or drift while any constituent is unpriced', () => {
    const summary = allocationSummary({
      legs,
      cashWeightBps: 1000,
      holdings,
      positions: [
        position({}),
        position({
          asset: XSA_MINT,
          symbol: 'XSFXA',
          raw: '150000000',
          price: null,
          value: null,
          issues: [
            {
              code: 'stale_price',
              asset: XSA_MINT,
              detail: 'latest XSFXA observation is 3 days old',
            },
          ],
        }),
      ],
    });
    expect(summary.complete).toBe(false);
    expect(summary.totalValue).toBeNull();
    expect(summary.rows.every((row) => row.actualBps === null && row.driftBps === null)).toBe(true);
    expect(summary.reasons).toEqual(['XSFXA: latest XSFXA observation is 3 days old']);
    expect(summary.largestDriftBps).toBeNull();
  });

  it('lists a partial investment (one leg not held) and a holding outside the recipe', () => {
    const summary = allocationSummary({
      legs,
      cashWeightBps: 1000,
      holdings: [
        holdings[0] as (typeof holdings)[number],
        {
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          unit: 'raw',
          attributedRaw: '1000000',
          lots: [],
        },
      ],
      positions: [
        position({}),
        position({
          asset: CASH_MINT,
          symbol: 'USDC',
          raw: '1000000',
          scaledQuantity: '1',
          price: {
            value: '1',
            unit: 'USD',
            kind: 'secondary_market',
            observedAt: '2026-09-25T00:00:00.000Z',
            source: 'assumption:par',
            ageMs: 0,
          },
          value: '1.000000',
          caveats: ['stablecoin_par'],
        }),
      ],
    });
    expect(summary.totalValue).toBe('1801.000000');
    const [aero, xsa, cash] = summary.rows;
    expect(aero?.actualBps).toBe(9994);
    expect(xsa).toMatchObject({
      symbol: 'XSFXA',
      attributedRaw: '0',
      actualBps: 0,
      driftBps: -3333,
      note: 'not held by this instance',
    });
    expect(cash).toMatchObject({
      symbol: 'USDC',
      targetBps: 0,
      actualBps: 6,
      driftBps: 6,
      note: 'not in the pinned recipe',
    });
  });
});

describe('performance wording', () => {
  const metrics: WindowMetrics = {
    period: '30d',
    start: '2026-08-26T00:00:00.000Z',
    end: '2026-09-25T00:00:00.000Z',
    available: true,
    reasons: [],
    timeWeightedReturn: '0.03500000',
    moneyWeightedReturn: '0.02000000',
    maxDrawdown: {
      value: '0.10000000',
      peakAt: '2026-09-01T00:00:00.000Z',
      troughAt: '2026-09-10T00:00:00.000Z',
    },
    startValue: '4000.000000',
    endValue: '5140.000000',
    netFlows: '1000.000000',
    turnover: '0.25000000',
    tradedValue: '1000.000000',
    realizedPnl: '0.000000',
    unrealizedPnl: '140.000000',
    fees: { lamports: '5000', value: '0.000750' },
    completeness: {
      expectedPoints: 31,
      completePoints: 31,
      ratio: '1.00000000',
      missing: [],
      historyDays: 40,
      endFresh: true,
    },
  };

  it('labels every figure with its exact string and never states a deposit as return', () => {
    const lines = metricLines(metrics);
    const byKey = new Map(lines.map((line) => [line.key, line]));
    expect(byKey.get('twr')?.value).toBe('+3.50%');
    expect(byKey.get('twr')?.exact).toBe('0.03500000');
    expect(byKey.get('flows')?.value).toBe('$1,000.00');
    expect(byKey.get('flows')?.note).toContain('never in return');
    expect(byKey.get('drawdown')?.value).toBe('-10.00%');
    expect(byKey.get('fees')?.value).toBe('0.000005 SOL ($0.00)');
    expect(byKey.get('completeness')?.value).toBe('31 of 31 points');
  });

  it('states the reasons when a window is not reported', () => {
    const lines = metricLines({
      ...metrics,
      available: false,
      reasons: ['incomplete_points', 'stale_end'],
      timeWeightedReturn: null,
      moneyWeightedReturn: null,
      maxDrawdown: null,
      endValue: null,
      fees: { lamports: '5000', value: null },
    });
    const byKey = new Map(lines.map((line) => [line.key, line]));
    expect(byKey.get('twr')?.value).toBe('Not reported');
    expect(byKey.get('twr')?.note).toBe(
      'some points of the window could not be valued; the latest price is older than the methodology allows',
    );
    expect(byKey.get('end')?.value).toBe('Unpriced');
    expect(byKey.get('fees')?.note).toBe('not valued: no SOL price at the end');
  });

  it('summarises the chart in words with the extremes and breaks the line at unvalued points', () => {
    const series: PerformanceSeries = {
      kind: 'actual',
      subject: { type: 'wallet', id: INSTANCE_ID, label: 'wallet' },
      methodologyVersion: 'stocks-v1',
      currency: 'USD',
      start: '2026-09-22T00:00:00.000Z',
      end: '2026-09-25T00:00:00.000Z',
      points: [
        {
          at: '2026-09-22T00:00:00.000Z',
          value: '100.000000',
          complete: true,
          netFlow: '0.000000',
          index: '100.00000000',
          issues: [],
          caveats: [],
        },
        {
          at: '2026-09-23T00:00:00.000Z',
          value: '90.000000',
          complete: true,
          netFlow: '0.000000',
          index: '90.00000000',
          issues: [],
          caveats: [],
        },
        {
          at: '2026-09-24T00:00:00.000Z',
          value: null,
          complete: false,
          netFlow: null,
          index: null,
          issues: [{ code: 'no_observation', asset: AERO_MINT, detail: 'no price' }],
          caveats: [],
        },
        {
          at: '2026-09-25T00:00:00.000Z',
          value: '110.000000',
          complete: true,
          netFlow: '0.000000',
          index: null,
          issues: [],
          caveats: [],
        },
      ],
      flows: [],
      latest: [],
    };
    const summary = chartSummary(series);
    expect(summary.points).toBe(4);
    expect(summary.complete).toBe(3);
    expect(summary.lowest).toEqual({ at: '2026-09-23T00:00:00.000Z', value: '90.000000' });
    expect(summary.highest).toEqual({ at: '2026-09-25T00:00:00.000Z', value: '110.000000' });
    expect(summary.text).toContain('value $100.00 at the start and $110.00 at the end');
    expect(summary.text).toContain('1 point could not be valued');
    const drawing = sparkline(series.points, 300, 100);
    // Three valued points on four slots: x = 0, 100, 300; y scaled between 90 (bottom) and 110 (top).
    expect(drawing.path).toBe('M0.00 50.00 L100.00 100.00 M300.00 0.00');
    expect(drawing.gaps).toBe(1);
    expect(sparkline([], 300, 100)).toEqual({ path: '', gaps: 0 });
  });
});

describe('journal wording', () => {
  it('describes fills, fees, deposits and withdrawals from the wallet lines and finds the flows to explain', () => {
    const deposit: JournalEntry = {
      ...ENTRY_A,
      entryId: 'e1000000-0000-4000-8000-000000000001',
      kind: 'external_inflow',
      occurredAt: '2026-09-25T08:00:00.000Z',
      source: { kind: 'chain_reconciliation', ref: 'ckpt-1' },
      attribution: 'needs_reconciliation',
      acknowledgement: null,
      instanceId: null,
      lines: [
        {
          account: 'wallet',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '1000000000',
          lotId: null,
        },
        {
          account: 'external',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '-1000000000',
          lotId: null,
        },
      ],
    };
    const withdrawal: JournalEntry = {
      ...deposit,
      entryId: 'e1000000-0000-4000-8000-000000000002',
      kind: 'external_outflow',
      occurredAt: '2026-09-24T12:00:00.000Z',
      attribution: 'unassigned',
      acknowledgement: {
        kind: 'withdrawal',
        note: 'to my exchange',
        acknowledgedAt: '2026-09-24T13:00:00.000Z',
      },
      lines: [
        {
          account: 'wallet',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '-250000000',
          lotId: null,
        },
        {
          account: 'external',
          asset: CASH_MINT,
          symbol: 'USDC',
          decimals: 6,
          deltaRaw: '250000000',
          lotId: null,
        },
      ],
    };
    const fee: JournalEntry = {
      ...deposit,
      entryId: 'e1000000-0000-4000-8000-000000000003',
      kind: 'network_fee',
      occurredAt: '2026-09-23T12:00:00.000Z',
      attribution: 'unassigned',
      source: { kind: 'execution_fill', ref: 'sig-1:fee' },
      lines: [
        {
          account: 'wallet',
          asset: 'SOL',
          symbol: 'SOL',
          decimals: 9,
          deltaRaw: '-5000',
          lotId: null,
        },
        {
          account: 'network_fee',
          asset: 'SOL',
          symbol: 'SOL',
          decimals: 9,
          deltaRaw: '5000',
          lotId: null,
        },
      ],
    };
    expect(describeEntry(ENTRY_A)).toBe('Fill: -100 USDC, +5 FXAERO');
    expect(describeEntry(deposit)).toBe('Inflow from outside Markov: +1,000 USDC');
    expect(describeEntry(withdrawal)).toBe('Outflow from this wallet: -250 USDC');
    expect(describeEntry(fee)).toBe('Network fee: -0.000005 SOL');
    const rows = journalRows(
      [fee, deposit, withdrawal, ENTRY_A],
      new Map([[INSTANCE_ID, 'Aerospace tilt']]),
    );
    expect(rows.map((row) => row.kind)).toEqual([
      'external_inflow',
      'external_outflow',
      'network_fee',
      'fill',
    ]);
    expect(rows[0]?.needsAcknowledgement).toBe(true);
    expect(rows[1]?.acknowledgement).toBe(
      'a withdrawal (to my exchange), Sep 24, 2026, 1:00 PM UTC',
    );
    expect(rows[3]?.attributionLabel).toBe('Aerospace tilt');
    expect(pendingFlows([fee, deposit, withdrawal, ENTRY_A]).map((entry) => entry.entryId)).toEqual(
      [deposit.entryId],
    );
  });
});

describe('receipt explanation', () => {
  const body = {
    approved: {
      legs: [
        { legIndex: 0, maxInputRaw: '100000000', minimumOutputRaw: '4900000' },
        { legIndex: 1, maxInputRaw: '50000000', minimumOutputRaw: '2400000' },
      ],
      totalSpendRaw: '150000000',
      networkFeeMaxLamports: '20000',
    },
    fills: [
      {
        legIndex: 0,
        side: 'buy',
        inputMint: CASH_MINT,
        outputMint: AERO_MINT,
        inputSpentRaw: '100000000',
        outputReceivedRaw: '5000000',
        feeLamports: '5000',
        lamportsSpent: '5000',
        withinBounds: true,
        signature: '5'.repeat(88),
        slot: 12,
      },
    ],
    subject: { intentKind: 'basket_investment' },
  } as unknown as ReceiptBody;

  it('pairs every approved leg with its fill or says it was not filled, and checks the fee cap', () => {
    const rows = receiptLegRows(body);
    expect(rows).toEqual([
      {
        legIndex: 0,
        side: 'buy',
        approvedMaxInputRaw: '100000000',
        approvedMinimumOutputRaw: '4900000',
        filledInputRaw: '100000000',
        filledOutputRaw: '5000000',
        withinBounds: true,
        signature: '5'.repeat(88),
        status: 'filled',
      },
      {
        legIndex: 1,
        side: 'buy',
        approvedMaxInputRaw: '50000000',
        approvedMinimumOutputRaw: '2400000',
        filledInputRaw: null,
        filledOutputRaw: null,
        withinBounds: null,
        signature: null,
        status: 'not filled',
      },
    ]);
    expect(receiptFeeSummary(body)).toEqual({
      spentLamports: '5000',
      capLamports: '20000',
      withinCap: true,
    });
  });
});

describe('quantity display without a position', () => {
  it('shows base units and says the multiplier is not confirmed', () => {
    expect(quantityDisplay('5000000', 6, null)).toEqual({
      text: '5,000,000 base units',
      scaled: false,
      multiplier: null,
      note: 'multiplier not confirmed for this point; base units shown',
    });
  });
});
