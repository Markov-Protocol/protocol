import type {
  DecodedInstruction as DecodedInstructionSummary,
  ExecutionPlan,
  PlanLeg,
  TransactionEffects,
  TransactionLegEffect,
} from '@markov/contracts';
import { routeProgramVerdict } from '@markov/planning';
import {
  associatedTokenAddress,
  DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION,
  LAMPORTS_PER_SIGNATURE,
  MAX_COMPUTE_UNITS,
  MAX_TRANSACTION_BYTES,
  type ResolvedAccount,
  rentExemptMinimum,
  resolveInstructions,
  resolveMessageAccounts,
  SIGNATURE_LENGTH,
  serializeTransaction,
  TOKEN_ACCOUNT_LENGTH,
  type Transaction,
} from '@markov/solana-codec';
import { type DecodedEntry, decodeInstruction, summarize } from './decode.js';

/**
 * Validation of a built transaction against the approved plan. The venue's
 * bytes are untrusted: every instruction is decoded and compared with what
 * the plan allows (fee payer, the one signer, the token accounts of the
 * owner, the mints, the exact input and the minimum output of every leg,
 * compute budget bounds, account creation only for the owner), and anything
 * else is a refusal. A transaction carries one leg (B10) or every leg of an
 * atomic basket (B11): each swap must match exactly one leg and every leg
 * must be swapped exactly once. Fail closed: a program the matrix has not
 * reviewed for the plan's mode, an instruction the decoder cannot name, or
 * an account that could be written for no explained reason all refuse the
 * transaction.
 */

export type ValidationCode =
  | 'UNSUPPORTED_VERSION'
  | 'LOOKUP_TABLE_UNRESOLVED'
  | 'SIGNER_MISMATCH'
  | 'EXTRA_SIGNER'
  | 'PROGRAM_NOT_ALLOWED'
  | 'INSTRUCTION_NOT_ALLOWED'
  | 'UNEXPECTED_TRANSFER'
  | 'DELEGATE_APPROVAL'
  | 'AUTHORITY_CHANGE'
  | 'ACCOUNT_CLOSURE'
  | 'ACCOUNT_CREATION_NOT_ALLOWED'
  | 'UNEXPECTED_WRITABLE_ACCOUNT'
  | 'ROUTE_MISSING'
  | 'ROUTE_DUPLICATED'
  | 'ROUTE_ACCOUNTS_MISMATCH'
  | 'MINT_MISMATCH'
  | 'INPUT_ABOVE_BOUND'
  | 'OUTPUT_BELOW_BOUND'
  | 'SLIPPAGE_ABOVE_LIMIT'
  | 'COMPUTE_BUDGET_DUPLICATED'
  | 'FEE_ABOVE_CAP'
  | 'MESSAGE_TOO_LARGE';

export interface ValidationRefusal {
  readonly code: ValidationCode;
  readonly message: string;
  readonly instructionIndex: number | null;
}

export interface SwapExpectation {
  readonly plan: ExecutionPlan;
  /** The legs this transaction carries: one for a single-leg plan or a staged batch, all of them for an atomic basket. */
  readonly legs: readonly PlanLeg[];
  /** The wallet that pays, signs and owns every token account. */
  readonly owner: string;
  /** Token program of the platform stablecoin. */
  readonly stablecoinTokenProgram: string;
  /** Token program of each instrument mint (the leg's `tokenProgram` mapped to a program id). */
  readonly instrumentTokenProgram: (leg: PlanLeg) => string;
  /** Addresses of every lookup table the message names (versioned messages only). */
  readonly lookupTables?: ReadonlyMap<string, readonly string[]>;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly refusals: readonly ValidationRefusal[];
  readonly instructions: readonly DecodedInstructionSummary[];
  readonly effects: TransactionEffects | null;
  readonly accounts: readonly ResolvedAccount[];
}

function refusal(
  code: ValidationCode,
  message: string,
  instructionIndex: number | null = null,
): ValidationRefusal {
  return { code, message, instructionIndex };
}

/** Priority fee for a compute budget, rounded up as the runtime charges it. */
export function priorityFeeLamports(unitLimit: number, unitPriceMicroLamports: bigint): bigint {
  return (BigInt(unitLimit) * unitPriceMicroLamports + 999_999n) / 1_000_000n;
}

interface LegAccounts {
  readonly leg: PlanLeg;
  readonly inputTokenProgram: string;
  readonly outputTokenProgram: string;
  readonly source: string;
  readonly destination: string;
}

/** The token programs and the owner's associated token accounts of a leg. */
export function legTokenAccounts(
  leg: PlanLeg,
  owner: string,
  stablecoinTokenProgram: string,
  instrumentTokenProgram: string,
): LegAccounts {
  const inputTokenProgram = leg.side === 'buy' ? stablecoinTokenProgram : instrumentTokenProgram;
  const outputTokenProgram = leg.side === 'buy' ? instrumentTokenProgram : stablecoinTokenProgram;
  return {
    leg,
    inputTokenProgram,
    outputTokenProgram,
    source: associatedTokenAddress(owner, leg.inputMint, inputTokenProgram).address,
    destination: associatedTokenAddress(owner, leg.outputMint, outputTokenProgram).address,
  };
}

export function validateSwapTransaction(
  transaction: Transaction,
  expectation: SwapExpectation,
): ValidationResult {
  const refusals: ValidationRefusal[] = [];
  const { message } = transaction;
  const { plan, owner } = expectation;

  let accounts: readonly ResolvedAccount[];
  try {
    accounts = resolveMessageAccounts(message, expectation.lookupTables ?? new Map());
  } catch (error) {
    return {
      ok: false,
      refusals: [
        refusal(
          'LOOKUP_TABLE_UNRESOLVED',
          error instanceof Error ? error.message : 'lookup tables could not be resolved',
        ),
      ],
      instructions: [],
      effects: null,
      accounts: [],
    };
  }
  const entries: DecodedEntry[] = resolveInstructions(message, accounts).map(decodeInstruction);
  const summaries: DecodedInstructionSummary[] = entries.map((entry) => ({
    index: entry.index,
    programId: entry.programId,
    program: entry.program,
    kind: entry.decoded.kind,
    summary: summarize(entry).slice(0, 400),
  }));

  // Signers: exactly the owner, who is the fee payer.
  const signers = accounts.filter((account) => account.isSigner).map((account) => account.pubkey);
  if (message.header.numRequiredSignatures !== 1 || signers.length !== 1) {
    refusals.push(
      refusal(
        'EXTRA_SIGNER',
        `the message requires ${signers.length} signatures; exactly one (the owner) is allowed`,
      ),
    );
  }
  if (accounts[0]?.pubkey !== owner) {
    refusals.push(
      refusal(
        'SIGNER_MISMATCH',
        `the fee payer ${accounts[0]?.pubkey ?? 'missing'} is not the plan's wallet ${owner}`,
      ),
    );
  }
  if (plan.fees.feePayer !== owner) {
    refusals.push(refusal('SIGNER_MISMATCH', 'the plan names another fee payer than the wallet'));
  }

  // Size: the signed transaction must fit one packet.
  const signedLength = serializeTransaction(
    Array.from(
      { length: message.header.numRequiredSignatures },
      () => new Uint8Array(SIGNATURE_LENGTH),
    ),
    transaction.messageBytes,
  ).length;
  if (signedLength > MAX_TRANSACTION_BYTES) {
    refusals.push(
      refusal('MESSAGE_TOO_LARGE', `${signedLength} bytes exceed ${MAX_TRANSACTION_BYTES}`),
    );
  }

  // The owner's token accounts for every leg's mints.
  const legs = expectation.legs.map((leg) =>
    legTokenAccounts(
      leg,
      owner,
      expectation.stablecoinTokenProgram,
      expectation.instrumentTokenProgram(leg),
    ),
  );
  if (legs.length === 0) {
    refusals.push(refusal('ROUTE_MISSING', 'the transaction carries no leg of the plan'));
  }
  const allowedWritable = new Set([owner, ...legs.flatMap((l) => [l.source, l.destination])]);
  const allowedCreations = new Map<
    string,
    LegAccounts & { readonly mint: string; readonly program: string }
  >();
  for (const l of legs) {
    allowedCreations.set(l.source, { ...l, mint: l.leg.inputMint, program: l.inputTokenProgram });
    allowedCreations.set(l.destination, {
      ...l,
      mint: l.leg.outputMint,
      program: l.outputTokenProgram,
    });
  }
  const accountsCreated: string[] = [];
  let unitLimit: number | null = null;
  let unitPrice = 0n;
  let limitCount = 0;
  let priceCount = 0;
  const matched = new Map<number, TransactionLegEffect>();
  const swapsSeen: number[] = [];

  for (const entry of entries) {
    const d = entry.decoded;
    const at = entry.index;
    switch (d.kind) {
      case 'compute_unit_limit':
        limitCount += 1;
        unitLimit = Math.min(MAX_COMPUTE_UNITS, d.units);
        break;
      case 'compute_unit_price':
        priceCount += 1;
        unitPrice = d.microLamports;
        break;
      case 'compute_heap_frame':
      case 'compute_loaded_data_limit':
        break;
      case 'compute_other':
        refusals.push(refusal('INSTRUCTION_NOT_ALLOWED', summarize(entry), at));
        break;
      case 'system_transfer':
        refusals.push(
          refusal('UNEXPECTED_TRANSFER', `lamport transfer to ${d.to} is not part of the plan`, at),
        );
        break;
      case 'system_other':
      case 'ata_other':
      case 'token_sync_native':
      case 'token_initialize_account':
      case 'token_other':
      case 'route_other':
        refusals.push(refusal('INSTRUCTION_NOT_ALLOWED', summarize(entry), at));
        break;
      case 'token_transfer':
        refusals.push(
          refusal(
            'UNEXPECTED_TRANSFER',
            `token transfer to ${d.destination} is not part of the plan`,
            at,
          ),
        );
        break;
      case 'token_approve':
        refusals.push(refusal('DELEGATE_APPROVAL', summarize(entry), at));
        break;
      case 'token_revoke':
      case 'token_set_authority':
        refusals.push(refusal('AUTHORITY_CHANGE', summarize(entry), at));
        break;
      case 'token_close_account':
        refusals.push(refusal('ACCOUNT_CLOSURE', summarize(entry), at));
        break;
      case 'ata_create': {
        const expected = allowedCreations.get(d.ata);
        if (
          !expected ||
          d.owner !== owner ||
          d.payer !== owner ||
          d.mint !== expected.mint ||
          d.tokenProgram !== expected.program ||
          !d.idempotent ||
          accountsCreated.includes(d.ata)
        ) {
          refusals.push(
            refusal(
              'ACCOUNT_CREATION_NOT_ALLOWED',
              'only one idempotent creation of the owner’s own token account for one of the plan’s mints, paid by the owner, is allowed',
              at,
            ),
          );
        } else {
          accountsCreated.push(d.ata);
        }
        break;
      }
      case 'route_swap': {
        swapsSeen.push(at);
        if (routeProgramVerdict(d.programId, plan.mode) !== 'allowed') {
          refusals.push(
            refusal(
              'PROGRAM_NOT_ALLOWED',
              `route program ${d.programId} is not reviewed for ${plan.mode} plans`,
              at,
            ),
          );
        }
        // The leg this swap serves: same mints, not yet matched.
        const candidate = legs.find(
          (l) =>
            l.leg.inputMint === d.inputMint &&
            l.leg.outputMint === d.outputMint &&
            !matched.has(l.leg.legIndex),
        );
        if (!candidate) {
          const duplicate = legs.find(
            (l) => l.leg.inputMint === d.inputMint && l.leg.outputMint === d.outputMint,
          );
          refusals.push(
            duplicate
              ? refusal(
                  'ROUTE_DUPLICATED',
                  `a second swap of ${d.inputMint} for ${d.outputMint}; the plan has one leg for that pair`,
                  at,
                )
              : refusal('MINT_MISMATCH', 'the swap’s mints match no leg of this transaction', at),
          );
          break;
        }
        const leg = candidate.leg;
        if (!leg.quote.routePlan.some((step) => step.programId === d.programId)) {
          refusals.push(
            refusal(
              'PROGRAM_NOT_ALLOWED',
              `route program ${d.programId} is not on the quoted route of ${leg.symbol}`,
              at,
            ),
          );
        }
        if (
          d.owner !== owner ||
          d.source !== candidate.source ||
          d.destination !== candidate.destination
        ) {
          refusals.push(
            refusal(
              'ROUTE_ACCOUNTS_MISMATCH',
              'the swap must spend from and pay to the owner’s own associated token accounts',
              at,
            ),
          );
        }
        if (
          d.inputTokenProgram !== candidate.inputTokenProgram ||
          d.outputTokenProgram !== candidate.outputTokenProgram
        ) {
          refusals.push(
            refusal('MINT_MISMATCH', 'the swap names another token program than the mints use', at),
          );
        }
        if (d.inAmountRaw > BigInt(leg.maxInputRaw)) {
          refusals.push(
            refusal(
              'INPUT_ABOVE_BOUND',
              `${leg.symbol}: input ${d.inAmountRaw} exceeds the approved maximum ${leg.maxInputRaw}`,
              at,
            ),
          );
        }
        if (d.minimumOutRaw < BigInt(leg.minimumOutputRaw)) {
          refusals.push(
            refusal(
              'OUTPUT_BELOW_BOUND',
              `${leg.symbol}: minimum output ${d.minimumOutRaw} is below the approved ${leg.minimumOutputRaw}`,
              at,
            ),
          );
        }
        if (d.slippageBps > leg.slippageBps) {
          refusals.push(
            refusal(
              'SLIPPAGE_ABOVE_LIMIT',
              `${leg.symbol}: slippage ${d.slippageBps} bps exceeds the approved ${leg.slippageBps} bps`,
              at,
            ),
          );
        }
        matched.set(leg.legIndex, {
          legIndex: leg.legIndex,
          side: leg.side,
          inputMint: d.inputMint,
          outputMint: d.outputMint,
          maxInputRaw: d.inAmountRaw.toString(),
          minimumOutputRaw: d.minimumOutRaw.toString(),
          sourceTokenAccount: candidate.source,
          destinationTokenAccount: candidate.destination,
        });
        break;
      }
      case 'unknown_program':
        refusals.push(refusal('PROGRAM_NOT_ALLOWED', summarize(entry), at));
        break;
    }
  }
  for (const l of legs) {
    if (!matched.has(l.leg.legIndex)) {
      refusals.push(
        refusal('ROUTE_MISSING', `no reviewed swap instruction serves ${l.leg.symbol}`),
      );
    }
  }
  if (limitCount > 1 || priceCount > 1) {
    refusals.push(
      refusal('COMPUTE_BUDGET_DUPLICATED', 'compute budget instructions may appear once each'),
    );
  }

  // Writable accounts: only the owner and the owner's token accounts of the legs.
  for (const account of accounts) {
    if (account.isWritable && !allowedWritable.has(account.pubkey)) {
      refusals.push(
        refusal(
          'UNEXPECTED_WRITABLE_ACCOUNT',
          `${account.pubkey} may be written by this transaction for no reason the plan explains`,
        ),
      );
    }
  }

  // Fees against the plan's caps.
  const nonBudget = entries.filter((entry) => entry.program !== 'compute-budget').length;
  const effectiveLimit =
    unitLimit ??
    Math.min(MAX_COMPUTE_UNITS, DEFAULT_COMPUTE_UNITS_PER_INSTRUCTION * Math.max(1, nonBudget));
  const priority = priorityFeeLamports(effectiveLimit, unitPrice);
  const priorityCap = BigInt(plan.fees.network.priorityFeeCapLamports);
  if (priority > priorityCap) {
    refusals.push(
      refusal(
        'FEE_ABOVE_CAP',
        `priority fee of up to ${priority} lamports exceeds the plan's cap ${priorityCap}`,
      ),
    );
  }
  const rent = rentExemptMinimum(TOKEN_ACCOUNT_LENGTH) * BigInt(accountsCreated.length);
  if (rent > BigInt(plan.fees.network.rentLamports)) {
    refusals.push(
      refusal(
        'FEE_ABOVE_CAP',
        `rent ${rent} exceeds the plan's allowance ${plan.fees.network.rentLamports}`,
      ),
    );
  }
  const baseFee =
    LAMPORTS_PER_SIGNATURE * BigInt(Math.max(1, message.header.numRequiredSignatures));

  const legEffects = [...matched.values()].sort((a, b) => a.legIndex - b.legIndex);
  const first = legs[0];
  const effects: TransactionEffects | null =
    legEffects.length === 0 || !first
      ? null
      : {
          side: first.leg.side,
          inputMint: first.leg.inputMint,
          maxInputRaw: legEffects
            .reduce((sum, effect) => sum + BigInt(effect.maxInputRaw), 0n)
            .toString(),
          legs: legEffects,
          accountsCreated,
          computeUnitLimit: unitLimit,
          computeUnitPriceMicroLamports: unitPrice.toString(),
          baseFeeLamports: baseFee.toString(),
          priorityFeeMaxLamports: priority.toString(),
          rentLamports: rent.toString(),
          totalLamportsMax: (baseFee + priority + rent).toString(),
          signers: [owner],
          routeProgramIds: [...new Set(swapsSeen.map((index) => entries[index]?.programId ?? ''))]
            .filter((id) => id !== '')
            .slice(0, 8),
        };

  return {
    ok: refusals.length === 0 && effects !== null,
    refusals,
    instructions: summaries,
    effects,
    accounts,
  };
}
