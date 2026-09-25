import type {
  CreatorProfile,
  DiscoveryResponse,
  DiscoveryStrategy,
  RankingEntry,
  RankingResponse,
} from '@markov/contracts';

export const STRATEGY_A = '44444444-4444-4444-8444-444444444444';
export const STRATEGY_B = '55555555-5555-4555-8555-555555555555';
export const VERSION_A = '66666666-6666-4666-8666-666666666666';
export const VERSION_B = '77777777-7777-4777-8777-777777777777';
export const AERO_ID = '11111111-1111-4111-8111-111111111111';
export const BIO_ID = '33333333-3333-4333-8333-333333333333';
export const PUBLISHER = '4uFNLZ8GKBUywsX48vYhMeGjgpjdQC2iN6pQxo1JTG3X';
export const OTHER_PUBLISHER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
export const RECORD_A = 'GQeKCnNeG3QG6rDwM7kUWvFDZYo7t7SbYqR4y9G7vQ1M';
export const AS_OF = '2026-09-25T11:00:00.000Z';

/** A young recipe: registered today, listed without a rank and without a return. */
export function discoveryRow(overrides: Partial<DiscoveryStrategy> = {}): DiscoveryStrategy {
  return {
    strategyId: STRATEGY_A,
    title: 'Aerospace tilt',
    thesisExcerpt: 'Launch cadence is underestimated.',
    forkOf: null,
    creator: { publisherWallet: PUBLISHER },
    issuers: ['prestocks'],
    versionCount: 1,
    followerCount: 0,
    latestVersion: {
      versionId: VERSION_A,
      versionNumber: 1,
      title: 'Aerospace tilt',
      manifestHash: 'a'.repeat(64),
      recordAddress: RECORD_A,
      status: 'active',
      publisher: PUBLISHER,
      registeredAt: '2026-09-25T10:00:00.000Z',
      frozenAt: '2026-09-25T09:00:00.000Z',
      parentVersionId: null,
      legCount: 2,
      cashWeightBps: 1000,
      constituents: [
        {
          instrumentId: AERO_ID,
          symbol: 'FXAERO',
          companyName: 'Fixture Aerospace, Inc.',
          issuer: 'prestocks',
          weightBps: 6000,
        },
        {
          instrumentId: BIO_ID,
          symbol: 'FXBIO',
          companyName: 'Fixture Biotech Ltd',
          issuer: 'prestocks',
          weightBps: 3000,
        },
      ],
    },
    performance: {
      period: '30d',
      methodologyVersion: 'stocks-v1',
      eligible: false,
      rank: null,
      timeWeightedReturn: null,
      maxDrawdown: null,
      historyDays: 0,
      completeness: null,
      reasons: ['insufficient_history'],
    },
    ...overrides,
  };
}

/** A recipe with 31 days of complete history: ranked first with its return. */
export const RANKED_ROW = discoveryRow({
  strategyId: STRATEGY_B,
  title: 'Steady core',
  thesisExcerpt: 'Two fixture names, held.',
  creator: { publisherWallet: OTHER_PUBLISHER },
  followerCount: 3,
  latestVersion: {
    ...discoveryRow().latestVersion,
    versionId: VERSION_B,
    publisher: OTHER_PUBLISHER,
    registeredAt: '2026-08-25T10:00:00.000Z',
    frozenAt: '2026-08-25T09:00:00.000Z',
  },
  performance: {
    period: '30d',
    methodologyVersion: 'stocks-v1',
    eligible: true,
    rank: 1,
    timeWeightedReturn: '0.03500000',
    maxDrawdown: '0.01250000',
    historyDays: 31,
    completeness: {
      expectedPoints: 32,
      completePoints: 32,
      ratio: '1.00000000',
      missing: [],
      historyDays: 31,
      endFresh: true,
    },
    reasons: [],
  },
});

export function discoveryResponse(
  strategies: readonly DiscoveryStrategy[],
  overrides: Partial<DiscoveryResponse> = {},
): DiscoveryResponse {
  return {
    strategies: [...strategies],
    nextCursor: null,
    matched: strategies.length,
    period: '30d',
    sort: 'rank',
    methodologyVersion: 'stocks-v1',
    minHistoryDays: 30,
    asOf: AS_OF,
    note: 'Listed: active strategies with at least one registered version that platform moderation has not withheld.',
    ...overrides,
  };
}

export function rankingEntry(overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    rank: 1,
    strategyId: STRATEGY_B,
    versionId: VERSION_B,
    versionNumber: 1,
    title: 'Steady core',
    kind: 'model',
    timeWeightedReturn: '0.03500000',
    maxDrawdown: '0.01250000',
    historyDays: 31,
    completeness: {
      expectedPoints: 32,
      completePoints: 32,
      ratio: '1.00000000',
      missing: [],
      historyDays: 31,
      endFresh: true,
    },
    eligible: true,
    reasons: [],
    ...overrides,
  };
}

export const UNRANKED_ENTRY = rankingEntry({
  rank: null,
  strategyId: STRATEGY_A,
  versionId: VERSION_A,
  title: 'Aerospace tilt',
  timeWeightedReturn: null,
  maxDrawdown: null,
  historyDays: 0,
  completeness: null,
  eligible: false,
  reasons: ['insufficient_history'],
});

export function rankingResponse(
  entries: readonly RankingEntry[],
  overrides: Partial<RankingResponse> = {},
): RankingResponse {
  return {
    period: '30d',
    kind: 'model',
    methodologyVersion: 'stocks-v1',
    asOf: AS_OF,
    minHistoryDays: 30,
    entries: [...entries],
    note: 'Model series of published recipes rank; no account does.',
    ...overrides,
  };
}

export function creatorProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  return {
    publisherWallet: OTHER_PUBLISHER,
    strategyCount: 1,
    versionCount: 1,
    followerCount: 3,
    firstRegisteredAt: '2026-08-25T10:00:00.000Z',
    latestRegisteredAt: '2026-08-25T10:00:00.000Z',
    strategies: [RANKED_ROW],
    note: 'A creator is the wallet that signed a registration on chain.',
    ...overrides,
  };
}

/* ------------------------------------------------- public projections */

import type {
  MethodologySummary,
  PublicStrategy,
  PublicVersion,
  StrategyVersion,
} from '@markov/contracts';
import { version as ownVersion } from './portfolio-fixtures';

export const HASH_A = 'a'.repeat(64);
export const DIGEST_A = 'b'.repeat(64);
export const SIGNATURE =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

/** The registered projection of the owner fixture version, as the public route answers it. */
export function publicVersion(overrides: Partial<PublicVersion> = {}): PublicVersion {
  const own: StrategyVersion = ownVersion();
  return {
    strategyId: own.strategyId,
    versionId: own.versionId,
    versionNumber: own.versionNumber,
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    title: own.title,
    thesis: own.thesis,
    thesisId: null,
    legs: own.legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      symbol: leg.symbol,
      companyName: leg.companyName,
      issuer: leg.issuer,
      mint: leg.admission.mint,
      tokenProgram: leg.admission.tokenProgram,
      weightBps: leg.weightBps,
    })),
    cashWeightBps: own.cashWeightBps,
    maintenance: own.maintenance,
    disclosures: own.disclosures,
    references: [],
    parentVersionId: null,
    forkOf: null,
    canonicalManifest: '{"cashWeightBps":1000,"kind":"stock_spot_basket"}',
    manifestHash: HASH_A,
    contentDigest: DIGEST_A,
    registration: {
      signature: SIGNATURE,
      slot: 4242,
      blockTime: '2026-09-25T10:00:00.000Z',
      recordAddress: RECORD_A,
      publisher: PUBLISHER,
      status: 'active',
      transactionUrl: null,
      recordUrl: null,
    },
    verification: {
      manifestHashMatches: true,
      contentMatches: true,
      recomputedManifestHash: HASH_A,
      mismatches: [],
      checkedAt: AS_OF,
    },
    deprecatedBy: null,
    frozenAt: '2026-09-25T09:00:00.000Z',
    ...overrides,
  };
}

export function publicStrategy(overrides: Partial<PublicStrategy> = {}): PublicStrategy {
  const v1 = publicVersion();
  return {
    strategyId: v1.strategyId,
    title: v1.title,
    forkOf: null,
    followerCount: 0,
    versions: [
      {
        versionId: v1.versionId,
        versionNumber: 1,
        title: v1.title,
        manifestHash: HASH_A,
        recordAddress: RECORD_A,
        status: 'active',
        registeredAt: '2026-09-25T10:00:00.000Z',
        frozenAt: v1.frozenAt,
      },
    ],
    ...overrides,
  };
}

export const METHODOLOGY: MethodologySummary = {
  version: 'stocks-v1',
  currency: 'USD',
  priceMaxAgeMs: 86_400_000,
  rankingMinHistoryDays: 30,
  stablecoinDepegBps: 100,
  pricing: 'Latest recorded observation at or before the point.',
  cashTreatment: 'Cash at par of the stablecoin.',
  flows: 'External flows close their own subperiod.',
  returns: 'Chained time-weighted return.',
  modelAssumptions:
    'Bought once at the first priced point after the freeze; no fees, no rebalancing.',
  document: 'docs/markov/accounting-methodology.md',
};
