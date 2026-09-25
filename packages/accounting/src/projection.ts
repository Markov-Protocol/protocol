import type { JournalEntry, JournalProjectionReport, Lot, LotConsumption } from '@markov/contracts';
import { type AttributionInstance, attributeIntent } from './attribution.js';
import { entriesForFill, type FillObservation } from './journal.js';
import { consumeFifo, openLot } from './lots.js';

/**
 * Projection of settled fills into the journal, driven through a store
 * port so the API and the worker run the same rules. Every fill becomes
 * its entries once (the store skips a source reference it already holds),
 * a buy opens a lot attributed to the fill's instance or to the wallet, and
 * a sell consumes the wallet's open lots of the asset oldest first.
 */

export interface ProjectableFillInput {
  readonly fill: FillObservation & {
    readonly fillId: string;
    readonly ownerUserId: string;
  };
  readonly intent: {
    readonly kind: string;
    readonly walletId: string;
    readonly strategyId: string | null;
    readonly versionId: string | null;
  };
  readonly leg: {
    readonly inputSymbol: string;
    readonly inputDecimals: number;
    readonly outputSymbol: string;
    readonly outputDecimals: number;
  } | null;
}

export interface ProjectionStore {
  listUnjournaledFills(input: {
    readonly ownerUserId: string | null;
    readonly limit: number;
  }): Promise<readonly ProjectableFillInput[]>;
  listAttributionInstances(ownerUserId: string): Promise<readonly AttributionInstance[]>;
  strategyIdOfVersion(versionId: string): Promise<string | null>;
  listOpenLots(input: {
    readonly ownerUserId: string;
    readonly walletId: string;
    readonly asset: string;
  }): Promise<readonly Lot[]>;
  appendFillProjection(input: {
    readonly entries: readonly JournalEntry[];
    readonly lot: Lot | null;
    readonly consumptions: readonly LotConsumption[];
    readonly lotUpdates: readonly Lot[];
  }): Promise<{ readonly appended: readonly string[] }>;
}

export interface ProjectionDeps {
  readonly store: ProjectionStore;
  readonly newId: () => string;
  readonly now: () => Date;
  /** Called when a sell consumes more than the attributed lots hold; the shortfall stays visible. */
  readonly onShortfall?: (input: {
    readonly fillId: string;
    readonly asset: string;
    readonly shortfallRaw: bigint;
  }) => void;
}

export async function projectFills(
  deps: ProjectionDeps,
  input: { readonly ownerUserId: string | null; readonly limit?: number },
): Promise<JournalProjectionReport> {
  const fills = await deps.store.listUnjournaledFills({
    ownerUserId: input.ownerUserId,
    limit: input.limit ?? 200,
  });
  const report = {
    fillsSeen: 0,
    entriesAppended: 0,
    entriesExisting: 0,
    lotsOpened: 0,
    lotsConsumed: 0,
  };
  const instancesByOwner = new Map<string, readonly AttributionInstance[]>();
  const strategyByVersion = new Map<string, string | null>();
  for (const item of fills) {
    report.fillsSeen += 1;
    const owner = item.fill.ownerUserId;
    let instances = instancesByOwner.get(owner);
    if (instances === undefined) {
      instances = await deps.store.listAttributionInstances(owner);
      instancesByOwner.set(owner, instances);
    }
    let strategyId = item.intent.strategyId;
    if (strategyId === null && item.intent.versionId !== null) {
      if (!strategyByVersion.has(item.intent.versionId)) {
        strategyByVersion.set(
          item.intent.versionId,
          await deps.store.strategyIdOfVersion(item.intent.versionId),
        );
      }
      strategyId = strategyByVersion.get(item.intent.versionId) ?? null;
    }
    const decision = attributeIntent(
      {
        kind: item.intent.kind as 'basket_investment' | 'single_buy' | 'single_sell',
        walletId: item.intent.walletId,
        strategyId,
        versionId: item.intent.versionId,
      },
      instances,
    );
    const leg = item.leg ?? {
      inputSymbol: item.fill.side === 'buy' ? 'STABLE' : 'TOKEN',
      inputDecimals: 0,
      outputSymbol: item.fill.side === 'buy' ? 'TOKEN' : 'STABLE',
      outputDecimals: 0,
    };
    const recordedAt = deps.now().toISOString();
    const lotId =
      item.fill.side === 'buy' && BigInt(item.fill.outputReceivedRaw) > 0n ? deps.newId() : null;
    const entryIds = { fill: deps.newId(), fee: deps.newId(), rent: deps.newId() };
    const entries = entriesForFill({
      fill: item.fill,
      leg,
      ownerUserId: owner,
      walletId: item.intent.walletId,
      instanceId: decision.instanceId,
      attribution: decision.attribution,
      entryIds,
      lotId,
      recordedAt,
    });
    let lot: Lot | null = null;
    let consumptions: LotConsumption[] = [];
    let lotUpdates: Lot[] = [];
    if (lotId !== null) {
      lot = openLot({
        lotId,
        ownerUserId: owner,
        walletId: item.intent.walletId,
        instanceId: decision.instanceId,
        intentId: item.fill.intentId,
        asset: item.fill.outputMint,
        symbol: leg.outputSymbol,
        decimals: leg.outputDecimals,
        openedAt: item.fill.blockTime ?? item.fill.observedAt,
        quantityRaw: BigInt(item.fill.outputReceivedRaw),
        costAsset: item.fill.inputMint,
        costRaw: BigInt(item.fill.inputSpentRaw),
        feeLamports: BigInt(item.fill.lamportsSpent),
        sourceEntryId: entryIds.fill,
      });
    } else if (item.fill.side === 'sell' && BigInt(item.fill.inputSpentRaw) > 0n) {
      const open = await deps.store.listOpenLots({
        ownerUserId: owner,
        walletId: item.intent.walletId,
        asset: item.fill.inputMint,
      });
      const result = consumeFifo({
        lots: open,
        quantityRaw: BigInt(item.fill.inputSpentRaw),
        proceedsRaw: BigInt(item.fill.outputReceivedRaw),
        entryId: entryIds.fill,
        consumedAt: recordedAt,
        consumptionIds: open.map(() => deps.newId()),
      });
      consumptions = result.consumptions;
      lotUpdates = result.lots.filter((updated) =>
        open.some(
          (before) =>
            before.lotId === updated.lotId && before.remainingRaw !== updated.remainingRaw,
        ),
      );
      if (result.shortfallRaw > 0n) {
        deps.onShortfall?.({
          fillId: item.fill.fillId,
          asset: item.fill.inputMint,
          shortfallRaw: result.shortfallRaw,
        });
      }
    }
    const outcome = await deps.store.appendFillProjection({
      entries,
      lot,
      consumptions,
      lotUpdates,
    });
    if (outcome.appended.length === 0) {
      report.entriesExisting += entries.length;
      continue;
    }
    report.entriesAppended += outcome.appended.length;
    report.entriesExisting += entries.length - outcome.appended.length;
    if (lot !== null) {
      report.lotsOpened += 1;
    }
    report.lotsConsumed += consumptions.length;
  }
  return report;
}
