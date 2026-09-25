/**
 * Fills from a landed transaction's own balance changes: the owner's token
 * accounts for every leg's mints before and after, and the fee payer's
 * lamports. Only accounts of this transaction are counted, which attributes
 * the effect to this signature rather than to any other activity of the
 * wallet. Several legs in one transaction share the input mint (the
 * stablecoin for buys): each leg's input is the exact amount its validated
 * swap instruction spends, and the observed total must equal their sum;
 * each leg's output is the change of its own output mint.
 */

export interface TokenBalanceObservation {
  readonly accountIndex: number;
  readonly mint: string;
  readonly owner: string | null;
  readonly amount: string;
}

export interface FillLegInput {
  readonly legIndex: number;
  readonly inputMint: string;
  readonly outputMint: string;
  /** The exact input the validated swap instruction spends. */
  readonly inputRaw: bigint;
  readonly bounds: { readonly maxInputRaw: bigint; readonly minimumOutputRaw: bigint };
}

export interface FillInput {
  readonly owner: string;
  readonly feePayerIndex: number;
  readonly legs: readonly FillLegInput[];
  readonly preTokenBalances: readonly TokenBalanceObservation[];
  readonly postTokenBalances: readonly TokenBalanceObservation[];
  readonly preBalances: readonly number[];
  readonly postBalances: readonly number[];
  readonly fee: number | null;
}

export interface LegFillObservation {
  readonly legIndex: number;
  readonly inputSpentRaw: bigint;
  readonly outputReceivedRaw: bigint;
  readonly withinBounds: boolean;
  readonly notes: readonly string[];
}

export interface FillObservation {
  readonly legs: readonly LegFillObservation[];
  /** The owner's observed change of the shared input mint across the transaction. */
  readonly inputSpentRaw: bigint;
  readonly feeLamports: bigint;
  readonly lamportsSpent: bigint;
  /** Every leg within bounds and the observed input equal to the legs' exact inputs. */
  readonly withinBounds: boolean;
  readonly notes: readonly string[];
}

function sumFor(balances: readonly TokenBalanceObservation[], owner: string, mint: string): bigint {
  return balances
    .filter((entry) => entry.mint === mint && (entry.owner === null || entry.owner === owner))
    .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
}

export function fillsFromMeta(input: FillInput): FillObservation {
  const notes: string[] = [];
  const inputMints = [...new Set(input.legs.map((leg) => leg.inputMint))];
  const spentByMint = new Map<string, bigint>();
  for (const mint of inputMints) {
    const before = sumFor(input.preTokenBalances, input.owner, mint);
    const after = sumFor(input.postTokenBalances, input.owner, mint);
    spentByMint.set(mint, before > after ? before - after : 0n);
  }
  const legs: LegFillObservation[] = input.legs.map((leg) => {
    const legNotes: string[] = [];
    const outputBefore = sumFor(input.preTokenBalances, input.owner, leg.outputMint);
    const outputAfter = sumFor(input.postTokenBalances, input.owner, leg.outputMint);
    const outputReceivedRaw = outputAfter > outputBefore ? outputAfter - outputBefore : 0n;
    const inputSpentRaw =
      input.legs.length === 1 ? (spentByMint.get(leg.inputMint) ?? 0n) : leg.inputRaw;
    if (inputSpentRaw > leg.bounds.maxInputRaw) {
      legNotes.push(
        `leg ${leg.legIndex}: input spent ${inputSpentRaw} exceeds the approved maximum ${leg.bounds.maxInputRaw}`,
      );
    }
    if (outputReceivedRaw < leg.bounds.minimumOutputRaw) {
      legNotes.push(
        `leg ${leg.legIndex}: output received ${outputReceivedRaw} is below the approved minimum ${leg.bounds.minimumOutputRaw}`,
      );
    }
    notes.push(...legNotes);
    return {
      legIndex: leg.legIndex,
      inputSpentRaw,
      outputReceivedRaw,
      withinBounds: legNotes.length === 0,
      notes: legNotes,
    };
  });
  // Shared input: what left the wallet must be exactly what the validated swaps spend.
  for (const mint of inputMints) {
    const expected = input.legs
      .filter((leg) => leg.inputMint === mint)
      .reduce((sum, leg) => sum + leg.inputRaw, 0n);
    const observed = spentByMint.get(mint) ?? 0n;
    if (input.legs.length > 1 && observed !== expected) {
      notes.push(
        `input ${mint}: ${observed} raw left the wallet but the validated swaps spend ${expected}; attribution is uncertain`,
      );
    }
  }
  const before = BigInt(input.preBalances[input.feePayerIndex] ?? 0);
  const after = BigInt(input.postBalances[input.feePayerIndex] ?? 0);
  const lamportsSpent = before > after ? before - after : 0n;
  return {
    legs,
    inputSpentRaw: [...spentByMint.values()].reduce((sum, value) => sum + value, 0n),
    feeLamports: BigInt(input.fee ?? 0),
    lamportsSpent,
    withinBounds: notes.length === 0,
    notes,
  };
}
