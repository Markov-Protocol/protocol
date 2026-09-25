import { generateKeyPairSync } from 'node:crypto';
import type { JournalEntry, Lot, ReceiptBody } from '@markov/contracts';
import { receiptSchema } from '@markov/contracts';
import { signerFromPrivateKey } from '@markov/solana-codec';
import { describe, expect, it } from 'vitest';
import {
  assertBalanced,
  attributeIntent,
  consumeFifo,
  dedupeBySourceRef,
  entriesForFill,
  entryForExternalFlow,
  isBalanced,
  JournalImbalanceError,
  openLot,
  projectAttributedBalances,
  projectBalances,
  receiptHash,
  reconcileBalances,
  remainingCostOf,
  reversalOf,
  signReceipt,
  verifyReceipt,
} from '../src/index.js';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AERO = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const OWNER = '11111111-1111-4111-8111-111111111111';
const WALLET = '22222222-2222-4222-8222-222222222222';
const CHECKPOINT = 'cccccccc-0000-4000-8000-000000000001';
const INSTANCE = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-25T12:00:00.000Z';
const SIGNATURE = '5'.repeat(87);

function fill(overrides: Partial<Parameters<typeof entriesForFill>[0]['fill']> = {}) {
  return {
    intentId: '44444444-4444-4444-8444-444444444444',
    planId: '55555555-5555-4555-8555-555555555555',
    legIndex: 0,
    signature: SIGNATURE,
    slot: 4300,
    blockTime: '2026-09-25T11:59:00.000Z',
    side: 'buy' as const,
    inputMint: USDC,
    outputMint: AERO,
    inputSpentRaw: '100000000',
    outputReceivedRaw: '5435698',
    feeLamports: '5400',
    lamportsSpent: '2044680',
    observedAt: NOW,
    ...overrides,
  };
}

const ids = (prefix: string) => ({
  fill: `${prefix}0000-0000-4000-8000-000000000001`,
  fee: `${prefix}0000-0000-4000-8000-000000000002`,
  rent: `${prefix}0000-0000-4000-8000-000000000003`,
});

function buyEntries(prefix = 'aaaaaaaa-'): JournalEntry[] {
  return entriesForFill({
    fill: fill(),
    leg: { inputSymbol: 'USDC', inputDecimals: 6, outputSymbol: 'FXAERO', outputDecimals: 6 },
    ownerUserId: OWNER,
    walletId: WALLET,
    instanceId: INSTANCE,
    attribution: 'instance',
    entryIds: ids(prefix),
    lotId: 'cccccccc-0000-4000-8000-000000000001',
    recordedAt: NOW,
  });
}

describe('journal', () => {
  it('records a fill as balanced entries per asset: swap, network fee and rent', () => {
    const entries = buyEntries();
    expect(entries.map((entry) => entry.kind)).toEqual(['fill', 'network_fee', 'rent']);
    for (const entry of entries) {
      assertBalanced(entry);
    }
    const [swap, fee, rent] = entries as [JournalEntry, JournalEntry, JournalEntry];
    expect(swap.source).toEqual({ kind: 'execution_fill', ref: `fill:${SIGNATURE}:0` });
    expect(swap.attribution).toBe('instance');
    expect(swap.instanceId).toBe(INSTANCE);
    expect(swap.lines.map((line) => [line.account, line.asset, line.deltaRaw])).toEqual([
      ['wallet', USDC, '-100000000'],
      ['venue', USDC, '100000000'],
      ['wallet', AERO, '5435698'],
      ['venue', AERO, '-5435698'],
    ]);
    expect(swap.lines.find((line) => line.asset === AERO && line.account === 'wallet')?.lotId).toBe(
      'cccccccc-0000-4000-8000-000000000001',
    );
    expect(fee.lines.map((line) => [line.account, line.deltaRaw])).toEqual([
      ['wallet', '-5400'],
      ['network_fee', '5400'],
    ]);
    expect(rent.lines.map((line) => [line.account, line.deltaRaw])).toEqual([
      ['wallet', '-2039280'],
      ['rent', '2039280'],
    ]);
    // No fee, no rent: only the swap entry.
    const bare = entriesForFill({
      fill: fill({ feeLamports: '0', lamportsSpent: '0' }),
      leg: { inputSymbol: 'USDC', inputDecimals: 6, outputSymbol: 'FXAERO', outputDecimals: 6 },
      ownerUserId: OWNER,
      walletId: WALLET,
      instanceId: null,
      attribution: 'unassigned',
      entryIds: ids('bbbbbbbb-'),
      lotId: null,
      recordedAt: NOW,
    });
    expect(bare).toHaveLength(1);
    expect(bare[0]?.instanceId).toBeNull();
  });

  it('refuses an entry that does not balance for an asset', () => {
    const [swap] = buyEntries() as [JournalEntry];
    const broken = { lines: swap.lines.slice(0, 3) };
    expect(isBalanced(broken)).toBe(false);
    expect(() => assertBalanced(broken)).toThrow(JournalImbalanceError);
    try {
      assertBalanced(broken);
    } catch (error) {
      expect((error as JournalImbalanceError).asset).toBe(AERO);
      expect((error as JournalImbalanceError).sumRaw).toBe(5435698n);
    }
    // Different assets never share an equation: a USDC line cannot offset a stock line.
    const crossed = {
      lines: [
        { ...(swap.lines[0] as JournalEntry['lines'][number]), deltaRaw: '-5' },
        { ...(swap.lines[2] as JournalEntry['lines'][number]), deltaRaw: '5' },
      ],
    };
    expect(isBalanced(crossed)).toBe(false);
  });

  it('projects balances and counts a duplicate observation once', () => {
    const once = buyEntries('aaaaaaaa-');
    const again = buyEntries('dddddddd-');
    const twice = [...once, ...again];
    expect(dedupeBySourceRef(twice)).toHaveLength(3);
    const balances = projectBalances(twice);
    expect(balances.map((balance) => [balance.asset, balance.raw.toString()])).toEqual([
      [AERO, '5435698'],
      [USDC, '-100000000'],
      ['SOL', '-2044680'],
    ]);
    expect(projectBalances(once)).toEqual(balances);
    expect(projectBalances(twice, 'venue').map((b) => b.raw.toString())).toEqual([
      '-5435698',
      '100000000',
    ]);
    const attributed = projectAttributedBalances(twice);
    expect(
      attributed
        .filter((balance) => balance.asset === AERO)
        .map((balance) => [balance.attribution, balance.instanceId, balance.raw.toString()]),
    ).toEqual([['instance', INSTANCE, '5435698']]);
  });

  it('reverses an entry line by line without rewriting it', () => {
    const [swap] = buyEntries() as [JournalEntry];
    const reversal = reversalOf(swap, {
      entryId: 'eeeeeeee-0000-4000-8000-000000000001',
      recordedAt: NOW,
      memo: 'operator correction: fill recorded against the wrong wallet',
    });
    expect(reversal.kind).toBe('correction');
    expect(reversal.reversesEntryId).toBe(swap.entryId);
    expect(reversal.source.ref).toBe(`reverse:${swap.entryId}`);
    expect(projectBalances([swap, reversal]).every((balance) => balance.raw === 0n)).toBe(true);
  });

  it('records an external flow against the external account and needs reconciliation', () => {
    const inflow = entryForExternalFlow({
      observationId: CHECKPOINT,
      entryId: 'ffffffff-0000-4000-8000-000000000001',
      ownerUserId: OWNER,
      walletId: WALLET,
      asset: USDC,
      symbol: 'USDC',
      decimals: 6,
      differenceRaw: 5_000_000_000n,
      slot: 100,
      observedAt: NOW,
      recordedAt: NOW,
    });
    expect(inflow.kind).toBe('external_inflow');
    expect(inflow.attribution).toBe('needs_reconciliation');
    expect(inflow.instanceId).toBeNull();
    expect(inflow.source.ref).toBe(`chain:${WALLET}:${CHECKPOINT}:100:${USDC}`);
    expect(inflow.lines.map((line) => [line.account, line.deltaRaw])).toEqual([
      ['wallet', '5000000000'],
      ['external', '-5000000000'],
    ]);
    const outflow = entryForExternalFlow({
      observationId: CHECKPOINT,
      entryId: 'ffffffff-0000-4000-8000-000000000002',
      ownerUserId: OWNER,
      walletId: WALLET,
      asset: AERO,
      symbol: 'FXAERO',
      decimals: 6,
      differenceRaw: -1000n,
      slot: 101,
      observedAt: NOW,
      recordedAt: NOW,
    });
    expect(outflow.kind).toBe('external_outflow');
    expect(() =>
      entryForExternalFlow({
        observationId: CHECKPOINT,
        entryId: 'ffffffff-0000-4000-8000-000000000003',
        ownerUserId: OWNER,
        walletId: WALLET,
        asset: AERO,
        symbol: 'FXAERO',
        decimals: 6,
        differenceRaw: 0n,
        slot: 101,
        observedAt: NOW,
        recordedAt: NOW,
      }),
    ).toThrow(/non-zero/);
  });
});

describe('lots', () => {
  const lot = (id: string, openedAt: string, quantity: bigint, cost: bigint): Lot =>
    openLot({
      lotId: id,
      ownerUserId: OWNER,
      walletId: WALLET,
      instanceId: INSTANCE,
      intentId: null,
      asset: AERO,
      symbol: 'FXAERO',
      decimals: 6,
      openedAt,
      quantityRaw: quantity,
      costAsset: USDC,
      costRaw: cost,
      feeLamports: 5400n,
      sourceEntryId: 'aaaaaaaa-0000-4000-8000-000000000001',
    });

  it('consumes the oldest lots first and attributes cost by integer proportion', () => {
    const lots = [
      lot('lot-b', '2026-09-25T11:00:00.000Z', 300n, 3000n),
      lot('lot-a', '2026-09-25T10:00:00.000Z', 100n, 1000n),
    ];
    const result = consumeFifo({
      lots,
      quantityRaw: 250n,
      proceedsRaw: 2_501n,
      entryId: 'sell-entry',
      consumedAt: NOW,
      consumptionIds: ['c1', 'c2', 'c3'],
    });
    expect(result.shortfallRaw).toBe(0n);
    expect(
      result.consumptions.map((c) => [c.lotId, c.quantityRaw, c.costRaw, c.proceedsRaw]),
    ).toEqual([
      ['lot-a', '100', '1000', '1000'],
      ['lot-b', '150', '1500', '1501'],
    ]);
    expect(result.costRaw).toBe(2500n);
    const byId = new Map(result.lots.map((entry) => [entry.lotId, entry]));
    expect(byId.get('lot-a')).toMatchObject({ remainingRaw: '0', status: 'closed' });
    expect(byId.get('lot-b')).toMatchObject({ remainingRaw: '150', status: 'open' });
    expect(remainingCostOf(byId.get('lot-b') as Lot)).toBe(1500n);
  });

  it('reports a shortfall when a sell exceeds the attributed lots', () => {
    const result = consumeFifo({
      lots: [lot('lot-a', NOW, 100n, 1000n)],
      quantityRaw: 150n,
      proceedsRaw: 1500n,
      entryId: 'sell-entry',
      consumedAt: NOW,
      consumptionIds: ['c1'],
    });
    expect(result.shortfallRaw).toBe(50n);
    expect(result.consumptions).toHaveLength(1);
    expect(result.consumptions[0]?.quantityRaw).toBe('100');
  });

  it('refuses a lot without quantity', () => {
    expect(() => lot('x', NOW, 0n, 0n)).toThrow(/positive quantity/);
  });
});

describe('attribution', () => {
  const instance = (id: string, walletId = WALLET, status = 'active') => ({
    instanceId: id,
    walletId,
    strategyId: 'strategy-1',
    pinnedVersionId: 'version-1',
    status,
  });

  it('attributes a basket to the one active instance of its strategy in the wallet, and nothing else', () => {
    const basket = {
      kind: 'basket_investment' as const,
      walletId: WALLET,
      strategyId: 'strategy-1',
      versionId: 'version-2',
    };
    expect(attributeIntent(basket, [instance('i1')])).toMatchObject({
      attribution: 'instance',
      instanceId: 'i1',
    });
    expect(attributeIntent(basket, [instance('i1'), instance('i2')])).toMatchObject({
      attribution: 'unassigned',
      instanceId: null,
    });
    expect(attributeIntent(basket, [instance('i1', 'other-wallet')])).toMatchObject({
      attribution: 'unassigned',
    });
    expect(attributeIntent(basket, [instance('i1', WALLET, 'archived')])).toMatchObject({
      attribution: 'unassigned',
    });
    expect(
      attributeIntent({ kind: 'single_buy', walletId: WALLET, strategyId: null, versionId: null }, [
        instance('i1'),
      ]),
    ).toMatchObject({ attribution: 'unassigned' });
  });
});

describe('reconciliation', () => {
  const base = {
    ownerUserId: OWNER,
    walletId: WALLET,
    slot: 5000,
    observedAt: NOW,
    recordedAt: NOW,
    entryIdFor: (asset: string) => `entry-${asset.slice(0, 4)}`,
  };

  it('matches when the chain agrees, and records every difference as an external flow to acknowledge', () => {
    const ledger = projectBalances(buyEntries());
    const matched = reconcileBalances({
      observationId: CHECKPOINT,
      ...base,
      ledger,
      chain: [
        { asset: USDC, raw: -100_000_000n, symbol: 'USDC', decimals: 6 },
        { asset: AERO, raw: 5_435_698n, symbol: 'FXAERO', decimals: 6 },
        { asset: 'SOL', raw: -2_044_680n, symbol: 'SOL', decimals: 9 },
      ],
      pendingFlowAssets: new Set(),
    });
    expect(matched.status).toBe('matched');
    expect(matched.entries).toHaveLength(0);
    // An unexplained transfer of 1000 raw FXAERO out of the wallet.
    const drifted = reconcileBalances({
      observationId: CHECKPOINT,
      ...base,
      ledger,
      chain: [
        { asset: USDC, raw: -100_000_000n, symbol: 'USDC', decimals: 6 },
        { asset: AERO, raw: 5_434_698n, symbol: 'FXAERO', decimals: 6 },
        { asset: 'SOL', raw: -2_044_680n, symbol: 'SOL', decimals: 9 },
      ],
      pendingFlowAssets: new Set(),
    });
    expect(drifted.status).toBe('needs_review');
    expect(drifted.entries).toHaveLength(1);
    expect(drifted.entries[0]).toMatchObject({
      kind: 'external_outflow',
      attribution: 'needs_reconciliation',
    });
    expect(drifted.assets.find((asset) => asset.asset === AERO)).toMatchObject({
      differenceRaw: -1000n,
      outcome: 'external_outflow_recorded',
    });
    // Once flagged, the same difference is not flagged again until acknowledged.
    const again = reconcileBalances({
      observationId: CHECKPOINT,
      ...base,
      ledger: projectBalances([...buyEntries(), ...drifted.entries]),
      chain: [
        { asset: USDC, raw: -100_000_000n, symbol: 'USDC', decimals: 6 },
        { asset: AERO, raw: 5_434_698n, symbol: 'FXAERO', decimals: 6 },
        { asset: 'SOL', raw: -2_044_680n, symbol: 'SOL', decimals: 9 },
      ],
      pendingFlowAssets: new Set([AERO]),
    });
    expect(again.status).toBe('matched');
    expect(again.entries).toHaveLength(0);
  });

  it('keeps an unknown asset visible and unassigned instead of journaling it', () => {
    const result = reconcileBalances({
      observationId: CHECKPOINT,
      ...base,
      ledger: [],
      chain: [
        {
          asset: 'So11111111111111111111111111111111111111112',
          raw: 7n,
          symbol: null,
          decimals: null,
        },
      ],
      pendingFlowAssets: new Set(),
    });
    expect(result.status).toBe('needs_review');
    expect(result.entries).toHaveLength(0);
    expect(result.assets[0]?.outcome).toBe('unassigned_asset');
  });
});

describe('receipts', () => {
  const key = generateKeyPairSync('ed25519').privateKey;
  const signer = signerFromPrivateKey(key);
  const receiptSigner = { keyId: 'test-2026-09', publicKey: signer.publicKey, sign: signer.sign };
  const body: ReceiptBody = {
    version: '1',
    kind: 'execution',
    receiptId: '66666666-6666-4666-8666-666666666666',
    issuedAt: NOW,
    network: { cluster: 'devnet', genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' },
    actor: { class: 'user', ref: 'c'.repeat(64) },
    subject: {
      ownerRef: 'd'.repeat(64),
      intentId: '44444444-4444-4444-8444-444444444444',
      intentKind: 'single_buy',
      planId: '55555555-5555-4555-8555-555555555555',
      planHash: 'a'.repeat(64),
      strategyVersionId: null,
      manifestHash: null,
      walletAddress: 'GcZjWRLBiCVHq6L4oaxbBwhcuRi5kAN5PwUxYpWbizCu',
      continuationOfIntentId: null,
    },
    policy: {
      policyVersion: 'beta-2026-09',
      outcome: 'allow',
      decisionIds: ['77777777-7777-4777-8777-777777777777'],
      approvedLimits: null,
      slippageBps: 50,
    },
    sources: { venue: 'jupiter', mode: 'fixture', quoteRefs: ['fixture:venue#1'] },
    hashes: { planHash: 'a'.repeat(64), messageHashes: ['b'.repeat(64)] },
    approved: {
      legs: [{ legIndex: 0, maxInputRaw: '100000000', minimumOutputRaw: '5400000' }],
      totalSpendRaw: '100000000',
      networkFeeMaxLamports: '2144280',
    },
    chain: { signatures: [SIGNATURE], finality: 'finalized', slots: [4300] },
    fills: [
      {
        legIndex: 0,
        side: 'buy',
        inputMint: USDC,
        outputMint: AERO,
        inputSpentRaw: '100000000',
        outputReceivedRaw: '5435698',
        feeLamports: '5400',
        lamportsSpent: '2044680',
        withinBounds: true,
        signature: SIGNATURE,
        slot: 4300,
      },
    ],
    fees: { networkFeeLamports: '5400', rentLamports: '2039280', protocolFeeRaw: '0' },
    timestamps: {
      intentCreatedAt: NOW,
      planCreatedAt: NOW,
      acknowledgedAt: NOW,
      firstSubmittedAt: NOW,
      settledAt: NOW,
    },
    status: { intentState: 'FINALIZED', terminal: true, failure: null, recovery: null },
    scope: {
      attests: 'record',
      settlement: 'chain_evidence',
      ownership: 'not_asserted',
      policy: 'evaluated_as_recorded',
    },
  };
  const keys = [
    {
      keyId: 'test-2026-09',
      algorithm: 'ed25519' as const,
      publicKey: signer.publicKey,
      status: 'active' as const,
      validFrom: NOW,
      validTo: null,
    },
  ];

  it('signs a canonical body and verifies it offline with the published key', () => {
    const receipt = signReceipt(body, receiptSigner);
    expect(receiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.canonicalHash).toBe(receiptHash(body));
    // Key order does not change the hash; the domain does.
    const reordered = JSON.parse(
      JSON.stringify(body, Object.keys(body).sort().reverse()),
    ) as ReceiptBody;
    expect(receiptHash({ ...reordered, ...body })).toBe(receipt.canonicalHash);
    const result = verifyReceipt(receipt, keys);
    expect(result).toMatchObject({
      valid: true,
      keyStatus: 'active',
      hashMatches: true,
      signatureValid: true,
      issues: [],
    });
    expect(result.meaning).toMatch(/settlement is established by the chain evidence/);
  });

  it('refuses a tampered body, an unknown key, another signer and a bad signature; a retired key still verifies with a note', () => {
    const receipt = signReceipt(body, receiptSigner);
    const tampered = {
      ...receipt,
      body: {
        ...receipt.body,
        fills: [{ ...receipt.body.fills[0], outputReceivedRaw: '9999999' }],
      },
    } as typeof receipt;
    expect(verifyReceipt(tampered, keys).issues).toEqual(['HASH_MISMATCH', 'SIGNATURE_INVALID']);
    expect(verifyReceipt(receipt, []).issues).toEqual(['KEY_UNKNOWN']);
    const other = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
    expect(
      verifyReceipt(receipt, [
        { ...(keys[0] as (typeof keys)[number]), publicKey: other.publicKey },
      ]).issues,
    ).toEqual(['SIGNER_MISMATCH']);
    const forged = {
      ...receipt,
      signature: signReceipt(body, { ...receiptSigner, sign: other.sign }).signature,
    };
    expect(verifyReceipt(forged, keys).issues).toEqual(['SIGNATURE_INVALID']);
    const retired = verifyReceipt(receipt, [
      { ...(keys[0] as (typeof keys)[number]), status: 'retired', validTo: NOW },
    ]);
    expect(retired).toMatchObject({ valid: true, keyStatus: 'retired', issues: ['KEY_RETIRED'] });
    expect(
      verifyReceipt({ ...receipt, body: { ...receipt.body, version: '2' } as never }, keys).issues,
    ).toEqual(['BODY_INVALID']);
  });
});
