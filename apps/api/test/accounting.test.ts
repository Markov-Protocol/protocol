import { verifyReceipt } from '@markov/accounting';
import type {
  ErrorResponse,
  ExecutionPlan,
  ExecutionStatus,
  InstanceHoldingsResponse,
  Intent,
  JournalEntry,
  JournalListResponse,
  JournalProjectionReport,
  PreparedTransaction,
  Receipt,
  ReceiptKeysResponse,
  StrategyDraftContent,
  WalletHoldingsResponse,
} from '@markov/contracts';
import {
  base64ToBytes,
  bytesToBase64,
  type signerFromPrivateKey,
  signTransaction,
} from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, STABLECOIN, withHarness } from './support/harness.js';

/**
 * Accounting (B12) against the fixture chain: settled fills project into a
 * journal that balances per asset and changes nothing when projected
 * twice; the wallet reconciles against the chain with the funding it
 * received before the platform saw it recorded as external inflows to
 * acknowledge; an unexplained transfer out of the wallet is detected as an
 * external outflow without touching the strategy's lots; a basket lands in
 * lots attributed to the one active instance; receipts are issued once per
 * intent, kind and state, verify against the published keys, and are
 * redacted when read publicly.
 */

type Signer = ReturnType<typeof signerFromPrivateKey>;

function pair(ids: Record<string, string>): StrategyDraftContent {
  return {
    title: 'Two names',
    thesis: 'Two fixture names from two issuers.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 4500, note: null },
      { instrumentId: ids['xsa'] as string, weightBps: 4500, note: null },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    references: [],
  };
}

async function approved(
  h: Harness,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ intent: Intent; plan: ExecutionPlan }> {
  const created = await h.app.inject({
    method: 'POST',
    url: '/v1/me/intents',
    headers: bearer(token),
    payload,
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

/** Builds, signs, submits and finalizes the next transaction of an approved intent. */
async function land(
  h: Harness,
  token: string,
  intentId: string,
  signer: Signer,
): Promise<ExecutionStatus> {
  const built = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions`,
    headers: bearer(token),
  });
  expect(built.statusCode, built.body).toBe(201);
  const prepared = built.json() as PreparedTransaction;
  const signed = bytesToBase64(
    signTransaction(base64ToBytes(prepared.unsignedTransaction), signer).bytes,
  );
  const submitted = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/transactions/${prepared.transactionIndex}/submissions`,
    headers: bearer(token),
    payload: { signedTransaction: signed },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  h.chain.finalize();
  const reconciled = await h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/execution/reconciliations`,
    headers: bearer(token),
  });
  expect(reconciled.statusCode, reconciled.body).toBe(200);
  const settled = reconciled.json() as ExecutionStatus;
  expect(settled.state).toBe('FINALIZED');
  return settled;
}

const holdings = async (h: Harness, token: string, walletId: string) => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/wallets/${walletId}/holdings`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as WalletHoldingsResponse;
};
const reconcileWallet = async (h: Harness, token: string, walletId: string) => {
  const response = await h.app.inject({
    method: 'POST',
    url: `/v1/me/wallets/${walletId}/reconciliations`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as WalletHoldingsResponse;
};
const journal = async (h: Harness, token: string, walletId: string) => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/wallets/${walletId}/journal`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as JournalListResponse;
};
const project = async (h: Harness, token: string) => {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/me/journal/projections',
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as JournalProjectionReport;
};
const acknowledge = (h: Harness, token: string, entryId: string, kind: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/journal/${entryId}/acknowledgements`,
    headers: bearer(token),
    payload: { kind, note: `explained as ${kind}` },
  });
const holding = (response: WalletHoldingsResponse, asset: string) => {
  const found = response.holdings.find((entry) => entry.asset === asset);
  expect(found, `holding of ${asset}`).toBeDefined();
  return found as WalletHoldingsResponse['holdings'][number];
};
const balanced = (entries: readonly JournalEntry[]) => {
  for (const entry of entries) {
    const perAsset = new Map<string, bigint>();
    for (const line of entry.lines) {
      perAsset.set(line.asset, (perAsset.get(line.asset) ?? 0n) + BigInt(line.deltaRaw));
    }
    for (const [asset, sum] of perAsset) {
      expect(sum, `${entry.kind} entry ${entry.entryId} balances ${asset}`).toBe(0n);
    }
  }
};
const totals = (response: WalletHoldingsResponse) =>
  Object.fromEntries(response.holdings.map((entry) => [entry.asset, entry.ledgerRaw]));
const issue = (h: Harness, token: string, intentId: string, kind: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/me/intents/${intentId}/receipts`,
    headers: bearer(token),
    payload: { kind },
  });
const keys = async (h: Harness) => {
  const response = await h.app.inject({ method: 'GET', url: '/v1/receipts/keys' });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ReceiptKeysResponse;
};

describe.skipIf(adminUrl === null)('accounting API', () => {
  it('journals a settled buy once, reconciles funding as acknowledged deposits and matches the chain after the trade', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });

      // Nothing journaled yet: no holdings, no checkpoint.
      const empty = await holdings(h, alice, wallet.walletId);
      expect(empty.holdings).toEqual([]);
      expect(empty.checkpoint).toBeNull();
      expect(empty.lotPolicy).toBe('fifo');

      // The funding arrived before the platform recorded anything: the first reconciliation
      // records it as external inflows the owner has to explain, and attributes nothing to a strategy.
      const first = await reconcileWallet(h, alice, wallet.walletId);
      expect(first.checkpoint?.status).toBe('needs_review');
      expect(first.unexplainedEntryIds).toHaveLength(2);
      const sol = holding(first, 'SOL');
      expect(sol).toMatchObject({
        symbol: 'SOL',
        decimals: 9,
        ledgerRaw: '50000000',
        chainRaw: '50000000',
        differenceRaw: '0',
        status: 'needs_reconciliation',
      });
      expect(sol.attribution).toEqual([
        { instanceId: null, attribution: 'needs_reconciliation', raw: '50000000' },
      ]);
      const cash = holding(first, STABLECOIN);
      expect(cash).toMatchObject({
        ledgerRaw: '5000000000',
        chainRaw: '5000000000',
        status: 'needs_reconciliation',
      });
      const inflows = (await journal(h, alice, wallet.walletId)).entries;
      expect(inflows.map((entry) => entry.kind)).toEqual(['external_inflow', 'external_inflow']);
      expect(inflows.every((entry) => entry.attribution === 'needs_reconciliation')).toBe(true);
      expect(inflows.every((entry) => entry.source.kind === 'chain_reconciliation')).toBe(true);
      balanced(inflows);
      // A second look at an unchanged chain flags nothing twice: the checkpoint matches the
      // journal that now carries the inflows, while the holdings still wait for the explanation.
      const again = await reconcileWallet(h, alice, wallet.walletId);
      expect(again.checkpoint?.status).toBe('matched');
      expect(again.unexplainedEntryIds).toHaveLength(2);
      expect(holding(again, 'SOL').status).toBe('needs_reconciliation');
      expect((await journal(h, alice, wallet.walletId)).entries).toHaveLength(2);

      // Only a flow awaiting reconciliation can be acknowledged; acknowledged flows become wallet-level.
      for (const entryId of first.unexplainedEntryIds) {
        const acknowledged = await acknowledge(h, alice, entryId, 'deposit');
        expect(acknowledged.statusCode, acknowledged.body).toBe(200);
        const entry = acknowledged.json() as JournalEntry;
        expect(entry.attribution).toBe('unassigned');
        expect(entry.acknowledgement?.kind).toBe('deposit');
        const twice = await acknowledge(h, alice, entryId, 'deposit');
        expect(twice.statusCode).toBe(400);
        expect((twice.json() as ErrorResponse).error.code).toBe('VALIDATION_FAILED');
      }
      const explained = await holdings(h, alice, wallet.walletId);
      expect(explained.unexplainedEntryIds).toEqual([]);
      expect(holding(explained, 'SOL').status).toBe('matched');
      expect(holding(explained, STABLECOIN).attribution).toEqual([
        { instanceId: null, attribution: 'unassigned', raw: '5000000000' },
      ]);

      // A single buy settles; the projection journals it once.
      const { intent, plan } = await approved(h, alice, {
        kind: 'single_buy',
        instrumentId: ids['aero'],
        walletId: wallet.walletId,
        budget: { rawAmount: '100000000' },
        idempotencyKey: 'acct-buy-1',
      });
      const settled = await land(h, alice, intent.intentId, wallet.signer);
      const fill = settled.fills[0] as ExecutionStatus['fills'][number];
      const report = await project(h, alice);
      expect(report).toMatchObject({ fillsSeen: 1, entriesExisting: 0, lotsOpened: 1 });
      expect(report.entriesAppended).toBeGreaterThanOrEqual(2);
      const afterBuy = await holdings(h, alice, wallet.walletId);
      const bought = holding(afterBuy, fill.outputMint);
      expect(bought).toMatchObject({
        symbol: 'FXAERO',
        ledgerRaw: fill.outputReceivedRaw,
        chainRaw: null,
        status: 'unobserved',
      });
      expect(bought.attribution).toEqual([
        { instanceId: null, attribution: 'unassigned', raw: fill.outputReceivedRaw },
      ]);
      // The stablecoin moved after the last observation: stale until the next reconciliation.
      const spent = holding(afterBuy, STABLECOIN);
      expect(spent.ledgerRaw).toBe((5_000_000_000n - BigInt(fill.inputSpentRaw)).toString());
      expect(spent.status).toBe('stale');
      expect(holding(afterBuy, 'SOL').ledgerRaw).toBe(
        (50_000_000n - BigInt(fill.lamportsSpent)).toString(),
      );

      // Duplicate observations change nothing: the same fill projected again is existing, totals identical.
      const before = totals(afterBuy);
      const duplicate = await project(h, alice);
      expect(duplicate).toMatchObject({ fillsSeen: 0, entriesAppended: 0, lotsOpened: 0 });
      expect(totals(await holdings(h, alice, wallet.walletId))).toEqual(before);
      const entries = (await journal(h, alice, wallet.walletId)).entries;
      expect(entries.filter((entry) => entry.kind === 'fill')).toHaveLength(1);
      expect(entries.filter((entry) => entry.kind === 'network_fee')).toHaveLength(1);
      expect(
        entries.every((entry) => entry.lines.every((line) => /^-?\d+$/.test(line.deltaRaw))),
      ).toBe(true);
      balanced(entries);
      const fillEntry = entries.find((entry) => entry.kind === 'fill') as JournalEntry;
      expect(fillEntry.source).toMatchObject({
        kind: 'execution_fill',
        ref: `fill:${fill.signature}:${fill.legIndex}`,
      });
      expect(fillEntry.lines.map((line) => [line.account, line.asset, line.deltaRaw])).toEqual([
        ['wallet', STABLECOIN, `-${fill.inputSpentRaw}`],
        ['venue', STABLECOIN, fill.inputSpentRaw],
        ['wallet', fill.outputMint, fill.outputReceivedRaw],
        ['venue', fill.outputMint, `-${fill.outputReceivedRaw}`],
      ]);
      expect(plan.legs[0]?.maxInputRaw).toBe(fill.inputSpentRaw);

      // After the trade the chain and the journal agree on every asset: no external flow is invented.
      const matched = await reconcileWallet(h, alice, wallet.walletId);
      expect(matched.checkpoint?.status, JSON.stringify(matched.checkpoint)).toBe('matched');
      expect(matched.unexplainedEntryIds).toEqual([]);
      expect(matched.holdings.map((entry) => entry.status)).toEqual([
        'matched',
        'matched',
        'matched',
      ]);
      expect(holding(matched, fill.outputMint).chainRaw).toBe(fill.outputReceivedRaw);
      expect(h.chain.tokenBalance(owner, fill.outputMint)).toBe(BigInt(fill.outputReceivedRaw));
      expect((await journal(h, alice, wallet.walletId)).entries).toHaveLength(entries.length);

      // Another person sees none of it.
      const bob = await h.user('did:test:bob');
      const foreign = await h.app.inject({
        method: 'GET',
        url: `/v1/me/wallets/${wallet.walletId}/holdings`,
        headers: bearer(bob),
      });
      expect(foreign.statusCode).toBe(404);
    });
  }, 120_000);

  it('attributes a basket to its instance in FIFO lots and detects an unexplained transfer out without touching them', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      const owner = wallet.signer.publicKey;
      h.fund(owner, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const version = await h.freezeVersion(alice, pair(ids));
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/instances',
        headers: bearer(alice),
        payload: {
          strategyId: version.strategyId,
          versionId: version.versionId,
          walletId: wallet.walletId,
          label: 'two names',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const instanceId = (created.json() as { instanceId: string }).instanceId;

      // Funding explained first so the trade is the only movement afterwards.
      const funded = await reconcileWallet(h, alice, wallet.walletId);
      for (const entryId of funded.unexplainedEntryIds) {
        expect((await acknowledge(h, alice, entryId, 'deposit')).statusCode).toBe(200);
      }

      const { intent } = await approved(h, alice, {
        kind: 'basket_investment',
        strategyVersionId: version.versionId,
        walletId: wallet.walletId,
        budget: { rawAmount: '1000000000' },
        idempotencyKey: 'acct-basket-1',
      });
      const settled = await land(h, alice, intent.intentId, wallet.signer);
      expect(settled.fills).toHaveLength(2);
      const report = await project(h, alice);
      expect(report).toMatchObject({ fillsSeen: 2, lotsOpened: 2, lotsConsumed: 0 });

      // Each fill opened a lot attributed to the one active instance of this wallet and strategy.
      const instanceView = await h.app.inject({
        method: 'GET',
        url: `/v1/me/instances/${instanceId}/holdings`,
        headers: bearer(alice),
      });
      expect(instanceView.statusCode, instanceView.body).toBe(200);
      const attributed = instanceView.json() as InstanceHoldingsResponse;
      expect(attributed).toMatchObject({
        instanceId,
        walletId: wallet.walletId,
        strategyId: version.strategyId,
        lotPolicy: 'fifo',
      });
      expect(attributed.holdings).toHaveLength(2);
      for (const fill of settled.fills) {
        const asset = attributed.holdings.find((entry) => entry.asset === fill.outputMint);
        expect(asset?.attributedRaw).toBe(fill.outputReceivedRaw);
        expect(asset?.lots).toHaveLength(1);
        expect(asset?.lots[0]).toMatchObject({
          instanceId,
          intentId: intent.intentId,
          status: 'open',
          quantityRaw: fill.outputReceivedRaw,
          remainingRaw: fill.outputReceivedRaw,
          costAsset: STABLECOIN,
          costRaw: fill.inputSpentRaw,
        });
      }
      expect(attributed.costBasis).toEqual({
        asset: STABLECOIN,
        raw: settled.fills.reduce((sum, fill) => sum + BigInt(fill.inputSpentRaw), 0n).toString(),
      });
      const matched = await reconcileWallet(h, alice, wallet.walletId);
      expect(matched.checkpoint?.status, JSON.stringify(matched.checkpoint)).toBe('matched');
      const first = settled.fills[0] as ExecutionStatus['fills'][number];
      expect(holding(matched, first.outputMint).attribution).toEqual([
        { instanceId, attribution: 'instance', raw: first.outputReceivedRaw },
      ]);

      // Tokens leave the wallet outside the platform: the ledger detects the gap as an external
      // outflow awaiting the owner's explanation; the instance's lots are exactly as before.
      const moved = 1_000n;
      h.chain.setTokenBalance(owner, first.outputMint, BigInt(first.outputReceivedRaw) - moved);
      const detected = await reconcileWallet(h, alice, wallet.walletId);
      expect(detected.checkpoint?.status, JSON.stringify(detected.checkpoint)).toBe('needs_review');
      expect(detected.unexplainedEntryIds).toHaveLength(1);
      const gap = holding(detected, first.outputMint);
      expect(gap).toMatchObject({
        status: 'needs_reconciliation',
        ledgerRaw: (BigInt(first.outputReceivedRaw) - moved).toString(),
        chainRaw: (BigInt(first.outputReceivedRaw) - moved).toString(),
        differenceRaw: '0',
      });
      expect(gap.attribution).toEqual([
        { instanceId, attribution: 'instance', raw: first.outputReceivedRaw },
        { instanceId: null, attribution: 'needs_reconciliation', raw: `-${moved}` },
      ]);
      const checkpointRow = detected.checkpoint?.assets.find(
        (entry) => entry.asset === first.outputMint,
      );
      expect(checkpointRow).toMatchObject({
        outcome: 'external_outflow_recorded',
        differenceRaw: `-${moved}`,
        ledgerBeforeRaw: first.outputReceivedRaw,
      });
      const outflow = (await journal(h, alice, wallet.walletId)).entries.find(
        (entry) => entry.kind === 'external_outflow',
      ) as JournalEntry;
      expect(outflow.attribution).toBe('needs_reconciliation');
      expect(outflow.lines.map((line) => [line.account, line.deltaRaw])).toEqual([
        ['wallet', `-${moved}`],
        ['external', `${moved}`],
      ]);
      const untouched = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/instances/${instanceId}/holdings`,
          headers: bearer(alice),
        })
      ).json() as InstanceHoldingsResponse;
      expect(untouched.status).toBe('needs_reconciliation');
      expect(
        untouched.holdings.find((entry) => entry.asset === first.outputMint)?.attributedRaw,
      ).toBe(first.outputReceivedRaw);

      // Explained as a transfer: wallet-level, the lots still unchanged, and the next look matches.
      const acknowledged = await acknowledge(h, alice, outflow.entryId, 'transfer');
      expect(acknowledged.statusCode, acknowledged.body).toBe(200);
      const explained = await reconcileWallet(h, alice, wallet.walletId);
      expect(explained.checkpoint?.status).toBe('matched');
      expect(holding(explained, first.outputMint).attribution).toEqual([
        { instanceId, attribution: 'instance', raw: first.outputReceivedRaw },
        { instanceId: null, attribution: 'unassigned', raw: `-${moved}` },
      ]);
      expect(
        (await journal(h, alice, wallet.walletId)).entries.filter(
          (entry) => entry.kind === 'external_outflow',
        ),
      ).toHaveLength(1);
    });
  }, 120_000);

  it('issues receipts once per intent, kind and state, verifies them against the published keys and redacts public reads', async () => {
    await withHarness({ venue: 'fixture', writes: true }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.fund(wallet.signer.publicKey, { lamports: 50_000_000, stablecoinRaw: 5_000_000_000n });
      const { intent, plan } = await approved(h, alice, {
        kind: 'single_buy',
        instrumentId: ids['aero'],
        walletId: wallet.walletId,
        budget: { rawAmount: '100000000' },
        idempotencyKey: 'acct-receipt-1',
      });

      // No submission yet: only a decision receipt can be issued.
      const early = await issue(h, alice, intent.intentId, 'execution');
      expect(early.statusCode).toBe(400);
      const decision = await issue(h, alice, intent.intentId, 'decision');
      expect(decision.statusCode, decision.body).toBe(201);
      const decisionReceipt = decision.json() as Receipt;
      expect(decisionReceipt.body).toMatchObject({
        version: '1',
        kind: 'decision',
        subject: { intentId: intent.intentId, planId: plan.planId, planHash: plan.planHash },
        policy: { outcome: 'allow', policyVersion: plan.validity.evidence.policyVersion },
        hashes: { planHash: plan.planHash, messageHashes: [] },
        chain: { signatures: [], finality: 'none', slots: [] },
        fills: [],
        status: { intentState: 'AWAITING_APPROVAL', terminal: false },
        scope: {
          attests: 'record',
          settlement: 'chain_evidence',
          ownership: 'not_asserted',
          policy: 'evaluated_as_recorded',
        },
      });
      expect(decisionReceipt.ownerUserId).not.toBeNull();
      // No raw account or actor identifier is inside the signed body.
      expect(JSON.stringify(decisionReceipt.body)).not.toContain(decisionReceipt.ownerUserId);

      const settled = await land(h, alice, intent.intentId, wallet.signer);
      const fill = settled.fills[0] as ExecutionStatus['fills'][number];
      const issued = await issue(h, alice, intent.intentId, 'execution');
      expect(issued.statusCode, issued.body).toBe(201);
      const receipt = issued.json() as Receipt;
      expect(receipt.body).toMatchObject({
        kind: 'execution',
        subject: {
          intentId: intent.intentId,
          planHash: plan.planHash,
          walletAddress: intent.wallet.address,
        },
        chain: { signatures: [fill.signature], finality: 'finalized' },
        fees: { networkFeeLamports: fill.feeLamports },
        status: { intentState: 'FINALIZED', terminal: true, failure: null },
      });
      expect(receipt.body.fills).toEqual([
        {
          legIndex: fill.legIndex,
          side: 'buy',
          inputMint: fill.inputMint,
          outputMint: fill.outputMint,
          inputSpentRaw: fill.inputSpentRaw,
          outputReceivedRaw: fill.outputReceivedRaw,
          feeLamports: fill.feeLamports,
          lamportsSpent: fill.lamportsSpent,
          withinBounds: true,
          signature: fill.signature,
          slot: fill.slot,
        },
      ]);
      expect(receipt.body.hashes.messageHashes).toHaveLength(1);
      expect(receipt.signer).toMatchObject({ keyId: 'api-test-key-1', algorithm: 'ed25519' });
      expect(receipt.public).toBe(false);

      // Idempotent per intent, kind and state.
      const repeat = await issue(h, alice, intent.intentId, 'execution');
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect((repeat.json() as Receipt).canonicalHash).toBe(receipt.canonicalHash);
      expect((repeat.json() as Receipt).body.receiptId).toBe(receipt.body.receiptId);
      const listed = await h.app.inject({
        method: 'GET',
        url: `/v1/me/intents/${intent.intentId}/receipts`,
        headers: bearer(alice),
      });
      expect((listed.json() as { receipts: Receipt[] }).receipts.map((r) => r.body.kind)).toEqual([
        'decision',
        'execution',
      ]);

      // Verification needs only the receipt and the published keys.
      const published = await keys(h);
      expect(published.domain).toBe('markov-receipt/v1');
      expect(published.keys.map((key) => [key.keyId, key.status])).toEqual([
        ['api-test-key-1', 'active'],
      ]);
      const verdict = verifyReceipt(receipt, published.keys);
      expect(verdict).toMatchObject({
        valid: true,
        keyId: 'api-test-key-1',
        keyStatus: 'active',
        hashMatches: true,
        signatureValid: true,
        issues: [],
      });
      const tampered: Receipt = {
        ...receipt,
        body: {
          ...receipt.body,
          fills: receipt.body.fills.map((entry) => ({ ...entry, outputReceivedRaw: '1' })),
        },
      };
      expect(verifyReceipt(tampered, published.keys).valid).toBe(false);
      expect(verifyReceipt(tampered, published.keys).issues).toContain('HASH_MISMATCH');
      expect(verifyReceipt(receipt, []).issues).toEqual(['KEY_UNKNOWN']);

      // Private by default: unauthenticated and foreign reads see nothing; the owner and a
      // read-scoped agent see the whole receipt.
      const url = `/v1/receipts/${receipt.body.receiptId}`;
      expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(404);
      const bob = await h.user('did:test:bob');
      expect((await h.app.inject({ method: 'GET', url, headers: bearer(bob) })).statusCode).toBe(
        404,
      );
      const own = await h.app.inject({ method: 'GET', url, headers: bearer(alice) });
      expect(own.statusCode).toBe(200);
      expect((own.json() as Receipt).ownerUserId).toBe(receipt.ownerUserId);
      const agent = await h.agent(receipt.ownerUserId as string, ['portfolio:read']);
      const viaAgent = await h.app.inject({ method: 'GET', url, headers: bearer(agent) });
      expect(viaAgent.statusCode, viaAgent.body).toBe(200);
      expect((viaAgent.json() as Receipt).ownerUserId).toBe(receipt.ownerUserId);
      const agentIssue = await h.app.inject({
        method: 'POST',
        url: `/v1/me/intents/${intent.intentId}/receipts`,
        headers: bearer(agent),
        payload: { kind: 'execution' },
      });
      expect(agentIssue.statusCode).toBe(403);

      // Opted into public reading: the owner id is redacted, the signed body still verifies.
      const opened = await h.app.inject({
        method: 'POST',
        url: `/v1/me/receipts/${receipt.body.receiptId}/visibility`,
        headers: bearer(alice),
        payload: { public: true },
      });
      expect(opened.statusCode, opened.body).toBe(200);
      const publicRead = await h.app.inject({ method: 'GET', url });
      expect(publicRead.statusCode, publicRead.body).toBe(200);
      const redacted = publicRead.json() as Receipt;
      expect(redacted.ownerUserId).toBeNull();
      expect(redacted.public).toBe(true);
      expect(redacted.canonicalHash).toBe(receipt.canonicalHash);
      expect(verifyReceipt(redacted, published.keys).valid).toBe(true);
      const closed = await h.app.inject({
        method: 'POST',
        url: `/v1/me/receipts/${receipt.body.receiptId}/visibility`,
        headers: bearer(alice),
        payload: { public: false },
      });
      expect(closed.statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(404);
      const foreignToggle = await h.app.inject({
        method: 'POST',
        url: `/v1/me/receipts/${receipt.body.receiptId}/visibility`,
        headers: bearer(bob),
        payload: { public: true },
      });
      expect(foreignToggle.statusCode).toBe(404);
    });
  }, 120_000);
});
