import type {
  JournalAsset,
  JournalAttribution,
  JournalEntry,
  JournalLine,
  PlanSide,
} from '@markov/contracts';

/**
 * The quantity journal. Every entry balances per asset: for each asset the
 * signed deltas across its lines sum to zero, so a stablecoin line and a
 * stock line never share an equation. Entries are append-only; a mistake
 * is reversed by a correction entry that points at what it reverses.
 */

export class JournalImbalanceError extends Error {
  constructor(
    readonly asset: JournalAsset,
    readonly sumRaw: bigint,
  ) {
    super(`journal entry does not balance for ${asset}: lines sum to ${sumRaw}`);
    this.name = 'JournalImbalanceError';
  }
}

/** Sums the lines per asset; throws when any asset does not net to zero. */
export function assertBalanced(entry: Pick<JournalEntry, 'lines'>): void {
  const sums = new Map<JournalAsset, bigint>();
  for (const line of entry.lines) {
    sums.set(line.asset, (sums.get(line.asset) ?? 0n) + BigInt(line.deltaRaw));
  }
  for (const [asset, sum] of sums) {
    if (sum !== 0n) {
      throw new JournalImbalanceError(asset, sum);
    }
  }
}

export function isBalanced(entry: Pick<JournalEntry, 'lines'>): boolean {
  try {
    assertBalanced(entry);
    return true;
  } catch {
    return false;
  }
}

const str = (value: bigint): string => value.toString();

/** Observation of one settled leg, as the execution store records it. */
export interface FillObservation {
  readonly intentId: string;
  readonly planId: string;
  readonly legIndex: number;
  readonly signature: string;
  readonly slot: number;
  readonly blockTime: string | null;
  readonly side: PlanSide;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inputSpentRaw: string;
  readonly outputReceivedRaw: string;
  readonly feeLamports: string;
  readonly lamportsSpent: string;
  readonly observedAt: string;
}

export interface FillLegLabels {
  readonly inputSymbol: string;
  readonly inputDecimals: number;
  readonly outputSymbol: string;
  readonly outputDecimals: number;
}

export interface FillEntryInput {
  readonly fill: FillObservation;
  readonly leg: FillLegLabels;
  readonly ownerUserId: string;
  readonly walletId: string;
  readonly instanceId: string | null;
  readonly attribution: Exclude<JournalAttribution, 'needs_reconciliation'>;
  /** Fresh ids for the entries this fill produces, supplied by the caller (the store owns ids). */
  readonly entryIds: { readonly fill: string; readonly fee: string; readonly rent: string };
  /** The lot id the fill's output opens (buys) or null; sells consume lots through consumptions. */
  readonly lotId: string | null;
  readonly recordedAt: string;
}

/** Idempotency keys of the entries a fill produces. */
export function fillSourceRefs(
  signature: string,
  legIndex: number,
): {
  readonly fill: string;
  readonly fee: string;
  readonly rent: string;
} {
  return {
    fill: `fill:${signature}:${legIndex}`,
    fee: `fee:${signature}:${legIndex}`,
    rent: `rent:${signature}:${legIndex}`,
  };
}

/**
 * The journal entries of one settled leg: the swap itself (input leaves
 * the wallet for the venue, output arrives from the venue), the network fee
 * (SOL to `network_fee`) and, when the transaction created token accounts,
 * their rent (SOL to `rent`). Fee and rent lines are produced only when
 * the amounts are positive; a fill's fee is recorded on the leg that
 * carries it (the first leg of a multi-leg transaction).
 */
export function entriesForFill(input: FillEntryInput): JournalEntry[] {
  const { fill, leg } = input;
  const refs = fillSourceRefs(fill.signature, fill.legIndex);
  const occurredAt = fill.blockTime ?? fill.observedAt;
  const inputRaw = BigInt(fill.inputSpentRaw);
  const outputRaw = BigInt(fill.outputReceivedRaw);
  const base = {
    ownerUserId: input.ownerUserId,
    walletId: input.walletId,
    instanceId: input.attribution === 'instance' ? input.instanceId : null,
    occurredAt,
    recordedAt: input.recordedAt,
    reversesEntryId: null,
    attribution: input.attribution,
    acknowledgement: null,
  } as const;
  const lines: JournalLine[] = [
    {
      account: 'wallet',
      asset: fill.inputMint,
      symbol: leg.inputSymbol,
      decimals: leg.inputDecimals,
      deltaRaw: str(-inputRaw),
      lotId: fill.side === 'sell' ? input.lotId : null,
    },
    {
      account: 'venue',
      asset: fill.inputMint,
      symbol: leg.inputSymbol,
      decimals: leg.inputDecimals,
      deltaRaw: str(inputRaw),
      lotId: null,
    },
    {
      account: 'wallet',
      asset: fill.outputMint,
      symbol: leg.outputSymbol,
      decimals: leg.outputDecimals,
      deltaRaw: str(outputRaw),
      lotId: fill.side === 'buy' ? input.lotId : null,
    },
    {
      account: 'venue',
      asset: fill.outputMint,
      symbol: leg.outputSymbol,
      decimals: leg.outputDecimals,
      deltaRaw: str(-outputRaw),
      lotId: null,
    },
  ];
  const entries: JournalEntry[] = [
    {
      ...base,
      entryId: input.entryIds.fill,
      kind: 'fill',
      source: { kind: 'execution_fill', ref: refs.fill },
      memo: `${fill.side} leg ${fill.legIndex} of intent ${fill.intentId}: ${fill.inputSpentRaw} raw ${leg.inputSymbol} for ${fill.outputReceivedRaw} raw ${leg.outputSymbol} (${fill.signature.slice(0, 12)}…)`,
      lines,
    },
  ];
  const fee = BigInt(fill.feeLamports);
  if (fee > 0n) {
    entries.push({
      ...base,
      entryId: input.entryIds.fee,
      kind: 'network_fee',
      source: { kind: 'execution_fill', ref: refs.fee },
      memo: `network fee of ${fill.signature.slice(0, 12)}…`,
      lines: solLines(-fee, 'network_fee'),
    });
  }
  const rent = BigInt(fill.lamportsSpent) - fee;
  if (rent > 0n) {
    entries.push({
      ...base,
      entryId: input.entryIds.rent,
      kind: 'rent',
      source: { kind: 'execution_fill', ref: refs.rent },
      memo: `rent-exempt deposits of token accounts created by ${fill.signature.slice(0, 12)}…`,
      lines: solLines(-rent, 'rent'),
    });
  }
  for (const entry of entries) {
    assertBalanced(entry);
  }
  return entries;
}

function solLines(walletDelta: bigint, counter: 'network_fee' | 'rent'): JournalLine[] {
  return [
    {
      account: 'wallet',
      asset: 'SOL',
      symbol: 'SOL',
      decimals: 9,
      deltaRaw: str(walletDelta),
      lotId: null,
    },
    {
      account: counter,
      asset: 'SOL',
      symbol: 'SOL',
      decimals: 9,
      deltaRaw: str(-walletDelta),
      lotId: null,
    },
  ];
}

export interface ExternalFlowEntryInput {
  /** The reconciliation checkpoint this observation belongs to. */
  readonly observationId: string;
  readonly entryId: string;
  readonly ownerUserId: string;
  readonly walletId: string;
  readonly asset: JournalAsset;
  readonly symbol: string;
  readonly decimals: number;
  /** chain minus ledger: positive is an inflow, negative an outflow. */
  readonly differenceRaw: bigint;
  readonly slot: number;
  readonly observedAt: string;
  readonly recordedAt: string;
}

/** Idempotency key of an external flow: one per wallet, slot and asset. */
/** One reference per observation (the checkpoint), wallet, slot and asset: a repeated observation is one entry, a new one never collides. */
export function externalFlowSourceRef(
  walletId: string,
  observationId: string,
  slot: number,
  asset: JournalAsset,
): string {
  return `chain:${walletId}:${observationId}:${slot}:${asset}`;
}

/**
 * An external flow: the chain shows a quantity the journal does not
 * explain. The wallet account moves by the difference against the
 * `external` counteraccount and the entry needs reconciliation until the
 * owner acknowledges it (a deposit, a withdrawal, a transfer they made).
 * Nothing attributes it to a strategy.
 */
export function entryForExternalFlow(input: ExternalFlowEntryInput): JournalEntry {
  if (input.differenceRaw === 0n) {
    throw new Error('an external flow needs a non-zero difference');
  }
  const inflow = input.differenceRaw > 0n;
  const entry: JournalEntry = {
    entryId: input.entryId,
    ownerUserId: input.ownerUserId,
    walletId: input.walletId,
    instanceId: null,
    kind: inflow ? 'external_inflow' : 'external_outflow',
    source: {
      kind: 'chain_reconciliation',
      ref: externalFlowSourceRef(input.walletId, input.observationId, input.slot, input.asset),
    },
    occurredAt: input.observedAt,
    recordedAt: input.recordedAt,
    reversesEntryId: null,
    attribution: 'needs_reconciliation',
    acknowledgement: null,
    memo: `${inflow ? 'inflow' : 'outflow'} of ${input.differenceRaw < 0n ? -input.differenceRaw : input.differenceRaw} raw ${input.symbol} observed at slot ${input.slot} that no Markov execution explains`,
    lines: [
      {
        account: 'wallet',
        asset: input.asset,
        symbol: input.symbol,
        decimals: input.decimals,
        deltaRaw: str(input.differenceRaw),
        lotId: null,
      },
      {
        account: 'external',
        asset: input.asset,
        symbol: input.symbol,
        decimals: input.decimals,
        deltaRaw: str(-input.differenceRaw),
        lotId: null,
      },
    ],
  };
  assertBalanced(entry);
  return entry;
}

/**
 * A correction reverses an entry line by line against the `correction`
 * account semantics: every line is negated, so the projected balances
 * return to what they were before the reversed entry; the reversed entry
 * stays in the journal.
 */
export function reversalOf(
  entry: JournalEntry,
  input: { readonly entryId: string; readonly recordedAt: string; readonly memo: string },
): JournalEntry {
  const reversal: JournalEntry = {
    entryId: input.entryId,
    ownerUserId: entry.ownerUserId,
    walletId: entry.walletId,
    instanceId: entry.instanceId,
    kind: 'correction',
    source: { kind: 'operator', ref: `reverse:${entry.entryId}` },
    occurredAt: input.recordedAt,
    recordedAt: input.recordedAt,
    reversesEntryId: entry.entryId,
    attribution: entry.attribution,
    acknowledgement: null,
    memo: input.memo,
    lines: entry.lines.map((line) => ({ ...line, deltaRaw: str(-BigInt(line.deltaRaw)) })),
  };
  assertBalanced(reversal);
  return reversal;
}

export interface AssetBalance {
  readonly asset: JournalAsset;
  readonly symbol: string;
  readonly decimals: number;
  readonly raw: bigint;
}

/** The balance of one account per asset over a set of entries (duplicates by source ref counted once). */
export function projectBalances(
  entries: readonly JournalEntry[],
  account: JournalLine['account'] = 'wallet',
): AssetBalance[] {
  const seen = new Set<string>();
  const balances = new Map<JournalAsset, AssetBalance>();
  for (const entry of entries) {
    const key = `${entry.ownerUserId}:${entry.source.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const line of entry.lines) {
      if (line.account !== account) {
        continue;
      }
      const current = balances.get(line.asset);
      balances.set(line.asset, {
        asset: line.asset,
        symbol: line.symbol,
        decimals: line.decimals,
        raw: (current?.raw ?? 0n) + BigInt(line.deltaRaw),
      });
    }
  }
  return [...balances.values()].sort((a, b) =>
    a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0,
  );
}

export interface AttributedBalance extends AssetBalance {
  readonly instanceId: string | null;
  readonly attribution: JournalAttribution;
}

/** Wallet-account balances split by attribution (instance, unassigned, needs reconciliation). */
export function projectAttributedBalances(entries: readonly JournalEntry[]): AttributedBalance[] {
  const seen = new Set<string>();
  const balances = new Map<string, AttributedBalance>();
  for (const entry of entries) {
    const key = `${entry.ownerUserId}:${entry.source.ref}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    for (const line of entry.lines) {
      if (line.account !== 'wallet') {
        continue;
      }
      const bucket = `${line.asset}|${entry.attribution}|${entry.instanceId ?? ''}`;
      const current = balances.get(bucket);
      balances.set(bucket, {
        asset: line.asset,
        symbol: line.symbol,
        decimals: line.decimals,
        instanceId: entry.attribution === 'instance' ? entry.instanceId : null,
        attribution: entry.attribution,
        raw: (current?.raw ?? 0n) + BigInt(line.deltaRaw),
      });
    }
  }
  return [...balances.values()];
}

/** Keeps the first entry per owner and source ref; the same observation recorded twice is one entry. */
export function dedupeBySourceRef(entries: readonly JournalEntry[]): JournalEntry[] {
  const seen = new Set<string>();
  const out: JournalEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.ownerUserId}:${entry.source.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}
