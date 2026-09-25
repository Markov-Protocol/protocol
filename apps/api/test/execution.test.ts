import { generateKeyPairSync } from 'node:crypto';
import type {
  ErrorResponse,
  ExecutionPlan,
  ExecutionStatus,
  Intent,
  PreparedTransaction,
  SpendReservation,
  StrategyDraftContent,
} from '@markov/contracts';
import {
  encodeFixtureSwapData,
  FIXTURE_ROUTE_PROGRAM_ID,
  type VenueAdapter,
} from '@markov/planning';
import {
  BLOCKHASH_VALIDITY,
  base64ToBytes,
  bytesToBase64,
  compileLegacyMessage,
  type Instruction,
  parseTransaction,
  resolveInstructions,
  resolveMessageAccounts,
  SPL_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  signerFromPrivateKey,
  signTransaction,
  unsignedTransaction,
} from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, STABLECOIN, withHarness } from './support/harness.js';

/**
 * Execution (B10) against the fixture chain: the whole lifecycle of a buy
 * and a sell, refusals of malicious venue output before anything is shown
 * for signing, changed signatures, a lost answer after the broadcast, resends
 * of the same bytes, expiry without a trace, landing with an error, cancel
 * semantics, and the rule that no retry creates a second economic purchase.
 */

const AERO_MINT = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';

interface Approved {
  intent: Intent;
  plan: ExecutionPlan;
}

async function approvedSingle(
  h: Harness,
  token: string,
  input: {
    kind: 'single_buy' | 'single_sell';
    instrumentId: string;
    walletId: string;
    budget: string;
    key: string;
  },
): Promise<Approved> {
  const created = await h.app.inject({
    method: 'POST',
    url: '/v1/me/intents',
    headers: bearer(token),
    payload: {
      kind: input.kind,
      instrumentId: input.instrumentId,
      walletId: input.walletId,
      budget: { rawAmount: input.budget },
      idempotencyKey: input.key,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const intent = created.json() as Intent;
  const planned = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intent.intentId}/plans`,
    headers: bearer(token),
  });
  expect(planned.statusCode, planned.body).toBe(201);
  const plan = planned.json() as ExecutionPlan;
  const acknowledged = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intent.intentId}/plans/${plan.planId}/acknowledgements`,
    headers: bearer(token),
    payload: { planHash: plan.planHash, stagedAcknowledged: plan.grouping.acknowledgementRequired },
  });
  expect(acknowledged.statusCode, acknowledged.body).toBe(200);
  return { intent, plan };
}

const build = (h: Harness, token: string, intentId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions`,
    headers: bearer(token),
  });
const submit = (h: Harness, token: string, intentId: string, signed: string, index = 0) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions/${index}/submissions`,
    headers: bearer(token),
    payload: { signedTransaction: signed },
  });
const status = async (h: Harness, token: string, intentId: string): Promise<ExecutionStatus> => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/intents/${intentId}/execution`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ExecutionStatus;
};
const reconcile = async (h: Harness, token: string, intentId: string): Promise<ExecutionStatus> => {
  const response = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/execution/reconciliations`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ExecutionStatus;
};
const intentState = async (h: Harness, token: string, intentId: string): Promise<Intent> =>
  (
    await h.app.inject({ method: 'GET', url: `/v1/me/intents/${intentId}`, headers: bearer(token) })
  ).json() as Intent;

function sign(unsigned: string, signer: ReturnType<typeof signerFromPrivateKey>): string {
  return bytesToBase64(signTransaction(base64ToBytes(unsigned), signer).bytes);
}

const refusalCodes = (body: ErrorResponse): string[] =>
  (body.error.details ?? []).map((detail) => detail.message.split(':')[0] as string);

describe.skipIf(adminUrl === null)('execution API', () => {
  it('runs a buy and then a sell to finality with fills read from the landed transactions', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const me = (
        await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(alice) })
      ).json() as { user: { id: string } };
      const reader = await h.agent(me.user.id, ['portfolio:read']);

      // Nothing is built for a plan that was not acknowledged.
      const unapproved = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/intents',
          headers: bearer(alice),
          payload: {
            kind: 'single_buy',
            instrumentId: ids.aero,
            walletId: wallet.walletId,
            budget: { rawAmount: '100000000' },
            idempotencyKey: 'exec-unapproved',
          },
        })
      ).json() as Intent;
      const early = await build(h, alice, unapproved.intentId);
      expect(early.statusCode, early.body).toBe(409);
      expect((early.json() as ErrorResponse).error.code).toBe('TRANSACTION_REFUSED');
      expect(refusalCodes(early.json() as ErrorResponse)).toContain('PLAN_NOT_APPROVED');

      const { intent, plan } = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-buy-1',
      });
      const leg = plan.legs[0] as ExecutionPlan['legs'][number];
      expect(leg.side).toBe('buy');
      expect((await status(h, alice, intent.intentId)).nextAction).toBe('build');

      // Agents read; only the person builds and submits.
      expect((await build(h, reader, intent.intentId)).statusCode).toBe(403);

      const built = await build(h, alice, intent.intentId);
      expect(built.statusCode, built.body).toBe(201);
      const prepared = built.json() as PreparedTransaction;
      expect(prepared).toMatchObject({
        intentId: intent.intentId,
        planId: plan.planId,
        planHash: plan.planHash,
        transactionIndex: 0,
        batch: 0,
        legIndexes: [0],
        version: 'legacy',
        feePayer: owner,
        expectedSigner: owner,
        buildSource: 'fixture:venue',
        state: 'prepared',
        attempt: null,
      });
      expect(prepared.effects).toMatchObject({
        side: 'buy',
        inputMint: STABLECOIN,
        outputMint: AERO_MINT,
        maxInputRaw: leg.maxInputRaw,
        minimumOutputRaw: leg.minimumOutputRaw,
        signers: [owner],
        routeProgramIds: [FIXTURE_ROUTE_PROGRAM_ID],
        computeUnitLimit: 400_000,
      });
      // The owner holds no FXAERO account yet: exactly one idempotent creation, rent within the plan.
      expect(prepared.effects.accountsCreated).toHaveLength(1);
      expect(prepared.effects.rentLamports).toBe('2039280');
      expect(BigInt(prepared.effects.priorityFeeMaxLamports)).toBeLessThanOrEqual(
        BigInt(plan.fees.network.priorityFeeCapLamports),
      );
      expect(BigInt(prepared.effects.totalLamportsMax)).toBeLessThanOrEqual(
        BigInt(plan.fees.network.totalLamportsMax),
      );
      expect(prepared.instructions.map((entry) => entry.kind)).toEqual([
        'compute_unit_limit',
        'compute_unit_price',
        'ata_create',
        'route_swap',
      ]);
      expect(prepared.simulation.status).toBe('ok');
      expect(prepared.simulation.logsHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await intentState(h, alice, intent.intentId)).state).toBe('AUTHORIZED');
      const awaiting = await status(h, alice, intent.intentId);
      expect(awaiting.nextAction).toBe('sign');
      expect(awaiting.transactions.map((row) => row.transactionId)).toEqual([
        prepared.transactionId,
      ]);

      // Changed signatures: garbage, another key, and a signed transaction whose message differs.
      const garbage = await submit(h, alice, intent.intentId, bytesToBase64(new Uint8Array(40)));
      expect(garbage.statusCode).toBe(409);
      expect((garbage.json() as ErrorResponse).error.code).toBe('SIGNATURE_MISMATCH');
      const stranger = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
      const strangerBytes = parseTransaction(base64ToBytes(prepared.unsignedTransaction));
      const foreign = bytesToBase64(
        Uint8Array.from([
          ...stranger.sign(strangerBytes.messageBytes).subarray(0, 0),
          ...(() => {
            const signed = signTransaction(base64ToBytes(prepared.unsignedTransaction), {
              publicKey: owner,
              sign: (message) => stranger.sign(message),
            });
            return signed.bytes;
          })(),
        ]),
      );
      const wrongKey = await submit(h, alice, intent.intentId, foreign);
      expect(wrongKey.statusCode).toBe(409);
      expect((wrongKey.json() as ErrorResponse).error.message).toMatch(/does not verify/);
      const altered = parseTransaction(base64ToBytes(prepared.unsignedTransaction));
      const alteredMessage = compileLegacyMessage({
        feePayer: owner,
        instructions: resolveInstructions(
          altered.message,
          resolveMessageAccounts(altered.message, new Map()),
        ).map((entry, index, all) =>
          index === all.length - 1
            ? {
                ...entry,
                data: encodeFixtureSwapData({
                  inAmountRaw: BigInt(leg.maxInputRaw) * 2n,
                  minimumOutRaw: BigInt(leg.minimumOutputRaw),
                  slippageBps: leg.slippageBps,
                }),
              }
            : entry,
        ),
        recentBlockhash: altered.message.recentBlockhash,
      });
      const alteredSigned = sign(bytesToBase64(unsignedTransaction(alteredMessage)), wallet.signer);
      const changed = await submit(h, alice, intent.intentId, alteredSigned);
      expect(changed.statusCode).toBe(409);
      expect((changed.json() as ErrorResponse).error.message).toMatch(/differs from the prepared/);
      expect((await status(h, alice, intent.intentId)).attempts).toHaveLength(0);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(5_000_000_000n);

      // The real signature: persisted, broadcast once, observed to finality.
      const signed = sign(prepared.unsignedTransaction, wallet.signer);
      const submitted = await submit(h, alice, intent.intentId, signed);
      expect(submitted.statusCode, submitted.body).toBe(201);
      const afterSubmit = submitted.json() as ExecutionStatus;
      expect(afterSubmit.state).toBe('SUBMITTED');
      expect(afterSubmit.attempts).toHaveLength(1);
      const attempt = afterSubmit.attempts[0] as ExecutionStatus['attempts'][number];
      expect(attempt.state).toBe('submitted');
      expect(attempt.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
      expect(afterSubmit.transactions[0]?.state).toBe('submitted');
      expect(afterSubmit.nextAction).toBe('wait');
      // The chain moved the funds exactly once; the same bytes again answer the same attempt.
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
        5_000_000_000n - BigInt(leg.maxInputRaw),
      );
      const again = await submit(h, alice, intent.intentId, signed);
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as ExecutionStatus).attempts).toHaveLength(1);
      const rebuild = await build(h, alice, intent.intentId);
      expect(rebuild.statusCode).toBe(409);
      expect(refusalCodes(rebuild.json() as ErrorResponse)).toContain('ATTEMPT_IN_FLIGHT');
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
        5_000_000_000n - BigInt(leg.maxInputRaw),
      );

      h.chain.advance(1);
      h.clock.advance(3_000);
      const confirmed = await status(h, reader, intent.intentId);
      expect(confirmed.state).toBe('CONFIRMED');
      expect(confirmed.attempts[0]?.confirmationStatus).toBe('confirmed');
      expect(confirmed.fills).toHaveLength(0);
      h.chain.finalize();
      const finalized = await reconcile(h, alice, intent.intentId);
      expect(finalized.state).toBe('FINALIZED');
      expect(finalized.nextAction).toBe('none');
      expect(finalized.reconciliation.frozen).toBe(false);
      expect(finalized.attempts[0]).toMatchObject({ state: 'finalized', resendCount: 0 });
      expect(finalized.fills).toHaveLength(1);
      const fill = finalized.fills[0] as ExecutionStatus['fills'][number];
      expect(fill).toMatchObject({
        side: 'buy',
        inputMint: STABLECOIN,
        outputMint: AERO_MINT,
        inputSpentRaw: leg.maxInputRaw,
        outputReceivedRaw: leg.expectedOutputRaw,
        withinBounds: true,
        source: 'transaction_meta',
        signature: attempt.signature,
      });
      expect(BigInt(fill.lamportsSpent)).toBe(BigInt(fill.feeLamports) + 2_039_280n);
      expect(h.chain.tokenBalance(owner, AERO_MINT)).toBe(BigInt(leg.expectedOutputRaw));
      const reservations = (
        (
          await h.app.inject({
            method: 'GET',
            url: '/v1/me/reservations',
            headers: bearer(alice),
          })
        ).json() as { reservations: SpendReservation[] }
      ).reservations;
      expect(reservations.map((row) => [row.intentId, row.status])).toEqual([
        [intent.intentId, 'consumed'],
      ]);
      // Terminal: the same bytes again create nothing, and the intent cannot be cancelled.
      const late = await submit(h, alice, intent.intentId, signed);
      expect(late.statusCode).toBe(200);
      expect((late.json() as ExecutionStatus).attempts).toHaveLength(1);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/intents/${intent.intentId}/cancel`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(400);

      // The sell: the instrument is the budget, the stablecoin the output.
      const sold = await approvedSingle(h, alice, {
        kind: 'single_sell',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: fill.outputReceivedRaw,
        key: 'exec-sell-1',
      });
      expect(sold.intent.budget).toMatchObject({
        mint: AERO_MINT,
        symbol: 'FXAERO',
        decimals: 6,
        rawAmount: fill.outputReceivedRaw,
      });
      const sellLeg = sold.plan.legs[0] as ExecutionPlan['legs'][number];
      expect(sold.plan.side).toBe('sell');
      expect(sellLeg).toMatchObject({
        side: 'sell',
        inputMint: AERO_MINT,
        outputMint: STABLECOIN,
        maxInputRaw: fill.outputReceivedRaw,
      });
      expect(sold.plan.funds.inputRaw).toBe(fill.outputReceivedRaw);
      const sellBuilt = await build(h, alice, sold.intent.intentId);
      expect(sellBuilt.statusCode, sellBuilt.body).toBe(201);
      const sellPrepared = sellBuilt.json() as PreparedTransaction;
      expect(sellPrepared.effects).toMatchObject({
        side: 'sell',
        inputMint: AERO_MINT,
        outputMint: STABLECOIN,
        accountsCreated: [],
      });
      const stablecoinBefore = h.chain.tokenBalance(owner, STABLECOIN);
      const sellSubmitted = await submit(
        h,
        alice,
        sold.intent.intentId,
        sign(sellPrepared.unsignedTransaction, wallet.signer),
      );
      expect(sellSubmitted.statusCode, sellSubmitted.body).toBe(201);
      h.chain.finalize();
      const sellDone = await reconcile(h, alice, sold.intent.intentId);
      expect(sellDone.state).toBe('FINALIZED');
      expect(sellDone.fills[0]).toMatchObject({
        side: 'sell',
        inputSpentRaw: fill.outputReceivedRaw,
        outputReceivedRaw: sellLeg.expectedOutputRaw,
        withinBounds: true,
      });
      expect(h.chain.tokenBalance(owner, AERO_MINT)).toBe(0n);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
        stablecoinBefore + BigInt(sellLeg.expectedOutputRaw),
      );

      // A basket plan is staged: nothing of it is built here.
      const version = await h.freezeVersion(alice, basket(ids));
      const basketIntent = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/intents',
          headers: bearer(alice),
          payload: {
            kind: 'basket_investment',
            strategyVersionId: version.versionId,
            walletId: wallet.walletId,
            budget: { rawAmount: '1000000000' },
            idempotencyKey: 'exec-basket',
          },
        })
      ).json() as Intent;
      const basketPlan = (
        await h.app.inject({
          method: 'POST',
          url: `/v1/me/intents/${basketIntent.intentId}/plans`,
          headers: bearer(alice),
        })
      ).json() as ExecutionPlan;
      await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${basketIntent.intentId}/plans/${basketPlan.planId}/acknowledgements`,
        headers: bearer(alice),
        payload: { planHash: basketPlan.planHash, stagedAcknowledged: true },
      });
      const staged = await build(h, alice, basketIntent.intentId);
      expect(staged.statusCode, staged.body).toBe(409);
      expect(refusalCodes(staged.json() as ErrorResponse)).toContain('STAGED_NOT_SUPPORTED');
    });
  }, 120_000);

  it('refuses malicious venue output before anything is stored or shown for signing', async () => {
    let tamper:
      | ((
          instructions: Instruction[],
          blockhash: string,
        ) => {
          instructions: Instruction[];
          blockhash: string;
        })
      | null = null;
    const attacker = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey).publicKey;
    const wrapVenue = (base: VenueAdapter): VenueAdapter => ({
      ...base,
      build: async (request) => {
        const honest = await (base.build as NonNullable<VenueAdapter['build']>)(request);
        if (tamper === null) {
          return honest;
        }
        const parsed = parseTransaction(base64ToBytes(honest.unsignedTransaction));
        const instructions = resolveInstructions(
          parsed.message,
          resolveMessageAccounts(parsed.message, new Map()),
        ).map((entry) => ({
          programId: entry.programId,
          accounts: entry.accounts.map((account) => ({
            pubkey: account.pubkey,
            isSigner: account.isSigner,
            isWritable: account.isWritable,
          })),
          data: entry.data,
        }));
        const tampered = tamper(instructions, parsed.message.recentBlockhash);
        return {
          ...honest,
          unsignedTransaction: bytesToBase64(
            unsignedTransaction(
              compileLegacyMessage({
                feePayer: request.owner,
                instructions: tampered.instructions,
                recentBlockhash: tampered.blockhash,
              }),
            ),
          ),
        };
      },
    });
    await withHarness({ venue: 'fixture', writes: true, wrapVenue }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const { intent, plan } = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-malicious',
      });
      const leg = plan.legs[0] as ExecutionPlan['legs'][number];
      const transfer = (to: string, lamports: bigint): Instruction => {
        const data = new Uint8Array(12);
        new DataView(data.buffer).setUint32(0, 2, true);
        new DataView(data.buffer).setBigUint64(4, lamports, true);
        return {
          programId: SYSTEM_PROGRAM_ID,
          accounts: [
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: to, isSigner: false, isWritable: true },
          ],
          data,
        };
      };
      const swapIndex = (instructions: Instruction[]) =>
        instructions.findIndex((entry) => entry.programId === FIXTURE_ROUTE_PROGRAM_ID);
      const cases: {
        name: string;
        expected: string[];
        tamper: NonNullable<typeof tamper>;
      }[] = [
        {
          name: 'a lamport transfer to an attacker',
          expected: ['UNEXPECTED_TRANSFER', 'UNEXPECTED_WRITABLE_ACCOUNT'],
          tamper: (instructions, blockhash) => ({
            instructions: [...instructions, transfer(attacker, 1_000_000n)],
            blockhash,
          }),
        },
        {
          name: 'an input above the approved maximum',
          expected: ['INPUT_ABOVE_BOUND'],
          tamper: (instructions, blockhash) => ({
            instructions: instructions.map((entry, index) =>
              index === swapIndex(instructions)
                ? {
                    ...entry,
                    data: encodeFixtureSwapData({
                      inAmountRaw: BigInt(leg.maxInputRaw) + 1n,
                      minimumOutRaw: BigInt(leg.minimumOutputRaw),
                      slippageBps: leg.slippageBps,
                    }),
                  }
                : entry,
            ),
            blockhash,
          }),
        },
        {
          name: 'a minimum output below the approved bound',
          expected: ['OUTPUT_BELOW_BOUND'],
          tamper: (instructions, blockhash) => ({
            instructions: instructions.map((entry, index) =>
              index === swapIndex(instructions)
                ? {
                    ...entry,
                    data: encodeFixtureSwapData({
                      inAmountRaw: BigInt(leg.maxInputRaw),
                      minimumOutRaw: BigInt(leg.minimumOutputRaw) - 1n,
                      slippageBps: leg.slippageBps,
                    }),
                  }
                : entry,
            ),
            blockhash,
          }),
        },
        {
          name: 'the output paid to an attacker’s account',
          expected: ['ROUTE_ACCOUNTS_MISMATCH', 'UNEXPECTED_WRITABLE_ACCOUNT'],
          tamper: (instructions, blockhash) => ({
            instructions: instructions.map((entry, index) =>
              index === swapIndex(instructions)
                ? {
                    ...entry,
                    accounts: entry.accounts.map((account, position) =>
                      position === 2 ? { ...account, pubkey: attacker } : account,
                    ),
                  }
                : entry,
            ),
            blockhash,
          }),
        },
        {
          name: 'an instruction of an unreviewed program',
          expected: ['PROGRAM_NOT_ALLOWED'],
          tamper: (instructions, blockhash) => ({
            instructions: [
              ...instructions,
              { programId: attacker, accounts: [], data: Uint8Array.of(1, 2, 3) },
            ],
            blockhash,
          }),
        },
        {
          name: 'a second signer',
          expected: ['EXTRA_SIGNER'],
          tamper: (instructions, blockhash) => ({
            instructions: instructions.map((entry, index) =>
              index === swapIndex(instructions)
                ? {
                    ...entry,
                    accounts: [
                      ...entry.accounts,
                      { pubkey: attacker, isSigner: true, isWritable: false },
                    ],
                  }
                : entry,
            ),
            blockhash,
          }),
        },
        {
          name: 'a token approval for a delegate',
          expected: ['DELEGATE_APPROVAL'],
          tamper: (instructions, blockhash) => {
            const swap = instructions[swapIndex(instructions)] as Instruction;
            const data = new Uint8Array(9);
            data[0] = 4;
            new DataView(data.buffer).setBigUint64(1, 1_000_000n, true);
            return {
              instructions: [
                ...instructions,
                {
                  programId: SPL_TOKEN_PROGRAM_ID,
                  accounts: [
                    swap.accounts[1] as Instruction['accounts'][number],
                    { pubkey: attacker, isSigner: false, isWritable: false },
                    { pubkey: owner, isSigner: true, isWritable: false },
                  ],
                  data,
                },
              ],
              blockhash,
            };
          },
        },
        {
          name: 'no swap at all',
          expected: ['ROUTE_MISSING'],
          tamper: (instructions, blockhash) => ({
            instructions: instructions.filter((_, index) => index !== swapIndex(instructions)),
            blockhash,
          }),
        },
      ];
      for (const testCase of cases) {
        tamper = testCase.tamper;
        const refused = await build(h, alice, intent.intentId);
        expect(refused.statusCode, `${testCase.name}: ${refused.body}`).toBe(409);
        const body = refused.json() as ErrorResponse;
        expect(body.error.code, testCase.name).toBe('TRANSACTION_REFUSED');
        const codes = refusalCodes(body);
        expect(codes[0], testCase.name).toBe('VALIDATION_FAILED');
        for (const expected of testCase.expected) {
          expect(codes, testCase.name).toContain(expected);
        }
        const after = await status(h, alice, intent.intentId);
        expect(after.transactions, testCase.name).toHaveLength(0);
        expect(after.state, testCase.name).toBe('AWAITING_APPROVAL');
      }
      // Another blockhash than the one requested is refused too.
      tamper = (instructions) => ({
        instructions,
        blockhash: h.chain.latestBlockhash().blockhash,
      });
      const otherBlockhash = await build(h, alice, intent.intentId);
      expect(otherBlockhash.statusCode).toBe(409);
      expect((otherBlockhash.json() as ErrorResponse).error.message).toMatch(/another blockhash/);
      // Honest output builds; nothing above left a trace.
      tamper = null;
      const honest = await build(h, alice, intent.intentId);
      expect(honest.statusCode, honest.body).toBe(201);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(5_000_000_000n);
    });
  }, 120_000);

  it('recovers from a lost answer, resends the same bytes, and never buys twice', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });

      // Timeout after broadcast: the node executed the transaction but the answer never arrived.
      const lost = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-lost',
      });
      const lostLeg = lost.plan.legs[0] as ExecutionPlan['legs'][number];
      const lostPrepared = (
        await build(h, alice, lost.intent.intentId)
      ).json() as PreparedTransaction;
      const lostSigned = sign(lostPrepared.unsignedTransaction, wallet.signer);
      h.chain.loseNextResponse = true;
      const unknown = await submit(h, alice, lost.intent.intentId, lostSigned);
      expect(unknown.statusCode, unknown.body).toBe(201);
      const unknownStatus = unknown.json() as ExecutionStatus;
      expect(unknownStatus.state).toBe('UNKNOWN_REQUIRES_RECONCILIATION');
      expect(unknownStatus.attempts[0]?.state).toBe('unknown');
      expect(unknownStatus.nextAction).toBe('reconcile');
      expect(unknownStatus.reconciliation.frozen).toBe(true);
      const spentOnce = 5_000_000_000n - BigInt(lostLeg.maxInputRaw);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(spentOnce);
      // A retry with the same bytes answers the same attempt; nothing is sent twice.
      const retry = await submit(h, alice, lost.intent.intentId, lostSigned);
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as ExecutionStatus).attempts).toHaveLength(1);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(spentOnce);
      // Reconciliation finds the signature on the node: at processed depth the intent stays frozen
      // (processed is not evidence), at confirmed depth it leaves reconciliation, and finality
      // settles it with one fill.
      const found = await reconcile(h, alice, lost.intent.intentId);
      expect(found.state).toBe('UNKNOWN_REQUIRES_RECONCILIATION');
      expect(found.attempts[0]?.state).toBe('submitted');
      expect(found.reconciliation.evidence.join(' ')).toMatch(/processed at slot/);
      h.chain.advance(1);
      const confirmedAgain = await reconcile(h, alice, lost.intent.intentId);
      expect(confirmedAgain.state).toBe('CONFIRMED');
      expect(confirmedAgain.reconciliation.frozen).toBe(false);
      h.chain.finalize();
      const settled = await reconcile(h, alice, lost.intent.intentId);
      expect(settled.state).toBe('FINALIZED');
      expect(settled.fills).toHaveLength(1);
      expect(settled.attempts).toHaveLength(1);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(spentOnce);
      expect(h.chain.tokenBalance(owner, AERO_MINT)).toBe(BigInt(lostLeg.expectedOutputRaw));

      // Accepted by the node, never landed: the same signed bytes are resent while the blockhash lives.
      const dropped = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '50000000',
        key: 'exec-dropped',
      });
      const droppedPrepared = (
        await build(h, alice, dropped.intent.intentId)
      ).json() as PreparedTransaction;
      const droppedSigned = sign(droppedPrepared.unsignedTransaction, wallet.signer);
      h.chain.dropNext = true;
      const accepted = await submit(h, alice, dropped.intent.intentId, droppedSigned);
      expect(accepted.statusCode, accepted.body).toBe(201);
      expect((accepted.json() as ExecutionStatus).state).toBe('SUBMITTED');
      const before = h.chain.tokenBalance(owner, STABLECOIN);
      h.clock.advance(3_000);
      const waiting = await reconcile(h, alice, dropped.intent.intentId);
      expect(waiting.state).toBe('SUBMITTED');
      expect(waiting.attempts[0]?.resendCount).toBe(0);
      expect(waiting.reconciliation.evidence.join(' ')).toMatch(/unknown to the node/);
      h.clock.advance(6_000);
      const resent = await reconcile(h, alice, dropped.intent.intentId);
      expect(resent.attempts[0]?.resendCount).toBe(1);
      expect(resent.reconciliation.evidence.join(' ')).toMatch(/same signed bytes were sent again/);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(
        before - BigInt((dropped.plan.legs[0] as ExecutionPlan['legs'][number]).maxInputRaw),
      );
      h.chain.finalize();
      const landed = await reconcile(h, alice, dropped.intent.intentId);
      expect(landed.state).toBe('FINALIZED');
      expect(landed.fills).toHaveLength(1);

      // Never observed and the blockhash expired: FAILED on evidence, the reservation released.
      const expired = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '50000000',
        key: 'exec-expired',
      });
      const expiredPrepared = (
        await build(h, alice, expired.intent.intentId)
      ).json() as PreparedTransaction;
      h.chain.dropNext = true;
      const gone = await submit(
        h,
        alice,
        expired.intent.intentId,
        sign(expiredPrepared.unsignedTransaction, wallet.signer),
      );
      expect(gone.statusCode, gone.body).toBe(201);
      const balanceBeforeExpiry = h.chain.tokenBalance(owner, STABLECOIN);
      h.chain.advance(BLOCKHASH_VALIDITY + 1);
      const failed = await reconcile(h, alice, expired.intent.intentId);
      expect(failed.state).toBe('FAILED');
      expect(failed.attempts[0]?.state).toBe('expired');
      expect(failed.fills).toHaveLength(0);
      expect(h.chain.tokenBalance(owner, STABLECOIN)).toBe(balanceBeforeExpiry);
      const reservations = (
        (
          await h.app.inject({
            method: 'GET',
            url: '/v1/me/reservations',
            headers: bearer(alice),
          })
        ).json() as { reservations: SpendReservation[] }
      ).reservations;
      expect(reservations.find((row) => row.intentId === expired.intent.intentId)?.status).toBe(
        'released',
      );

      // Landed with an error: FAILED with the chain's error, no fill, reservation released.
      const erroring = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '50000000',
        key: 'exec-error',
      });
      const erroringPrepared = (
        await build(h, alice, erroring.intent.intentId)
      ).json() as PreparedTransaction;
      h.chain.landNextWithError = 6000;
      const errored = await submit(
        h,
        alice,
        erroring.intent.intentId,
        sign(erroringPrepared.unsignedTransaction, wallet.signer),
      );
      expect(errored.statusCode, errored.body).toBe(201);
      h.chain.advance(2);
      const erroredStatus = await reconcile(h, alice, erroring.intent.intentId);
      expect(erroredStatus.state).toBe('FAILED');
      expect(erroredStatus.attempts[0]).toMatchObject({ state: 'failed' });
      expect(erroredStatus.attempts[0]?.chainError).toMatch(/6000|Custom/);
      expect(erroredStatus.fills).toHaveLength(0);

      // Cancel after broadcast: recorded as a request; expiry without a trace settles it as CANCELLED.
      const cancelling = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '50000000',
        key: 'exec-cancel',
      });
      const cancellingPrepared = (
        await build(h, alice, cancelling.intent.intentId)
      ).json() as PreparedTransaction;
      h.chain.dropNext = true;
      await submit(
        h,
        alice,
        cancelling.intent.intentId,
        sign(cancellingPrepared.unsignedTransaction, wallet.signer),
      );
      const requested = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${cancelling.intent.intentId}/cancel`,
        headers: bearer(alice),
      });
      expect(requested.statusCode, requested.body).toBe(200);
      expect((requested.json() as Intent).state).toBe('CANCEL_REQUESTED');
      h.chain.advance(BLOCKHASH_VALIDITY + 1);
      const cancelled = await reconcile(h, alice, cancelling.intent.intentId);
      expect(cancelled.state).toBe('CANCELLED');
      expect(cancelled.attempts[0]?.state).toBe('expired');

      // Cancel before any signature withdraws the prepared transaction.
      const withdrawn = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '50000000',
        key: 'exec-withdraw',
      });
      const withdrawnPrepared = (
        await build(h, alice, withdrawn.intent.intentId)
      ).json() as PreparedTransaction;
      const withdrawal = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${withdrawn.intent.intentId}/cancel`,
        headers: bearer(alice),
      });
      expect((withdrawal.json() as Intent).state).toBe('CANCELLED');
      const afterWithdrawal = await status(h, alice, withdrawn.intent.intentId);
      expect(afterWithdrawal.transactions[0]?.state).toBe('cancelled');
      const tooLate = await submit(
        h,
        alice,
        withdrawn.intent.intentId,
        sign(withdrawnPrepared.unsignedTransaction, wallet.signer),
      );
      expect(tooLate.statusCode).toBe(409);
      expect(refusalCodes(tooLate.json() as ErrorResponse)).toContain('PLAN_CHANGED');
    });
  }, 120_000);

  it('refuses expired transactions and plans before signing, and policy denies submission without writes', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.fund(wallet.signer.publicKey, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });

      // The blockhash expires before the signature arrives: nothing is sent; a rebuild supersedes.
      const stale = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-stale-blockhash',
      });
      const first = (await build(h, alice, stale.intent.intentId)).json() as PreparedTransaction;
      h.chain.advance(BLOCKHASH_VALIDITY + 1);
      const expiredBlockhash = await submit(
        h,
        alice,
        stale.intent.intentId,
        sign(first.unsignedTransaction, wallet.signer),
      );
      expect(expiredBlockhash.statusCode, expiredBlockhash.body).toBe(409);
      expect(refusalCodes(expiredBlockhash.json() as ErrorResponse)).toContain(
        'TRANSACTION_EXPIRED',
      );
      const afterExpiry = await status(h, alice, stale.intent.intentId);
      expect(afterExpiry.state).toBe('AUTHORIZED');
      expect(afterExpiry.transactions[0]?.state).toBe('expired');
      expect(afterExpiry.nextAction).toBe('build');
      const second = await build(h, alice, stale.intent.intentId);
      expect(second.statusCode, second.body).toBe(201);
      const rebuilt = second.json() as PreparedTransaction;
      expect(rebuilt.transactionId).not.toBe(first.transactionId);
      expect(rebuilt.recentBlockhash).not.toBe(first.recentBlockhash);
      const current = await status(h, alice, stale.intent.intentId);
      expect(current.transactions.map((row) => row.transactionId)).toEqual([rebuilt.transactionId]);
      // The superseded bytes, signed, are not the current transaction.
      const oldSigned = await submit(
        h,
        alice,
        stale.intent.intentId,
        sign(first.unsignedTransaction, wallet.signer),
      );
      expect(oldSigned.statusCode).toBe(409);
      expect((oldSigned.json() as ErrorResponse).error.code).toBe('SIGNATURE_MISMATCH');

      // The plan's validity passes before the signature arrives: the intent expires, nothing is sent.
      h.clock.advance(60_000);
      const expiredPlan = await submit(
        h,
        alice,
        stale.intent.intentId,
        sign(rebuilt.unsignedTransaction, wallet.signer),
      );
      expect(expiredPlan.statusCode, expiredPlan.body).toBe(409);
      expect((expiredPlan.json() as ErrorResponse).error.code).toBe('QUOTE_EXPIRED');
      expect((await intentState(h, alice, stale.intent.intentId)).state).toBe('EXPIRED');
      expect((await status(h, alice, stale.intent.intentId)).attempts).toHaveLength(0);
      expect(h.chain.tokenBalance(wallet.signer.publicKey, STABLECOIN)).toBe(5_000_000_000n);

      // A plan whose validity passed cannot be built on either.
      const late = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-late-plan',
      });
      h.clock.advance(60_000);
      const lateBuild = await build(h, alice, late.intent.intentId);
      expect(lateBuild.statusCode).toBe(409);
      expect((lateBuild.json() as ErrorResponse).error.code).toBe('QUOTE_EXPIRED');
    });
    await withHarness({ venue: 'fixture', writes: false }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.fund(wallet.signer.publicKey, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const { intent } = await approvedSingle(h, alice, {
        kind: 'single_buy',
        instrumentId: ids.aero,
        walletId: wallet.walletId,
        budget: '100000000',
        key: 'exec-no-writes',
      });
      const prepared = (await build(h, alice, intent.intentId)).json() as PreparedTransaction;
      const denied = await submit(
        h,
        alice,
        intent.intentId,
        sign(prepared.unsignedTransaction, wallet.signer),
      );
      expect(denied.statusCode, denied.body).toBe(403);
      const body = denied.json() as ErrorResponse;
      expect(body.error.code).toBe('POLICY_DENIED');
      expect(
        body.error.details?.some((detail) => detail.message.startsWith('EXECUTION_DISABLED')),
      ).toBe(true);
      const after = await status(h, alice, intent.intentId);
      expect(after.state).toBe('AUTHORIZED');
      expect(after.attempts).toHaveLength(0);
      expect(h.chain.tokenBalance(wallet.signer.publicKey, STABLECOIN)).toBe(5_000_000_000n);
      expect(
        (
          (
            await h.app.inject({
              method: 'GET',
              url: '/v1/me/reservations',
              headers: bearer(alice),
            })
          ).json() as { reservations: SpendReservation[] }
        ).reservations,
      ).toEqual([]);
    });
  }, 120_000);
});

function basket(ids: Record<string, string>): StrategyDraftContent {
  return {
    title: 'Two names',
    thesis: 'Two fixture names for the staged refusal.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 5000, note: null },
      { instrumentId: ids['xsa'] as string, weightBps: 5000, note: null },
    ],
    cashWeightBps: 0,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}
