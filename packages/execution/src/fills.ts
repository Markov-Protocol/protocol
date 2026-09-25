/**
 * Fills from a landed transaction's own balance changes: the owner's token
 * accounts for the input and output mints before and after, and the fee
 * payer's lamports. Only accounts of this transaction are counted, which
 * attributes the effect to this signature rather than to any other activity
 * of the wallet.
 */

export interface TokenBalanceObservation {
  readonly accountIndex: number;
  readonly mint: string;
  readonly owner: string | null;
  readonly amount: string;
}

export interface FillInput {
  readonly owner: string;
  readonly feePayerIndex: number;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly preTokenBalances: readonly TokenBalanceObservation[];
  readonly postTokenBalances: readonly TokenBalanceObservation[];
  readonly preBalances: readonly number[];
  readonly postBalances: readonly number[];
  readonly fee: number | null;
  readonly bounds: { readonly maxInputRaw: bigint; readonly minimumOutputRaw: bigint };
}

export interface FillObservation {
  readonly inputSpentRaw: bigint;
  readonly outputReceivedRaw: bigint;
  readonly feeLamports: bigint;
  readonly lamportsSpent: bigint;
  readonly withinBounds: boolean;
  readonly notes: readonly string[];
}

function sumFor(balances: readonly TokenBalanceObservation[], owner: string, mint: string): bigint {
  return balances
    .filter((entry) => entry.mint === mint && (entry.owner === null || entry.owner === owner))
    .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
}

export function fillsFromMeta(input: FillInput): FillObservation {
  const inputBefore = sumFor(input.preTokenBalances, input.owner, input.inputMint);
  const inputAfter = sumFor(input.postTokenBalances, input.owner, input.inputMint);
  const outputBefore = sumFor(input.preTokenBalances, input.owner, input.outputMint);
  const outputAfter = sumFor(input.postTokenBalances, input.owner, input.outputMint);
  const inputSpentRaw = inputBefore > inputAfter ? inputBefore - inputAfter : 0n;
  const outputReceivedRaw = outputAfter > outputBefore ? outputAfter - outputBefore : 0n;
  const before = BigInt(input.preBalances[input.feePayerIndex] ?? 0);
  const after = BigInt(input.postBalances[input.feePayerIndex] ?? 0);
  const lamportsSpent = before > after ? before - after : 0n;
  const notes: string[] = [];
  if (inputSpentRaw > input.bounds.maxInputRaw) {
    notes.push(
      `input spent ${inputSpentRaw} exceeds the approved maximum ${input.bounds.maxInputRaw}`,
    );
  }
  if (outputReceivedRaw < input.bounds.minimumOutputRaw) {
    notes.push(
      `output received ${outputReceivedRaw} is below the approved minimum ${input.bounds.minimumOutputRaw}`,
    );
  }
  return {
    inputSpentRaw,
    outputReceivedRaw,
    feeLamports: BigInt(input.fee ?? 0),
    lamportsSpent,
    withinBounds: notes.length === 0,
    notes,
  };
}
