import { createHash } from 'node:crypto';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import type {
  ExecutionAttempt,
  ExecutionFill,
  ExecutionPlan,
  ExecutionStatus,
  IntentState,
  PlanLeg,
  PreparedTransaction,
  SignedTransactionSubmission,
  SimulationEvidence,
} from '@markov/contracts';
import {
  type AttemptContext,
  beginSubmission,
  createExecutionStorePort,
  type Database,
  type ExecutionAttemptRow,
  type ExecutionFillRow,
  type ExecutionPlanRow,
  expirePreparedTransactions,
  findAttemptContext,
  findIntent,
  findLiveAttempt,
  findPlan,
  type IntentRow,
  insertOutboxEvent,
  insertPreparedTransaction,
  listAttempts,
  listCurrentPreparedTransactions,
  listFills,
  markPlanStatus,
  type PreparedTransactionRow,
  recordAuditEvent,
  releaseReservation,
  transitionIntent,
  updateAttempt,
  updatePreparedTransactionState,
} from '@markov/db';
import {
  checkSignedSubmission,
  liveAttemptFromRows,
  type ReconcileOutcome,
  reconcileAttempt,
  validateSwapTransaction,
} from '@markov/execution';
import { type VenueAdapter, VenueQuoteError } from '@markov/planning';
import {
  associatedTokenAddress,
  base64ToBytes,
  bytesToBase64,
  decodeAddressLookupTable,
  messageHashHex,
  parseTransaction,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  type Transaction,
} from '@markov/solana-codec';
import { type SolanaRpcClient, SolanaRpcError } from '@markov/solana-rpc';
import { ApiError } from '../errors.js';
import type { PolicyService } from '../policy/service.js';

/**
 * Execution of an approved plan (B10): build one transaction per batch from
 * the venue, decode and validate every instruction against the plan,
 * simulate it, persist it, verify the owner's signature over the exact
 * message, re-evaluate policy with a reservation, persist the attempt before
 * any broadcast, then observe the signature to finality and reconcile from
 * chain evidence. Basket plans stay staged (B11); this session executes
 * single-leg plans, buy and sell, and never builds, signs or sends anything
 * a person did not approve by hash.
 */

/** Compute units requested for one swap; the fixture route needs far less, live routes are bounded by the cap. */
export const COMPUTE_UNIT_LIMIT = 400_000;
/** Priority fee price requested, in micro-lamports per unit, before the plan's cap tightens it. */
export const DEFAULT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 1_000n;
/** Read-time reconciliation is skipped when the attempt was checked this recently. */
export const READ_RECONCILE_MIN_INTERVAL_MS = 2_000;
export const MAX_ATTEMPTS_LISTED = 64;
export const MAX_FILLS_LISTED = 32;

export interface ExecutionServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly policy: PolicyService;
  /** Null when no venue is configured; building then fails closed. */
  readonly venue: VenueAdapter | null;
  readonly rpcClients: readonly SolanaRpcClient[];
  readonly genesisHash: string;
  readonly now?: () => Date;
}

export interface ExecutionService {
  buildTransaction(
    principal: Principal,
    intentId: string,
    requestId: string,
  ): Promise<PreparedTransaction>;
  submitTransaction(
    principal: Principal,
    intentId: string,
    transactionIndex: number,
    request: SignedTransactionSubmission,
    requestId: string,
  ): Promise<{ status: ExecutionStatus; created: boolean }>;
  /** The intent's execution state; a live attempt is reconciled from chain evidence on the way (throttled). */
  getExecution(principal: Principal, intentId: string): Promise<ExecutionStatus>;
  /** An explicit reconciliation round for a live attempt. */
  reconcile(principal: Principal, intentId: string, requestId: string): Promise<ExecutionStatus>;
  /** One reconciliation round over one attempt by id (the worker's entry point); null when not live. */
  reconcileAttemptById(attemptId: string): Promise<ReconcileOutcome | null>;
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

const LIVE_STATES: ReadonlySet<string> = new Set([
  'submitting',
  'submitted',
  'confirmed',
  'unknown',
]);
const OPEN_PLANNING_STATES: readonly IntentState[] = ['DRAFT', 'QUOTED', 'AWAITING_APPROVAL'];

function refusal(
  code:
    | 'PLAN_NOT_APPROVED'
    | 'PLAN_EXPIRED'
    | 'PLAN_CHANGED'
    | 'BUILD_UNAVAILABLE'
    | 'VALIDATION_FAILED'
    | 'SIMULATION_FAILED'
    | 'ATTEMPT_IN_FLIGHT'
    | 'STAGED_NOT_SUPPORTED'
    | 'TRANSACTION_EXPIRED',
  message: string,
  details: { path: string; message: string }[] = [],
): ApiError {
  const apiCode =
    code === 'PLAN_EXPIRED'
      ? 'QUOTE_EXPIRED'
      : code === 'PLAN_CHANGED'
        ? 'PLAN_CHANGED'
        : code === 'BUILD_UNAVAILABLE'
          ? 'PROVIDER_UNAVAILABLE'
          : 'TRANSACTION_REFUSED';
  return new ApiError(apiCode, message, [{ path: 'refusal', message: code }, ...details]);
}

function tokenProgramOf(program: PlanLeg['tokenProgram']): string {
  return program === 'token-2022' ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
}

function sha256Hex(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function createExecutionService(deps: ExecutionServiceDeps): ExecutionService {
  const { config, db, policy, venue } = deps;
  const now = deps.now ?? (() => new Date());
  const rpc = deps.rpcClients[0];
  if (!rpc) {
    throw new Error('execution service needs at least one RPC client');
  }
  const store = createExecutionStorePort(db);

  const audit = (
    principal: Principal,
    action: string,
    targetType: 'intent' | 'prepared_transaction' | 'execution_attempt',
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

  /** The owner's intent, expired first when its lifetime passed while still in planning. */
  const requireIntent = async (userId: string, intentId: string, at: Date): Promise<IntentRow> => {
    const row = await findIntent(db, userId, intentId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no intent with that id');
    }
    if (
      OPEN_PLANNING_STATES.includes(row.state as IntentState) &&
      row.expiresAt.getTime() <= at.getTime()
    ) {
      const expired = await transitionIntent(db, {
        intentId: row.id,
        from: OPEN_PLANNING_STATES,
        to: 'EXPIRED',
        reason: `the intent expired at ${row.expiresAt.toISOString()}`,
        now: at,
      });
      return expired ?? row;
    }
    return row;
  };

  const toAttempt = (row: ExecutionAttemptRow): ExecutionAttempt => ({
    attemptId: row.id,
    transactionId: row.transactionId,
    transactionIndex: row.transactionIndex,
    signature: row.signature,
    state: row.state as ExecutionAttempt['state'],
    reason: row.reason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    confirmationStatus: row.confirmationStatus as ExecutionAttempt['confirmationStatus'],
    slot: row.slot,
    resendCount: row.resendCount,
    chainError: row.chainError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  const toFill = (row: ExecutionFillRow): ExecutionFill => ({
    fillId: row.id,
    intentId: row.intentId,
    planId: row.planId,
    legIndex: row.legIndex,
    signature: row.signature,
    slot: row.slot,
    blockTime: row.blockTime?.toISOString() ?? null,
    side: row.side as ExecutionFill['side'],
    inputMint: row.inputMint,
    outputMint: row.outputMint,
    inputSpentRaw: row.inputSpentRaw,
    outputReceivedRaw: row.outputReceivedRaw,
    feeLamports: row.feeLamports,
    lamportsSpent: row.lamportsSpent,
    withinBounds: row.withinBounds,
    source: 'transaction_meta',
    observedAt: row.observedAt.toISOString(),
  });

  const toPrepared = (
    row: PreparedTransactionRow,
    plan: ExecutionPlanRow,
    attempt: ExecutionAttemptRow | null,
  ): PreparedTransaction => ({
    transactionId: row.id,
    intentId: row.intentId,
    planId: row.planId,
    planHash: plan.planHash,
    transactionIndex: row.transactionIndex,
    batch: row.batch,
    legIndexes: [...row.legIndexes],
    network: { cluster: config.solana.cluster, genesisHash: deps.genesisHash },
    version: row.version as PreparedTransaction['version'],
    unsignedTransaction: row.unsignedTransaction,
    messageHash: row.messageHash,
    feePayer: row.feePayer,
    expectedSigner: row.expectedSigner,
    recentBlockhash: row.recentBlockhash,
    lastValidBlockHeight: row.lastValidBlockHeight,
    buildSource: row.buildSource,
    instructions: [...row.instructions],
    effects: row.effects,
    simulation: row.simulation,
    state: row.state as PreparedTransaction['state'],
    attempt: attempt === null ? null : toAttempt(attempt),
    createdAt: row.createdAt.toISOString(),
  });

  /** The intent's current plan row, or null when it has none. */
  const currentPlan = async (
    userId: string,
    intent: IntentRow,
  ): Promise<ExecutionPlanRow | null> =>
    intent.latestPlanId === null ? null : findPlan(db, userId, intent.latestPlanId);

  const planExpired = (row: ExecutionPlanRow, at: Date): boolean =>
    row.status === 'expired' || row.expiresAt.getTime() <= at.getTime();

  /** Lookup tables named by a versioned message, read from the node; refuses when one cannot be read. */
  const lookupTablesFor = async (
    transaction: Transaction,
  ): Promise<ReadonlyMap<string, readonly string[]>> => {
    const tables = new Map<string, readonly string[]>();
    if (transaction.message.version !== 0) {
      return tables;
    }
    for (const lookup of transaction.message.addressTableLookups) {
      let account: Awaited<ReturnType<SolanaRpcClient['getAccountInfo']>>;
      try {
        account = await rpc.getAccountInfo(lookup.accountKey, config.solana.readCommitment);
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw refusal(
            'VALIDATION_FAILED',
            `lookup table ${lookup.accountKey} could not be read (${error.kind}); the transaction is refused`,
          );
        }
        throw error;
      }
      if (account.account === null) {
        throw refusal(
          'VALIDATION_FAILED',
          `lookup table ${lookup.accountKey} does not exist; the transaction is refused`,
        );
      }
      try {
        tables.set(lookup.accountKey, decodeAddressLookupTable(account.account.data).addresses);
      } catch {
        throw refusal(
          'VALIDATION_FAILED',
          `lookup table ${lookup.accountKey} is malformed; the transaction is refused`,
        );
      }
    }
    return tables;
  };

  /** Whether the owner already holds a token account for the mint (creation is then not asked for). */
  const tokenAccountExists = async (address: string): Promise<boolean> => {
    try {
      const info = await rpc.getAccountInfo(address, config.solana.readCommitment);
      return info.account !== null && info.account.data.length > 0;
    } catch (error) {
      if (error instanceof SolanaRpcError) {
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          `the owner's token accounts could not be read (${error.kind}); try again shortly`,
        );
      }
      throw error;
    }
  };

  const reconcileContext = async (
    context: AttemptContext,
    at: Date,
  ): Promise<ReconcileOutcome | null> => {
    const live = liveAttemptFromRows(context);
    if (live === null) {
      return null;
    }
    return reconcileAttempt({ rpc, store, now: () => at }, live);
  };

  const status = async (
    userId: string,
    intentId: string,
    options: { readonly reconcile: 'never' | 'throttled' | 'always' },
  ): Promise<ExecutionStatus> => {
    const at = now();
    let intent = await requireIntent(userId, intentId, at);
    const plan = await currentPlan(userId, intent);
    const evidence: string[] = [];
    let blockHeight: number | null = null;
    let lastCheckedAt: Date | null = null;
    let attempts = await listAttempts(db, intent.id);
    const live = attempts.find((row) => LIVE_STATES.has(row.state)) ?? null;
    if (live !== null && options.reconcile !== 'never') {
      const recently =
        live.lastCheckedAt !== null &&
        at.getTime() - live.lastCheckedAt.getTime() < READ_RECONCILE_MIN_INTERVAL_MS;
      if (options.reconcile === 'always' || !recently) {
        const context = await findAttemptContext(db, live.id);
        const outcome = context === null ? null : await reconcileContext(context, at);
        if (outcome !== null) {
          evidence.push(...outcome.evidence);
          const height = outcome.evidence.find((line) => line.startsWith('finalized block height'));
          if (height) {
            blockHeight = Number.parseInt(height.split(' ')[3] ?? '', 10) || null;
          }
        }
        intent = (await findIntent(db, userId, intentId)) ?? intent;
        attempts = await listAttempts(db, intent.id);
      } else {
        evidence.push('checked moments ago; the stored evidence stands');
      }
    }
    // An unsigned transaction whose blockhash passed cannot land; say so before anyone signs it.
    if (plan !== null && intent.state === 'AUTHORIZED' && options.reconcile !== 'never') {
      try {
        blockHeight = await rpc.getBlockHeight('finalized');
        const expired = await expirePreparedTransactions(db, plan.id, blockHeight, at);
        if (expired > 0) {
          evidence.push(
            `${expired} prepared transaction${expired === 1 ? '' : 's'} expired unsigned at finalized height ${blockHeight}`,
          );
        }
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
        evidence.push(`block height unavailable: ${error.kind}`);
      }
    }
    const transactions = plan === null ? [] : await listCurrentPreparedTransactions(db, plan.id);
    const fills = await listFills(db, intent.id);
    for (const attempt of attempts) {
      if (
        attempt.lastCheckedAt &&
        (lastCheckedAt === null || attempt.lastCheckedAt > lastCheckedAt)
      ) {
        lastCheckedAt = attempt.lastCheckedAt;
      }
    }
    const state = intent.state as IntentState;
    const violated = fills.some((fill) => !fill.withinBounds);
    const signable = transactions.some((row) => row.state === 'prepared');
    const nextAction: ExecutionStatus['nextAction'] =
      state === 'AWAITING_APPROVAL' && plan !== null && plan.acknowledgedHash === plan.planHash
        ? 'build'
        : state === 'AUTHORIZED'
          ? signable
            ? 'sign'
            : 'build'
          : state === 'SUBMITTING' || state === 'SUBMITTED' || state === 'CONFIRMED'
            ? 'wait'
            : state === 'CANCEL_REQUESTED'
              ? 'wait'
              : state === 'UNKNOWN_REQUIRES_RECONCILIATION'
                ? violated
                  ? 'review'
                  : 'reconcile'
                : 'none';
    return {
      intentId: intent.id,
      state,
      stateReason: intent.stateReason,
      planId: plan?.id ?? null,
      planHash: plan?.planHash ?? null,
      transactions: transactions.map((row) =>
        toPrepared(
          row,
          plan as ExecutionPlanRow,
          attempts.find((attempt) => attempt.transactionId === row.id) ?? null,
        ),
      ),
      attempts: attempts.slice(-MAX_ATTEMPTS_LISTED).map(toAttempt),
      fills: fills.slice(0, MAX_FILLS_LISTED).map(toFill),
      reconciliation: {
        lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
        blockHeight,
        evidence: evidence.slice(0, 12).map((line) => line.slice(0, 300)),
        frozen: state === 'UNKNOWN_REQUIRES_RECONCILIATION',
      },
      nextAction,
      updatedAt: intent.updatedAt.toISOString(),
    };
  };

  return {
    async buildTransaction(principal, intentId, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      if (venue === null || venue.build === null) {
        throw refusal(
          'BUILD_UNAVAILABLE',
          venue === null
            ? 'no execution venue is configured (EXECUTION_VENUE_PROVIDER); nothing can be built'
            : 'the configured venue quotes but does not build transactions (EXECUTION_VENUE_BUILD_URL); execution is unavailable',
        );
      }
      if ((await findLiveAttempt(db, intent.id)) !== null) {
        throw refusal(
          'ATTEMPT_IN_FLIGHT',
          'a signed transaction of this intent is already with the network; read its execution status',
        );
      }
      if (intent.state !== 'AWAITING_APPROVAL' && intent.state !== 'AUTHORIZED') {
        throw refusal(
          'PLAN_NOT_APPROVED',
          `the intent is ${intent.state}${intent.stateReason ? ` (${intent.stateReason})` : ''}; a transaction is built only for an acknowledged plan`,
        );
      }
      const planRow = await currentPlan(userId, intent);
      if (planRow === null || planRow.status === 'superseded') {
        throw refusal('PLAN_CHANGED', 'the intent has no current plan; build and acknowledge one');
      }
      if (planRow.planHash !== intent.latestPlanHash) {
        throw refusal('PLAN_CHANGED', 'the intent points at another plan than the one stored');
      }
      if (planRow.acknowledgedHash !== planRow.planHash) {
        throw refusal(
          'PLAN_NOT_APPROVED',
          'the plan has not been acknowledged by its hash; review and acknowledge it first',
        );
      }
      if (planExpired(planRow, at)) {
        if (planRow.status === 'valid') {
          await markPlanStatus(db, planRow.id, 'expired');
        }
        throw refusal(
          'PLAN_EXPIRED',
          `the plan expired at ${planRow.expiresAt.toISOString()}; build and acknowledge a new plan`,
        );
      }
      const plan: ExecutionPlan = {
        ...planRow.plan,
        review: {
          acknowledgedAt: planRow.acknowledgedAt?.toISOString() ?? null,
          acknowledgedHash: planRow.acknowledgedHash,
          stagedAcknowledged: planRow.stagedAcknowledged,
        },
        status: 'valid',
      };
      if (plan.grouping.batches.length !== 1 || plan.legs.length !== 1) {
        throw refusal(
          'STAGED_NOT_SUPPORTED',
          `this plan has ${plan.grouping.batches.length} batches; staged basket execution arrives with B11 and nothing of it is built here`,
        );
      }
      if (plan.mode !== venue.mode) {
        throw refusal(
          'PLAN_CHANGED',
          `the plan was quoted in ${plan.mode} mode but the configured venue runs ${venue.mode}; build a new plan`,
        );
      }
      const leg = plan.legs[0] as PlanLeg;
      const owner = plan.wallet.address;
      const stablecoinProgram = SPL_TOKEN_PROGRAM_ID;
      const instrumentProgram = tokenProgramOf(leg.tokenProgram);
      const inputTokenProgram = leg.side === 'buy' ? stablecoinProgram : instrumentProgram;
      const outputTokenProgram = leg.side === 'buy' ? instrumentProgram : stablecoinProgram;
      const destination = associatedTokenAddress(owner, leg.outputMint, outputTokenProgram).address;
      const createOutputAccount = !(await tokenAccountExists(destination));

      let blockhash: Awaited<ReturnType<SolanaRpcClient['getLatestBlockhash']>>;
      try {
        blockhash = await rpc.getLatestBlockhash('finalized');
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            'the network could not provide a recent blockhash; try again shortly',
          );
        }
        throw error;
      }
      const priorityCap = BigInt(plan.fees.network.priorityFeeCapLamports);
      const priceCap = (priorityCap * 1_000_000n) / BigInt(COMPUTE_UNIT_LIMIT);
      const computeUnitPriceMicroLamports =
        priceCap < DEFAULT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS
          ? priceCap
          : DEFAULT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS;

      let built: Awaited<ReturnType<NonNullable<VenueAdapter['build']>>>;
      try {
        built = await venue.build({
          quote: leg.quote,
          owner,
          inputTokenProgram,
          outputTokenProgram,
          recentBlockhash: blockhash.blockhash,
          computeUnitLimit: COMPUTE_UNIT_LIMIT,
          computeUnitPriceMicroLamports,
          createOutputAccount,
        });
      } catch (error) {
        if (error instanceof VenueQuoteError) {
          throw refusal(
            'BUILD_UNAVAILABLE',
            `the venue could not build the transaction (${error.kind}): ${error.message}`,
          );
        }
        throw error;
      }

      // Every byte the venue produced is untrusted until decoded and compared with the plan.
      let transaction: Transaction;
      try {
        transaction = parseTransaction(base64ToBytes(built.unsignedTransaction));
      } catch (error) {
        await audit(principal, 'execution.transaction.refused', 'intent', intent.id, requestId, {
          planId: plan.planId,
          source: built.sourceRef,
          refusals: [
            {
              code: 'VALIDATION_FAILED',
              message: error instanceof Error ? error.message : 'unparseable',
            },
          ],
        });
        throw refusal(
          'VALIDATION_FAILED',
          `the venue's transaction does not parse: ${error instanceof Error ? error.message : 'unparseable'}`,
        );
      }
      if (transaction.message.recentBlockhash !== blockhash.blockhash) {
        throw refusal(
          'VALIDATION_FAILED',
          'the venue built the transaction on another blockhash than the one requested',
        );
      }
      const lookupTables = await lookupTablesFor(transaction);
      const validation = validateSwapTransaction(transaction, {
        plan,
        leg,
        owner,
        inputTokenProgram,
        outputTokenProgram,
        lookupTables,
      });
      if (!validation.ok || validation.effects === null) {
        await audit(principal, 'execution.transaction.refused', 'intent', intent.id, requestId, {
          planId: plan.planId,
          source: built.sourceRef,
          refusals: validation.refusals.map((entry) => ({
            code: entry.code,
            message: entry.message,
            instructionIndex: entry.instructionIndex,
          })),
        });
        throw refusal(
          'VALIDATION_FAILED',
          `the venue's transaction was refused by ${validation.refusals.length} check${validation.refusals.length === 1 ? '' : 's'}; nothing was stored or shown for signing`,
          validation.refusals.map((entry) => ({
            path:
              entry.instructionIndex === null
                ? 'transaction'
                : `instructions[${entry.instructionIndex}]`,
            message: `${entry.code}: ${entry.message}`,
          })),
        );
      }

      // Whole-transaction simulation on the current state; a failing simulation is a refusal, an
      // unavailable node is not evidence of anything and fails closed too.
      let simulation: SimulationEvidence;
      try {
        const simulated = await rpc.simulateTransaction(built.unsignedTransaction, {
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: 'confirmed',
        });
        simulation = {
          status: simulated.err === null ? 'ok' : 'failed',
          unitsConsumed: simulated.unitsConsumed,
          err: simulated.err === null ? null : JSON.stringify(simulated.err).slice(0, 300),
          logsHash: sha256Hex(simulated.logs),
          slot: simulated.slot,
          observedAt: at.toISOString(),
        };
      } catch (error) {
        if (error instanceof SolanaRpcError) {
          throw new ApiError(
            'PROVIDER_UNAVAILABLE',
            `the transaction could not be simulated (${error.kind}); nothing is shown for signing without a simulation`,
          );
        }
        throw error;
      }
      if (simulation.status !== 'ok') {
        await audit(principal, 'execution.transaction.refused', 'intent', intent.id, requestId, {
          planId: plan.planId,
          source: built.sourceRef,
          refusals: [{ code: 'SIMULATION_FAILED', message: simulation.err }],
        });
        throw refusal(
          'SIMULATION_FAILED',
          `the transaction fails in simulation (${simulation.err}); nothing is shown for signing`,
        );
      }

      const row = await insertPreparedTransaction(db, {
        intentId: intent.id,
        planId: plan.planId,
        ownerUserId: userId,
        transactionIndex: 0,
        batch: 0,
        legIndexes: [leg.legIndex],
        version: built.version,
        messageHash: messageHashHex(transaction.messageBytes),
        unsignedTransaction: built.unsignedTransaction,
        feePayer: owner,
        expectedSigner: owner,
        recentBlockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        buildSource: built.sourceRef,
        instructions: validation.instructions,
        effects: validation.effects,
        simulation,
        now: at,
      });
      const moved = await transitionIntent(db, {
        intentId: intent.id,
        from: ['AWAITING_APPROVAL', 'AUTHORIZED'],
        to: 'AUTHORIZED',
        reason: `transaction 0 prepared (message ${row.messageHash.slice(0, 16)}); awaiting the owner's signature`,
        now: at,
      });
      if (!moved) {
        await updatePreparedTransactionState(db, row.id, 'superseded', at);
        throw refusal('PLAN_CHANGED', 'the intent changed while the transaction was being built');
      }
      await audit(
        principal,
        'execution.transaction.prepared',
        'prepared_transaction',
        row.id,
        requestId,
        {
          intentId: intent.id,
          planId: plan.planId,
          planHash: plan.planHash,
          messageHash: row.messageHash,
          source: built.sourceRef,
          effects: {
            side: validation.effects.side,
            maxInputRaw: validation.effects.maxInputRaw,
            minimumOutputRaw: validation.effects.minimumOutputRaw,
            totalLamportsMax: validation.effects.totalLamportsMax,
          },
          simulation: { status: simulation.status, unitsConsumed: simulation.unitsConsumed },
        },
      );
      return toPrepared(row, planRow, null);
    },

    async submitTransaction(principal, intentId, transactionIndex, request, requestId) {
      const userId = ownerOf(principal);
      const at = now();
      const intent = await requireIntent(userId, intentId, at);
      const planRow = await currentPlan(userId, intent);
      if (planRow === null) {
        throw new ApiError('NOT_FOUND', 'the intent has no plan; nothing was prepared for signing');
      }
      const transactions = await listCurrentPreparedTransactions(db, planRow.id);
      const row = transactions.find((entry) => entry.transactionIndex === transactionIndex);
      if (!row) {
        throw new ApiError(
          'NOT_FOUND',
          `no prepared transaction ${transactionIndex}; build one first`,
        );
      }

      // Signature first: nothing below runs for bytes that are not the prepared message signed by the owner.
      let signedBytes: Uint8Array;
      try {
        signedBytes = base64ToBytes(request.signedTransaction);
      } catch {
        throw new ApiError('SIGNATURE_MISMATCH', 'the signed transaction is not base64');
      }
      const prepared = parseTransaction(base64ToBytes(row.unsignedTransaction));
      const check = checkSignedSubmission({
        signedBytes,
        preparedMessageBytes: prepared.messageBytes,
        expectedSigner: row.expectedSigner,
      });
      if (!check.ok) {
        await audit(
          principal,
          'execution.submission.refused',
          'prepared_transaction',
          row.id,
          requestId,
          {
            intentId: intent.id,
            code: check.code,
            message: check.message,
          },
        );
        throw new ApiError('SIGNATURE_MISMATCH', check.message);
      }

      // The same signed bytes again, while the attempt is live or settled: the one attempt answers.
      const live = await findLiveAttempt(db, intent.id);
      if (live !== null) {
        if (live.transactionId === row.id && live.signature === check.signature) {
          return {
            status: await status(userId, intent.id, { reconcile: 'throttled' }),
            created: false,
          };
        }
        throw refusal(
          'ATTEMPT_IN_FLIGHT',
          'another signed transaction of this intent is already with the network; read its execution status',
        );
      }
      const settled = (await listAttempts(db, intent.id)).find(
        (attempt) => attempt.signature === check.signature,
      );
      if (settled) {
        return { status: await status(userId, intent.id, { reconcile: 'never' }), created: false };
      }
      if (row.state !== 'prepared') {
        throw refusal(
          row.state === 'expired' ? 'TRANSACTION_EXPIRED' : 'PLAN_CHANGED',
          `this transaction is ${row.state}; build a new one`,
        );
      }
      if (intent.state !== 'AUTHORIZED') {
        throw refusal(
          'PLAN_NOT_APPROVED',
          `the intent is ${intent.state}${intent.stateReason ? ` (${intent.stateReason})` : ''}; nothing was submitted`,
        );
      }
      if (planExpired(planRow, at)) {
        if (planRow.status === 'valid') {
          await markPlanStatus(db, planRow.id, 'expired');
        }
        await updatePreparedTransactionState(db, row.id, 'expired', at);
        await transitionIntent(db, {
          intentId: intent.id,
          from: ['AUTHORIZED'],
          to: 'EXPIRED',
          reason: `the plan expired at ${planRow.expiresAt.toISOString()} before its signature arrived`,
          now: at,
        });
        throw refusal(
          'PLAN_EXPIRED',
          `the plan expired at ${planRow.expiresAt.toISOString()} before the signature arrived; nothing was submitted, create a new intent`,
        );
      }
      try {
        const height = await rpc.getBlockHeight('finalized');
        if (height > row.lastValidBlockHeight) {
          await updatePreparedTransactionState(db, row.id, 'expired', at);
          throw refusal(
            'TRANSACTION_EXPIRED',
            `the transaction's blockhash expired at height ${row.lastValidBlockHeight} (finalized height ${height}) before the signature arrived; nothing was submitted, build it again`,
          );
        }
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          'the network could not be asked whether the transaction can still land; submit the same signed transaction again shortly',
        );
      }

      // Policy at submission, with the reservation that counts against the daily and account budgets.
      const leg = planRow.plan.legs[0] as PlanLeg;
      const decision = await policy.evaluate(
        principal,
        {
          stage: 'submit',
          side: leg.side,
          instrumentId: leg.instrumentId,
          notionalUsdcRaw: leg.side === 'buy' ? leg.maxInputRaw : leg.expectedOutputRaw,
          intentId: intent.id,
          venue: 'jupiter',
          slippageBps: leg.slippageBps,
          quoteObservedAt: leg.quote.observedAt,
          exposure: {
            source: 'caller_declared',
            observedAt: planRow.plan.funds.observedAt,
            positions: [],
            cashUsdcRaw: planRow.plan.funds.stablecoinRaw,
          },
          reserve: true,
        },
        requestId,
      );
      if (decision.outcome !== 'allow') {
        await audit(
          principal,
          'execution.submission.refused',
          'prepared_transaction',
          row.id,
          requestId,
          {
            intentId: intent.id,
            code: 'POLICY_DENIED',
            denials: decision.denials.map((denial) => denial.code),
          },
        );
        throw new ApiError(
          'POLICY_DENIED',
          'policy denied the submission; nothing was submitted',
          decision.denials.map((denial) => ({
            path: 'policy',
            message: `${denial.code}: ${denial.message}`,
          })),
        );
      }

      // Persist the attempt, its signed bytes and the outbox event before any broadcast.
      const begun = await beginSubmission(db, {
        transactionId: row.id,
        intentId: intent.id,
        planId: planRow.id,
        ownerUserId: userId,
        transactionIndex,
        signature: check.signature,
        signedTransaction: bytesToBase64(signedBytes),
        messageHash: check.messageHash,
        reservationId: decision.reservation?.reservationId ?? null,
        lastValidBlockHeight: row.lastValidBlockHeight,
        now: at,
        intentFrom: ['AUTHORIZED'],
      });
      if (begun.kind === 'attempt_in_flight') {
        return {
          status: await status(userId, intent.id, { reconcile: 'throttled' }),
          created: false,
        };
      }
      if (begun.kind === 'intent_not_ready') {
        await releaseReservation(db, { userId, intentId: intent.id, now: at });
        throw refusal('PLAN_CHANGED', 'the intent changed while the submission was being recorded');
      }
      const attempt = begun.attempt;
      await audit(
        principal,
        'execution.attempt.persisted',
        'execution_attempt',
        attempt.id,
        requestId,
        {
          intentId: intent.id,
          transactionId: row.id,
          signature: check.signature,
          messageHash: check.messageHash,
          reservationId: attempt.reservationId,
        },
      );

      try {
        const accepted = await rpc.sendTransaction(attempt.signedTransaction, {
          preflightCommitment: 'confirmed',
        });
        await updateAttempt(
          db,
          attempt.id,
          {
            state: 'submitted',
            reason: accepted === check.signature ? null : `the node answered signature ${accepted}`,
            submittedAt: at,
            lastSentAt: at,
            lastCheckedAt: at,
          },
          at,
        );
        const moved = await transitionIntent(db, {
          intentId: intent.id,
          from: ['SUBMITTING'],
          to: 'SUBMITTED',
          reason: null,
          now: at,
        });
        if (moved) {
          await insertOutboxEvent(db, {
            kind: 'execution.submitted',
            aggregateType: 'intent',
            aggregateId: intent.id,
            ownerUserId: userId,
            payload: { attemptId: attempt.id, signature: check.signature },
            now: at,
          });
        }
        await audit(
          principal,
          'execution.attempt.submitted',
          'execution_attempt',
          attempt.id,
          requestId,
          {
            intentId: intent.id,
            signature: check.signature,
          },
        );
      } catch (error) {
        if (!(error instanceof SolanaRpcError)) {
          throw error;
        }
        const verdict =
          error.kind === 'rpc-error' &&
          error.rpcCode !== null &&
          (error.rpcCode === -32002 || error.rpcCode === -32003);
        if (verdict) {
          // The node judged this transaction before broadcast: nothing landed, nothing can land.
          const reason = `the node refused the transaction before broadcast: ${error.message.slice(0, 300)}`;
          await updateAttempt(
            db,
            attempt.id,
            { state: 'failed', reason, chainError: error.message.slice(0, 300), lastCheckedAt: at },
            at,
          );
          await store.settleReservation(attempt.id, 'released', at);
          const moved = await transitionIntent(db, {
            intentId: intent.id,
            from: ['SUBMITTING'],
            to: 'FAILED',
            reason,
            now: at,
          });
          if (moved) {
            await insertOutboxEvent(db, {
              kind: 'execution.failed',
              aggregateType: 'intent',
              aggregateId: intent.id,
              ownerUserId: userId,
              payload: { attemptId: attempt.id, signature: check.signature, reason },
              now: at,
            });
          }
          await audit(
            principal,
            'execution.attempt.failed',
            'execution_attempt',
            attempt.id,
            requestId,
            {
              intentId: intent.id,
              reason,
            },
          );
        } else {
          // No verdict: the node may have the transaction. Nothing is rebuilt or re-signed; the same
          // bytes are observed and, while the blockhash lives, resent by reconciliation.
          const reason = `no answer from the node after the broadcast (${error.kind}); reconciliation decides`;
          await updateAttempt(
            db,
            attempt.id,
            { state: 'unknown', reason, lastSentAt: at, lastCheckedAt: at },
            at,
          );
          const moved = await transitionIntent(db, {
            intentId: intent.id,
            from: ['SUBMITTING'],
            to: 'UNKNOWN_REQUIRES_RECONCILIATION',
            reason,
            now: at,
          });
          if (moved) {
            await insertOutboxEvent(db, {
              kind: 'execution.unknown',
              aggregateType: 'intent',
              aggregateId: intent.id,
              ownerUserId: userId,
              payload: { attemptId: attempt.id, signature: check.signature, reason },
              now: at,
            });
          }
          await audit(
            principal,
            'execution.attempt.unknown',
            'execution_attempt',
            attempt.id,
            requestId,
            {
              intentId: intent.id,
              reason,
            },
          );
        }
      }
      return { status: await status(userId, intent.id, { reconcile: 'never' }), created: true };
    },

    getExecution(principal, intentId) {
      return status(ownerOf(principal), intentId, { reconcile: 'throttled' });
    },

    async reconcile(principal, intentId, requestId) {
      const userId = ownerOf(principal);
      const result = await status(userId, intentId, { reconcile: 'always' });
      await audit(principal, 'execution.reconciled', 'intent', intentId, requestId, {
        state: result.state,
        evidence: result.reconciliation.evidence,
      });
      return result;
    },

    async reconcileAttemptById(attemptId) {
      const context = await findAttemptContext(db, attemptId);
      return context === null ? null : reconcileContext(context, now());
    },
  };
}
