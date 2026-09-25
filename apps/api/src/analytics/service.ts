import {
  type AssetFacts,
  type BalanceChange,
  buildActualSeries,
  buildModelSeries,
  createPriceLookup,
  type FeeInput,
  type MetricsContext,
  methodologySummary,
  type ObservationInput,
  PERFORMANCE_NOTE,
  PRICE_HISTORY_NOTE,
  type PriceLookup,
  RANKING_NOTE,
  type RankingCandidate,
  Rational,
  type RealizedInput,
  rankModelSeries,
  type TradeInput,
  valuePositions,
  windowMetrics,
} from '@markov/analytics';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type AllocationRow,
  type FlowKind,
  type IngestionSource,
  type InstanceAllocation,
  type Issuer,
  type JournalEntry,
  type Lot,
  type MethodologySummary,
  PERFORMANCE_METHODOLOGY_VERSION,
  PERFORMANCE_PERIODS,
  type PerformanceExport,
  type PerformanceQuery,
  type PerformanceResponse,
  type PerformanceSeries,
  type PriceHistoryQuery,
  type PriceHistoryResponse,
  type PriceObservation,
  type PriceObservationRequest,
  RANKING_MIN_HISTORY_DAYS,
  type RankingEntry,
  type RankingQuery,
  type RankingResponse,
  type SeriesSubject,
  VALUE_SCALE,
} from '@markov/contracts';
import {
  type Database,
  earliestCheckpointAt,
  findInstance,
  findInstrument,
  findInstrumentByMint,
  findPublicVersion,
  findStrategy,
  findVersionById,
  type InstrumentRow,
  type LotConsumptionRow,
  latestVerificationsFor,
  listConsumptionsForLots,
  listJournalEntries,
  listJournalEntriesForInstance,
  listLotsForInstance,
  listLotsForWallet,
  listMultipliersFor,
  listPriceObservations,
  listRankableVersions,
  listVersions,
  listWallets,
  type NewPriceObservation,
  type PriceObservationRow,
  recordAuditEvent,
  recordPriceObservations,
  type StrategyVersionRow,
} from '@markov/db';
import { ApiError } from '../errors.js';

/**
 * Performance analytics (B13): valuation series and window metrics for a
 * strategy instance, a wallet and a published version's model recipe,
 * model-only rankings, the methodology, and the price observation record
 * (issuer feeds on ingestion, operators by hand). Every number that cannot
 * be computed is answered as null with its reason; nothing is filled in.
 */

export interface AnalyticsServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly now?: () => Date;
}

export interface AnalyticsService {
  instancePerformance(
    principal: Principal,
    instanceId: string,
    query: PerformanceQuery,
  ): Promise<PerformanceResponse>;
  instanceExport(principal: Principal, instanceId: string): Promise<PerformanceExport>;
  walletPerformance(
    principal: Principal,
    walletId: string,
    query: PerformanceQuery,
  ): Promise<PerformanceResponse>;
  walletExport(principal: Principal, walletId: string): Promise<PerformanceExport>;
  /** Public for registered, unmoderated versions; the strategy owner reads the rest. */
  versionPerformance(
    principal: Principal | null,
    strategyId: string,
    versionNumber: number,
    query: PerformanceQuery,
  ): Promise<PerformanceResponse>;
  versionExport(
    principal: Principal | null,
    strategyId: string,
    versionNumber: number,
  ): Promise<PerformanceExport>;
  /** Target versus actual allocation of an instance now, valued like the series; drift only where every row is valued (B15). */
  instanceAllocation(principal: Principal, instanceId: string): Promise<InstanceAllocation>;
  rankings(query: RankingQuery): Promise<RankingResponse>;
  /** Every entry of the model ranking for a period, ranked and unranked, without a page limit (discovery reads it). */
  rankingEntries(period: RankingQuery['period']): Promise<RankingEntry[]>;
  methodology(): MethodologySummary;
  recordObservation(
    principal: Principal,
    request: PriceObservationRequest,
    requestId: string,
  ): Promise<PriceObservation>;
  instrumentPriceHistory(
    instrumentId: string,
    query: PriceHistoryQuery,
    publicOnly: boolean,
  ): Promise<PriceHistoryResponse>;
  solPriceHistory(query: PriceHistoryQuery): Promise<PriceHistoryResponse>;
}

const PUBLIC_INSTRUMENT_STATUSES = new Set(['admitted', 'paused']);
export const ALLOCATION_NOTE =
  'Target weights are the pinned version’s, measured on the invested part (cash excluded); actual weights value the lots attributed to this instance with the same reference observations and freshness rule as the series. Any unpriced or stale leg leaves every actual weight and drift unknown rather than guessed; a drift is a review prompt, never an order.';
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SOL: AssetFacts = {
  asset: 'SOL',
  symbol: 'SOL',
  decimals: 9,
  scaled: false,
  multipliers: [],
};

/** Observations an ingested catalog snapshot carries; identical points are not recorded twice. */
export function observationsFromInstruments(
  rows: readonly InstrumentRow[],
  source: IngestionSource,
): NewPriceObservation[] {
  const observations: NewPriceObservation[] = [];
  for (const row of rows) {
    const price = row.referencePrice;
    if (!price || row.status === 'rejected') {
      continue;
    }
    observations.push({
      asset: row.mint,
      instrumentId: row.id,
      kind: price.kind,
      value: price.value,
      unit: price.unit,
      observedAt: new Date(price.observedAt),
      source: `${row.issuer}:${price.source}`,
      sourceKind: source === 'fixture' ? 'fixture' : 'issuer_feed',
    });
  }
  return observations;
}

function ownerOf(principal: Principal): string {
  if (principal.userId === null) {
    throw new ApiError('FORBIDDEN', 'this route needs a principal that belongs to a person');
  }
  return principal.userId;
}

function toObservation(row: PriceObservationRow): PriceObservation {
  return {
    observationId: row.id,
    asset: row.asset,
    instrumentId: row.instrumentId,
    kind: row.kind as PriceObservation['kind'],
    value: row.value,
    unit: row.unit,
    observedAt: row.observedAt.toISOString(),
    source: row.source,
    sourceKind: row.sourceKind as PriceObservation['sourceKind'],
    recordedAt: row.recordedAt.toISOString(),
  };
}

function toInput(row: PriceObservationRow): ObservationInput {
  return {
    asset: row.asset,
    kind: row.kind as ObservationInput['kind'],
    value: row.value,
    unit: row.unit,
    observedAt: row.observedAt.toISOString(),
    source: row.source,
  };
}

function units(raw: bigint | string, decimals: number): string {
  return Rational.of(BigInt(raw), 10n ** BigInt(decimals)).toDecimal(VALUE_SCALE);
}

function shorten(text: string): string {
  return text.length <= 12 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

export function createAnalyticsService(deps: AnalyticsServiceDeps): AnalyticsService {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const stablecoin = config.funding.stablecoin;
  const stablecoinFacts: AssetFacts | null = stablecoin
    ? {
        asset: stablecoin.mint,
        symbol: stablecoin.symbol,
        decimals: stablecoin.decimals,
        scaled: false,
        multipliers: [],
      }
    : null;

  /** Symbol, decimals, scaled-token status and multiplier evidence for every asset a series touches. */
  const factsFor = async (
    assets: Iterable<string>,
    hints: ReadonlyMap<string, { symbol: string; decimals: number }>,
  ): Promise<Map<string, AssetFacts>> => {
    const facts = new Map<string, AssetFacts>();
    const instruments = new Map<string, InstrumentRow>();
    for (const asset of new Set(assets)) {
      if (asset === 'SOL') {
        facts.set(asset, SOL);
        continue;
      }
      if (stablecoinFacts && asset === stablecoinFacts.asset) {
        facts.set(asset, stablecoinFacts);
        continue;
      }
      const row = await findInstrumentByMint(db, asset);
      if (row) {
        instruments.set(asset, row);
      } else {
        const hint = hints.get(asset);
        facts.set(asset, {
          asset,
          symbol: hint?.symbol ?? shorten(asset),
          decimals: hint?.decimals ?? 0,
          scaled: false,
          multipliers: [],
        });
      }
    }
    const ids = [...instruments.values()].map((row) => row.id);
    const verifications = await latestVerificationsFor(db, ids);
    const multipliers = await listMultipliersFor(db, ids);
    for (const [asset, row] of instruments) {
      const history = multipliers
        .filter((point) => point.instrumentId === row.id)
        .map((point) => ({
          effectiveAt: point.effectiveAt.toISOString(),
          multiplier: point.multiplier,
          source: point.source,
        }));
      const evidence = verifications.get(row.id)?.compatibility?.scaledUiAmount ?? null;
      facts.set(asset, {
        asset,
        symbol: row.symbol,
        decimals: row.decimals,
        scaled: evidence !== null || history.length > 0,
        multipliers: history,
      });
    }
    return facts;
  };

  const lookupFor = async (
    assets: Iterable<string>,
  ): Promise<{ prices: PriceLookup; rows: PriceObservationRow[] }> => {
    const rows = await listPriceObservations(db, { assets: [...new Set(assets)] });
    return {
      rows,
      prices: createPriceLookup({
        observations: rows.map(toInput),
        currency: 'USD',
        stablecoin: stablecoinFacts ? { asset: stablecoinFacts.asset } : null,
      }),
    };
  };

  const requireWallet = async (userId: string, walletId: string) => {
    const wallet = (await listWallets(db, userId)).find((row) => row.id === walletId);
    if (!wallet) {
      throw new ApiError('NOT_FOUND', 'no wallet with that id');
    }
    return wallet;
  };

  /** Cost, proceeds and fees of lots as metric inputs, in the valuation currency at par of the cost asset. */
  const lotContext = (
    lots: readonly Lot[],
    consumptions: readonly LotConsumptionRow[],
    feeEntries: readonly JournalEntry[],
  ): {
    trades: TradeInput[];
    realized: RealizedInput[];
    openCost: string | null;
    fees: FeeInput[];
  } => {
    const byLot = new Map(lots.map((lot) => [lot.lotId, lot]));
    const costDecimals = (lot: Lot): number | null =>
      stablecoin && lot.costAsset === stablecoin.mint ? stablecoin.decimals : null;
    const trades: TradeInput[] = [];
    const realized: RealizedInput[] = [];
    let openCost: Rational | null = Rational.zero();
    for (const lot of lots) {
      const decimals = costDecimals(lot);
      if (decimals === null) {
        openCost = null;
        continue;
      }
      trades.push({ at: lot.openedAt, value: units(lot.costRaw, decimals) });
      const consumedCost = consumptions
        .filter((row) => row.lotId === lot.lotId)
        .reduce((total, row) => total + BigInt(row.costRaw), 0n);
      if (openCost !== null) {
        openCost = openCost.add(
          Rational.of(BigInt(lot.costRaw) - consumedCost, 10n ** BigInt(decimals)),
        );
      }
    }
    for (const row of consumptions) {
      const lot = byLot.get(row.lotId);
      const decimals = lot ? costDecimals(lot) : null;
      if (decimals === null) {
        continue;
      }
      const at = row.consumedAt.toISOString();
      trades.push({ at, value: units(row.proceedsRaw, decimals) });
      realized.push({
        at,
        value: Rational.of(
          BigInt(row.proceedsRaw) - BigInt(row.costRaw),
          10n ** BigInt(decimals),
        ).toDecimal(VALUE_SCALE),
      });
    }
    const fees: FeeInput[] = [];
    for (const entry of feeEntries) {
      if (entry.kind !== 'network_fee' && entry.kind !== 'rent') {
        continue;
      }
      for (const line of entry.lines) {
        if (line.account === 'wallet' && line.asset === 'SOL' && line.deltaRaw.startsWith('-')) {
          fees.push({ at: entry.occurredAt, lamports: -BigInt(line.deltaRaw) });
        }
      }
    }
    return {
      trades,
      realized,
      openCost: openCost === null ? null : openCost.toDecimal(VALUE_SCALE),
      fees,
    };
  };

  interface Built {
    readonly series: PerformanceSeries;
    readonly context: MetricsContext;
    readonly rows: PriceObservationRow[];
    readonly facts: Map<string, AssetFacts>;
  }

  const buildWallet = async (principal: Principal, walletId: string): Promise<Built> => {
    const owner = ownerOf(principal);
    const wallet = await requireWallet(owner, walletId);
    const entries = await listJournalEntries(db, owner, walletId);
    const hints = new Map<string, { symbol: string; decimals: number }>();
    const changes: BalanceChange[] = [];
    for (const entry of entries) {
      const flowKind: FlowKind | null =
        entry.kind === 'external_inflow' || entry.kind === 'external_outflow' ? entry.kind : null;
      for (const line of entry.lines) {
        if (line.account !== 'wallet') {
          continue;
        }
        hints.set(line.asset, { symbol: line.symbol, decimals: line.decimals });
        changes.push({
          at: entry.occurredAt,
          asset: line.asset,
          deltaRaw: BigInt(line.deltaRaw),
          flow: flowKind === null ? null : { kind: flowKind, ref: `entry:${entry.entryId}` },
        });
      }
    }
    const facts = await factsFor(hints.keys(), hints);
    const { prices, rows } = await lookupFor([
      ...hints.keys(),
      ...(stablecoin ? [stablecoin.mint] : []),
    ]);
    const lots = await listLotsForWallet(db, owner, walletId);
    const consumptions = await listConsumptionsForLots(
      db,
      lots.map((lot) => lot.lotId),
    );
    const context = lotContext(lots, consumptions, entries);
    // Wallet-level trades come from the journal: the stablecoin side of every fill at par.
    const trades: TradeInput[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'fill' || !stablecoin) {
        continue;
      }
      for (const line of entry.lines) {
        if (line.account === 'wallet' && line.asset === stablecoin.mint) {
          const raw = BigInt(line.deltaRaw);
          trades.push({ at: entry.occurredAt, value: units(raw < 0n ? -raw : raw, line.decimals) });
        }
      }
    }
    const subject: SeriesSubject = {
      type: 'wallet',
      id: walletId,
      label: `wallet ${shorten(wallet.address)}`,
    };
    // The series starts when the platform first observed the wallet on chain: fills journaled
    // before that reconciliation are part of the opening position, never a negative balance.
    const start = await earliestCheckpointAt(db, owner, walletId);
    const series = buildActualSeries({
      subject,
      assets: facts,
      changes,
      prices,
      end: now(),
      start,
    });
    return { series, context: { ...context, trades, prices }, rows, facts };
  };

  const buildInstance = async (principal: Principal, instanceId: string): Promise<Built> => {
    const owner = ownerOf(principal);
    const instance = await findInstance(db, owner, instanceId);
    if (!instance) {
      throw new ApiError('NOT_FOUND', 'no instance with that id');
    }
    const lots = await listLotsForInstance(db, owner, instanceId);
    const consumptions = await listConsumptionsForLots(
      db,
      lots.map((lot) => lot.lotId),
    );
    const entries = await listJournalEntriesForInstance(db, owner, instanceId);
    const hints = new Map<string, { symbol: string; decimals: number }>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        hints.set(line.asset, { symbol: line.symbol, decimals: line.decimals });
      }
    }
    for (const lot of lots) {
      hints.set(lot.asset, { symbol: lot.symbol, decimals: lot.decimals });
    }
    const byLot = new Map(lots.map((lot) => [lot.lotId, lot]));
    const changes: BalanceChange[] = [];
    // A purchase contributes its cost to the instance and turns it into tokens; a sale is the reverse.
    for (const lot of lots) {
      changes.push(
        {
          at: lot.openedAt,
          asset: lot.costAsset,
          deltaRaw: BigInt(lot.costRaw),
          flow: { kind: 'contribution', ref: `lot:${lot.lotId}` },
        },
        { at: lot.openedAt, asset: lot.costAsset, deltaRaw: -BigInt(lot.costRaw), flow: null },
        { at: lot.openedAt, asset: lot.asset, deltaRaw: BigInt(lot.quantityRaw), flow: null },
      );
    }
    for (const row of consumptions) {
      const lot = byLot.get(row.lotId);
      if (!lot) {
        continue;
      }
      const at = row.consumedAt.toISOString();
      changes.push(
        { at, asset: lot.asset, deltaRaw: -BigInt(row.quantityRaw), flow: null },
        { at, asset: lot.costAsset, deltaRaw: BigInt(row.proceedsRaw), flow: null },
        {
          at,
          asset: lot.costAsset,
          deltaRaw: -BigInt(row.proceedsRaw),
          flow: { kind: 'withdrawal', ref: `consumption:${row.id}` },
        },
      );
    }
    const assets = new Set(changes.map((change) => change.asset));
    const facts = await factsFor(assets, hints);
    const { prices, rows } = await lookupFor(assets);
    const subject: SeriesSubject = {
      type: 'instance',
      id: instanceId,
      label: instance.label ?? `instance ${shorten(instanceId)}`,
    };
    const series = buildActualSeries({ subject, assets: facts, changes, prices, end: now() });
    return { series, context: { ...lotContext(lots, consumptions, entries), prices }, rows, facts };
  };

  const versionOf = async (
    principal: Principal | null,
    strategyId: string,
    versionNumber: number,
  ): Promise<StrategyVersionRow> => {
    const version =
      (await listVersions(db, strategyId)).find((row) => row.versionNumber === versionNumber) ??
      null;
    if (version === null) {
      throw new ApiError('NOT_FOUND', 'no version with that number');
    }
    const isPublic = (await findPublicVersion(db, strategyId, version.id)) !== null;
    if (!isPublic) {
      const userId = principal?.userId ?? null;
      const owned = userId === null ? null : await findStrategy(db, userId, strategyId);
      if (owned === null) {
        throw new ApiError('NOT_FOUND', 'no version with that number');
      }
    }
    return version;
  };

  const modelInputs = async (
    versions: readonly StrategyVersionRow[],
  ): Promise<{
    facts: Map<string, AssetFacts>;
    prices: PriceLookup;
    rows: PriceObservationRow[];
  }> => {
    const hints = new Map<string, { symbol: string; decimals: number }>();
    for (const version of versions) {
      for (const leg of version.legs) {
        hints.set(leg.admission.mint, { symbol: leg.symbol, decimals: leg.admission.decimals });
      }
    }
    const assets = [...hints.keys(), ...(stablecoin ? [stablecoin.mint] : [])];
    const facts = await factsFor(assets, hints);
    const { prices, rows } = await lookupFor(assets);
    return { facts, prices, rows };
  };

  const modelSeries = (
    version: StrategyVersionRow,
    facts: ReadonlyMap<string, AssetFacts>,
    prices: PriceLookup,
  ): PerformanceSeries =>
    buildModelSeries({
      subject: {
        type: 'version',
        id: version.id,
        label: `${version.title} · version ${version.versionNumber}`,
      },
      legs: version.legs.map((leg) => ({
        facts: facts.get(leg.admission.mint) as AssetFacts,
        weightBps: leg.weightBps,
      })),
      cash:
        stablecoinFacts && version.cashWeightBps > 0
          ? { facts: stablecoinFacts, weightBps: version.cashWeightBps }
          : null,
      frozenAt: version.frozenAt,
      end: now(),
      prices,
    });

  const buildVersion = async (
    principal: Principal | null,
    strategyId: string,
    versionNumber: number,
  ): Promise<Built> => {
    const version = await versionOf(principal, strategyId, versionNumber);
    const { facts, prices, rows } = await modelInputs([version]);
    return { series: modelSeries(version, facts, prices), context: { prices }, rows, facts };
  };

  const respond = (built: Built, query: PerformanceQuery): PerformanceResponse => ({
    series: built.series,
    metrics: windowMetrics(built.series, query.period, built.context),
    methodology: methodologySummary(),
    note: PERFORMANCE_NOTE,
  });

  const exportOf = (built: Built): PerformanceExport => ({
    exportedAt: now().toISOString(),
    methodology: methodologySummary(),
    series: built.series,
    metrics: PERFORMANCE_PERIODS.map((period) =>
      windowMetrics(built.series, period, built.context),
    ),
    observations: built.rows.map(toObservation),
    multipliers: [...built.facts.values()].flatMap((facts) =>
      facts.multipliers.map((point) => ({
        asset: facts.asset,
        effectiveAt: point.effectiveAt,
        multiplier: point.multiplier,
        source: point.source ?? 'unknown',
      })),
    ),
  });

  const rankingEntries = async (period: RankingQuery['period']): Promise<RankingEntry[]> => {
    const rankable = await listRankableVersions(db);
    const versions = rankable.map((entry) => entry.version);
    const { facts, prices } = await modelInputs(versions);
    const candidates: RankingCandidate[] = versions.map((version) => {
      const series = modelSeries(version, facts, prices);
      return {
        strategyId: version.strategyId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        title: version.title,
        series,
        metrics: windowMetrics(series, period, { prices }),
      };
    });
    return rankModelSeries(candidates);
  };

  const history = async (
    asset: string,
    instrumentId: string | null,
    query: PriceHistoryQuery,
  ): Promise<PriceHistoryResponse> => {
    const rows = await listPriceObservations(db, {
      assets: [asset],
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
    });
    return { asset, instrumentId, observations: rows.map(toObservation), note: PRICE_HISTORY_NOTE };
  };

  /** Integer basis points that sum exactly to 10 000 (largest remainder), or all null when the total is unknown. */
  const bpsShares = (parts: readonly (Rational | null)[]): (number | null)[] => {
    if (parts.some((part) => part === null)) {
      return parts.map(() => null);
    }
    const values = parts as Rational[];
    const total = values.reduce((sum, value) => sum.add(value), Rational.zero());
    if (total.isZero()) {
      return values.map(() => 0);
    }
    const exact = values.map((value) => value.multiply(Rational.of(10_000n)).divide(total));
    const floors = exact.map((value) => Number(value.toBigInt('down')));
    let remainder = 10_000 - floors.reduce((sum, value) => sum + value, 0);
    const order = exact
      .map((value, index) => ({
        index,
        fraction: value.subtract(Rational.of(BigInt(floors[index] ?? 0))),
      }))
      .sort((a, b) => b.fraction.compare(a.fraction) || a.index - b.index);
    for (const entry of order) {
      if (remainder <= 0) {
        break;
      }
      floors[entry.index] = (floors[entry.index] ?? 0) + 1;
      remainder -= 1;
    }
    return floors;
  };

  const instanceAllocation = async (
    principal: Principal,
    instanceId: string,
  ): Promise<InstanceAllocation> => {
    const owner = ownerOf(principal);
    const at = now();
    const instance = await findInstance(db, owner, instanceId);
    if (!instance) {
      throw new ApiError('NOT_FOUND', 'no instance with that id');
    }
    const version = await findVersionById(db, instance.pinnedVersionId);
    if (!version) {
      throw new ApiError('NOT_FOUND', 'the pinned version no longer exists');
    }
    const lots = await listLotsForInstance(db, owner, instanceId);
    const hints = new Map<string, { symbol: string; decimals: number }>();
    const attributed = new Map<string, bigint>();
    for (const lot of lots) {
      hints.set(lot.asset, { symbol: lot.symbol, decimals: lot.decimals });
      if (lot.status === 'open') {
        attributed.set(lot.asset, (attributed.get(lot.asset) ?? 0n) + BigInt(lot.remainingRaw));
      }
    }
    // Every recipe leg, then any attributed asset the recipe does not name.
    const legAssets = version.legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      asset: leg.admission.mint,
      weightBps: leg.weightBps,
      symbol: leg.symbol,
      decimals: leg.admission.decimals,
    }));
    const extras = [...attributed.keys()]
      .filter((asset) => !legAssets.some((leg) => leg.asset === asset))
      .map((asset) => ({
        instrumentId: null,
        asset,
        weightBps: 0,
        symbol: hints.get(asset)?.symbol ?? shorten(asset),
        decimals: hints.get(asset)?.decimals ?? 0,
      }));
    const entries = [...legAssets, ...extras];
    for (const entry of entries) {
      hints.set(entry.asset, { symbol: entry.symbol, decimals: entry.decimals });
    }
    const facts = await factsFor(
      entries.map((entry) => entry.asset),
      hints,
    );
    const { prices } = await lookupFor(entries.map((entry) => entry.asset));
    const valuation = valuePositions(
      entries.map((entry) => ({
        facts: facts.get(entry.asset) as AssetFacts,
        raw: attributed.get(entry.asset) ?? 0n,
      })),
      at,
      prices,
    );
    const byAsset = new Map(valuation.positions.map((position) => [position.asset, position]));
    const investedBps = 10_000 - version.cashWeightBps;
    const investedTargets = bpsShares(
      entries.map((entry) => Rational.of(BigInt(entry.weightBps), BigInt(investedBps || 1))),
    );
    const values = entries.map((entry) => {
      const raw = attributed.get(entry.asset) ?? 0n;
      if (raw === 0n) {
        return Rational.zero();
      }
      const position = byAsset.get(entry.asset);
      return position?.value == null ? null : Rational.fromDecimal(position.value);
    });
    const actualShares = bpsShares(values);
    let stale = false;
    const rows: AllocationRow[] = entries.map((entry, index) => {
      const position = byAsset.get(entry.asset) ?? null;
      const issues = position?.issues ?? [];
      if (issues.some((issue) => issue.code === 'stale_price' || issue.code === 'no_observation')) {
        stale = true;
      }
      const target = investedTargets[index] ?? 0;
      const actual = actualShares[index] ?? null;
      return {
        instrumentId: entry.instrumentId,
        asset: entry.asset,
        symbol: entry.symbol,
        decimals: entry.decimals,
        weightBps: entry.weightBps,
        investedTargetBps: target,
        attributedRaw: (attributed.get(entry.asset) ?? 0n).toString(),
        scaledQuantity: position?.scaledQuantity ?? null,
        price: position?.price ?? null,
        value: (position?.value ?? (attributed.get(entry.asset) ?? 0n) === 0n) ? '0' : null,
        actualBps: actual,
        driftBps: actual === null ? null : actual - target,
        issues,
        caveats: position?.caveats ?? [],
      };
    });
    const complete = values.every((value) => value !== null);
    const total = complete
      ? (values as Rational[]).reduce((sum, value) => sum.add(value), Rational.zero())
      : null;
    const drifts = rows
      .map((row) => row.driftBps)
      .filter((drift): drift is number => drift !== null)
      .map((drift) => Math.abs(drift));
    const largestDriftBps = drifts.length === 0 ? null : Math.max(...drifts);
    const threshold = version.maintenance.driftThresholdBps;
    return {
      instanceId: instance.id,
      walletId: instance.walletId,
      strategyId: instance.strategyId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      cashWeightBps: version.cashWeightBps,
      rows,
      currency: 'USD',
      totalValue: total === null ? null : total.toDecimal(VALUE_SCALE),
      complete,
      stale,
      largestDriftBps,
      driftThresholdBps: threshold,
      exceedsThreshold:
        threshold !== null && largestDriftBps !== null && largestDriftBps > threshold,
      asOf: at.toISOString(),
      note: ALLOCATION_NOTE,
    };
  };

  return {
    async instancePerformance(principal, instanceId, query) {
      return respond(await buildInstance(principal, instanceId), query);
    },
    instanceAllocation,
    async instanceExport(principal, instanceId) {
      return exportOf(await buildInstance(principal, instanceId));
    },
    async walletPerformance(principal, walletId, query) {
      return respond(await buildWallet(principal, walletId), query);
    },
    async walletExport(principal, walletId) {
      return exportOf(await buildWallet(principal, walletId));
    },
    async versionPerformance(principal, strategyId, versionNumber, query) {
      return respond(await buildVersion(principal, strategyId, versionNumber), query);
    },
    async versionExport(principal, strategyId, versionNumber) {
      return exportOf(await buildVersion(principal, strategyId, versionNumber));
    },

    async rankings(query) {
      return {
        period: query.period,
        kind: 'model',
        methodologyVersion: PERFORMANCE_METHODOLOGY_VERSION,
        asOf: now().toISOString(),
        minHistoryDays: RANKING_MIN_HISTORY_DAYS,
        entries: (await rankingEntries(query.period)).slice(0, query.limit),
        note: RANKING_NOTE,
      };
    },

    rankingEntries,

    methodology() {
      return methodologySummary();
    },

    async recordObservation(principal, request, requestId) {
      let asset = 'SOL';
      let instrumentId: string | null = null;
      if (request.instrumentId !== undefined) {
        const row = await findInstrument(db, request.instrumentId);
        if (!row) {
          throw new ApiError('NOT_FOUND', 'no instrument with that id');
        }
        asset = row.mint;
        instrumentId = row.id;
      }
      const observedAt = new Date(request.observedAt);
      if (observedAt.getTime() > now().getTime() + FUTURE_TOLERANCE_MS) {
        throw new ApiError('VALIDATION_FAILED', 'an observation cannot lie in the future', [
          { path: 'observedAt', message: 'must not be later than now' },
        ]);
      }
      const { inserted } = await recordPriceObservations(db, [
        {
          asset,
          instrumentId,
          kind: request.kind,
          value: request.value,
          unit: request.unit,
          observedAt,
          source: request.source,
          sourceKind: 'operator',
          evidence: request.evidence,
          recordedBy: principal.id,
        },
      ]);
      const rows = await listPriceObservations(db, {
        assets: [asset],
        from: observedAt,
        to: observedAt,
      });
      const row = rows.find(
        (entry) => entry.kind === request.kind && entry.source === request.source,
      );
      if (!row) {
        throw new ApiError('INTERNAL', 'the observation was not recorded');
      }
      if (inserted > 0) {
        await recordAuditEvent(db, {
          actorClass: principal.class,
          actorId: principal.id,
          action: 'analytics.price.recorded',
          targetType: 'price_observation',
          targetId: String(row.id),
          requestId,
          details: {
            asset,
            kind: request.kind,
            observedAt: request.observedAt,
            source: request.source,
          },
        });
      }
      return toObservation(row);
    },

    async instrumentPriceHistory(instrumentId, query, publicOnly) {
      const row = await findInstrument(db, instrumentId);
      if (!row || (publicOnly && !PUBLIC_INSTRUMENT_STATUSES.has(row.status))) {
        throw new ApiError('NOT_FOUND', 'no instrument with that id');
      }
      return history(row.mint, row.id, query);
    },

    async solPriceHistory(query) {
      return history('SOL', null, query);
    },
  };
}

export type { Issuer as AnalyticsIssuer };
