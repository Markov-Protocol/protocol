import type {
  InstanceHoldingsResponse,
  JournalEntry,
  Lot,
  PerformanceResponse,
  PortfolioInstance,
  StrategyVersion,
  ValuationPosition,
  WalletHoldingsResponse,
  WalletLink,
  WindowMetrics,
} from '@markov/contracts';

/** Fixture identities shared by the portfolio tests (synthetic mints served by the fixture RPC). */
export const AERO_MINT = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
export const XSA_MINT = 'A8GviP6cWZxAKfpCoKfQCvtSejyPh975CoLjsVVqmumh';
export const CASH_MINT = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
export const OWNER_ADDRESS = 'EY3y13V2TYRa4FWBqpyD7D1ZbLZhGzEamNnDcY4fAFb5';
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const OWNER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const WALLET_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const WALLET_ID_2 = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
export const STRATEGY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const INSTANCE_ID = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
export const INSTANCE_ID_2 = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e2';
export const INTENT_ID = '77777777-7777-4777-8777-777777777777';
export const LOT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
export const ENTRY_ID = 'e1000000-0000-4000-8000-000000000000';
export const CHECKPOINT_ID = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const NOW = '2026-09-25T12:00:00.000Z';

export const wallet: WalletLink = {
  walletId: WALLET_ID,
  chain: 'solana',
  genesisHash: GENESIS,
  address: OWNER_ADDRESS,
  verifiedAt: '2026-09-20T10:00:00.000Z',
};

export function instance(overrides: Partial<PortfolioInstance> = {}): PortfolioInstance {
  return {
    instanceId: INSTANCE_ID,
    ownerUserId: OWNER_ID,
    strategyId: STRATEGY_ID,
    pinnedVersionId: VERSION_ID,
    pinnedVersionNumber: 1,
    proposedVersionId: null,
    walletId: WALLET_ID,
    label: null,
    status: 'active',
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

export function lot(overrides: Partial<Lot> = {}): Lot {
  return {
    lotId: LOT_ID,
    ownerUserId: OWNER_ID,
    walletId: WALLET_ID,
    instanceId: INSTANCE_ID,
    intentId: INTENT_ID,
    asset: AERO_MINT,
    symbol: 'FXAERO',
    decimals: 6,
    openedAt: '2026-09-22T09:00:00.000Z',
    quantityRaw: '5000000',
    remainingRaw: '5000000',
    costAsset: CASH_MINT,
    costRaw: '100000000',
    feeLamports: '5000',
    sourceEntryId: ENTRY_ID,
    status: 'open',
    ...overrides,
  };
}

/** The fill that bought 5 FXAERO for 100 USDC, attributed to the instance. */
export const ENTRY_A: JournalEntry = {
  entryId: ENTRY_ID,
  ownerUserId: OWNER_ID,
  walletId: WALLET_ID,
  instanceId: INSTANCE_ID,
  kind: 'fill',
  source: { kind: 'execution_fill', ref: 'sig-1:0' },
  occurredAt: '2026-09-22T09:00:00.000Z',
  recordedAt: '2026-09-22T09:00:05.000Z',
  reversesEntryId: null,
  attribution: 'instance',
  acknowledgement: null,
  memo: 'basket investment leg 1',
  lines: [
    {
      account: 'wallet',
      asset: CASH_MINT,
      symbol: 'USDC',
      decimals: 6,
      deltaRaw: '-100000000',
      lotId: null,
    },
    {
      account: 'venue',
      asset: CASH_MINT,
      symbol: 'USDC',
      decimals: 6,
      deltaRaw: '100000000',
      lotId: null,
    },
    {
      account: 'wallet',
      asset: AERO_MINT,
      symbol: 'FXAERO',
      decimals: 6,
      deltaRaw: '5000000',
      lotId: LOT_ID,
    },
    {
      account: 'venue',
      asset: AERO_MINT,
      symbol: 'FXAERO',
      decimals: 6,
      deltaRaw: '-5000000',
      lotId: null,
    },
  ],
};

export function journalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return { ...ENTRY_A, ...overrides };
}

export function walletHoldings(
  overrides: Partial<WalletHoldingsResponse> = {},
): WalletHoldingsResponse {
  return {
    walletId: WALLET_ID,
    address: OWNER_ADDRESS,
    network: { cluster: 'devnet', genesisHash: GENESIS },
    checkpoint: {
      checkpointId: CHECKPOINT_ID,
      walletId: WALLET_ID,
      ownerUserId: OWNER_ID,
      slot: 4242,
      observedAt: '2026-09-25T11:00:00.000Z',
      commitment: 'finalized',
      status: 'matched',
      assets: [],
      createdAt: '2026-09-25T11:00:00.000Z',
    },
    holdings: [
      {
        asset: AERO_MINT,
        symbol: 'FXAERO',
        decimals: 6,
        unit: 'raw',
        ledgerRaw: '5000000',
        chainRaw: '5000000',
        observedAt: '2026-09-25T11:00:00.000Z',
        status: 'matched',
        differenceRaw: '0',
        attribution: [{ instanceId: INSTANCE_ID, attribution: 'instance', raw: '5000000' }],
      },
      {
        asset: XSA_MINT,
        symbol: 'XSFXA',
        decimals: 6,
        unit: 'raw',
        ledgerRaw: '150000000',
        chainRaw: '150000000',
        observedAt: '2026-09-25T11:00:00.000Z',
        status: 'matched',
        differenceRaw: '0',
        attribution: [{ instanceId: INSTANCE_ID, attribution: 'instance', raw: '150000000' }],
      },
      {
        asset: CASH_MINT,
        symbol: 'USDC',
        decimals: 6,
        unit: 'raw',
        ledgerRaw: '900000000',
        chainRaw: '900000000',
        observedAt: '2026-09-25T11:00:00.000Z',
        status: 'matched',
        differenceRaw: '0',
        attribution: [{ instanceId: null, attribution: 'unassigned', raw: '900000000' }],
      },
    ],
    unexplainedEntryIds: [],
    lotPolicy: 'fifo',
    note: 'Wallet totals stay separate from strategy-attributed totals; nothing is valued here.',
    ...overrides,
  };
}

export function instanceHoldings(
  overrides: Partial<InstanceHoldingsResponse> = {},
): InstanceHoldingsResponse {
  return {
    instanceId: INSTANCE_ID,
    walletId: WALLET_ID,
    strategyId: STRATEGY_ID,
    pinnedVersionId: VERSION_ID,
    status: 'reconciled',
    holdings: [
      {
        asset: AERO_MINT,
        symbol: 'FXAERO',
        decimals: 6,
        unit: 'raw',
        attributedRaw: '5000000',
        lots: [lot()],
      },
      {
        asset: XSA_MINT,
        symbol: 'XSFXA',
        decimals: 6,
        unit: 'raw',
        attributedRaw: '150000000',
        lots: [
          lot({
            lotId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a2',
            asset: XSA_MINT,
            symbol: 'XSFXA',
            quantityRaw: '150000000',
            remainingRaw: '150000000',
            costRaw: '50000000',
            openedAt: '2026-09-22T09:00:01.000Z',
          }),
        ],
      },
    ],
    costBasis: { asset: CASH_MINT, raw: '150000000' },
    feesLamports: '10000',
    lotPolicy: 'fifo',
    note: 'Open lots attributed to this instance (FIFO bookkeeping, not tax advice).',
    ...overrides,
  };
}

export function position(overrides: Partial<ValuationPosition> = {}): ValuationPosition {
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

export const XSA_POSITION = position({
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

export const CASH_POSITION = position({
  asset: CASH_MINT,
  symbol: 'USDC',
  raw: '900000000',
  scaledQuantity: '900',
  price: {
    value: '1',
    unit: 'USD',
    kind: 'secondary_market',
    observedAt: '2026-09-25T00:00:00.000Z',
    source: 'assumption:par',
    ageMs: 0,
  },
  value: '900.000000',
  caveats: ['stablecoin_par'],
});

export function metrics(overrides: Partial<WindowMetrics> = {}): WindowMetrics {
  return {
    period: 'all',
    start: '2026-09-22T09:00:00.000Z',
    end: '2026-09-25T00:00:00.000Z',
    available: true,
    reasons: [],
    timeWeightedReturn: '0.03500000',
    moneyWeightedReturn: '0.02000000',
    maxDrawdown: null,
    startValue: '4650.000000',
    endValue: '5700.000000',
    netFlows: '0.000000',
    turnover: '0.00000000',
    tradedValue: '0.000000',
    realizedPnl: '0.000000',
    unrealizedPnl: '4650.000000',
    fees: { lamports: '10000', value: '0.001500' },
    completeness: {
      expectedPoints: 4,
      completePoints: 4,
      ratio: '1.00000000',
      missing: [],
      historyDays: 3,
      endFresh: true,
    },
    ...overrides,
  };
}

export function performance(
  kind: 'actual' | 'model',
  overrides: Partial<PerformanceResponse> = {},
): PerformanceResponse {
  const latest =
    kind === 'model' ? [position(), XSA_POSITION] : [position(), XSA_POSITION, CASH_POSITION];
  return {
    series: {
      kind,
      subject:
        kind === 'model'
          ? { type: 'version', id: VERSION_ID, label: 'Aerospace tilt v1' }
          : { type: 'wallet', id: WALLET_ID, label: OWNER_ADDRESS },
      methodologyVersion: 'stocks-v1',
      currency: 'USD',
      start: '2026-09-22T09:00:00.000Z',
      end: '2026-09-25T00:00:00.000Z',
      points: [
        {
          at: '2026-09-22T09:00:00.000Z',
          value: '4650.000000',
          complete: true,
          netFlow: '0.000000',
          index: '100.00000000',
          issues: [],
          caveats: [],
        },
        {
          at: '2026-09-23T00:00:00.000Z',
          value: '4700.000000',
          complete: true,
          netFlow: '0.000000',
          index: '101.07526882',
          issues: [],
          caveats: [],
        },
        {
          at: '2026-09-24T00:00:00.000Z',
          value: '4400.000000',
          complete: true,
          netFlow: '0.000000',
          index: '94.62365591',
          issues: [],
          caveats: [],
        },
        {
          at: '2026-09-25T00:00:00.000Z',
          value: '5700.000000',
          complete: true,
          netFlow: '0.000000',
          index: '122.58064516',
          issues: [],
          caveats: [],
        },
      ],
      flows: [],
      latest,
    },
    metrics: metrics(),
    methodology: {
      version: 'stocks-v1',
      currency: 'USD',
      priceMaxAgeMs: 86_400_000,
      rankingMinHistoryDays: 30,
      stablecoinDepegBps: 50,
      pricing: 'secondary market, then issuer mark, then underlying equity as a stated assumption',
      cashTreatment: 'par unless observed',
      flows: 'external flows close a subperiod',
      returns: 'chained time-weighted; Modified Dietz money-weighted',
      modelAssumptions: 'buy and hold, no costs',
      document: 'docs/markov/accounting-methodology.md',
    },
    note: 'A model series is not anyone’s account; a personal series values your lots at reference prices.',
    ...overrides,
  };
}

export function version(overrides: Partial<StrategyVersion> = {}): StrategyVersion {
  return {
    versionId: VERSION_ID,
    strategyId: STRATEGY_ID,
    versionNumber: 1,
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    authorPrincipal: `user:${OWNER_ID}`,
    publisherWallet: null,
    parentVersionId: null,
    forkOf: null,
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    legs: [
      {
        instrumentId: '11111111-1111-4111-8111-111111111111',
        weightBps: 6000,
        note: null,
        issuer: 'prestocks',
        symbol: 'FXAERO',
        companyName: 'Fixture Aerospace, Inc.',
        admission: {
          status: 'admitted',
          admittedAt: '2026-09-20T00:00:00.000Z',
          verificationId: 1,
          verifiedAt: '2026-09-20T00:00:00.000Z',
          mint: AERO_MINT,
          tokenProgram: 'spl-token',
          decimals: 6,
          genesisHash: GENESIS,
        },
      },
      {
        instrumentId: '22222222-2222-4222-8222-222222222222',
        weightBps: 3000,
        note: null,
        issuer: 'xstocks',
        symbol: 'XSFXA',
        companyName: 'Fixture Alpha Corp',
        admission: {
          status: 'admitted',
          admittedAt: '2026-09-20T00:00:00.000Z',
          verificationId: 2,
          verifiedAt: '2026-09-20T00:00:00.000Z',
          mint: XSA_MINT,
          tokenProgram: 'token-2022',
          decimals: 6,
          genesisHash: GENESIS,
        },
      },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    disclosures: { issuers: [], companies: [] },
    references: [],
    manifestHash: '9f9f9f9f'.padEnd(64, '2'),
    contentDigest: '8e8e8e8e'.padEnd(64, '3'),
    publication: 'unpublished',
    moderation: 'none',
    deprecatedBy: null,
    frozenAt: '2026-09-21T09:00:00.000Z',
    ...overrides,
  };
}
