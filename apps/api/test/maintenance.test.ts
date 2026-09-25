import type {
  AgentProposal,
  ErrorResponse,
  MaintenanceRunReport,
  MandateDryRunResponse,
  Notification,
  NotificationListResponse,
  NotificationPreferences,
  Occurrence,
  OccurrenceListResponse,
  ProposalOpenResponse,
  Schedule,
  SchedulePreviewResponse,
  StrategyDraftContent,
} from '@markov/contracts';
import { advanceSchedule } from '@markov/db';
import { localTimeOf } from '@markov/maintenance';
import { createFixtureEmailAdapter } from '@markov/notifications';
import { describe, expect, it } from 'vitest';
import { adminUrl, bearer, type Harness, withHarness } from './support/harness.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function content(ids: Record<string, string>): StrategyDraftContent {
  return {
    title: 'Aerospace pair',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    kind: 'stock_spot_basket',
    legs: [
      { instrumentId: ids['aero'] as string, weightBps: 6000, note: null },
      { instrumentId: ids['xsa'] as string, weightBps: 3000, note: null },
    ],
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: 500, reviewEveryDays: null },
    references: [],
  };
}

/** A daily UTC cadence whose first occurrence fell `minutesAgo` before the harness clock. */
function dailyFrom(
  h: Harness,
  minutesAgo: number,
  daysBack = 0,
): { cadence: Record<string, unknown>; startAt: string } {
  const at = new Date(h.clock.current.getTime() - minutesAgo * 60_000 - daysBack * DAY);
  const local = localTimeOf(at, 'UTC');
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    cadence: { unit: 'day', timeOfDay: `${pad(local.hour)}:${pad(local.minute)}`, timeZone: 'UTC' },
    startAt: new Date(at.getTime() - 30 * 60_000).toISOString(),
  };
}

const errorOf = (response: { json(): unknown }) => (response.json() as ErrorResponse).error;

async function userId(h: Harness, token: string): Promise<string> {
  const response = await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
  return (response.json() as { user: { id: string } }).user.id;
}

const run = async (h: Harness, token: string, batchSize = 20): Promise<MaintenanceRunReport> => {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/ops/maintenance/run',
    headers: bearer(token),
    payload: { batchSize, requestedBy: 'maintenance-test' },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as MaintenanceRunReport;
};

const occurrencesOf = async (
  h: Harness,
  token: string,
  scheduleId: string,
): Promise<Occurrence[]> => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/schedules/${scheduleId}/occurrences`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as OccurrenceListResponse).occurrences;
};

const scheduleOf = async (h: Harness, token: string, scheduleId: string): Promise<Schedule> => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/schedules/${scheduleId}`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Schedule;
};

const notificationsOf = async (
  h: Harness,
  token: string,
  query = '',
): Promise<NotificationListResponse> => {
  const response = await h.app.inject({
    method: 'GET',
    url: `/v1/me/notifications${query}`,
    headers: bearer(token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as NotificationListResponse;
};

describe.skipIf(adminUrl === null)('maintenance API', () => {
  it('prepares proposals on schedule for the owner’s approval, never spends, dedups across restarts and skips missed occurrences', async () => {
    await withHarness({ venue: 'fixture' }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const bob = await h.user('did:test:bob');
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.fund(wallet.signer.publicKey, { lamports: 1_000_000_000, stablecoinRaw: 5_000_000_000n });
      const aliceId = await userId(h, alice);
      const agent = await h.agent(aliceId, ['proposals:create', 'portfolio:read', 'research:read']);
      const runner = await h.operator(['ops:maintenance:run', 'ops:read']);
      const readOnlyOperator = await h.operator(['ops:read']);
      const version = await h.freezeVersion(alice, content(ids));

      // Preview: wall-clock time kept across the American spring change.
      const preview = await h.app.inject({
        method: 'POST',
        url: '/v1/me/schedules/preview',
        headers: bearer(alice),
        payload: {
          cadence: { unit: 'day', timeOfDay: '09:00', timeZone: 'America/New_York' },
          startAt: '2026-03-06T00:00:00.000Z',
          count: 4,
        },
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const previewed = preview.json() as SchedulePreviewResponse;
      expect(previewed.occurrences.map((entry) => [entry.dueAt, entry.utcOffsetMinutes])).toEqual([
        ['2026-03-06T14:00:00.000Z', -300],
        ['2026-03-07T14:00:00.000Z', -300],
        ['2026-03-08T13:00:00.000Z', -240],
        ['2026-03-09T13:00:00.000Z', -240],
      ]);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/schedules/preview',
            headers: bearer(alice),
            payload: { cadence: { unit: 'day', timeZone: 'Mars/Olympus_Mons' } },
          })
        ).statusCode,
      ).toBe(400);

      // Create: the mode is prepare_for_approval and nothing else; agents cannot create schedules.
      const due = dailyFrom(h, 90);
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/schedules',
        headers: bearer(alice),
        payload: {
          kind: 'recurring_investment',
          label: 'Monthly aerospace',
          cadence: due.cadence,
          startAt: due.startAt,
          target: {
            strategyVersionId: version.versionId,
            walletId: wallet.walletId,
            budget: { rawAmount: '1000000000' },
          },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const schedule = created.json() as Schedule;
      expect(schedule).toMatchObject({
        kind: 'recurring_investment',
        status: 'active',
        mode: 'prepare_for_approval',
        lastSequence: 0,
        missedRunPolicy: 'skip',
      });
      expect(schedule.nextDueAt).not.toBeNull();
      expect(new Date(schedule.nextDueAt as string).getTime()).toBeLessThan(
        h.clock.current.getTime(),
      );
      const unattended = await h.app.inject({
        method: 'POST',
        url: '/v1/me/schedules',
        headers: bearer(alice),
        payload: {
          kind: 'recurring_investment',
          label: 'Nope',
          cadence: due.cadence,
          mode: 'unattended',
          target: {
            strategyVersionId: version.versionId,
            walletId: wallet.walletId,
            budget: { rawAmount: '1000000000' },
          },
        },
      });
      expect(unattended.statusCode).toBe(400);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/schedules',
            headers: bearer(agent),
            payload: {
              kind: 'recurring_investment',
              label: 'Agent',
              cadence: due.cadence,
              target: {
                strategyVersionId: version.versionId,
                walletId: wallet.walletId,
                budget: { rawAmount: '1000000000' },
              },
            },
          })
        ).statusCode,
      ).toBe(403);
      // Another person's wallet is not the owner's.
      const bobWallet = await h.linkWallet(bob);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/schedules',
            headers: bearer(alice),
            payload: {
              kind: 'recurring_investment',
              label: 'Foreign',
              cadence: due.cadence,
              target: {
                strategyVersionId: version.versionId,
                walletId: bobWallet.walletId,
                budget: { rawAmount: '1000000000' },
              },
            },
          })
        ).statusCode,
      ).toBe(404);

      // Only a worker or an operator with the scope runs a pass.
      for (const token of [alice, agent, readOnlyOperator]) {
        expect(
          (
            await h.app.inject({
              method: 'POST',
              url: '/v1/ops/maintenance/run',
              headers: bearer(token),
              payload: { batchSize: 10 },
            })
          ).statusCode,
        ).toBe(403);
      }

      // First pass: the due occurrence becomes an investment proposal and a notification.
      const first = await run(h, runner);
      expect(first.schedules).toEqual({
        considered: 1,
        proposed: 1,
        skipped: 0,
        failed: 0,
        expired: 0,
      });
      expect(first.notifications.projected).toBeGreaterThanOrEqual(1);
      const again = await run(h, runner);
      expect(again.schedules.considered).toBe(0);
      const occurrences = await occurrencesOf(h, alice, schedule.scheduleId);
      expect(occurrences).toHaveLength(1);
      const occurrence = occurrences[0] as Occurrence;
      expect(occurrence).toMatchObject({ sequence: 1, status: 'proposed', reason: null });
      expect(occurrence.dedupKey).toBe(`schedule:${schedule.scheduleId}:1`);
      const proposalId = occurrence.proposalId as string;
      const proposal = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/proposals/${proposalId}`,
          headers: bearer(alice),
        })
      ).json() as AgentProposal;
      expect(proposal).toMatchObject({
        kind: 'investment',
        status: 'proposed',
        scheduleId: schedule.scheduleId,
        occurrenceId: occurrence.occurrenceId,
        createdBy: `agent:schedule:${schedule.scheduleId}`,
      });
      expect(proposal.expiresAt).toBe(occurrence.windowEndsAt);
      if (proposal.kind === 'investment') {
        expect(proposal.payload.request).toMatchObject({
          kind: 'basket_investment',
          approvalMode: 'owner_each_plan',
          walletId: wallet.walletId,
          budget: { rawAmount: '1000000000' },
        });
      }
      const after = await scheduleOf(h, alice, schedule.scheduleId);
      expect(after.lastSequence).toBe(1);
      expect(after.counts).toEqual({ proposed: 1, skipped: 0, failed: 0 });
      expect(after.lastOccurrence?.proposalId).toBe(proposalId);
      const notified = await notificationsOf(h, alice);
      expect(notified.notifications.map((entry) => entry.kind)).toContain('proposal.created');
      const proposalNotification = notified.notifications.find(
        (entry) => entry.kind === 'proposal.created',
      ) as Notification;
      expect(proposalNotification.link).toEqual({ type: 'proposal', id: proposalId });
      expect(proposalNotification.deliveries).toEqual([
        expect.objectContaining({ channel: 'in_app', status: 'delivered' }),
      ]);
      expect(proposalNotification.body).toContain('A schedule prepared');
      expect(notified.unread).toBeGreaterThanOrEqual(1);

      // No authority path: the schedule's agent principal, an agent credential and an operator cannot open; the owner opens into a DRAFT intent.
      for (const token of [agent, runner]) {
        expect(
          (
            await h.app.inject({
              method: 'POST',
              url: `/v1/me/proposals/${proposalId}/open`,
              headers: bearer(token),
            })
          ).statusCode,
        ).toBe(403);
      }
      const opened = await h.app.inject({
        method: 'POST',
        url: `/v1/me/proposals/${proposalId}/open`,
        headers: bearer(alice),
      });
      expect(opened.statusCode, opened.body).toBe(200);
      const openedBody = opened.json() as ProposalOpenResponse;
      expect(openedBody.intent).toMatchObject({ state: 'DRAFT', approvalMode: 'owner_each_plan' });
      expect(openedBody.rebalance).toBeNull();
      expect((await occurrencesOf(h, alice, schedule.scheduleId))[0]?.status).toBe('opened');

      // Restart recovery: the schedule is rewound as if the pass died after creating the proposal and before
      // committing its occurrence; the next pass finds the proposal by its dedup key and makes no second one.
      await advanceSchedule(h.db, {
        scheduleId: schedule.scheduleId,
        lastSequence: 0,
        nextDueAt: new Date(schedule.nextDueAt as string),
        proposed: 0,
        skipped: 0,
        failed: 0,
        now: h.clock.current,
      });
      const recovered = await run(h, runner);
      expect(recovered.schedules).toMatchObject({ considered: 1, proposed: 1 });
      const proposals = (
        await h.app.inject({ method: 'GET', url: '/v1/me/proposals', headers: bearer(alice) })
      ).json() as { proposals: AgentProposal[] };
      expect(
        proposals.proposals.filter((entry) => entry.scheduleId === schedule.scheduleId),
      ).toHaveLength(1);
      expect(await occurrencesOf(h, alice, schedule.scheduleId)).toHaveLength(1);
      expect((await scheduleOf(h, alice, schedule.scheduleId)).lastSequence).toBe(1);

      // Missed occurrences are skipped, never accumulated: three days of a one-hour window, only today's is live.
      const missed = dailyFrom(h, 20, 3);
      const late = await h.app.inject({
        method: 'POST',
        url: '/v1/me/schedules',
        headers: bearer(alice),
        payload: {
          kind: 'recurring_investment',
          label: 'Late starter',
          cadence: missed.cadence,
          startAt: missed.startAt,
          reviewWindowHours: 1,
          target: {
            instrumentId: ids['aero'],
            walletId: wallet.walletId,
            budget: { rawAmount: '100000000' },
          },
        },
      });
      expect(late.statusCode, late.body).toBe(201);
      const lateSchedule = late.json() as Schedule;
      const latePass = await run(h, runner);
      expect(latePass.schedules).toMatchObject({
        considered: 1,
        proposed: 1,
        skipped: 3,
        failed: 0,
      });
      const lateOccurrences = await occurrencesOf(h, alice, lateSchedule.scheduleId);
      expect(lateOccurrences.map((entry) => [entry.sequence, entry.status, entry.reason])).toEqual([
        [4, 'proposed', null],
        [3, 'skipped', 'missed_window'],
        [2, 'skipped', 'missed_window'],
        [1, 'skipped', 'missed_window'],
      ]);
      const skippedNotices = (await notificationsOf(h, alice, '?category=schedules')).notifications;
      expect(skippedNotices.filter((entry) => entry.kind === 'schedule.skipped')).toHaveLength(3);
      expect(skippedNotices[0]?.link).toEqual({ type: 'schedule', id: lateSchedule.scheduleId });

      // Pause keeps its place; resume decides what came due meanwhile; cancel ends it for good.
      const paused = await h.app.inject({
        method: 'POST',
        url: `/v1/me/schedules/${schedule.scheduleId}/pause`,
        headers: bearer(alice),
      });
      expect(paused.statusCode, paused.body).toBe(200);
      expect((paused.json() as Schedule).status).toBe('paused');
      expect((paused.json() as Schedule).nextDueAt).toBeNull();
      h.clock.advance(DAY);
      const whilePaused = await run(h, runner);
      expect(whilePaused.schedules.considered).toBe(1); // the late starter's next day
      expect((await occurrencesOf(h, alice, schedule.scheduleId)).length).toBe(1);
      const resumed = await h.app.inject({
        method: 'POST',
        url: `/v1/me/schedules/${schedule.scheduleId}/resume`,
        headers: bearer(alice),
      });
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect((resumed.json() as Schedule).status).toBe('active');
      const afterResume = await run(h, runner);
      expect(afterResume.schedules.proposed).toBe(1);
      expect((await occurrencesOf(h, alice, schedule.scheduleId)).map((o) => o.sequence)).toEqual([
        2, 1,
      ]);
      const updated = await h.app.inject({
        method: 'PATCH',
        url: `/v1/me/schedules/${schedule.scheduleId}`,
        headers: bearer(alice),
        payload: { label: 'Monthly aerospace (smaller)', budget: { rawAmount: '500000000' } },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((updated.json() as Schedule).label).toBe('Monthly aerospace (smaller)');
      expect(
        ((updated.json() as Schedule).target as { budget: { rawAmount: string } }).budget.rawAmount,
      ).toBe('500000000');
      const cancelled = await h.app.inject({
        method: 'POST',
        url: `/v1/me/schedules/${schedule.scheduleId}/cancel`,
        headers: bearer(alice),
      });
      expect((cancelled.json() as Schedule).status).toBe('cancelled');
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/schedules/${schedule.scheduleId}/pause`,
            headers: bearer(alice),
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await h.app.inject({
            method: 'PATCH',
            url: `/v1/me/schedules/${schedule.scheduleId}`,
            headers: bearer(alice),
            payload: { label: 'x' },
          })
        ).statusCode,
      ).toBe(400);
      h.clock.advance(DAY);
      const afterCancel = await run(h, runner);
      expect(afterCancel.schedules.considered).toBe(1); // still only the late starter
      expect(await occurrencesOf(h, alice, schedule.scheduleId)).toHaveLength(2);

      // Review expiry: the second proposal was not opened; two days on it expired and the owner was told.
      expect(afterCancel.schedules.expired).toBeGreaterThanOrEqual(1);
      const expiredOccurrence = (await occurrencesOf(h, alice, schedule.scheduleId)).find(
        (entry) => entry.sequence === 2,
      ) as Occurrence;
      expect(expiredOccurrence.status).toBe('expired');
      expect(
        (await notificationsOf(h, alice, '?category=schedules')).notifications.some(
          (entry) => entry.kind === 'schedule.expired',
        ),
      ).toBe(true);

      // Revocation: the wallet a schedule relies on is unlinked; the next pass records the failure and revokes it.
      const unlinked = await h.app.inject({
        method: 'DELETE',
        url: `/v1/me/wallets/${wallet.walletId}`,
        headers: bearer(alice),
      });
      expect(unlinked.statusCode, unlinked.body).toBe(204);
      h.clock.advance(DAY);
      const afterUnlink = await run(h, runner);
      expect(afterUnlink.schedules.failed).toBe(1);
      const revoked = await scheduleOf(h, alice, lateSchedule.scheduleId);
      expect(revoked.status).toBe('revoked');
      expect(revoked.statusReason).toContain('target unavailable');
      expect(revoked.lastOccurrence).toMatchObject({
        status: 'failed',
        reason: 'target_unavailable',
      });
      expect(
        (await notificationsOf(h, alice, '?category=schedules')).notifications.some(
          (entry) => entry.kind === 'schedule.failed',
        ),
      ).toBe(true);

      // Cross-account: another person sees nothing; agents of the owner read but do not manage.
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: `/v1/me/schedules/${schedule.scheduleId}`,
            headers: bearer(bob),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/schedules', headers: bearer(bob) })
          ).json() as {
            schedules: Schedule[];
          }
        ).schedules,
      ).toEqual([]);
      expect(
        (
          (
            await h.app.inject({ method: 'GET', url: '/v1/me/schedules', headers: bearer(agent) })
          ).json() as {
            schedules: Schedule[];
          }
        ).schedules,
      ).toHaveLength(2);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/v1/me/schedules/${lateSchedule.scheduleId}/cancel`,
            headers: bearer(agent),
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  it('checks drift on schedule, opens a rebalance into reviewed intents, and never proposes twice while one waits', async () => {
    await withHarness({ venue: 'fixture' }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      await h.makeEligible(alice);
      const wallet = await h.linkWallet(alice);
      h.fund(wallet.signer.publicKey, { lamports: 1_000_000_000, stablecoinRaw: 5_000_000_000n });
      const runner = await h.operator(['ops:maintenance:run']);
      const version = await h.freezeVersion(alice, content(ids));
      const instance = (
        await h.app.inject({
          method: 'POST',
          url: '/v1/me/instances',
          headers: bearer(alice),
          payload: {
            strategyId: version.strategyId,
            versionId: version.versionId,
            walletId: wallet.walletId,
            label: 'drift watch',
          },
        })
      ).json() as { instanceId: string };
      const due = dailyFrom(h, 60);
      const created = await h.app.inject({
        method: 'POST',
        url: '/v1/me/schedules',
        headers: bearer(alice),
        payload: {
          kind: 'drift_rebalance',
          label: 'Weekly drift check',
          cadence: due.cadence,
          startAt: due.startAt,
          reviewWindowHours: 48,
          target: { instanceId: instance.instanceId, minIntervalHours: 24 },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const schedule = created.json() as Schedule;
      expect(schedule.kind).toBe('drift_rebalance');

      // An empty instance drifts entirely from its target: the creator's threshold (500 bps) is exceeded.
      const first = await run(h, runner);
      expect(first.schedules).toMatchObject({ considered: 1, proposed: 1, skipped: 0, failed: 0 });
      const occurrence = (await occurrencesOf(h, alice, schedule.scheduleId))[0] as Occurrence;
      expect(occurrence.status).toBe('proposed');
      const proposal = (
        await h.app.inject({
          method: 'GET',
          url: `/v1/me/proposals/${occurrence.proposalId as string}`,
          headers: bearer(alice),
        })
      ).json() as AgentProposal;
      expect(proposal.kind).toBe('rebalance');
      if (proposal.kind === 'rebalance') {
        expect(proposal.payload.allocation.exceedsThreshold).toBe(true);
        // Nothing is held yet, so nothing can be sized into a sell or a buy: the review is a report.
        expect(proposal.payload.legs).toEqual([]);
        expect(proposal.payload.executable).toBe(false);
      }
      // The next day: an open rebalance proposal exists, so the check is skipped quietly.
      h.clock.advance(DAY);
      const second = await run(h, runner);
      expect(second.schedules).toMatchObject({ considered: 1, proposed: 0, skipped: 1 });
      const occurrences = await occurrencesOf(h, alice, schedule.scheduleId);
      expect(occurrences.map((entry) => [entry.sequence, entry.status, entry.reason])).toEqual([
        [2, 'skipped', 'open_proposal_exists'],
        [1, 'proposed', null],
      ]);
      expect((await notificationsOf(h, alice, '?category=schedules')).notifications).toEqual([]);
      // The owner opens the report: no legs, no intents, and the proposal is opened rather than executed.
      const opened = (
        await h.app.inject({
          method: 'POST',
          url: `/v1/me/proposals/${occurrence.proposalId as string}/open`,
          headers: bearer(alice),
        })
      ).json() as ProposalOpenResponse;
      expect(opened.proposal.status).toBe('opened');
      expect(opened.intent).toBeNull();
      expect(opened.rebalance).toEqual({
        intents: [],
        note: expect.stringContaining('ordinary intent'),
      });
      // With the proposal opened, the following day's check proposes again (the interval of a day has passed).
      h.clock.advance(DAY + HOUR);
      const third = await run(h, runner);
      expect(third.schedules).toMatchObject({ proposed: 1 });
    });
  });

  it('delivers notifications in-app, by verified email only, retries then dead-letters a failing provider, and dry-runs a mandate', async () => {
    const email = createFixtureEmailAdapter({
      // Verification messages go through; every notification message is refused with a retryable outcome.
      fail: (message) => (message.idempotencyKey.startsWith('notification:') ? 'retryable' : null),
    });
    await withHarness({ venue: 'fixture', email }, async (h) => {
      const ids = await h.seed(await h.operator(['ops:catalog:read', 'ops:catalog:write']));
      const alice = await h.user();
      const bob = await h.user('did:test:bob');
      const aliceId = await userId(h, alice);
      const runner = await h.operator(['ops:maintenance:run', 'ops:read']);
      const wallet = await h.linkWallet(alice);

      // Preferences: in-app everywhere, email only for security until the owner says otherwise.
      const defaults = (
        await h.app.inject({
          method: 'GET',
          url: '/v1/me/notification-preferences',
          headers: bearer(alice),
        })
      ).json() as NotificationPreferences;
      expect(defaults.email).toMatchObject({
        address: null,
        verifiedAt: null,
        provider: 'fixture',
      });
      expect(defaults.categories.proposals).toEqual({ inApp: true, email: false });
      expect(defaults.categories.security).toEqual({ inApp: true, email: true });

      // Email: set, receive a code through the adapter, refuse a wrong code, verify, turn proposals on.
      const set = await h.app.inject({
        method: 'POST',
        url: '/v1/me/notification-preferences/email',
        headers: bearer(alice),
        payload: { address: 'alice@example.com' },
      });
      expect(set.statusCode, set.body).toBe(200);
      expect((set.json() as { verification: { status: string } }).verification.status).toBe('sent');
      const verification = email.sent[email.sent.length - 1];
      expect(verification?.to).toBe('alice@example.com');
      expect(verification?.text).not.toMatch(/mkv_/);
      const code = /notifications: (\d{6})/.exec(verification?.text ?? '')?.[1] as string;
      expect(code).toMatch(/^\d{6}$/);
      const wrong = await h.app.inject({
        method: 'POST',
        url: '/v1/me/notification-preferences/email/verify',
        headers: bearer(alice),
        payload: { code: code === '000000' ? '000001' : '000000' },
      });
      expect(wrong.statusCode).toBe(400);
      const verified = await h.app.inject({
        method: 'POST',
        url: '/v1/me/notification-preferences/email/verify',
        headers: bearer(alice),
        payload: { code },
      });
      expect(verified.statusCode, verified.body).toBe(200);
      expect((verified.json() as NotificationPreferences).email.verifiedAt).not.toBeNull();
      const turnedOn = await h.app.inject({
        method: 'PUT',
        url: '/v1/me/notification-preferences',
        headers: bearer(alice),
        payload: { categories: { proposals: { inApp: true, email: true } } },
      });
      expect(turnedOn.statusCode, turnedOn.body).toBe(200);
      expect((turnedOn.json() as NotificationPreferences).categories.proposals.email).toBe(true);

      // A proposal by the owner's own hand becomes a notification with an email delivery that the provider refuses.
      const proposed = await h.app.inject({
        method: 'POST',
        url: '/v1/agent/tools/basket.propose',
        headers: bearer(alice),
        payload: { content: content(ids) },
      });
      expect(proposed.statusCode, proposed.body).toBe(200);
      let report = await run(h, runner);
      expect(report.notifications.projected).toBeGreaterThanOrEqual(1);
      expect(report.notifications.retried).toBe(1);
      const listed = await notificationsOf(h, alice, '?category=proposals');
      const notification = listed.notifications[0] as Notification;
      expect(
        notification.deliveries.map((entry) => [entry.channel, entry.status, entry.attempts]),
      ).toEqual([
        ['email', 'queued', 1],
        ['in_app', 'delivered', 1],
      ]);
      expect(email.refused.map((entry) => entry.message.to)).toEqual(['alice@example.com']);
      expect(email.refused[0]?.message.text).toContain(`/proposals/${notification.link?.id}`);
      // Retries follow the backoff, then the delivery is dead-lettered for an operator.
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        h.clock.advance(5 * HOUR);
        report = await run(h, runner);
      }
      expect(report.notifications.dead).toBe(1);
      const dead = await h.app.inject({
        method: 'GET',
        url: '/v1/ops/notifications/dead-letter',
        headers: bearer(runner),
      });
      expect(dead.statusCode, dead.body).toBe(200);
      expect(
        (dead.json() as { deliveries: { notificationId: string; attempts: number }[] }).deliveries,
      ).toEqual([
        expect.objectContaining({
          notificationId: notification.notificationId,
          attempts: 5,
          channel: 'email',
        }),
      ]);
      const retried = await h.app.inject({
        method: 'POST',
        url: `/v1/ops/notifications/${notification.notificationId}/retry`,
        headers: bearer(runner),
        payload: { channel: 'email' },
      });
      expect(retried.statusCode, retried.body).toBe(200);
      expect((retried.json() as { status: string }).status).toBe('queued');
      // Read state and paging.
      const read = await h.app.inject({
        method: 'POST',
        url: `/v1/me/notifications/${notification.notificationId}/read`,
        headers: bearer(alice),
      });
      expect(read.statusCode, read.body).toBe(200);
      expect((read.json() as Notification).readAt).not.toBeNull();
      expect(
        (await notificationsOf(h, alice, '?unread=true')).notifications.map(
          (n) => n.notificationId,
        ),
      ).not.toContain(notification.notificationId);
      // Other people and agents see nothing; a paired device with notifications:receive reads them.
      expect((await notificationsOf(h, bob)).notifications).toEqual([]);
      const agent = await h.agent(aliceId, ['portfolio:read']);
      expect(
        (await h.app.inject({ method: 'GET', url: '/v1/me/notifications', headers: bearer(agent) }))
          .statusCode,
      ).toBe(403);
      const pairing = await h.app.inject({
        method: 'POST',
        url: '/v1/me/devices/pairings',
        headers: bearer(alice),
        payload: { capabilities: ['notifications:receive'] },
      });
      const paired = await h.app.inject({
        method: 'POST',
        url: '/v1/devices/pair',
        payload: { code: (pairing.json() as { code: string }).code, deviceName: 'Mark I' },
      });
      expect(paired.statusCode, paired.body).toBe(201);
      const byDevice = await notificationsOf(
        h,
        (paired.json() as { deviceToken: string }).deviceToken,
      );
      expect(byDevice.notifications.map((entry) => entry.notificationId)).toContain(
        notification.notificationId,
      );
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: '/v1/me/notification-preferences',
            headers: bearer((paired.json() as { deviceToken: string }).deviceToken),
          })
        ).statusCode,
      ).toBe(403);
      // Removing the address stops email at once: a new proposal projects with in-app only.
      const cleared = await h.app.inject({
        method: 'DELETE',
        url: '/v1/me/notification-preferences/email',
        headers: bearer(alice),
      });
      expect((cleared.json() as NotificationPreferences).email.address).toBeNull();
      await h.app.inject({
        method: 'POST',
        url: '/v1/agent/tools/basket.propose',
        headers: bearer(alice),
        payload: { content: { ...content(ids), title: 'Second draft' } },
      });
      await run(h, runner);
      const latest = (await notificationsOf(h, alice, '?category=proposals')).notifications.at(
        -1,
      ) as Notification;
      expect(latest.deliveries.map((entry) => entry.channel)).toEqual(['in_app']);

      // Mandate dry run: a bounded envelope evaluated deterministically; unattended stays DISABLED.
      const genesis =
        h.config.solana.expectedGenesisHash ?? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      const mandate = {
        mandateId: '00000000-0000-4000-8000-000000000010',
        ownerUserId: aliceId,
        walletId: wallet.walletId,
        strategyVersionId: '00000000-0000-4000-8000-000000000013',
        chain: { cluster: 'devnet', genesisHash: genesis },
        allowedInstrumentIds: [ids['aero']],
        allowedVenues: ['jupiter'],
        actions: ['buy', 'sell'],
        destinations: { inputWalletId: wallet.walletId, outputWalletId: wallet.walletId },
        perOrderBudgetRaw: '100000000',
        periodBudget: { windowDays: 30, rawAmount: '300000000' },
        cumulativeTurnoverRaw: '1000000000',
        maxFeeBps: 50,
        maintenance: { allowBuys: true, allowSells: true, reduceOnly: false, maxSlippageBps: 100 },
        expiresAt: new Date(h.clock.current.getTime() + 30 * DAY).toISOString(),
        nonce: 1,
      };
      const action = {
        kind: 'buy',
        ownerUserId: aliceId,
        walletId: wallet.walletId,
        strategyVersionId: mandate.strategyVersionId,
        chain: mandate.chain,
        venue: 'jupiter',
        instrumentIds: [ids['aero']],
        sides: ['buy'],
        notionalRaw: '50000000',
        feeBps: 25,
        slippageBps: 50,
        destinations: mandate.destinations,
        nonce: 1,
        at: h.clock.current.toISOString(),
      };
      const dryRun = await h.app.inject({
        method: 'POST',
        url: '/v1/me/mandates/dry-run',
        headers: bearer(alice),
        payload: { mandate, action },
      });
      expect(dryRun.statusCode, dryRun.body).toBe(200);
      const evaluated = dryRun.json() as MandateDryRunResponse;
      expect(evaluated.outcome).toBe('allow');
      expect(evaluated.unattended).toEqual({
        capability: 'automation.unattended',
        status: 'DISABLED',
      });
      const widened = await h.app.inject({
        method: 'POST',
        url: '/v1/me/mandates/dry-run',
        headers: bearer(alice),
        payload: {
          mandate: { ...mandate, maintenance: { ...mandate.maintenance, reduceOnly: true } },
          action,
        },
      });
      expect((widened.json() as MandateDryRunResponse).outcome).toBe('deny');
      expect(
        (widened.json() as MandateDryRunResponse).checks
          .filter((check) => !check.ok)
          .map((check) => check.code),
      ).toEqual(['SIDES_PERMITTED']);
      expect(
        errorOf(
          await h.app.inject({
            method: 'POST',
            url: '/v1/me/mandates/dry-run',
            headers: bearer(bob),
            payload: { mandate, action },
          }),
        ).code,
      ).toBe('VALIDATION_FAILED');
    });
  });
});
