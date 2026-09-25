import { randomUUID } from 'node:crypto';
import type { Principal } from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type AgentProposal,
  type Cadence,
  type DriftTarget,
  type InvestmentTarget,
  MAINTENANCE_SCHEMA_VERSION,
  type MaintenanceRunReport,
  type MaintenanceRunRequest,
  type MandateDryRunRequest,
  type MandateDryRunResponse,
  type Occurrence,
  type OccurrenceListResponse,
  type OccurrenceReason,
  type OccurrenceStatus,
  type Schedule,
  type ScheduleCreateRequest,
  type ScheduleListResponse,
  type SchedulePreviewRequest,
  type SchedulePreviewResponse,
  type ScheduleUpdateRequest,
} from '@markov/contracts';
import {
  advanceSchedule,
  claimDueSchedules,
  createSchedule as createScheduleRow,
  type Database,
  findOpenRebalanceProposal,
  findProposal,
  findSchedule,
  findVersionById,
  latestOccurrence,
  listCapabilityReadiness,
  listExpiredOccurrences,
  listOccurrences,
  listSchedules,
  listWallets,
  markOccurrenceExpired,
  type OccurrenceRow,
  recordAuditEvent,
  recordOccurrence,
  type ScheduleRow,
  transitionSchedule,
  updateSchedule as updateScheduleRow,
} from '@markov/db';
import {
  decideDrift,
  dueOccurrences,
  evaluateMandate,
  firstOccurrenceAtOrAfter,
  isKnownTimeZone,
  nextDueAfter,
  occurrenceDedupKey,
  previewOccurrences,
} from '@markov/maintenance';
import type { AgentService } from '../agents/service.js';
import type { AnalyticsService } from '../analytics/service.js';
import type { CatalogService } from '../catalog/service.js';
import { ApiError } from '../errors.js';
import type { NotificationService } from '../notifications/service.js';
import type { StrategyService } from '../strategies/service.js';

export const SCHEDULE_NOTE =
  'A schedule prepares proposals for your approval and nothing else: each occurrence creates a proposal (or records why it could not) and a notification. Opening a proposal is your act, and every order still needs its plan, your acknowledgement and your wallet signature. Missed occurrences are skipped, never accumulated.';
export const PREVIEW_NOTE =
  'Instants the cadence would fire at, in the zone you chose. Clocks that change for daylight saving keep the wall-clock time; a time the change day lacks moves forward by the gap and an ambiguous one fires once.';
export const OCCURRENCES_NOTE =
  'Every occurrence the scheduler decided, newest first: proposed (with its proposal), skipped (with why), failed (with why) or expired (the proposal was not opened in time); opened and dismissed follow the proposal.';
export const MANDATE_NOTE =
  'A dry run evaluates a hypothetical mandate against one action and changes nothing. Unattended execution stays DISABLED until an independently reviewed mechanism can enforce a mandate outside this process; a server-held key behind an if-statement is not that mechanism.';

const SCHEDULE_SCOPES = ['proposals:create', 'portfolio:read', 'research:read'] as const;
const OCCURRENCES_PER_PASS = 25;

export interface MaintenanceServiceDeps {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly agents: AgentService;
  readonly analytics: AnalyticsService;
  readonly catalog: CatalogService;
  readonly strategies: StrategyService;
  readonly notifications: NotificationService;
  readonly now?: () => Date;
}

export interface MaintenanceService {
  createSchedule(
    principal: Principal,
    request: ScheduleCreateRequest,
    requestId: string,
  ): Promise<Schedule>;
  listSchedules(
    principal: Principal,
    query: { status?: Schedule['status']; limit: number },
  ): Promise<ScheduleListResponse>;
  getSchedule(principal: Principal, scheduleId: string): Promise<Schedule>;
  updateSchedule(
    principal: Principal,
    scheduleId: string,
    request: ScheduleUpdateRequest,
    requestId: string,
  ): Promise<Schedule>;
  pauseSchedule(principal: Principal, scheduleId: string, requestId: string): Promise<Schedule>;
  resumeSchedule(principal: Principal, scheduleId: string, requestId: string): Promise<Schedule>;
  cancelSchedule(principal: Principal, scheduleId: string, requestId: string): Promise<Schedule>;
  preview(principal: Principal, request: SchedulePreviewRequest): Promise<SchedulePreviewResponse>;
  listOccurrences(
    principal: Principal,
    scheduleId: string,
    limit: number,
  ): Promise<OccurrenceListResponse>;
  /** One maintenance pass (worker or operator): due occurrences, expiries, notification projection and delivery. */
  run(
    principal: Principal,
    request: MaintenanceRunRequest,
    requestId: string,
  ): Promise<MaintenanceRunReport>;
  mandateDryRun(
    principal: Principal,
    request: MandateDryRunRequest,
    requestId: string,
  ): Promise<MandateDryRunResponse>;
}

function ownerOf(principal: Principal): string {
  if (principal.class !== 'user' || principal.userId === null) {
    throw new ApiError('FORBIDDEN', 'only the owner’s own session manages schedules');
  }
  return principal.userId;
}

function readerOf(principal: Principal): string {
  if ((principal.class !== 'user' && principal.class !== 'agent') || principal.userId === null) {
    throw new ApiError('FORBIDDEN', 'schedules belong to a person’s account');
  }
  return principal.userId;
}

/**
 * The authority a schedule acts with: the owner's account with the scopes
 * of a proposing agent credential. It can propose and read; it cannot open
 * a proposal, approve a plan or sign, whatever the schedule says.
 */
function schedulePrincipal(row: ScheduleRow): Principal {
  return {
    class: 'agent',
    id: `schedule:${row.id}`,
    userId: row.ownerUserId,
    scopes: [...SCHEDULE_SCOPES],
    authTime: null,
    sessionId: null,
    sessionExpiresAt: null,
    credentialId: null,
  };
}

function isInvestmentTarget(target: InvestmentTarget | DriftTarget): target is InvestmentTarget {
  return 'walletId' in target;
}

export function createMaintenanceService(deps: MaintenanceServiceDeps): MaintenanceService {
  const { db, agents, analytics, catalog, strategies, notifications } = deps;
  const now = deps.now ?? (() => new Date());

  const audit = (
    principal: Principal,
    action: string,
    targetType: string,
    targetId: string,
    requestId: string,
    details: Record<string, unknown> = {},
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

  const occurrenceOf = (row: OccurrenceRow, proposal: AgentProposal | null): Occurrence => {
    let status = row.status as OccurrenceStatus;
    if (row.status === 'proposed' && proposal !== null) {
      if (proposal.status === 'opened') {
        status = 'opened';
      } else if (proposal.status === 'dismissed') {
        status = 'dismissed';
      } else if (proposal.status === 'expired') {
        status = 'expired';
      }
    }
    return {
      occurrenceId: row.id,
      scheduleId: row.scheduleId,
      sequence: row.sequence,
      dueAt: row.dueAt.toISOString(),
      windowEndsAt: row.windowEndsAt.toISOString(),
      status,
      reason: row.reason as OccurrenceReason | null,
      detail: row.detail,
      proposalId: row.proposalId,
      dedupKey: row.dedupKey,
      decidedAt: row.decidedAt.toISOString(),
    };
  };

  const proposalFor = async (row: OccurrenceRow): Promise<AgentProposal | null> => {
    if (row.proposalId === null) {
      return null;
    }
    const proposal = await findProposal(db, row.ownerUserId, row.proposalId);
    if (proposal === null) {
      return null;
    }
    return agents.getProposal(
      {
        class: 'agent',
        id: `schedule:${row.scheduleId}`,
        userId: row.ownerUserId,
        scopes: [...SCHEDULE_SCOPES],
        authTime: null,
        sessionId: null,
        sessionExpiresAt: null,
        credentialId: null,
      },
      row.proposalId,
    );
  };

  const scheduleOf = async (row: ScheduleRow): Promise<Schedule> => {
    const last = await latestOccurrence(db, row.id);
    return {
      schemaVersion: MAINTENANCE_SCHEMA_VERSION,
      scheduleId: row.id,
      kind: row.kind as Schedule['kind'],
      status: row.status as Schedule['status'],
      mode: 'prepare_for_approval',
      label: row.label,
      cadence: row.cadence,
      target: row.target,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt?.toISOString() ?? null,
      reviewWindowHours: row.reviewWindowHours,
      missedRunPolicy: row.missedRunPolicy as Schedule['missedRunPolicy'],
      nextDueAt: row.status === 'active' ? (row.nextDueAt?.toISOString() ?? null) : null,
      lastSequence: row.lastSequence,
      lastOccurrence: last === null ? null : occurrenceOf(last, await proposalFor(last)),
      counts: { proposed: row.proposedCount, skipped: row.skippedCount, failed: row.failedCount },
      statusReason: row.statusReason,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      note: SCHEDULE_NOTE,
    };
  };

  const requireSchedule = async (ownerUserId: string, scheduleId: string): Promise<ScheduleRow> => {
    const row = await findSchedule(db, ownerUserId, scheduleId);
    if (!row) {
      throw new ApiError('NOT_FOUND', 'no schedule with that id');
    }
    return row;
  };

  const validateCadence = (cadence: Cadence) => {
    if (!isKnownTimeZone(cadence.timeZone)) {
      throw new ApiError('VALIDATION_FAILED', 'unknown time zone', [
        {
          path: 'cadence.timeZone',
          message: `${cadence.timeZone} is not an IANA time zone this platform knows`,
        },
      ]);
    }
  };

  /** The resources a target names must be the owner's (or public, for a version) at creation; the tick checks again. */
  const validateTarget = async (principal: Principal, request: ScheduleCreateRequest) => {
    const ownerUserId = ownerOf(principal);
    if (request.kind === 'recurring_investment') {
      const target = request.target;
      const wallet = (await listWallets(db, ownerUserId)).find((row) => row.id === target.walletId);
      if (!wallet) {
        throw new ApiError('NOT_FOUND', 'no verified wallet with that id');
      }
      if (target.strategyVersionId !== null) {
        const version = await findVersionById(db, target.strategyVersionId);
        if (!version) {
          throw new ApiError('NOT_FOUND', 'no strategy version with that id');
        }
        await strategies.getVersion(principal, version.strategyId, version.id);
        return {
          walletId: wallet.id,
          instanceId: null,
          strategyVersionId: version.id,
          instrumentId: null,
        };
      }
      const instrument = await catalog.getPublic(target.instrumentId as string);
      return {
        walletId: wallet.id,
        instanceId: null,
        strategyVersionId: null,
        instrumentId: instrument.instrumentId,
      };
    }
    const instance = await strategies.getInstance(principal, request.target.instanceId);
    if (instance.status !== 'active') {
      throw new ApiError('VALIDATION_FAILED', 'the instance is not active');
    }
    return {
      walletId: instance.walletId,
      instanceId: instance.instanceId,
      strategyVersionId: null,
      instrumentId: null,
    };
  };

  /** Decides one claimed schedule's due occurrences inside the caller's transaction. */
  const processSchedule = async (
    tx: Database,
    row: ScheduleRow,
    at: Date,
    requestId: string,
    counters: { proposed: number; skipped: number; failed: number },
  ): Promise<void> => {
    const due = dueOccurrences({
      cadence: row.cadence,
      startAt: row.startAt,
      endAt: row.endAt,
      lastSequence: row.lastSequence,
      reviewWindowHours: row.reviewWindowHours,
      missedRunPolicy: row.missedRunPolicy as Schedule['missedRunPolicy'],
      now: at,
      limit: OCCURRENCES_PER_PASS,
    });
    let lastSequence = row.lastSequence;
    let lastProposalAt: Date | null | undefined;
    let revoked = false;
    const principal = schedulePrincipal(row);
    const record = async (
      occurrence: (typeof due)[number],
      status: 'proposed' | 'skipped' | 'failed',
      reason: OccurrenceReason | null,
      detail: string | null,
      proposalId: string | null,
      occurrenceId: string,
      notify: boolean,
    ) => {
      await recordOccurrence(tx, {
        id: occurrenceId,
        scheduleId: row.id,
        ownerUserId: row.ownerUserId,
        sequence: occurrence.sequence,
        dueAt: occurrence.dueAt,
        windowEndsAt: occurrence.windowEndsAt,
        status,
        reason,
        detail,
        proposalId,
        dedupKey: occurrenceDedupKey(row.id, occurrence.sequence),
        now: at,
      });
      lastSequence = Math.max(lastSequence, occurrence.sequence);
      counters[status] += 1;
      if (notify) {
        await notifications.notifyScheduleOutcome({
          ownerUserId: row.ownerUserId,
          scheduleId: row.id,
          occurrenceId,
          label: row.label,
          status,
          reason,
          detail,
        });
      }
    };
    for (const occurrence of due) {
      if (revoked) {
        break;
      }
      const occurrenceId = randomUUID();
      if (occurrence.decision === 'skip') {
        await record(occurrence, 'skipped', occurrence.reason, null, null, occurrenceId, true);
        continue;
      }
      const dedupKey = occurrenceDedupKey(row.id, occurrence.sequence);
      const source = {
        scheduleId: row.id,
        occurrenceId,
        dedupKey,
        expiresAt: occurrence.windowEndsAt,
      };
      try {
        if (row.kind === 'recurring_investment' && isInvestmentTarget(row.target)) {
          const target = row.target;
          const invocation = await agents.invoke(
            principal,
            'investment.propose',
            {
              strategyVersionId: target.strategyVersionId,
              instrumentId: target.instrumentId,
              walletId: target.walletId,
              budget: target.budget,
              budgetMode: target.budgetMode,
              slippageBps: target.slippageBps,
              summary: `Scheduled: ${row.label}`.slice(0, 300),
            },
            requestId,
            null,
            source,
          );
          const proposal = invocation.output as AgentProposal;
          await record(
            occurrence,
            'proposed',
            null,
            null,
            proposal.proposalId,
            occurrenceId,
            false,
          );
          continue;
        }
        if (row.kind === 'drift_rebalance' && !isInvestmentTarget(row.target)) {
          const target = row.target;
          const allocation = await analytics.instanceAllocation(principal, target.instanceId);
          const open = await findOpenRebalanceProposal(db, row.ownerUserId, target.instanceId, at);
          const decision = decideDrift({
            allocation,
            thresholdBps: target.driftThresholdBps,
            lastProposalAt: row.lastProposalAt,
            minIntervalHours: target.minIntervalHours,
            openProposalExists: open !== null,
            now: at,
          });
          if (!decision.propose) {
            await record(
              occurrence,
              'skipped',
              decision.reason,
              decision.largestDriftBps === null
                ? null
                : `largest drift ${decision.largestDriftBps} bps against ${decision.thresholdBps ?? 'no'} threshold`,
              null,
              occurrenceId,
              false,
            );
            continue;
          }
          const invocation = await agents.invoke(
            principal,
            'rebalance.propose',
            { instanceId: target.instanceId },
            requestId,
            null,
            source,
          );
          const proposal = invocation.output as AgentProposal;
          lastProposalAt = at;
          await record(
            occurrence,
            'proposed',
            null,
            null,
            proposal.proposalId,
            occurrenceId,
            false,
          );
          continue;
        }
        await record(
          occurrence,
          'failed',
          'error',
          'schedule kind and target do not match',
          null,
          occurrenceId,
          true,
        );
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'NOT_FOUND') {
            // The wallet, version, instrument or instance is gone: the schedule's authority path ended with it.
            await record(
              occurrence,
              'failed',
              'target_unavailable',
              error.message,
              null,
              occurrenceId,
              true,
            );
            await transitionSchedule(tx, {
              ownerUserId: null,
              scheduleId: row.id,
              from: ['active', 'paused'],
              to: 'revoked',
              reason: `target unavailable: ${error.message}`.slice(0, 300),
              nextDueAt: null,
              now: at,
            });
            revoked = true;
            continue;
          }
          await record(
            occurrence,
            'failed',
            error.code === 'POLICY_DENIED' ? 'policy_denied' : 'error',
            `${error.code}: ${error.message}`.slice(0, 500),
            null,
            occurrenceId,
            true,
          );
          continue;
        }
        await record(
          occurrence,
          'failed',
          'error',
          (error instanceof Error ? error.message : String(error)).slice(0, 500),
          null,
          occurrenceId,
          true,
        );
      }
    }
    await advanceSchedule(tx, {
      scheduleId: row.id,
      lastSequence,
      nextDueAt: revoked ? null : nextDueAfter(row.cadence, row.startAt, row.endAt, lastSequence),
      proposed: counters.proposed,
      skipped: counters.skipped,
      failed: counters.failed,
      ...(lastProposalAt !== undefined ? { lastProposalAt } : {}),
      now: at,
    });
  };

  return {
    async createSchedule(principal, request, requestId) {
      const ownerUserId = ownerOf(principal);
      validateCadence(request.cadence);
      const at = now();
      const startAt = request.startAt === null ? at : new Date(request.startAt);
      const endAt = request.endAt === null ? null : new Date(request.endAt);
      if (endAt !== null && endAt.getTime() <= startAt.getTime()) {
        throw new ApiError('VALIDATION_FAILED', 'endAt must be after startAt');
      }
      const bound = await validateTarget(principal, request);
      const row = await createScheduleRow(db, {
        ownerUserId,
        kind: request.kind,
        label: request.label,
        cadence: request.cadence,
        target: request.target,
        ...bound,
        startAt,
        endAt,
        reviewWindowHours: request.reviewWindowHours,
        missedRunPolicy: request.missedRunPolicy,
        nextDueAt: firstOccurrenceAtOrAfter(request.cadence, startAt, startAt),
        now: at,
      });
      await audit(principal, 'maintenance.schedule.create', 'schedule', row.id, requestId, {
        kind: row.kind,
        cadence: row.cadence,
        mode: row.mode,
      });
      return scheduleOf(row);
    },

    async listSchedules(principal, query) {
      const ownerUserId = readerOf(principal);
      const rows = await listSchedules(db, ownerUserId, {
        status: query.status ?? null,
        limit: query.limit,
      });
      const schedules: Schedule[] = [];
      for (const row of rows) {
        schedules.push(await scheduleOf(row));
      }
      return { schedules, note: SCHEDULE_NOTE };
    },

    async getSchedule(principal, scheduleId) {
      const ownerUserId = readerOf(principal);
      return scheduleOf(await requireSchedule(ownerUserId, scheduleId));
    },

    async updateSchedule(principal, scheduleId, request, requestId) {
      const ownerUserId = ownerOf(principal);
      const row = await requireSchedule(ownerUserId, scheduleId);
      if (row.status === 'cancelled' || row.status === 'revoked') {
        throw new ApiError('VALIDATION_FAILED', `a ${row.status} schedule cannot be changed`);
      }
      const at = now();
      const cadence = request.cadence ?? row.cadence;
      if (request.cadence !== undefined) {
        validateCadence(request.cadence);
      }
      const endAt =
        request.endAt === undefined
          ? row.endAt
          : request.endAt === null
            ? null
            : new Date(request.endAt);
      if (endAt !== null && endAt.getTime() <= row.startAt.getTime()) {
        throw new ApiError('VALIDATION_FAILED', 'endAt must be after startAt');
      }
      let target = row.target;
      if (isInvestmentTarget(target)) {
        target = {
          ...target,
          ...(request.budget !== undefined ? { budget: request.budget } : {}),
          ...(request.slippageBps !== undefined ? { slippageBps: request.slippageBps } : {}),
        };
      } else {
        target = {
          ...target,
          ...(request.driftThresholdBps !== undefined
            ? { driftThresholdBps: request.driftThresholdBps }
            : {}),
          ...(request.minIntervalHours !== undefined
            ? { minIntervalHours: request.minIntervalHours }
            : {}),
        };
      }
      const updated = await updateScheduleRow(
        db,
        ownerUserId,
        scheduleId,
        {
          ...(request.label !== undefined ? { label: request.label } : {}),
          cadence,
          target,
          endAt,
          ...(request.reviewWindowHours !== undefined
            ? { reviewWindowHours: request.reviewWindowHours }
            : {}),
          ...(request.missedRunPolicy !== undefined
            ? { missedRunPolicy: request.missedRunPolicy }
            : {}),
          nextDueAt:
            row.status === 'active'
              ? nextDueAfter(cadence, row.startAt, endAt, row.lastSequence)
              : row.nextDueAt,
        },
        at,
      );
      if (!updated) {
        throw new ApiError('NOT_FOUND', 'no schedule with that id');
      }
      await audit(principal, 'maintenance.schedule.update', 'schedule', scheduleId, requestId, {
        fields: Object.keys(request),
      });
      return scheduleOf(updated);
    },

    async pauseSchedule(principal, scheduleId, requestId) {
      const ownerUserId = ownerOf(principal);
      const row = await requireSchedule(ownerUserId, scheduleId);
      const paused = await transitionSchedule(db, {
        ownerUserId,
        scheduleId,
        from: ['active'],
        to: 'paused',
        reason: 'paused by the owner',
        now: now(),
      });
      if (!paused) {
        throw new ApiError('VALIDATION_FAILED', `a ${row.status} schedule cannot be paused`);
      }
      await audit(principal, 'maintenance.schedule.pause', 'schedule', scheduleId, requestId);
      return scheduleOf(paused);
    },

    async resumeSchedule(principal, scheduleId, requestId) {
      const ownerUserId = ownerOf(principal);
      const row = await requireSchedule(ownerUserId, scheduleId);
      const at = now();
      // Occurrences missed while paused are decided under the missed-run policy on the next pass.
      const resumed = await transitionSchedule(db, {
        ownerUserId,
        scheduleId,
        from: ['paused'],
        to: 'active',
        reason: null,
        nextDueAt: nextDueAfter(row.cadence, row.startAt, row.endAt, row.lastSequence),
        now: at,
      });
      if (!resumed) {
        throw new ApiError('VALIDATION_FAILED', `a ${row.status} schedule cannot be resumed`);
      }
      await audit(principal, 'maintenance.schedule.resume', 'schedule', scheduleId, requestId);
      return scheduleOf(resumed);
    },

    async cancelSchedule(principal, scheduleId, requestId) {
      const ownerUserId = ownerOf(principal);
      const row = await requireSchedule(ownerUserId, scheduleId);
      const cancelled = await transitionSchedule(db, {
        ownerUserId,
        scheduleId,
        from: ['active', 'paused'],
        to: 'cancelled',
        reason: 'cancelled by the owner',
        nextDueAt: null,
        now: now(),
      });
      if (!cancelled) {
        throw new ApiError('VALIDATION_FAILED', `a ${row.status} schedule cannot be cancelled`);
      }
      await audit(principal, 'maintenance.schedule.cancel', 'schedule', scheduleId, requestId);
      return scheduleOf(cancelled);
    },

    async preview(principal, request) {
      readerOf(principal);
      validateCadence(request.cadence);
      const at = now();
      const startAt = request.startAt === null ? at : new Date(request.startAt);
      const occurrences = previewOccurrences(request.cadence, startAt, startAt, request.count);
      return {
        timeZone: request.cadence.timeZone,
        occurrences: occurrences.map((entry) => ({
          sequence: entry.sequence,
          dueAt: entry.dueAt.toISOString(),
          localTime: entry.localTime,
          utcOffsetMinutes: entry.utcOffsetMinutes,
        })),
        note: PREVIEW_NOTE,
      };
    },

    async listOccurrences(principal, scheduleId, limit) {
      const ownerUserId = readerOf(principal);
      await requireSchedule(ownerUserId, scheduleId);
      const rows = await listOccurrences(db, ownerUserId, scheduleId, limit);
      const occurrences: Occurrence[] = [];
      for (const row of rows) {
        occurrences.push(occurrenceOf(row, await proposalFor(row)));
      }
      return { occurrences, note: OCCURRENCES_NOTE };
    },

    async run(principal, request, requestId) {
      if (principal.class !== 'worker' && principal.class !== 'operator') {
        throw new ApiError(
          'FORBIDDEN',
          'maintenance passes run with a worker or operator credential',
        );
      }
      const started = Date.now();
      const at = now();
      const counters = { proposed: 0, skipped: 0, failed: 0 };
      let considered = 0;
      // One schedule per transaction: the claim locks it for this pass only, the decisions and the
      // advance commit together, and a crash in between leaves the next pass to redo exactly it.
      for (let index = 0; index < request.batchSize; index += 1) {
        const processed = await db.transaction(async (tx) => {
          const [row] = await claimDueSchedules(tx, at, 1);
          if (!row) {
            return false;
          }
          const before = { ...counters };
          const passCounters = { proposed: 0, skipped: 0, failed: 0 };
          await processSchedule(tx, row, at, requestId, passCounters);
          counters.proposed = before.proposed + passCounters.proposed;
          counters.skipped = before.skipped + passCounters.skipped;
          counters.failed = before.failed + passCounters.failed;
          return true;
        });
        if (!processed) {
          break;
        }
        considered += 1;
      }
      let expired = 0;
      for (const { occurrence, scheduleLabel } of await listExpiredOccurrences(
        db,
        at,
        request.batchSize,
      )) {
        const marked = await markOccurrenceExpired(db, occurrence.id, at);
        if (marked === null) {
          continue;
        }
        expired += 1;
        await notifications.notifyScheduleOutcome({
          ownerUserId: occurrence.ownerUserId,
          scheduleId: occurrence.scheduleId,
          occurrenceId: occurrence.id,
          label: scheduleLabel,
          status: 'expired',
          reason: null,
          detail: null,
        });
      }
      const projection = await notifications.project(request.batchSize);
      const delivery = await notifications.deliver(request.batchSize);
      const report: MaintenanceRunReport = {
        ranAt: at.toISOString(),
        requestedBy: request.requestedBy,
        schedules: { considered, ...counters, expired },
        notifications: {
          projected: projection.projected,
          delivered: delivery.delivered,
          retried: delivery.retried,
          dead: delivery.dead,
        },
        durationMs: Date.now() - started,
      };
      await audit(principal, 'maintenance.run', 'maintenance', 'pass', requestId, {
        ...report.schedules,
        ...report.notifications,
      });
      return report;
    },

    async mandateDryRun(principal, request, requestId) {
      const ownerUserId = ownerOf(principal);
      if (request.mandate.ownerUserId !== ownerUserId) {
        throw new ApiError('VALIDATION_FAILED', 'a dry run evaluates your own mandate only');
      }
      const evaluation = evaluateMandate(request.mandate, request.action, request.usage);
      const readiness = (await listCapabilityReadiness(db)).find(
        (entry) => entry.capability === 'automation.unattended',
      );
      await audit(
        principal,
        'maintenance.mandate.dry_run',
        'mandate',
        request.mandate.mandateId,
        requestId,
        {
          outcome: evaluation.outcome,
          failed: evaluation.checks.filter((check) => !check.ok).map((check) => check.code),
        },
      );
      return {
        outcome: evaluation.outcome,
        checks: evaluation.checks,
        unattended: {
          capability: 'automation.unattended',
          status: readiness?.status ?? 'DISABLED',
        },
        evaluatedAt: now().toISOString(),
        note: MANDATE_NOTE,
      };
    },
  };
}
