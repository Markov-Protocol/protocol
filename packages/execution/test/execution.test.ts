import { generateKeyPairSync } from 'node:crypto';
import type { ExecutionPlan, PlanLeg } from '@markov/contracts';
import { FIXTURE_ROUTE_PROGRAM_ID, fixtureSwapInstruction } from '@markov/planning';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  base64ToBytes,
  bytesToBase64,
  COMPUTE_BUDGET_PROGRAM_ID,
  compileLegacyMessage,
  type Instruction,
  type Message,
  parseTransaction,
  resolveInstructions,
  resolveMessageAccounts,
  SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  serializeMessage,
  signerFromPrivateKey,
  signTransaction,
  TOKEN_2022_PROGRAM_ID,
  unsignedTransaction,
} from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import {
  checkSignedSubmission,
  decideReconciliation,
  decodeInstruction,
  fillsFromMeta,
  liveAttemptFromRows,
  priorityFeeLamports,
  reconcileAttempt,
  validateSwapTransaction,
} from '../src/index.js';

const STABLECOIN = 'GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts';
const AERO = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const BLOCKHASH = 'GcZjWRLBiCVHq6L4oaxbBwhcuRi5kAN5PwUxYpWbizCu';
const ATTACKER = 'FXAERo1111111111111111111111111111111111111';
const owner = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
const stranger = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
const ID = '2b7e6b5e-3d3a-4b0e-8f1a-5b0f0a1c2d3e';

/** A single-leg buy plan with only the fields the validator reads populated meaningfully. */
function plan(overrides: Partial<PlanLeg> = {}): ExecutionPlan {
  const leg: PlanLeg = {
    legIndex: 0,
    instrumentId: ID,
    symbol: 'FXAERO',
    issuer: 'prestocks',
    mint: AERO,
    tokenProgram: 'spl-token',
    decimals: 6,
    side: 'buy',
    weightBps: 10_000,
    inputMint: STABLECOIN,
    inputSymbol: 'USDC',
    inputDecimals: 6,
    outputMint: AERO,
    outputSymbol: 'FXAERO',
    outputDecimals: 6,
    targetInputRaw: '100000000',
    maxInputRaw: '100000000',
    expectedOutputRaw: '5463000',
    minimumOutputRaw: '5435685',
    slippageBps: 50,
    priceImpactBps: 0,
    quote: {
      schemaVersion: '1',
      venue: 'jupiter',
      mode: 'fixture',
      quoteRef: 'fixture:0000000000000000',
      inputMint: STABLECOIN,
      outputMint: AERO,
      inAmountRaw: '100000000',
      outAmountRaw: '5463000',
      otherAmountThresholdRaw: '5435685',
      slippageBps: 50,
      priceImpactBps: 0,
      routePlan: [{ programId: FIXTURE_ROUTE_PROGRAM_ID, label: 'fixture-amm', percent: 100 }],
      contextSlot: 1,
      observedAt: '2026-09-25T00:00:00.000Z',
      expiresAt: '2026-09-25T00:00:30.000Z',
      sourceRef: 'fixture:venue',
    },
    policyDecision: {
      decisionId: ID,
      outcome: 'allow',
      policyVersion: null,
      expiresAt: '2026-09-25T00:01:00.000Z',
    },
    batch: 0,
    ...overrides,
  };
  return {
    planId: ID,
    planHash: 'a'.repeat(64),
    schemaVersion: '1',
    intentId: ID,
    kind: 'single_buy',
    side: 'buy',
    mode: 'fixture',
    network: { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
    wallet: { walletId: ID, address: owner.publicKey },
    strategy: null,
    input: {
      mint: STABLECOIN,
      symbol: 'USDC',
      decimals: 6,
      budgetRaw: '100000000',
      budgetMode: 'all_in_stablecoin',
      investableRaw: '100000000',
      totalSpendRaw: '100000000',
    },
    allocation: {
      method: 'largest_remainder',
      legs: [
        {
          key: ID,
          weightBps: 10_000,
          exactFloorRaw: '100000000',
          roundingRaw: '0',
          targetRaw: '100000000',
        },
      ],
      cash: { key: 'cash', weightBps: 0, exactFloorRaw: '0', roundingRaw: '0', targetRaw: '0' },
      feeReserveRaw: '0',
      dustRaw: '0',
      investableRaw: '100000000',
      sumRaw: '100000000',
      conserved: true,
    },
    legs: [leg],
    fees: {
      feePayer: owner.publicKey,
      network: {
        unit: 'lamports',
        baseFeeLamportsPerSignature: '5000',
        signaturesPerBatch: 1,
        batches: 1,
        baseFeeLamports: '5000',
        priorityFeeCapLamports: '100000',
        rentExemptTokenAccountLamports: '2039280',
        newTokenAccounts: 1,
        rentLamports: '2039280',
        totalLamportsMax: '2144280',
      },
      protocol: { feePolicyVersion: 'beta-0', feeBps: 0, feeRaw: '0' },
    },
    grouping: {
      mode: 'atomic',
      batches: [
        {
          batch: 0,
          legIndexes: [0],
          description: 'one transaction',
          worstCaseSpentRaw: '100000000',
          remainingCashRaw: '0',
        },
      ],
      acknowledgementRequired: false,
      note: '',
    },
    bounds: {
      maxTotalInputRaw: '100000000',
      maxTotalLamports: '2144280',
      minimumOutputs: [{ legIndex: 0, mint: AERO, minimumOutputRaw: '5435685' }],
      residualCashRaw: '0',
    },
    validity: {
      quotesObservedAt: '2026-09-25T00:00:00.000Z',
      quotesExpireAt: '2026-09-25T00:00:30.000Z',
      policyExpiresAt: '2026-09-25T00:01:00.000Z',
      expiresAt: '2026-09-25T00:00:30.000Z',
      simulation: null,
      evidence: {
        eligibilityDecisionId: null,
        policyVersion: null,
        policyDecisionIds: [ID],
        quoteRefs: [],
        instrumentUpdatedAt: [],
      },
    },
    funds: {
      observedAt: '2026-09-25T00:00:00.000Z',
      slot: 1,
      stablecoinRaw: '500000000',
      inputRaw: '500000000',
      lamports: '50000000',
      sufficient: true,
      shortfalls: [],
    },
    warnings: [],
    review: {
      acknowledgedAt: '2026-09-25T00:00:01.000Z',
      acknowledgedHash: 'a'.repeat(64),
      stagedAcknowledged: false,
    },
    status: 'valid',
    createdAt: '2026-09-25T00:00:00.000Z',
  };
}

const source = associatedTokenAddress(owner.publicKey, STABLECOIN, SPL_TOKEN_PROGRAM_ID).address;
const destination = associatedTokenAddress(owner.publicKey, AERO, SPL_TOKEN_PROGRAM_ID).address;

function computeBudget(limit: number, priceMicroLamports: bigint): Instruction[] {
  const limitData = new Uint8Array(5);
  limitData[0] = 2;
  new DataView(limitData.buffer).setUint32(1, limit, true);
  const priceData = new Uint8Array(9);
  priceData[0] = 3;
  new DataView(priceData.buffer).setBigUint64(1, priceMicroLamports, true);
  return [
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: limitData },
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: priceData },
  ];
}

function ataCreate(idempotent = true): Instruction {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: false, isWritable: false },
      { pubkey: AERO, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(idempotent ? 1 : 0),
  };
}

function swap(
  args: { inAmountRaw?: bigint; minimumOutRaw?: bigint; slippageBps?: number } = {},
): Instruction {
  return fixtureSwapInstruction(
    {
      owner: owner.publicKey,
      source,
      destination,
      inputMint: STABLECOIN,
      outputMint: AERO,
      inputTokenProgram: SPL_TOKEN_PROGRAM_ID,
      outputTokenProgram: SPL_TOKEN_PROGRAM_ID,
    },
    {
      inAmountRaw: args.inAmountRaw ?? 100_000_000n,
      minimumOutRaw: args.minimumOutRaw ?? 5_435_685n,
      slippageBps: args.slippageBps ?? 50,
    },
  );
}

function honest(): Instruction[] {
  return [...computeBudget(400_000, 250n), ataCreate(), swap()];
}

function message(instructions: readonly Instruction[], feePayer = owner.publicKey): Message {
  return compileLegacyMessage({ feePayer, instructions, recentBlockhash: BLOCKHASH });
}

const expectation = () => ({
  plan: plan(),
  leg: plan().legs[0] as PlanLeg,
  owner: owner.publicKey,
  inputTokenProgram: SPL_TOKEN_PROGRAM_ID,
  outputTokenProgram: SPL_TOKEN_PROGRAM_ID,
});

function validate(instructions: readonly Instruction[]) {
  return validateSwapTransaction(
    parseTransaction(unsignedTransaction(message(instructions))),
    expectation(),
  );
}

describe('decoding', () => {
  it('names every instruction kind the validator relies on and marks the rest unknown', () => {
    const transferData = new Uint8Array(12);
    new DataView(transferData.buffer).setUint32(0, 2, true);
    new DataView(transferData.buffer).setBigUint64(4, 7n, true);
    const approve = new Uint8Array(9);
    approve[0] = 4;
    const instructions: Instruction[] = [
      ...honest(),
      {
        programId: SYSTEM_PROGRAM_ID,
        accounts: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: ATTACKER, isSigner: false, isWritable: true },
        ],
        data: transferData,
      },
      {
        programId: SPL_TOKEN_PROGRAM_ID,
        accounts: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: ATTACKER, isSigner: false, isWritable: false },
          { pubkey: owner.publicKey, isSigner: true, isWritable: false },
        ],
        data: approve,
      },
      { programId: ATTACKER, accounts: [], data: Uint8Array.of(9) },
    ];
    const compiled = message(instructions);
    const resolved = resolveInstructions(compiled, resolveMessageAccounts(compiled, new Map()));
    const kinds = resolved.map((entry) => decodeInstruction(entry).decoded.kind);
    expect(kinds).toEqual([
      'compute_unit_limit',
      'compute_unit_price',
      'ata_create',
      'route_swap',
      'system_transfer',
      'token_approve',
      'unknown_program',
    ]);
    const decodedSwap = decodeInstruction(resolved[3] as (typeof resolved)[number]).decoded;
    expect(decodedSwap).toMatchObject({
      kind: 'route_swap',
      owner: owner.publicKey,
      source,
      destination,
      inputMint: STABLECOIN,
      outputMint: AERO,
      inAmountRaw: 100_000_000n,
      minimumOutRaw: 5_435_685n,
      slippageBps: 50,
    });
  });
});

describe('validation against the plan', () => {
  it('accepts the honest build and reports its effects and bounds', () => {
    const result = validate(honest());
    expect(result.refusals).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.effects).toMatchObject({
      side: 'buy',
      inputMint: STABLECOIN,
      outputMint: AERO,
      maxInputRaw: '100000000',
      minimumOutputRaw: '5435685',
      sourceTokenAccount: source,
      destinationTokenAccount: destination,
      accountsCreated: [destination],
      computeUnitLimit: 400_000,
      computeUnitPriceMicroLamports: '250',
      baseFeeLamports: '5000',
      priorityFeeMaxLamports: '100',
      rentLamports: '2039280',
      totalLamportsMax: '2044380',
      signers: [owner.publicKey],
      routeProgramIds: [FIXTURE_ROUTE_PROGRAM_ID],
    });
    expect(result.instructions.map((entry) => entry.kind)).toEqual([
      'compute_unit_limit',
      'compute_unit_price',
      'ata_create',
      'route_swap',
    ]);
    expect(priorityFeeLamports(400_000, 250n)).toBe(100n);
    expect(priorityFeeLamports(1, 1n)).toBe(1n);
  });

  const transferTo = (to: string): Instruction => {
    const data = new Uint8Array(12);
    new DataView(data.buffer).setUint32(0, 2, true);
    new DataView(data.buffer).setBigUint64(4, 1_000n, true);
    return {
      programId: SYSTEM_PROGRAM_ID,
      accounts: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: true },
      ],
      data,
    };
  };

  const cases: { name: string; instructions: () => Instruction[]; codes: string[] }[] = [
    {
      name: 'a lamport transfer to an attacker',
      instructions: () => [...honest(), transferTo(ATTACKER)],
      codes: ['UNEXPECTED_TRANSFER', 'UNEXPECTED_WRITABLE_ACCOUNT'],
    },
    {
      name: 'an input above the bound',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ataCreate(),
        swap({ inAmountRaw: 100_000_001n }),
      ],
      codes: ['INPUT_ABOVE_BOUND'],
    },
    {
      name: 'a minimum output below the bound',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ataCreate(),
        swap({ minimumOutRaw: 5_435_684n }),
      ],
      codes: ['OUTPUT_BELOW_BOUND'],
    },
    {
      name: 'slippage above the approved',
      instructions: () => [...computeBudget(400_000, 250n), ataCreate(), swap({ slippageBps: 51 })],
      codes: ['SLIPPAGE_ABOVE_LIMIT'],
    },
    {
      name: 'no swap',
      instructions: () => [...computeBudget(400_000, 250n), ataCreate()],
      codes: ['ROUTE_MISSING'],
    },
    { name: 'two swaps', instructions: () => [...honest(), swap()], codes: ['ROUTE_DUPLICATED'] },
    {
      name: 'two compute limits',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ...computeBudget(400_000, 250n),
        ataCreate(),
        swap(),
      ],
      codes: ['COMPUTE_BUDGET_DUPLICATED'],
    },
    {
      name: 'a priority fee above the cap',
      instructions: () => [...computeBudget(1_400_000, 100_000n), ataCreate(), swap()],
      codes: ['FEE_ABOVE_CAP'],
    },
    {
      name: 'a non-idempotent account creation',
      instructions: () => [...computeBudget(400_000, 250n), ataCreate(false), swap()],
      codes: ['ACCOUNT_CREATION_NOT_ALLOWED'],
    },
    {
      name: 'the output paid to an attacker',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ataCreate(),
        {
          ...swap(),
          accounts: swap().accounts.map((account, index) =>
            index === 2 ? { ...account, pubkey: ATTACKER } : account,
          ),
        },
      ],
      codes: ['ROUTE_ACCOUNTS_MISMATCH', 'UNEXPECTED_WRITABLE_ACCOUNT'],
    },
    {
      name: 'a second signer',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ataCreate(),
        {
          ...swap(),
          accounts: [
            ...swap().accounts,
            { pubkey: stranger.publicKey, isSigner: true, isWritable: false },
          ],
        },
      ],
      codes: ['EXTRA_SIGNER'],
    },
    {
      name: 'an unreviewed program',
      instructions: () => [
        ...honest(),
        { programId: ATTACKER, accounts: [], data: Uint8Array.of(1) },
      ],
      codes: ['PROGRAM_NOT_ALLOWED'],
    },
    {
      name: 'a token approval',
      instructions: () => {
        const data = new Uint8Array(9);
        data[0] = 4;
        return [
          ...honest(),
          {
            programId: SPL_TOKEN_PROGRAM_ID,
            accounts: [
              { pubkey: source, isSigner: false, isWritable: true },
              { pubkey: ATTACKER, isSigner: false, isWritable: false },
              { pubkey: owner.publicKey, isSigner: true, isWritable: false },
            ],
            data,
          },
        ];
      },
      codes: ['DELEGATE_APPROVAL'],
    },
    {
      name: 'a closed account',
      instructions: () => [
        ...honest(),
        {
          programId: SPL_TOKEN_PROGRAM_ID,
          accounts: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: owner.publicKey, isSigner: false, isWritable: true },
            { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          ],
          data: Uint8Array.of(9),
        },
      ],
      codes: ['ACCOUNT_CLOSURE'],
    },
    {
      name: 'the wrong token program for the mint',
      instructions: () => [
        ...computeBudget(400_000, 250n),
        ataCreate(),
        {
          ...swap(),
          accounts: swap().accounts.map((account, index) =>
            index === 6 ? { ...account, pubkey: TOKEN_2022_PROGRAM_ID } : account,
          ),
        },
      ],
      codes: ['MINT_MISMATCH'],
    },
  ];
  for (const testCase of cases) {
    it(`refuses ${testCase.name}`, () => {
      const result = validate(testCase.instructions());
      expect(result.ok).toBe(false);
      for (const code of testCase.codes) {
        expect(
          result.refusals.map((refusal) => refusal.code),
          testCase.name,
        ).toContain(code);
      }
    });
  }

  it('refuses another fee payer, an unreviewed route in live mode and a swap of the wrong mints', () => {
    const foreign = validateSwapTransaction(
      parseTransaction(unsignedTransaction(message(honest(), stranger.publicKey))),
      expectation(),
    );
    expect(foreign.refusals.map((refusal) => refusal.code)).toContain('SIGNER_MISMATCH');
    const live = validateSwapTransaction(parseTransaction(unsignedTransaction(message(honest()))), {
      ...expectation(),
      plan: { ...plan(), mode: 'live' },
    });
    expect(live.refusals.map((refusal) => refusal.code)).toContain('PROGRAM_NOT_ALLOWED');
    const otherMint = validateSwapTransaction(
      parseTransaction(unsignedTransaction(message(honest()))),
      {
        ...expectation(),
        leg: { ...(plan().legs[0] as PlanLeg), outputMint: STABLECOIN, inputMint: AERO },
      },
    );
    expect(otherMint.refusals.map((refusal) => refusal.code)).toContain('MINT_MISMATCH');
  });
});

describe('signed submissions', () => {
  const prepared = unsignedTransaction(message(honest()));
  const preparedMessage = parseTransaction(prepared).messageBytes;

  it('accepts exactly the prepared message signed by the owner', () => {
    const signed = signTransaction(prepared, owner);
    const check = checkSignedSubmission({
      signedBytes: signed.bytes,
      preparedMessageBytes: preparedMessage,
      expectedSigner: owner.publicKey,
    });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.signature).toBe(signed.signature);
      expect(check.messageHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('refuses garbage, an empty slot, a stranger, another message and another signer', () => {
    const garbage = checkSignedSubmission({
      signedBytes: new Uint8Array(10),
      preparedMessageBytes: preparedMessage,
      expectedSigner: owner.publicKey,
    });
    expect(garbage).toMatchObject({ ok: false, code: 'SIGNATURE_MISMATCH' });
    const empty = checkSignedSubmission({
      signedBytes: prepared,
      preparedMessageBytes: preparedMessage,
      expectedSigner: owner.publicKey,
    });
    expect(empty.ok ? '' : empty.message).toMatch(/slot is empty/);
    const foreignKey = signTransaction(prepared, {
      publicKey: owner.publicKey,
      sign: (bytes) => stranger.sign(bytes),
    });
    const foreign = checkSignedSubmission({
      signedBytes: foreignKey.bytes,
      preparedMessageBytes: preparedMessage,
      expectedSigner: owner.publicKey,
    });
    expect(foreign.ok ? '' : foreign.message).toMatch(/does not verify/);
    const other = signTransaction(unsignedTransaction(message([...honest(), swap()])), owner);
    const altered = checkSignedSubmission({
      signedBytes: other.bytes,
      preparedMessageBytes: preparedMessage,
      expectedSigner: owner.publicKey,
    });
    expect(altered.ok ? '' : altered.message).toMatch(/differs from the prepared/);
    const otherSigner = checkSignedSubmission({
      signedBytes: signTransaction(prepared, owner).bytes,
      preparedMessageBytes: preparedMessage,
      expectedSigner: stranger.publicKey,
    });
    expect(otherSigner.ok ? '' : otherSigner.message).toMatch(/not the expected signer/);
    expect(bytesToBase64(base64ToBytes(bytesToBase64(serializeMessage(message(honest())))))).toBe(
      bytesToBase64(serializeMessage(message(honest()))),
    );
  });
});

describe('reconciliation decisions', () => {
  const now = new Date('2026-09-25T00:00:10.000Z');
  const base = {
    state: 'submitted' as const,
    lastValidBlockHeight: 1_000,
    lastSentAt: new Date('2026-09-25T00:00:00.000Z'),
    now,
  };

  it('follows the evidence table', () => {
    expect(
      decideReconciliation({ ...base, status: 'unavailable', blockHeight: 'unavailable' }).next,
    ).toBe('unknown');
    expect(
      decideReconciliation({
        ...base,
        status: { slot: 5, confirmationStatus: 'processed', err: { x: 1 } },
        blockHeight: 900,
      }).next,
    ).toBe('wait');
    expect(
      decideReconciliation({
        ...base,
        status: { slot: 5, confirmationStatus: 'confirmed', err: { x: 1 } },
        blockHeight: 900,
      }),
    ).toMatchObject({ next: 'failed', slot: 5, err: '{"x":1}' });
    expect(
      decideReconciliation({
        ...base,
        status: { slot: 5, confirmationStatus: 'processed', err: null },
        blockHeight: 900,
      }),
    ).toMatchObject({ next: 'submitted', slot: 5 });
    expect(
      decideReconciliation({
        ...base,
        status: { slot: 5, confirmationStatus: 'confirmed', err: null },
        blockHeight: 900,
      }),
    ).toMatchObject({ next: 'confirmed', slot: 5 });
    expect(
      decideReconciliation({
        ...base,
        status: { slot: 5, confirmationStatus: 'finalized', err: null },
        blockHeight: 900,
      }),
    ).toMatchObject({ next: 'finalized', slot: 5 });
    expect(decideReconciliation({ ...base, status: null, blockHeight: 'unavailable' }).next).toBe(
      'unknown',
    );
    expect(decideReconciliation({ ...base, status: null, blockHeight: 1_001 })).toMatchObject({
      next: 'expired',
      blockHeight: 1_001,
    });
    expect(decideReconciliation({ ...base, status: null, blockHeight: 1_000 }).next).toBe('resend');
    expect(
      decideReconciliation({
        ...base,
        status: null,
        blockHeight: 1_000,
        lastSentAt: new Date('2026-09-25T00:00:08.000Z'),
      }).next,
    ).toBe('wait');
    expect(
      decideReconciliation({ ...base, status: null, blockHeight: 1_000, lastSentAt: null }).next,
    ).toBe('resend');
  });

  it('applies a decision through the store and rpc ports: resend of the same bytes, then finality with a fill', async () => {
    const sent: string[] = [];
    const events: string[] = [];
    const transitions: string[] = [];
    let statuses: (null | {
      slot: number;
      confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
      err: null;
    })[] = [null];
    const rpc = {
      async getSignatureStatuses() {
        return { slot: 10, statuses };
      },
      async getBlockHeight() {
        return 500;
      },
      async sendTransaction(bytes: string) {
        sent.push(bytes);
        return 'sig';
      },
      async getTransaction() {
        return {
          slot: 12,
          blockTime: 1_700_000_000,
          err: null,
          fee: 5_000,
          accountKeys: [owner.publicKey, source, destination],
          preBalances: [10_000_000, 2_039_280, 0],
          postBalances: [7_955_720, 2_039_280, 2_039_280],
          preTokenBalances: [
            { accountIndex: 1, mint: STABLECOIN, owner: owner.publicKey, amount: '500000000' },
          ],
          postTokenBalances: [
            { accountIndex: 1, mint: STABLECOIN, owner: owner.publicKey, amount: '400000000' },
            { accountIndex: 2, mint: AERO, owner: owner.publicKey, amount: '5463000' },
          ],
        };
      },
    };
    const patches: Record<string, unknown>[] = [];
    const store = {
      async updateAttempt(_id: string, patch: Record<string, unknown>) {
        patches.push(patch);
      },
      async transitionIntent(input: { to: string }) {
        transitions.push(input.to);
        return true;
      },
      async recordFill(fill: {
        withinBounds: boolean;
        inputSpentRaw: string;
        outputReceivedRaw: string;
      }) {
        events.push(`fill:${fill.inputSpentRaw}:${fill.outputReceivedRaw}:${fill.withinBounds}`);
        return true;
      },
      async settleReservation(_id: string, outcome: string) {
        events.push(`reservation:${outcome}`);
      },
      async writeOutbox(event: { kind: string }) {
        events.push(event.kind);
      },
    };
    const attempt = liveAttemptFromRows({
      attempt: {
        id: 'a',
        intentId: 'i',
        planId: 'p',
        ownerUserId: 'u',
        transactionIndex: 0,
        signature: 'sig',
        signedTransaction: 'AAAA',
        state: 'submitted',
        lastValidBlockHeight: 1_000,
        lastSentAt: new Date('2026-09-25T00:00:00.000Z'),
        resendCount: 0,
      },
      transaction: {
        feePayer: owner.publicKey,
        legIndexes: [0],
        effects: {
          side: 'buy',
          inputMint: STABLECOIN,
          outputMint: AERO,
          maxInputRaw: '100000000',
          minimumOutputRaw: '5435685',
        },
      },
      intent: { state: 'SUBMITTED' },
    });
    expect(attempt).not.toBeNull();
    const live = attempt as NonNullable<typeof attempt>;
    const resent = await reconcileAttempt(
      { rpc, store, now: () => new Date('2026-09-25T00:00:10.000Z') },
      live,
    );
    expect(resent.next).toBe('resend');
    expect(sent).toEqual(['AAAA']);
    expect(patches.at(-1)).toMatchObject({ state: 'submitted', resendCount: 1 });
    statuses = [{ slot: 12, confirmationStatus: 'finalized', err: null }];
    const settled = await reconcileAttempt(
      { rpc, store, now: () => new Date('2026-09-25T00:00:20.000Z') },
      live,
    );
    expect(settled.next).toBe('finalized');
    expect(events).toEqual([
      'fill:100000000:5463000:true',
      'reservation:consumed',
      'execution.finalized',
    ]);
    expect(transitions.at(-1)).toBe('FINALIZED');
    expect(
      liveAttemptFromRows({
        ...{
          attempt: {
            id: 'a',
            intentId: 'i',
            planId: 'p',
            ownerUserId: 'u',
            transactionIndex: 0,
            signature: 'sig',
            signedTransaction: 'AAAA',
            state: 'finalized',
            lastValidBlockHeight: 1,
            lastSentAt: null,
            resendCount: 0,
          },
          transaction: {
            feePayer: owner.publicKey,
            legIndexes: [0],
            effects: {
              side: 'buy',
              inputMint: STABLECOIN,
              outputMint: AERO,
              maxInputRaw: '1',
              minimumOutputRaw: '1',
            },
          },
          intent: { state: 'FINALIZED' },
        },
      }),
    ).toBeNull();
  });
});

describe('fills from transaction meta', () => {
  it('attributes the owner’s balance changes to the signature and checks the bounds', () => {
    const input = {
      owner: owner.publicKey,
      feePayerIndex: 0,
      inputMint: STABLECOIN,
      outputMint: AERO,
      preTokenBalances: [
        { accountIndex: 1, mint: STABLECOIN, owner: owner.publicKey, amount: '500000000' },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: STABLECOIN, owner: owner.publicKey, amount: '400000000' },
        { accountIndex: 2, mint: AERO, owner: owner.publicKey, amount: '5463000' },
        { accountIndex: 3, mint: AERO, owner: ATTACKER, amount: '999' },
      ],
      preBalances: [10_000_000, 0, 0, 0],
      postBalances: [7_955_720, 0, 0, 0],
      fee: 5_000,
      bounds: { maxInputRaw: 100_000_000n, minimumOutputRaw: 5_435_685n },
    };
    const fill = fillsFromMeta(input);
    expect(fill).toMatchObject({
      inputSpentRaw: 100_000_000n,
      outputReceivedRaw: 5_463_000n,
      feeLamports: 5_000n,
      lamportsSpent: 2_044_280n,
      withinBounds: true,
      notes: [],
    });
    const violated = fillsFromMeta({
      ...input,
      bounds: { maxInputRaw: 99_999_999n, minimumOutputRaw: 5_463_001n },
    });
    expect(violated.withinBounds).toBe(false);
    expect(violated.notes).toHaveLength(2);
  });
});
