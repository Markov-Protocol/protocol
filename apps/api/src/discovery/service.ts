import type { Principal } from '@markov/auth';
import {
  type CreatorProfile,
  type CreatorQuery,
  DISCOVERY_POPULATION_MAX,
  type DiscoveryPerformance,
  type DiscoveryQuery,
  type DiscoveryResponse,
  type DiscoveryStrategy,
  type Issuer,
  type ModerationDecision,
  type ModerationDecisionRequest,
  type ModerationHistoryResponse,
  PERFORMANCE_METHODOLOGY_VERSION,
  RANKING_MIN_HISTORY_DAYS,
  type RankingEntry,
  THESIS_EXCERPT_MAX,
} from '@markov/contracts';
import {
  type Database,
  listModerationDecisions,
  listPublicStrategies,
  listVersions,
  type ModerationDecisionRow,
  type PublicStrategyCandidate,
  recordAuditEvent,
  recordModerationDecision,
} from '@markov/db';
import type { AnalyticsService } from '../analytics/service.js';
import { ApiError } from '../errors.js';

export interface DiscoveryServiceDeps {
  readonly db: Database;
  readonly analytics: Pick<AnalyticsService, 'rankingEntries'>;
  readonly now?: () => Date;
}

export interface DiscoveryService {
  explore(query: DiscoveryQuery): Promise<DiscoveryResponse>;
  creator(publisherWallet: string, query: CreatorQuery): Promise<CreatorProfile>;
  moderate(
    principal: Principal,
    strategyId: string,
    versionId: string,
    request: ModerationDecisionRequest,
    requestId: string,
  ): Promise<{ decision: ModerationDecision; created: boolean }>;
  moderationHistory(strategyId: string): Promise<ModerationHistoryResponse>;
}

export const DISCOVERY_NOTE =
  'Listed: active strategies with at least one registered version that platform moderation has not withheld. The performance column is the model series of the newest such version under one period and methodology version; a version without the minimum complete history, with an incomplete window or a stale end price is listed without a rank and without a return. Follower counts are counts. No account, deposit, transaction count or creator claim ranks anything.';

export const CREATOR_NOTE =
  'A creator is the wallet that signed a registration on chain. The platform asserts no name, no track record and no claim beyond the registered versions and their model series.';

interface Cursor {
  readonly v: 1;
  readonly sort: DiscoveryQuery['sort'];
  readonly period: DiscoveryQuery['period'];
  readonly after: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { after?: unknown }).after === 'string' &&
      typeof (parsed as { sort?: unknown }).sort === 'string' &&
      typeof (parsed as { period?: unknown }).period === 'string'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

/** The first characters of the thesis, cut at a word boundary; the full text is on the public version. */
export function thesisExcerpt(thesis: string, max = THESIS_EXCERPT_MAX): string {
  const compact = thesis.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) {
    return compact;
  }
  const cut = compact.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function performanceOf(
  entry: RankingEntry | undefined,
  period: DiscoveryQuery['period'],
): DiscoveryPerformance {
  if (!entry) {
    return {
      period,
      methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
      eligible: false,
      rank: null,
      timeWeightedReturn: null,
      maxDrawdown: null,
      historyDays: 0,
      completeness: null,
      reasons: ['no_series'],
    };
  }
  return {
    period,
    methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
    eligible: entry.eligible,
    rank: entry.rank,
    timeWeightedReturn: entry.timeWeightedReturn,
    maxDrawdown: entry.maxDrawdown,
    historyDays: entry.historyDays,
    completeness: entry.completeness,
    reasons: entry.reasons,
  };
}

function rowOf(
  candidate: PublicStrategyCandidate,
  entries: ReadonlyMap<string, RankingEntry>,
  period: DiscoveryQuery['period'],
): DiscoveryStrategy | null {
  const latest = candidate.versions[0];
  if (!latest) {
    return null;
  }
  const { version, record } = latest;
  const issuers: Issuer[] = [];
  for (const leg of version.legs) {
    if (!issuers.includes(leg.issuer)) {
      issuers.push(leg.issuer);
    }
  }
  return {
    strategyId: candidate.strategy.id,
    title: version.title,
    thesisExcerpt: thesisExcerpt(version.thesis),
    forkOf:
      candidate.strategy.forkOfStrategyId && candidate.strategy.forkOfVersionId
        ? {
            strategyId: candidate.strategy.forkOfStrategyId,
            versionId: candidate.strategy.forkOfVersionId,
          }
        : null,
    creator: { publisherWallet: record.publisher },
    issuers,
    versionCount: candidate.versions.length,
    followerCount: candidate.followerCount,
    latestVersion: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      manifestHash: version.manifestHash,
      recordAddress: record.address,
      status: record.status as 'active' | 'deprecated',
      publisher: record.publisher,
      registeredAt: new Date(record.registeredUnixTime * 1000).toISOString(),
      frozenAt: version.frozenAt.toISOString(),
      parentVersionId: version.parentVersionId,
      legCount: version.legs.length,
      cashWeightBps: version.cashWeightBps,
      constituents: version.legs.map((leg) => ({
        instrumentId: leg.instrumentId,
        symbol: leg.symbol,
        companyName: leg.companyName,
        issuer: leg.issuer,
        weightBps: leg.weightBps,
      })),
    },
    performance: performanceOf(entries.get(version.id), period),
  };
}

function matches(row: DiscoveryStrategy, query: DiscoveryQuery): boolean {
  if (query.issuer && !row.issuers.includes(query.issuer)) {
    return false;
  }
  if (
    query.instrumentId &&
    !row.latestVersion.constituents.some((leg) => leg.instrumentId === query.instrumentId)
  ) {
    return false;
  }
  if (query.creator && row.creator.publisherWallet !== query.creator) {
    return false;
  }
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = [
      row.title,
      row.thesisExcerpt,
      ...row.latestVersion.constituents.flatMap((leg) => [leg.symbol, leg.companyName]),
    ]
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }
  return true;
}

/** Ranked rows by rank; the rest newest registration first; ties by strategy id, so a page is stable. */
function compareRows(
  sort: DiscoveryQuery['sort'],
): (a: DiscoveryStrategy, b: DiscoveryStrategy) => number {
  const byNewest = (a: DiscoveryStrategy, b: DiscoveryStrategy) =>
    b.latestVersion.registeredAt.localeCompare(a.latestVersion.registeredAt) ||
    a.strategyId.localeCompare(b.strategyId);
  switch (sort) {
    case 'newest':
      return byNewest;
    case 'followers':
      return (a, b) => b.followerCount - a.followerCount || byNewest(a, b);
    case 'rank':
      return (a, b) => {
        const ra = a.performance.rank;
        const rb = b.performance.rank;
        if (ra !== null && rb !== null) {
          return ra - rb;
        }
        if (ra !== null) {
          return -1;
        }
        if (rb !== null) {
          return 1;
        }
        return byNewest(a, b);
      };
  }
}

/**
 * Discovery (B14): public projections over registered strategies, creator
 * provenance from chain records, and platform moderation. Every row is
 * built from public columns only; the ranking column reuses the B13 model
 * ranking under one period and methodology version.
 */
export function createDiscoveryService(deps: DiscoveryServiceDeps): DiscoveryService {
  const { db, analytics } = deps;
  const now = deps.now ?? (() => new Date());

  const rows = async (period: DiscoveryQuery['period']): Promise<DiscoveryStrategy[]> => {
    const [candidates, entries] = await Promise.all([
      listPublicStrategies(db, DISCOVERY_POPULATION_MAX),
      analytics.rankingEntries(period),
    ]);
    const byVersion = new Map(entries.map((entry) => [entry.versionId, entry]));
    const built: DiscoveryStrategy[] = [];
    for (const candidate of candidates) {
      const row = rowOf(candidate, byVersion, period);
      if (row) {
        built.push(row);
      }
    }
    return built;
  };

  const decisionOf = (row: ModerationDecisionRow, versionNumber: number): ModerationDecision => ({
    decisionId: row.id,
    strategyId: row.strategyId,
    versionId: row.versionId,
    versionNumber,
    status: row.status as ModerationDecision['status'],
    previousStatus: row.previousStatus as ModerationDecision['previousStatus'],
    reason: row.reason,
    reference: row.reference,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
  });

  return {
    async explore(query) {
      const all = (await rows(query.period)).filter((row) => matches(row, query));
      all.sort(compareRows(query.sort));
      let start = 0;
      if (query.cursor !== undefined) {
        const cursor = decodeCursor(query.cursor);
        if (!cursor || cursor.sort !== query.sort || cursor.period !== query.period) {
          throw new ApiError('VALIDATION_FAILED', 'the cursor does not belong to this query', [
            { path: 'cursor', message: 'restart from the first page' },
          ]);
        }
        const index = all.findIndex((row) => row.strategyId === cursor.after);
        if (index < 0) {
          throw new ApiError('VALIDATION_FAILED', 'the cursor is no longer valid', [
            { path: 'cursor', message: 'restart from the first page' },
          ]);
        }
        start = index + 1;
      }
      const page = all.slice(start, start + query.limit);
      const last = page.at(-1);
      const nextCursor =
        last && start + query.limit < all.length
          ? encodeCursor({ v: 1, sort: query.sort, period: query.period, after: last.strategyId })
          : null;
      return {
        strategies: page,
        nextCursor,
        matched: all.length,
        period: query.period,
        sort: query.sort,
        methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
        minHistoryDays: RANKING_MIN_HISTORY_DAYS,
        asOf: now().toISOString(),
        note: DISCOVERY_NOTE,
      };
    },

    async creator(publisherWallet, query) {
      const [candidates, entries] = await Promise.all([
        listPublicStrategies(db, DISCOVERY_POPULATION_MAX),
        analytics.rankingEntries(query.period),
      ]);
      const byVersion = new Map(entries.map((entry) => [entry.versionId, entry]));
      const strategies: DiscoveryStrategy[] = [];
      let versionCount = 0;
      let followerCount = 0;
      let first: number | null = null;
      let latest: number | null = null;
      for (const candidate of candidates) {
        const row = rowOf(candidate, byVersion, query.period);
        if (!row || row.creator.publisherWallet !== publisherWallet) {
          continue;
        }
        strategies.push(row);
        followerCount += candidate.followerCount;
        for (const { record } of candidate.versions) {
          if (record.publisher !== publisherWallet) {
            continue;
          }
          versionCount += 1;
          const at = record.registeredUnixTime * 1000;
          first = first === null ? at : Math.min(first, at);
          latest = latest === null ? at : Math.max(latest, at);
        }
      }
      if (strategies.length === 0 || first === null || latest === null) {
        throw new ApiError('NOT_FOUND', 'no listed strategy was registered by that wallet');
      }
      strategies.sort(compareRows('rank'));
      return {
        publisherWallet,
        strategyCount: strategies.length,
        versionCount,
        followerCount,
        firstRegisteredAt: new Date(first).toISOString(),
        latestRegisteredAt: new Date(latest).toISOString(),
        strategies,
        note: CREATOR_NOTE,
      };
    },

    async moderate(principal, strategyId, versionId, request, requestId) {
      const result = await recordModerationDecision(db, {
        strategyId,
        versionId,
        status: request.status,
        reason: request.reason,
        reference: request.reference,
        decidedBy: principal.id,
        now: now(),
      });
      if (result.outcome === 'not_found') {
        throw new ApiError('NOT_FOUND', 'no version with that id in that strategy');
      }
      if (result.outcome === 'unchanged') {
        if (result.latest === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `the version is already ${request.status === 'none' ? 'visible' : 'hidden'} and no decision recorded it`,
          );
        }
        return {
          decision: decisionOf(result.latest, result.version.versionNumber),
          created: false,
        };
      }
      await recordAuditEvent(db, {
        actorClass: principal.class,
        actorId: principal.id,
        action: 'strategy.moderate',
        targetType: 'strategy_version',
        targetId: versionId,
        requestId,
        details: {
          strategyId,
          status: request.status,
          previousStatus: result.decision.previousStatus,
          reason: request.reason,
          reference: request.reference,
        },
      });
      return { decision: decisionOf(result.decision, result.version.versionNumber), created: true };
    },

    async moderationHistory(strategyId) {
      const versions = await listVersions(db, strategyId);
      if (versions.length === 0) {
        throw new ApiError('NOT_FOUND', 'no strategy with frozen versions and that id');
      }
      const numbers = new Map(versions.map((version) => [version.id, version.versionNumber]));
      const decisions = await listModerationDecisions(db, strategyId);
      return {
        strategyId,
        versions: versions.map((version) => ({
          versionId: version.id,
          versionNumber: version.versionNumber,
          moderation: version.moderation as 'none' | 'hidden',
          publication: version.publication,
        })),
        decisions: decisions.map((row) => decisionOf(row, numbers.get(row.versionId) ?? 0)),
      };
    },
  };
}
