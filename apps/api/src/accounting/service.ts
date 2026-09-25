import { randomUUID } from 'node:crypto';
import {
  type AssetBalance,
  type ChainBalance,
  projectBalances,
  projectFills,
  type ReceiptSigner,
  reconcileBalances,
  remainingCostOf,
  signReceipt,
} from '@markov/accounting';
import { hasScope, type Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type ExternalFlowAcknowledgementRequest,
  type Holding,
  type InstanceHoldingsResponse,
  type IntentState,
  type JournalEntry,
  type JournalListResponse,
  type JournalProjectionReport,
  LOT_ATTRIBUTION_POLICY,
  type Lot,
  RECEIPT_DOMAIN,
  RECEIPT_VERSION,
  type Receipt,
  type ReceiptBody,
  type ReceiptKeysResponse,
  type ReceiptKind,
  type ReceiptListResponse,
  type ReconciliationCheckpoint,
  type WalletHoldingsResponse,
} from '@markov/contracts';
import {
  acknowledgeJournalEntry,
  appendJournalEntries,
  createProjectionStorePort,
  type Database,
  findInstance,
  findInstrumentByMint,
  findIntent,
  findJournalEntry,
  findPlan,
  findReceipt,
  insertCheckpoint,
  insertReceipt,
  latestCheckpoint,
  listAttempts,
  listCurrentPreparedTransactions,
  listFills,
  listJournalEntries,
  listLotsForInstance,
  listLotsForWallet,
  listPendingFlowAssets,
  listReceipts,
  listReceiptsForIntent,
  listSigningKeys,
  listWallets,
  type ReceiptRow,
  recordAuditEvent,
  setReceiptPublic as setReceiptPublicRow,
  upsertSigningKey,
} from '@markov/db';
import { sha256Hex, TERMINAL_INTENT_STATES } from '@markov/planning';
import {
  decodeTokenAccount,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@markov/solana-codec';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { ApiError } from '../errors.js';
import type { PolicyService } from '../policy/service.js';

/**
 * Accounting (B12): projects settled fills into the quantity journal,
 * reconciles a wallet's journal against the chain with explicit external
 * flows and checkpoints, answers wallet and strategy-attributed holdings
 * without valuing anything, and issues canonical signed receipts whose
 * verification needs only the published keys.
 */

export const WALLET_HOLDINGS_NOTE =
  'Wallet totals are the journal against the chain; strategy-attributed totals are open lots and stay separate. Quantities are raw base units; nothing here is a valuation.' as const;
export const INSTANCE_HOLDINGS_NOTE =
  'Open lots attributed to this instance (FIFO bookkeeping, not tax advice). A token counts towards one instance only; the wallet may hold more of the asset outside it.' as const;
export const RECEIPT_KEYS_NOTE =
  'A receipt signature proves the signer attested to the record; settlement is established by the chain evidence the record references. Retired keys still verify what they signed while active.' as const;

export interface AccountingServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly policy: PolicyService;
  readonly rpcClients: readonly SolanaRpcClient[];
  readonly genesisHash: string;
  /** Null when receipts are disabled; issuing then fails closed with PROVIDER_UNAVAILABLE. */
  readonly signer: ReceiptSigner | null;
  readonly now?: () => Date;
}

export interface AccountingService {
  /** Projects settled fills into the journal (idempotent); null owner means every owner. */
  projectJournal(principal: Principal): Promise<JournalProjectionReport>;
  walletHoldings(principal: Principal, walletId: string): Promise<WalletHoldingsResponse>;
  reconcileWallet(
    principal: Principal,
    walletId: string,
    requestId: string,
  ): Promise<WalletHoldingsResponse>;
  walletJournal(principal: Principal, walletId: string): Promise<JournalListResponse>;
  acknowledgeFlow(
    principal: Principal,
    entryId: string,
    request: ExternalFlowAcknowledgementRequest,
    requestId: string,
  ): Promise<JournalEntry>;
  instanceHoldings(principal: Principal, instanceId: string): Promise<InstanceHoldingsResponse>;
  issueReceipt(
    principal: Principal,
    intentId: string,
    kind: ReceiptKind,
    requestId: string,
  ): Promise<{ receipt: Receipt; created: boolean }>;
  intentReceipts(principal: Principal, intentId: string): Promise<ReceiptListResponse>;
  listReceipts(principal: Principal): Promise<ReceiptListResponse>;
  readReceipt(principal: Principal | null, receiptId: string): Promise<Receipt>;
  setReceiptPublic(
    principal: Principal,
    receiptId: string,
    isPublic: boolean,
    requestId: string,
  ): Promise<Receipt>;
  verificationKeys(): Promise<ReceiptKeysResponse>;
  /** Records the configured signing key as active (boot); no-op without a signer. */
  registerSigningKey(): Promise<void>;
}

function ownerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError(
      'FORBIDDEN',
      'this operation requires a user session or an agent acting for one',
    );
  }
  return principal.userId;
}

const str = (value: bigint): string => value.toString();

/** Owner and actor references inside a signed receipt: irreversible commitments, never raw ids. */
export function receiptOwnerRef(ownerUserId: string): string {
  return sha256Hex('markov-receipt-owner/v1', '\u0000', ownerUserId);
}
export function receiptActorRef(actorClass: string, actorId: string): string {
  return sha256Hex('markov-receipt-actor/v1', '\u0000', actorClass, '\u0000', actorId);
}

export function createAccountingService(deps: AccountingServiceDeps): AccountingService {
  const { config, db, policy } = deps;
  const now = deps.now ?? (() => new Date());
  const rpc = deps.rpcClients[0];
  if (!rpc) {
    throw new Error('accounting service needs at least one RPC client');
  }
  const projectionStore = createProjectionStorePort(db);
  const stablecoin = config.funding.stablecoin;

  const audit = (
    principal: Principal,
    action: string,
    targetType: 'wallet' | 'journal_entry' | 'receipt' | 'intent',
    targetId: string,
    requestId: string,
    details: Record<string, unknown>,
  ) =>
    recordAuditEvent(db, {
      actorClass: principal.class,
      actorId: principal.id,
      action,
      targetType,
      targetId,
      requestId,
      details,
    });

  const requireWallet = async (userId: string, walletId: string) => {
    const wallet = (await listWallets(db, userId)).find((row) => row.id === walletId);
    if (!wallet) {
      throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
    }
    return wallet;
  };

  const project = (ownerUserId: string | null): Promise<JournalProjectionReport> =>
    projectFills({ store: projectionStore, newId: randomUUID, now }, { ownerUserId, limit: 500 });

  /** Symbol and decimals of an asset: the journal knows it, the stablecoin is configured, or the catalog names the mint. */
  const labelFor = async (
    asset: string,
    ledger: readonly AssetBalance[],
  ): Promise<{ symbol: string; decimals: number } | null> => {
    if (asset === 'SOL') {
      return { symbol: 'SOL', decimals: 9 };
    }
    const known = ledger.find((balance) => balance.asset === asset);
    if (known) {
      return { symbol: known.symbol, decimals: known.decimals };
    }
    if (stablecoin !== null && asset === stablecoin.mint) {
      return { symbol: stablecoin.symbol, decimals: stablecoin.decimals };
    }
    const instrument = await findInstrumentByMint(db, asset);
    return instrument ? { symbol: instrument.symbol, decimals: instrument.decimals } : null;
  };

  /** Lamports and every SPL and Token-2022 balance the wallet holds, summed per mint. */
  const chainBalancesOf = async (
    address: string,
    ledger: readonly AssetBalance[],
  ): Promise<{ slot: number; balances: ChainBalance[] }> => {
    const commitment = config.solana.readCommitment;
    try {
      const [sol, spl, token2022] = await Promise.all([
        rpc.getBalance(address, commitment),
        rpc.getTokenAccountsByOwner(address, { programId: SPL_TOKEN_PROGRAM_ID }, commitment),
        rpc.getTokenAccountsByOwner(address, { programId: TOKEN_2022_PROGRAM_ID }, commitment),
      ]);
      const totals = new Map<string, bigint>();
      for (const account of [...spl.accounts, ...token2022.accounts]) {
        let token: ReturnType<typeof decodeTokenAccount>;
        try {
          token = decodeTokenAccount(account.data);
        } catch {
          continue;
        }
        if (token.owner !== address) {
          continue;
        }
        totals.set(token.mint, (totals.get(token.mint) ?? 0n) + token.amount);
      }
      const balances: ChainBalance[] = [
        { asset: 'SOL', raw: BigInt(sol.lamports), symbol: 'SOL', decimals: 9 },
      ];
      for (const [mint, raw] of totals) {
        const label = await labelFor(mint, ledger);
        balances.push({
          asset: mint,
          raw,
          symbol: label?.symbol ?? null,
          decimals: label?.decimals ?? null,
        });
      }
      return { slot: Math.max(sol.slot, spl.slot, token2022.slot), balances };
    } catch (error) {
      if (error instanceof SolanaRpcError) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          `the wallet's balances could not be read (${error.kind}); nothing was reconciled`,
        );
      }
      throw error;
    }
  };

  const holdingsFor = async (
    userId: string,
    wallet: { id: string; address: string },
  ): Promise<WalletHoldingsResponse> => {
    const entries = await listJournalEntries(db, userId, wallet.id);
    const ledger = projectBalances(entries);
    const checkpoint = await latestCheckpoint(db, userId, wallet.id);
    const pending = await listPendingFlowAssets(db, userId, wallet.id);
    const pendingAssets = new Set(pending.map((row) => row.asset));
    const lots = (await listLotsForWallet(db, userId, wallet.id)).filter(
      (lot) => lot.status === 'open',
    );
    const lastEntryAt = entries.reduce(
      (latest, entry) => (entry.recordedAt > latest ? entry.recordedAt : latest),
      '',
    );
    const assets = new Set<string>([
      ...ledger.map((balance) => balance.asset),
      ...(checkpoint?.assets.map((asset) => asset.asset) ?? []),
    ]);
    const pendingByAsset = new Map<string, bigint>();
    for (const entry of entries) {
      if (entry.attribution !== 'needs_reconciliation') {
        continue;
      }
      for (const line of entry.lines) {
        if (line.account === 'wallet') {
          pendingByAsset.set(
            line.asset,
            (pendingByAsset.get(line.asset) ?? 0n) + BigInt(line.deltaRaw),
          );
        }
      }
    }
    const holdings: Holding[] = [];
    for (const asset of [...assets].sort()) {
      const balance = ledger.find((entry) => entry.asset === asset) ?? null;
      const observed = checkpoint?.assets.find((entry) => entry.asset === asset) ?? null;
      const label = balance
        ? { symbol: balance.symbol, decimals: balance.decimals }
        : ((await labelFor(asset, ledger)) ?? {
            symbol: observed?.symbol ?? asset.slice(0, 8),
            decimals: observed?.decimals ?? 0,
          });
      const ledgerRaw = balance?.raw ?? 0n;
      const chainRaw = observed === null ? null : BigInt(observed.chainRaw);
      const difference = chainRaw === null ? null : chainRaw - ledgerRaw;
      let status: Holding['status'];
      if (observed?.outcome === 'unassigned_asset') {
        status = 'unassigned_asset';
      } else if (pendingAssets.has(asset)) {
        status = 'needs_reconciliation';
      } else if (checkpoint === null || observed === null) {
        status = 'unobserved';
      } else if (difference === 0n) {
        status = 'matched';
      } else {
        // Entries recorded at or after the observation moved the journal: observe again.
        status = checkpoint.createdAt <= lastEntryAt ? 'stale' : 'needs_reconciliation';
      }
      const attribution: Holding['attribution'] = [];
      const byInstance = new Map<string, bigint>();
      for (const lot of lots) {
        if (lot.asset !== asset || lot.instanceId === null) {
          continue;
        }
        byInstance.set(
          lot.instanceId,
          (byInstance.get(lot.instanceId) ?? 0n) + BigInt(lot.remainingRaw),
        );
      }
      let attributed = 0n;
      for (const [instanceId, raw] of byInstance) {
        attribution.push({ instanceId, attribution: 'instance', raw: str(raw) });
        attributed += raw;
      }
      const pendingRaw = pendingByAsset.get(asset) ?? 0n;
      if (pendingRaw !== 0n) {
        attribution.push({
          instanceId: null,
          attribution: 'needs_reconciliation',
          raw: str(pendingRaw),
        });
      }
      const rest = ledgerRaw - attributed - pendingRaw;
      if (rest !== 0n || attribution.length === 0) {
        attribution.push({ instanceId: null, attribution: 'unassigned', raw: str(rest) });
      }
      holdings.push({
        asset,
        symbol: label.symbol,
        decimals: label.decimals,
        unit: 'raw',
        ledgerRaw: str(ledgerRaw),
        chainRaw: chainRaw === null ? null : str(chainRaw),
        observedAt: observed === null ? null : (checkpoint?.observedAt ?? null),
        status,
        differenceRaw: difference === null ? null : str(difference),
        attribution,
      });
    }
    return {
      walletId: wallet.id,
      address: wallet.address,
      network: { cluster: config.solana.cluster, genesisHash: deps.genesisHash },
      checkpoint,
      holdings,
      unexplainedEntryIds: [...new Set(pending.map((row) => row.entryId))],
      lotPolicy: LOT_ATTRIBUTION_POLICY,
      note: WALLET_HOLDINGS_NOTE,
    };
  };

  const toReceipt = (row: ReceiptRow, options: { readonly redact: boolean }): Receipt => ({
    ownerUserId: options.redact ? null : row.ownerUserId,
    body: row.body,
    canonicalHash: row.canonicalHash,
    signer: { keyId: row.keyId, algorithm: 'ed25519', publicKey: row.signerPublicKey },
    signature: row.signature,
    public: row.public,
  });

  const canReadFully = (principal: Principal | null, row: ReceiptRow): boolean => {
    if (principal === null) {
      return false;
    }
    if (principal.class === 'user') {
      return principal.userId === row.ownerUserId;
    }
    if (principal.class === 'agent') {
      return principal.userId === row.ownerUserId && hasScope(principal, 'portfolio:read');
    }
    return false;
  };

  return {
    async registerSigningKey() {
      if (deps.signer === null) {
        return;
      }
      await upsertSigningKey(db, {
        keyId: deps.signer.keyId,
        publicKey: deps.signer.publicKey,
        now: now(),
      });
    },

    async projectJournal(principal) {
      return project(ownerOf(principal));
    },

    async walletHoldings(principal, walletId) {
      const userId = ownerOf(principal);
      const wallet = await requireWallet(userId, walletId);
      await project(userId);
      return holdingsFor(userId, wallet);
    },

    async reconcileWallet(principal, walletId, requestId) {
      const userId = ownerOf(principal);
      const wallet = await requireWallet(userId, walletId);
      await project(userId);
      const at = now();
      const entries = await listJournalEntries(db, userId, wallet.id);
      const ledger = projectBalances(entries);
      const chain = await chainBalancesOf(wallet.address, ledger);
      const pending = await listPendingFlowAssets(db, userId, wallet.id);
      const checkpointId = randomUUID();
      const result = reconcileBalances({
        ownerUserId: userId,
        walletId: wallet.id,
        observationId: checkpointId,
        slot: chain.slot,
        observedAt: at.toISOString(),
        recordedAt: at.toISOString(),
        ledger,
        chain: chain.balances,
        pendingFlowAssets: new Set(pending.map((row) => row.asset)),
        entryIdFor: () => randomUUID(),
      });
      const appended = new Set(await appendJournalEntries(db, result.entries));
      const checkpoint: ReconciliationCheckpoint = await insertCheckpoint(db, {
        checkpointId,
        ownerUserId: userId,
        walletId: wallet.id,
        slot: chain.slot,
        observedAt: at.toISOString(),
        commitment: config.solana.readCommitment,
        status: result.status,
        assets: result.assets.map((asset) => ({
          asset: asset.asset,
          symbol: asset.symbol,
          decimals: asset.decimals,
          ledgerBeforeRaw: str(asset.ledgerBeforeRaw),
          chainRaw: str(asset.chainRaw),
          differenceRaw: str(asset.differenceRaw),
          outcome: asset.outcome,
          entryId:
            asset.entry !== null && appended.has(asset.entry.entryId) ? asset.entry.entryId : null,
        })),
        now: at,
      });
      await audit(principal, 'accounting.wallet.reconciled', 'wallet', wallet.id, requestId, {
        checkpointId: checkpoint.checkpointId,
        slot: chain.slot,
        status: result.status,
        externalFlows: result.entries.map((entry) => ({
          entryId: entry.entryId,
          kind: entry.kind,
          asset: entry.lines[0]?.asset ?? null,
        })),
      });
      return holdingsFor(userId, wallet);
    },

    async walletJournal(principal, walletId) {
      const userId = ownerOf(principal);
      const wallet = await requireWallet(userId, walletId);
      await project(userId);
      const entries = await listJournalEntries(db, userId, wallet.id, 200);
      return { walletId: wallet.id, entries, balancing: 'per_asset' };
    },

    async acknowledgeFlow(principal, entryId, request, requestId) {
      const userId = ownerOf(principal);
      const existing = await findJournalEntry(db, userId, entryId);
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'no journal entry with that id');
      }
      if (existing.attribution !== 'needs_reconciliation') {
        throw new ApiError(
          'VALIDATION_FAILED',
          'only an external flow awaiting reconciliation can be acknowledged',
          [{ path: 'entryId', message: `the entry is ${existing.kind} (${existing.attribution})` }],
        );
      }
      const updated = await acknowledgeJournalEntry(db, {
        ownerUserId: userId,
        entryId,
        acknowledgement: request,
        now: now(),
      });
      if (!updated) {
        throw new ApiError('PLAN_CHANGED', 'the entry changed while it was being acknowledged');
      }
      await audit(principal, 'accounting.flow.acknowledged', 'journal_entry', entryId, requestId, {
        kind: request.kind,
        entryKind: existing.kind,
      });
      return updated;
    },

    async instanceHoldings(principal, instanceId) {
      const userId = ownerOf(principal);
      const instance = await findInstance(db, userId, instanceId);
      if (!instance) {
        throw new ApiError('NOT_FOUND', 'no instance with that id');
      }
      await project(userId);
      const lots = await listLotsForInstance(db, userId, instanceId);
      const checkpoint = await latestCheckpoint(db, userId, instance.walletId);
      const pending = await listPendingFlowAssets(db, userId, instance.walletId);
      const byAsset = new Map<string, { lots: Lot[]; symbol: string; decimals: number }>();
      for (const lot of lots) {
        const bucket = byAsset.get(lot.asset) ?? {
          lots: [],
          symbol: lot.symbol,
          decimals: lot.decimals,
        };
        bucket.lots.push(lot);
        byAsset.set(lot.asset, bucket);
      }
      let costRaw = 0n;
      let costAsset: string | null = null;
      let feesLamports = 0n;
      const holdings: InstanceHoldingsResponse['holdings'] = [];
      for (const [asset, bucket] of [...byAsset.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const open = bucket.lots.filter((lot) => lot.status === 'open');
        const attributed = open.reduce((sum, lot) => sum + BigInt(lot.remainingRaw), 0n);
        for (const lot of open) {
          costRaw += remainingCostOf(lot);
          costAsset ??= lot.costAsset;
        }
        for (const lot of bucket.lots) {
          feesLamports += BigInt(lot.feeLamports);
        }
        holdings.push({
          asset,
          symbol: bucket.symbol,
          decimals: bucket.decimals,
          unit: 'raw',
          attributedRaw: str(attributed),
          lots: open.slice(0, 100),
        });
      }
      const status: InstanceHoldingsResponse['status'] =
        pending.length > 0
          ? 'needs_reconciliation'
          : checkpoint === null
            ? 'unobserved'
            : checkpoint.status === 'matched'
              ? 'reconciled'
              : 'needs_reconciliation';
      return {
        instanceId: instance.id,
        walletId: instance.walletId,
        strategyId: instance.strategyId,
        pinnedVersionId: instance.pinnedVersionId,
        status,
        holdings,
        costBasis: { asset: costAsset, raw: str(costRaw) },
        feesLamports: str(feesLamports),
        lotPolicy: LOT_ATTRIBUTION_POLICY,
        note: INSTANCE_HOLDINGS_NOTE,
      };
    },

    async issueReceipt(principal, intentId, kind, requestId) {
      const userId = ownerOf(principal);
      if (deps.signer === null) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'no receipt signing key is configured (RECEIPT_SIGNING_PROVIDER); receipts cannot be issued',
        );
      }
      if (principal.class !== 'user') {
        throw new ApiError('FORBIDDEN', 'only the person issues receipts');
      }
      const intent = await findIntent(db, userId, intentId);
      if (!intent) {
        throw new ApiError('NOT_FOUND', 'no intent with that id');
      }
      const planRow =
        intent.latestPlanId === null ? null : await findPlan(db, userId, intent.latestPlanId);
      if (!planRow) {
        throw new ApiError('VALIDATION_FAILED', 'the intent has no plan; nothing to attest', [
          { path: 'intentId', message: 'build and acknowledge a plan first' },
        ]);
      }
      if (planRow.acknowledgedHash !== planRow.planHash) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'the plan was not acknowledged by its hash; a receipt attests to a reviewed decision',
          [{ path: 'intentId', message: 'acknowledge the plan first' }],
        );
      }
      const attempts = await listAttempts(db, intent.id);
      const fills = await listFills(db, intent.id);
      const transactions = await listCurrentPreparedTransactions(db, planRow.id);
      if (kind === 'execution' && attempts.length === 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'no signed transaction of this intent was submitted; issue a decision receipt instead',
          [{ path: 'kind', message: 'execution receipts need at least one attempt' }],
        );
      }
      const limits = await policy.limits(principal);
      const plan = planRow.plan;
      const at = now();
      const state = intent.state as IntentState;
      const terminal = TERMINAL_INTENT_STATES.has(state);
      const depth = (attempt: (typeof attempts)[number]) =>
        attempt.state === 'finalized'
          ? 3
          : attempt.confirmationStatus === 'finalized'
            ? 3
            : attempt.confirmationStatus === 'confirmed' || attempt.state === 'confirmed'
              ? 2
              : attempt.confirmationStatus === 'processed'
                ? 1
                : 0;
      const finalityDepth = attempts.reduce((max, attempt) => Math.max(max, depth(attempt)), 0);
      const finality =
        (['none', 'processed', 'confirmed', 'finalized'] as const)[finalityDepth] ?? 'none';
      const submittedAts = attempts
        .map((attempt) => attempt.submittedAt)
        .filter((value): value is Date => value !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      const networkFee = fills.reduce((sum, fill) => sum + BigInt(fill.feeLamports), 0n);
      const rent = fills.reduce(
        (sum, fill) => sum + (BigInt(fill.lamportsSpent) - BigInt(fill.feeLamports)),
        0n,
      );
      const failureStates: IntentState[] = [
        'FAILED',
        'EXPIRED',
        'CANCELLED',
        'PARTIALLY_COMPLETED',
        'REJECTED',
      ];
      const body: ReceiptBody = {
        version: RECEIPT_VERSION,
        kind,
        receiptId: randomUUID(),
        issuedAt: at.toISOString(),
        network: { cluster: config.solana.cluster, genesisHash: deps.genesisHash },
        actor: { class: principal.class, ref: receiptActorRef(principal.class, principal.id) },
        subject: {
          ownerRef: receiptOwnerRef(userId),
          intentId: intent.id,
          intentKind: intent.kind as ReceiptBody['subject']['intentKind'],
          planId: planRow.id,
          planHash: planRow.planHash,
          strategyVersionId: plan.strategy?.versionId ?? null,
          manifestHash: plan.strategy?.manifestHash ?? null,
          walletAddress: intent.walletAddress,
          continuationOfIntentId: intent.continuationOfIntentId,
        },
        policy: {
          policyVersion: plan.validity.evidence.policyVersion,
          outcome: 'allow',
          decisionIds: plan.validity.evidence.policyDecisionIds,
          approvedLimits: limits.effective,
          slippageBps: intent.slippageBps,
        },
        sources: {
          venue: 'jupiter',
          mode: plan.mode,
          quoteRefs: plan.legs.map((leg) => `${leg.quote.sourceRef}#leg${leg.legIndex}`),
        },
        hashes: {
          planHash: planRow.planHash,
          messageHashes: kind === 'execution' ? transactions.map((row) => row.messageHash) : [],
        },
        approved: {
          legs: plan.legs.map((leg) => ({
            legIndex: leg.legIndex,
            maxInputRaw: leg.maxInputRaw,
            minimumOutputRaw: leg.minimumOutputRaw,
          })),
          totalSpendRaw: plan.input.totalSpendRaw,
          networkFeeMaxLamports: plan.fees.network.totalLamportsMax,
        },
        chain: {
          signatures: kind === 'execution' ? attempts.map((attempt) => attempt.signature) : [],
          finality: kind === 'execution' ? finality : 'none',
          slots:
            kind === 'execution'
              ? attempts
                  .map((attempt) => attempt.slot)
                  .filter((slot): slot is number => slot !== null)
              : [],
        },
        fills:
          kind === 'execution'
            ? fills.map((fill) => ({
                legIndex: fill.legIndex,
                side: fill.side as 'buy' | 'sell',
                inputMint: fill.inputMint,
                outputMint: fill.outputMint,
                inputSpentRaw: fill.inputSpentRaw,
                outputReceivedRaw: fill.outputReceivedRaw,
                feeLamports: fill.feeLamports,
                lamportsSpent: fill.lamportsSpent,
                withinBounds: fill.withinBounds,
                signature: fill.signature,
                slot: fill.slot,
              }))
            : [],
        fees: {
          networkFeeLamports: str(kind === 'execution' ? networkFee : 0n),
          rentLamports: str(kind === 'execution' ? rent : 0n),
          protocolFeeRaw: plan.fees.protocol.feeRaw,
        },
        timestamps: {
          intentCreatedAt: intent.createdAt.toISOString(),
          planCreatedAt: planRow.createdAt.toISOString(),
          acknowledgedAt: planRow.acknowledgedAt?.toISOString() ?? null,
          firstSubmittedAt: submittedAts[0]?.toISOString() ?? null,
          settledAt: terminal ? intent.updatedAt.toISOString() : null,
        },
        status: {
          intentState: state,
          terminal,
          failure: failureStates.includes(state) ? intent.stateReason : null,
          recovery:
            state === 'UNKNOWN_REQUIRES_RECONCILIATION'
              ? 'reconciliation pending: the node has not given evidence yet'
              : state === 'PARTIALLY_COMPLETED' && intent.continuedByIntentId !== null
                ? `continued by intent ${intent.continuedByIntentId}`
                : null,
        },
        scope: {
          attests: 'record',
          settlement: 'chain_evidence',
          ownership: 'not_asserted',
          policy: 'evaluated_as_recorded',
        },
      };
      const signed = signReceipt(body, deps.signer);
      const stored = await insertReceipt(db, {
        receiptId: body.receiptId,
        ownerUserId: userId,
        kind,
        intentId: intent.id,
        planId: planRow.id,
        intentState: state,
        body: signed.body,
        canonicalHash: signed.canonicalHash,
        keyId: signed.signer.keyId,
        signerPublicKey: signed.signer.publicKey,
        signature: signed.signature,
        public: false,
        issuedAt: at,
      });
      if (stored.created) {
        await audit(principal, 'accounting.receipt.issued', 'receipt', stored.row.id, requestId, {
          intentId: intent.id,
          kind,
          intentState: state,
          canonicalHash: signed.canonicalHash,
          keyId: signed.signer.keyId,
        });
      }
      return { receipt: toReceipt(stored.row, { redact: false }), created: stored.created };
    },

    async intentReceipts(principal, intentId) {
      const userId = ownerOf(principal);
      const rows = await listReceiptsForIntent(db, userId, intentId);
      return { receipts: rows.map((row) => toReceipt(row, { redact: false })) };
    },

    async listReceipts(principal) {
      const userId = ownerOf(principal);
      const rows = await listReceipts(db, userId);
      return { receipts: rows.map((row) => toReceipt(row, { redact: false })) };
    },

    async readReceipt(principal, receiptId) {
      const row = await findReceipt(db, receiptId);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no receipt with that id');
      }
      if (canReadFully(principal, row)) {
        return toReceipt(row, { redact: false });
      }
      if (row.public) {
        return toReceipt(row, { redact: true });
      }
      throw new ApiError('NOT_FOUND', 'no receipt with that id');
    },

    async setReceiptPublic(principal, receiptId, isPublic, requestId) {
      const userId = ownerOf(principal);
      const row = await setReceiptPublicRow(db, userId, receiptId, isPublic);
      if (!row) {
        throw new ApiError('NOT_FOUND', 'no receipt with that id');
      }
      await audit(principal, 'accounting.receipt.visibility', 'receipt', row.id, requestId, {
        public: isPublic,
      });
      return toReceipt(row, { redact: false });
    },

    async verificationKeys() {
      const rows = await listSigningKeys(db);
      return {
        keys: rows.map((row) => ({
          keyId: row.keyId,
          algorithm: 'ed25519' as const,
          publicKey: row.publicKey,
          status: row.status as 'active' | 'retired',
          validFrom: row.validFrom.toISOString(),
          validTo: row.validTo?.toISOString() ?? null,
        })),
        domain: RECEIPT_DOMAIN,
        note: RECEIPT_KEYS_NOTE,
      };
    },
  };
}
