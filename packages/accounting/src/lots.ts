import type { Lot, LotConsumption } from '@markov/contracts';

/**
 * Lot attribution. A buy opens one lot per fill (quantity, cost in the
 * input asset, the fees the fill charged); a sell consumes open lots of
 * the same asset oldest first (FIFO) and attributes cost to the consumed
 * quantity by integer proportion. This is analytics bookkeeping for the
 * person's own records, not tax advice for any jurisdiction.
 */

const str = (value: bigint): string => value.toString();

export interface OpenLotInput {
  readonly lotId: string;
  readonly ownerUserId: string;
  readonly walletId: string;
  readonly instanceId: string | null;
  readonly intentId: string | null;
  readonly asset: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly openedAt: string;
  readonly quantityRaw: bigint;
  readonly costAsset: string;
  readonly costRaw: bigint;
  readonly feeLamports: bigint;
  readonly sourceEntryId: string;
}

export function openLot(input: OpenLotInput): Lot {
  if (input.quantityRaw <= 0n) {
    throw new Error('a lot needs a positive quantity');
  }
  return {
    lotId: input.lotId,
    ownerUserId: input.ownerUserId,
    walletId: input.walletId,
    instanceId: input.instanceId,
    intentId: input.intentId,
    asset: input.asset,
    symbol: input.symbol,
    decimals: input.decimals,
    openedAt: input.openedAt,
    quantityRaw: str(input.quantityRaw),
    remainingRaw: str(input.quantityRaw),
    costAsset: input.costAsset,
    costRaw: str(input.costRaw),
    feeLamports: str(input.feeLamports),
    sourceEntryId: input.sourceEntryId,
    status: 'open',
  };
}

export interface FifoConsumptionInput {
  /** Open lots of one asset in any order; consumption takes the oldest first. */
  readonly lots: readonly Lot[];
  readonly quantityRaw: bigint;
  readonly proceedsRaw: bigint;
  readonly entryId: string;
  readonly consumedAt: string;
  /** Fresh ids for the consumptions, one per lot touched at most. */
  readonly consumptionIds: readonly string[];
}

export interface FifoConsumptionResult {
  readonly consumptions: LotConsumption[];
  readonly lots: Lot[];
  /** Quantity the open lots could not cover: the sell exceeds what is attributed. */
  readonly shortfallRaw: bigint;
  /** Cost basis attributed to the consumed quantity. */
  readonly costRaw: bigint;
}

/**
 * Consumes `quantityRaw` from the open lots oldest first. Each lot's cost
 * is attributed to the consumed part by integer proportion (floor), the
 * lot keeps the rest, and proceeds are split the same way; a lot consumed
 * entirely carries its whole remaining cost, so nothing is lost to
 * rounding over the life of a lot.
 */
export function consumeFifo(input: FifoConsumptionInput): FifoConsumptionResult {
  const ordered = [...input.lots]
    .filter((lot) => lot.status === 'open' && BigInt(lot.remainingRaw) > 0n)
    .sort((a, b) =>
      a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : a.lotId < b.lotId ? -1 : 1,
    );
  let remainingToConsume = input.quantityRaw;
  let costTotal = 0n;
  let proceedsAllocated = 0n;
  const consumptions: LotConsumption[] = [];
  const updated: Lot[] = [];
  const untouched = new Map(input.lots.map((lot) => [lot.lotId, lot]));
  for (const lot of ordered) {
    if (remainingToConsume <= 0n) {
      break;
    }
    const available = BigInt(lot.remainingRaw);
    const take = available < remainingToConsume ? available : remainingToConsume;
    const remainingCost = remainingCostOf(lot);
    const cost = take === available ? remainingCost : (remainingCost * take) / available;
    const proceeds = (input.proceedsRaw * take) / input.quantityRaw;
    const id = input.consumptionIds[consumptions.length];
    if (id === undefined) {
      throw new Error('not enough consumption ids for the lots touched');
    }
    consumptions.push({
      consumptionId: id,
      lotId: lot.lotId,
      entryId: input.entryId,
      quantityRaw: str(take),
      costRaw: str(cost),
      proceedsRaw: str(proceeds),
      consumedAt: input.consumedAt,
    });
    const left = available - take;
    updated.push({
      ...lot,
      remainingRaw: str(left),
      status: left === 0n ? 'closed' : 'open',
    });
    untouched.delete(lot.lotId);
    remainingToConsume -= take;
    costTotal += cost;
    proceedsAllocated += proceeds;
  }
  // The proceeds' rounding remainder goes to the last consumption so the sum is exact.
  const last = consumptions.at(-1);
  if (last && proceedsAllocated !== input.proceedsRaw && remainingToConsume === 0n) {
    last.proceedsRaw = str(BigInt(last.proceedsRaw) + (input.proceedsRaw - proceedsAllocated));
  }
  return {
    consumptions,
    lots: [...updated, ...untouched.values()],
    shortfallRaw: remainingToConsume,
    costRaw: costTotal,
  };
}

/** The cost still carried by a lot's remaining quantity (integer proportion of its original cost). */
export function remainingCostOf(lot: Lot): bigint {
  const quantity = BigInt(lot.quantityRaw);
  const remaining = BigInt(lot.remainingRaw);
  if (quantity === 0n || remaining === quantity) {
    return BigInt(lot.costRaw);
  }
  return (BigInt(lot.costRaw) * remaining) / quantity;
}
