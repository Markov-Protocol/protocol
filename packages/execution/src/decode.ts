import {
  decodeFixtureSwapData,
  FIXTURE_ROUTE_PROGRAM_ID,
  fixtureSwapAccountsOf,
  ROUTE_PROGRAM_MATRIX,
} from '@markov/planning';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ByteReader,
  COMPUTE_BUDGET_PROGRAM_ID,
  isTokenProgram,
  type ResolvedInstruction,
  SYSTEM_PROGRAM_ID,
} from '@markov/solana-codec';

/**
 * Every instruction of a built transaction, decoded into what it does.
 * Decoding is exhaustive by design: an instruction the decoder cannot name
 * is `unknown` and the validator refuses it. Program ids are compared as
 * exact strings; a program-id allowlist alone never decides anything here,
 * the decoded effect does.
 */

export type DecodedInstruction =
  | { readonly kind: 'compute_unit_limit'; readonly units: number }
  | { readonly kind: 'compute_unit_price'; readonly microLamports: bigint }
  | { readonly kind: 'compute_heap_frame'; readonly bytes: number }
  | { readonly kind: 'compute_loaded_data_limit'; readonly bytes: number }
  | { readonly kind: 'compute_other'; readonly variant: number }
  | {
      readonly kind: 'system_transfer';
      readonly from: string;
      readonly to: string;
      readonly lamports: bigint;
    }
  | { readonly kind: 'system_other'; readonly variant: number }
  | {
      readonly kind: 'ata_create';
      readonly payer: string;
      readonly ata: string;
      readonly owner: string;
      readonly mint: string;
      readonly tokenProgram: string;
      readonly idempotent: boolean;
    }
  | { readonly kind: 'ata_other'; readonly variant: number }
  | {
      readonly kind: 'token_transfer';
      readonly tokenProgram: string;
      readonly source: string;
      readonly destination: string;
      readonly authority: string;
      readonly amount: bigint;
      readonly mint: string | null;
    }
  | { readonly kind: 'token_approve'; readonly tokenProgram: string; readonly delegate: string }
  | { readonly kind: 'token_revoke'; readonly tokenProgram: string }
  | { readonly kind: 'token_set_authority'; readonly tokenProgram: string }
  | {
      readonly kind: 'token_close_account';
      readonly tokenProgram: string;
      readonly account: string;
    }
  | { readonly kind: 'token_sync_native'; readonly tokenProgram: string }
  | { readonly kind: 'token_initialize_account'; readonly tokenProgram: string }
  | { readonly kind: 'token_other'; readonly tokenProgram: string; readonly variant: number }
  | {
      readonly kind: 'route_swap';
      readonly programId: string;
      readonly label: string;
      readonly owner: string;
      readonly source: string;
      readonly destination: string;
      readonly inputMint: string;
      readonly outputMint: string;
      readonly inputTokenProgram: string;
      readonly outputTokenProgram: string;
      readonly inAmountRaw: bigint;
      readonly minimumOutRaw: bigint;
      readonly slippageBps: number;
    }
  | { readonly kind: 'route_other'; readonly programId: string; readonly label: string }
  | { readonly kind: 'unknown_program'; readonly programId: string };

export interface DecodedEntry {
  readonly index: number;
  readonly programId: string;
  readonly program: string;
  readonly decoded: DecodedInstruction;
  readonly accounts: ResolvedInstruction['accounts'];
}

function u32(data: Uint8Array, offset: number): number {
  return new ByteReader(data.subarray(offset, offset + 4)).u32();
}

function u64(data: Uint8Array, offset: number): bigint {
  return new ByteReader(data.subarray(offset, offset + 8)).u64();
}

function key(instruction: ResolvedInstruction, position: number): string | null {
  return instruction.accounts[position]?.pubkey ?? null;
}

function decodeComputeBudget(data: Uint8Array): DecodedInstruction {
  const variant = data[0] ?? -1;
  if (variant === 2 && data.length === 5) {
    return { kind: 'compute_unit_limit', units: u32(data, 1) };
  }
  if (variant === 3 && data.length === 9) {
    return { kind: 'compute_unit_price', microLamports: u64(data, 1) };
  }
  if (variant === 1 && data.length === 5) {
    return { kind: 'compute_heap_frame', bytes: u32(data, 1) };
  }
  if (variant === 4 && data.length === 5) {
    return { kind: 'compute_loaded_data_limit', bytes: u32(data, 1) };
  }
  return { kind: 'compute_other', variant };
}

function decodeSystem(instruction: ResolvedInstruction): DecodedInstruction {
  const { data } = instruction;
  if (data.length < 4) {
    return { kind: 'system_other', variant: -1 };
  }
  const variant = u32(data, 0);
  const from = key(instruction, 0);
  const to = key(instruction, 1);
  if (variant === 2 && data.length === 12 && from && to) {
    return { kind: 'system_transfer', from, to, lamports: u64(data, 4) };
  }
  return { kind: 'system_other', variant };
}

function decodeAssociatedToken(instruction: ResolvedInstruction): DecodedInstruction {
  const variant = instruction.data.length === 0 ? 0 : (instruction.data[0] as number);
  const payer = key(instruction, 0);
  const ata = key(instruction, 1);
  const owner = key(instruction, 2);
  const mint = key(instruction, 3);
  const tokenProgram = key(instruction, 5);
  if ((variant === 0 || variant === 1) && payer && ata && owner && mint && tokenProgram) {
    return { kind: 'ata_create', payer, ata, owner, mint, tokenProgram, idempotent: variant === 1 };
  }
  return { kind: 'ata_other', variant };
}

function decodeToken(instruction: ResolvedInstruction): DecodedInstruction {
  const tokenProgram = instruction.programId;
  const { data } = instruction;
  const variant = data[0] ?? -1;
  switch (variant) {
    case 3: {
      const source = key(instruction, 0);
      const destination = key(instruction, 1);
      const authority = key(instruction, 2);
      if (data.length === 9 && source && destination && authority) {
        return {
          kind: 'token_transfer',
          tokenProgram,
          source,
          destination,
          authority,
          amount: u64(data, 1),
          mint: null,
        };
      }
      return { kind: 'token_other', tokenProgram, variant };
    }
    case 12: {
      const source = key(instruction, 0);
      const mint = key(instruction, 1);
      const destination = key(instruction, 2);
      const authority = key(instruction, 3);
      if (data.length === 10 && source && mint && destination && authority) {
        return {
          kind: 'token_transfer',
          tokenProgram,
          source,
          destination,
          authority,
          amount: u64(data, 1),
          mint,
        };
      }
      return { kind: 'token_other', tokenProgram, variant };
    }
    case 4:
    case 13:
      return { kind: 'token_approve', tokenProgram, delegate: key(instruction, 1) ?? 'unknown' };
    case 5:
      return { kind: 'token_revoke', tokenProgram };
    case 6:
      return { kind: 'token_set_authority', tokenProgram };
    case 9:
      return {
        kind: 'token_close_account',
        tokenProgram,
        account: key(instruction, 0) ?? 'unknown',
      };
    case 17:
      return { kind: 'token_sync_native', tokenProgram };
    case 1:
    case 16:
    case 18:
      return { kind: 'token_initialize_account', tokenProgram };
    default:
      return { kind: 'token_other', tokenProgram, variant };
  }
}

function decodeRoute(instruction: ResolvedInstruction): DecodedInstruction {
  const entry = ROUTE_PROGRAM_MATRIX.find((row) => row.programId === instruction.programId);
  if (!entry) {
    return { kind: 'unknown_program', programId: instruction.programId };
  }
  if (instruction.programId === FIXTURE_ROUTE_PROGRAM_ID) {
    const args = decodeFixtureSwapData(instruction.data);
    const accounts = fixtureSwapAccountsOf(instruction.accounts.map((account) => account.pubkey));
    if (args && accounts) {
      return {
        kind: 'route_swap',
        programId: instruction.programId,
        label: entry.label,
        ...accounts,
        inAmountRaw: args.inAmountRaw,
        minimumOutRaw: args.minimumOutRaw,
        slippageBps: args.slippageBps,
      };
    }
  }
  return { kind: 'route_other', programId: instruction.programId, label: entry.label };
}

export function programLabel(programId: string): string {
  switch (programId) {
    case SYSTEM_PROGRAM_ID:
      return 'system';
    case COMPUTE_BUDGET_PROGRAM_ID:
      return 'compute-budget';
    case ASSOCIATED_TOKEN_PROGRAM_ID:
      return 'associated-token-account';
    default: {
      if (isTokenProgram(programId)) {
        return programId.startsWith('TokenzQd') ? 'token-2022' : 'spl-token';
      }
      return ROUTE_PROGRAM_MATRIX.find((row) => row.programId === programId)?.label ?? 'unknown';
    }
  }
}

export function decodeInstruction(instruction: ResolvedInstruction): DecodedEntry {
  const programId = instruction.programId;
  let decoded: DecodedInstruction;
  if (programId === COMPUTE_BUDGET_PROGRAM_ID) {
    decoded = decodeComputeBudget(instruction.data);
  } else if (programId === SYSTEM_PROGRAM_ID) {
    decoded = decodeSystem(instruction);
  } else if (programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
    decoded = decodeAssociatedToken(instruction);
  } else if (isTokenProgram(programId)) {
    decoded = decodeToken(instruction);
  } else {
    decoded = decodeRoute(instruction);
  }
  return {
    index: instruction.index,
    programId,
    program: programLabel(programId),
    decoded,
    accounts: instruction.accounts,
  };
}

/** A one-line, credential-free description for the review and the audit trail. */
export function summarize(entry: DecodedEntry): string {
  const d = entry.decoded;
  switch (d.kind) {
    case 'compute_unit_limit':
      return `compute unit limit ${d.units}`;
    case 'compute_unit_price':
      return `compute unit price ${d.microLamports} micro-lamports`;
    case 'compute_heap_frame':
      return `heap frame ${d.bytes} bytes`;
    case 'compute_loaded_data_limit':
      return `loaded accounts data limit ${d.bytes} bytes`;
    case 'compute_other':
      return `compute budget variant ${d.variant} (not allowed)`;
    case 'system_transfer':
      return `transfer ${d.lamports} lamports from ${d.from} to ${d.to}`;
    case 'system_other':
      return `system instruction variant ${d.variant} (not allowed)`;
    case 'ata_create':
      return `${d.idempotent ? 'create (idempotent)' : 'create'} associated token account ${d.ata} for owner ${d.owner}, mint ${d.mint}, paid by ${d.payer}`;
    case 'ata_other':
      return `associated token account variant ${d.variant} (not allowed)`;
    case 'token_transfer':
      return `token transfer of ${d.amount} raw from ${d.source} to ${d.destination} by ${d.authority}`;
    case 'token_approve':
      return `token delegate approval to ${d.delegate} (not allowed)`;
    case 'token_revoke':
      return 'token delegate revocation (not allowed)';
    case 'token_set_authority':
      return 'token authority change (not allowed)';
    case 'token_close_account':
      return `token account closure of ${d.account} (not allowed)`;
    case 'token_sync_native':
      return 'sync native (not allowed)';
    case 'token_initialize_account':
      return 'token account initialization (not allowed)';
    case 'token_other':
      return `token instruction variant ${d.variant} (not allowed)`;
    case 'route_swap':
      return `${d.label} swap: spend exactly ${d.inAmountRaw} raw of ${d.inputMint} for at least ${d.minimumOutRaw} raw of ${d.outputMint} at ${d.slippageBps} bps, owner ${d.owner}`;
    case 'route_other':
      return `${d.label} instruction that is not a reviewed swap (not allowed)`;
    case 'unknown_program':
      return `instruction of unreviewed program ${d.programId} (not allowed)`;
  }
}
