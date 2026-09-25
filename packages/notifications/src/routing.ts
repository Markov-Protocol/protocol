import type {
  CategoryPreferences,
  MarkEvent,
  NotificationCategory,
  NotificationChannel,
  OccurrenceReason,
  OccurrenceStatus,
} from '@markov/contracts';

/**
 * Routing (B16): which owner events become notifications, in which
 * category, with which title and body, and which channels carry them. Text
 * is plain, states are named, amounts are never invented, and a link names a
 * resource the app opens after its own authentication.
 */

export interface RoutedNotification {
  readonly category: NotificationCategory;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link: {
    readonly type:
      | 'proposal'
      | 'intent'
      | 'plan'
      | 'schedule'
      | 'occurrence'
      | 'instance'
      | 'device'
      | 'run';
    readonly id: string;
  } | null;
}

function text(value: unknown, fallback: string, max = 200): string {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : fallback;
}

/**
 * Routes one Mark I event. Returns null for events the owner is told about
 * by another event of the same fact (a proposal's `review.required` follows
 * its `proposal.created`) so nobody is notified twice.
 */
export function routeMarkEvent(
  event: Pick<MarkEvent, 'kind' | 'subject' | 'payload'>,
): RoutedNotification | null {
  const payload = event.payload;
  switch (event.kind) {
    case 'proposal.created': {
      const kind = text(payload['kind'], 'proposal', 40);
      const source = text(payload['createdBy'], '', 120);
      // Who prepared it: a schedule's principal, an agent credential, a companion run, or the owner through the tool API.
      const origin = source.includes('schedule:')
        ? 'A schedule'
        : source.startsWith('agent:')
          ? 'An agent credential'
          : typeof payload['runId'] === 'string'
            ? 'The companion'
            : 'You';
      return {
        category: 'proposals',
        kind: event.kind,
        title:
          kind === 'investment'
            ? 'An investment proposal is waiting for your review'
            : kind === 'rebalance'
              ? 'A rebalance proposal is waiting for your review'
              : 'A strategy draft is waiting for your review',
        body: `${origin} prepared a ${kind.replace('_', ' ')} proposal. Nothing happens until you open it, review the plan and sign.`,
        link: { type: 'proposal', id: event.subject.id },
      };
    }
    case 'review.required': {
      if (event.subject.type === 'proposal') {
        return null;
      }
      if (event.subject.type === 'plan') {
        const intentId = text(payload['intentId'], event.subject.id, 100);
        return {
          category: 'execution',
          kind: event.kind,
          title: 'A plan is ready for your review',
          body: 'A quoted plan waits for your acknowledgement and signature; it expires on its own if you do nothing.',
          link: { type: 'intent', id: intentId },
        };
      }
      return {
        category: 'execution',
        kind: event.kind,
        title: 'An order needs your attention',
        body: `The order is in state ${text(payload['state'], 'UNKNOWN', 40)} and needs reconciliation: ${text(payload['reason'], 'see the order for details', 200)}.`,
        link: { type: 'intent', id: event.subject.id },
      };
    }
    case 'execution.pending':
      return {
        category: 'execution',
        kind: event.kind,
        title: 'Your transaction was submitted',
        body: 'The signed transaction is being observed on chain; the order updates as evidence lands.',
        link: { type: 'intent', id: event.subject.id },
      };
    case 'execution.finalized':
      return {
        category: 'execution',
        kind: event.kind,
        title: 'Your order finalized',
        body: 'Every fill was read from the landed transaction and a receipt is available.',
        link: { type: 'intent', id: event.subject.id },
      };
    case 'execution.failed':
      return {
        category: 'execution',
        kind: event.kind,
        title: 'Your order did not complete',
        body: `The order ended in state ${text(payload['state'], 'FAILED', 40)}${payload['reason'] ? `: ${text(payload['reason'], '', 200)}` : ''}. Nothing further is spent.`,
        link: { type: 'intent', id: event.subject.id },
      };
    case 'data.stale':
      return {
        category: 'data',
        kind: event.kind,
        title: 'Some reference data is stale',
        body:
          event.subject.type === 'instance'
            ? 'A leg of this instance could not be valued on fresh data; drift and rebalance figures wait for a fresh observation.'
            : 'An answer rested on stale reference data; treat its figures as indicative only.',
        link:
          event.subject.type === 'instance'
            ? { type: 'instance', id: event.subject.id }
            : event.subject.type === 'run'
              ? { type: 'run', id: event.subject.id }
              : null,
      };
    case 'device.revoked':
      return {
        category: 'security',
        kind: event.kind,
        title: 'A paired device was revoked',
        body: `The device ${text(payload['name'], 'you paired', 60)} can no longer read your account. If you did not do this, review your devices now.`,
        link: { type: 'device', id: event.subject.id },
      };
    default:
      return null;
  }
}

/** Schedule outcomes the owner is told about; a proposed occurrence is announced by its proposal. */
export function routeScheduleOutcome(input: {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly label: string;
  readonly status: OccurrenceStatus;
  readonly reason: OccurrenceReason | null;
  readonly detail: string | null;
}): RoutedNotification | null {
  const label = input.label.slice(0, 100);
  switch (input.status) {
    case 'skipped':
      return {
        category: 'schedules',
        kind: 'schedule.skipped',
        title: `"${label}" skipped an occurrence`,
        body:
          input.reason === 'missed_window' || input.reason === 'superseded_by_catch_up'
            ? 'Its review window had already closed, so no budget was proposed; missed occurrences never accumulate.'
            : `No proposal was made: ${describeReason(input.reason)}.`,
        link: { type: 'schedule', id: input.scheduleId },
      };
    case 'failed':
      return {
        category: 'schedules',
        kind: 'schedule.failed',
        title: `"${label}" could not prepare a proposal`,
        body: `${describeReason(input.reason)}${input.detail ? `: ${input.detail.slice(0, 200)}` : ''}. The schedule stays active and tries again at its next occurrence.`,
        link: { type: 'schedule', id: input.scheduleId },
      };
    case 'expired':
      return {
        category: 'schedules',
        kind: 'schedule.expired',
        title: `A proposal from "${label}" expired unopened`,
        body: 'Its review window closed. Nothing was spent; the next occurrence prepares a fresh one.',
        link: { type: 'schedule', id: input.scheduleId },
      };
    default:
      return null;
  }
}

export function describeReason(reason: OccurrenceReason | null): string {
  switch (reason) {
    case 'missed_window':
      return 'the review window had closed';
    case 'superseded_by_catch_up':
      return 'a later missed occurrence was caught up instead';
    case 'schedule_not_active':
      return 'the schedule was not active';
    case 'no_drift':
      return 'the allocation is within its threshold';
    case 'within_min_interval':
      return 'a rebalance was proposed recently';
    case 'open_proposal_exists':
      return 'a rebalance proposal is already waiting';
    case 'threshold_unset':
      return 'no drift threshold is set';
    case 'policy_denied':
      return 'the policy denied the proposal';
    case 'target_unavailable':
      return 'the wallet, version, instrument or instance is no longer available';
    case 'error':
      return 'an unexpected error occurred';
    default:
      return 'no reason was recorded';
  }
}

/** Channels a notification of a category takes under the owner's preferences; email needs a verified address. */
export function channelsFor(
  category: NotificationCategory,
  preferences: CategoryPreferences,
  emailVerified: boolean,
): NotificationChannel[] {
  const preference = preferences[category];
  const channels: NotificationChannel[] = [];
  if (preference.inApp) {
    channels.push('in_app');
  }
  if (preference.email && emailVerified) {
    channels.push('email');
  }
  return channels;
}

/** The app path a link opens; never a bearer credential, never an action. */
export function appPathOf(link: RoutedNotification['link']): string | null {
  if (link === null) {
    return null;
  }
  switch (link.type) {
    case 'proposal':
      return `/proposals/${link.id}`;
    case 'intent':
    case 'plan':
      return `/review/${link.id}`;
    case 'schedule':
    case 'occurrence':
      return `/automations/${link.id}`;
    case 'instance':
      return `/portfolio/${link.id}`;
    case 'device':
      return '/settings/devices';
    case 'run':
      return `/companion/${link.id}`;
    default:
      return null;
  }
}
