import { DEFAULT_CATEGORY_PREFERENCES } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import {
  appPathOf,
  channelsFor,
  createConfiguredEmailAdapter,
  createFixtureEmailAdapter,
  hashVerificationCode,
  nextAttemptDelayMs,
  renderNotificationEmail,
  renderVerificationEmail,
  routeMarkEvent,
  routeScheduleOutcome,
  verificationCodeFrom,
  verificationCodesMatch,
} from '../src/index.js';

const proposalId = '00000000-0000-4000-8000-000000000001';

describe('routing', () => {
  it('routes every event kind once, with a link the app opens after its own authentication', () => {
    const created = routeMarkEvent({
      kind: 'proposal.created',
      subject: { type: 'proposal', id: proposalId },
      payload: { kind: 'investment', createdBy: 'schedule:abc' },
    });
    expect(created).toMatchObject({
      category: 'proposals',
      kind: 'proposal.created',
      link: { type: 'proposal', id: proposalId },
    });
    expect(created?.title).toContain('investment proposal');
    expect(created?.body).toContain('A schedule prepared');
    // The proposal's own review.required follows its proposal.created: not a second notification.
    expect(
      routeMarkEvent({
        kind: 'review.required',
        subject: { type: 'proposal', id: proposalId },
        payload: {},
      }),
    ).toBeNull();
    expect(
      routeMarkEvent({
        kind: 'review.required',
        subject: { type: 'plan', id: 'plan-1' },
        payload: { intentId: 'intent-1' },
      }),
    ).toMatchObject({ category: 'execution', link: { type: 'intent', id: 'intent-1' } });
    expect(
      routeMarkEvent({
        kind: 'execution.failed',
        subject: { type: 'intent', id: 'intent-2' },
        payload: { state: 'EXPIRED', reason: 'the plan expired' },
      }),
    ).toMatchObject({
      category: 'execution',
      body: 'The order ended in state EXPIRED: the plan expired. Nothing further is spent.',
    });
    expect(
      routeMarkEvent({
        kind: 'device.revoked',
        subject: { type: 'device', id: 'device-1' },
        payload: { name: 'Kitchen Mark' },
      }),
    ).toMatchObject({ category: 'security', link: { type: 'device', id: 'device-1' } });
    expect(
      routeMarkEvent({ kind: 'data.stale', subject: { type: 'instance', id: 'i-1' }, payload: {} }),
    ).toMatchObject({ category: 'data', link: { type: 'instance', id: 'i-1' } });
    expect(appPathOf({ type: 'proposal', id: proposalId })).toBe(`/proposals/${proposalId}`);
    expect(appPathOf({ type: 'device', id: 'x' })).toBe('/settings/devices');
  });

  it('tells the owner about skipped, failed and expired occurrences, never about proposed ones', () => {
    const base = {
      scheduleId: 's-1',
      occurrenceId: 'o-1',
      label: 'Monthly aerospace',
      detail: null,
    };
    expect(
      routeScheduleOutcome({ ...base, status: 'skipped', reason: 'missed_window' }),
    ).toMatchObject({
      category: 'schedules',
      kind: 'schedule.skipped',
      link: { type: 'schedule', id: 's-1' },
    });
    expect(
      routeScheduleOutcome({
        ...base,
        status: 'failed',
        reason: 'policy_denied',
        detail: 'REFERENCE_STALE',
      })?.body,
    ).toContain('the policy denied the proposal: REFERENCE_STALE');
    expect(routeScheduleOutcome({ ...base, status: 'expired', reason: null })?.kind).toBe(
      'schedule.expired',
    );
    expect(routeScheduleOutcome({ ...base, status: 'proposed', reason: null })).toBeNull();
  });

  it('adds the email channel only for a category the owner turned on with a verified address', () => {
    expect(channelsFor('proposals', DEFAULT_CATEGORY_PREFERENCES, true)).toEqual(['in_app']);
    expect(channelsFor('security', DEFAULT_CATEGORY_PREFERENCES, true)).toEqual([
      'in_app',
      'email',
    ]);
    expect(channelsFor('security', DEFAULT_CATEGORY_PREFERENCES, false)).toEqual(['in_app']);
    expect(
      channelsFor(
        'proposals',
        { ...DEFAULT_CATEGORY_PREFERENCES, proposals: { inApp: false, email: true } },
        true,
      ),
    ).toEqual(['email']);
  });
});

describe('email', () => {
  it('renders plain text with an app path and no credential, and a verification code that grants nothing', () => {
    const message = renderNotificationEmail(
      {
        notificationId: 'n-1',
        category: 'proposals',
        kind: 'proposal.created',
        title: 'An investment proposal is waiting for your review',
        body: 'A schedule prepared it.',
        link: { type: 'proposal', id: proposalId },
      },
      'alice@example.com',
      { appOrigin: 'https://markov.pet' },
    );
    expect(message.subject).toBe('Markov: An investment proposal is waiting for your review');
    expect(message.text).toContain(`Open in the app: https://markov.pet/proposals/${proposalId}`);
    expect(message.text).toContain('contains no sign-in link');
    expect(message.text).not.toMatch(/mkv_|token=|Bearer/);
    expect(message.idempotencyKey).toBe('notification:n-1:email');
    const code = verificationCodeFrom(() => 42);
    expect(code).toBe('000042');
    const verification = renderVerificationEmail(
      'alice@example.com',
      code,
      new Date('2026-01-01T00:10:00Z'),
      'attempt-1',
    );
    expect(verification.text).toContain('000042');
    expect(verification.text).toContain('grants nothing else');
    const hash = hashVerificationCode(code, 'pepper', 'salt');
    expect(verificationCodesMatch(hash, hashVerificationCode('000042', 'pepper', 'salt'))).toBe(
      true,
    );
    expect(verificationCodesMatch(hash, hashVerificationCode('000043', 'pepper', 'salt'))).toBe(
      false,
    );
  });

  it('records what the fixture accepted and refused', async () => {
    const adapter = createFixtureEmailAdapter({
      fail: (message) => (message.subject.includes('boom') ? 'retryable' : null),
    });
    const ok = await adapter.send({
      to: 'alice@example.com',
      subject: 'fine',
      text: 'hello',
      idempotencyKey: 'k-1',
    });
    const failed = await adapter.send({
      to: 'alice@example.com',
      subject: 'boom',
      text: 'hello',
      idempotencyKey: 'k-2',
    });
    expect(ok).toEqual({ accepted: true, providerMessageId: 'fixture-1' });
    expect(failed).toEqual({
      accepted: false,
      retryable: true,
      detail: 'fixture: temporary failure',
    });
    expect(adapter.sent.map((message) => message.idempotencyKey)).toEqual(['k-1']);
    expect(adapter.refused.map((entry) => entry.message.idempotencyKey)).toEqual(['k-2']);
  });

  it('speaks the configured HTTP contract and classifies failures', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 200;
    let body: unknown = { messageId: 'm-1' };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const adapter = createConfiguredEmailAdapter({
      url: 'https://mail.example.invalid/send',
      apiKey: 'secret-key',
      from: 'notifications@markov.pet',
      fetchImpl,
    });
    const message = { to: 'alice@example.com', subject: 's', text: 't', idempotencyKey: 'k-9' };
    expect(await adapter.send(message)).toEqual({ accepted: true, providerMessageId: 'm-1' });
    const sent = calls[0] as { url: string; init: RequestInit };
    const headers = sent.init.headers as Record<string, string>;
    expect(sent.url).toBe('https://mail.example.invalid/send');
    expect(headers['authorization']).toBe('Bearer secret-key');
    expect(headers['idempotency-key']).toBe('k-9');
    expect(JSON.parse(String(sent.init.body))).toEqual({
      from: 'notifications@markov.pet',
      to: 'alice@example.com',
      subject: 's',
      text: 't',
      idempotencyKey: 'k-9',
    });
    status = 503;
    expect(await adapter.send(message)).toMatchObject({ accepted: false, retryable: true });
    status = 422;
    expect(await adapter.send(message)).toMatchObject({ accepted: false, retryable: false });
    status = 200;
    body = { ok: true };
    expect(await adapter.send(message)).toMatchObject({ accepted: false, retryable: false });
    const failing = createConfiguredEmailAdapter({
      url: 'https://mail.example.invalid/send',
      apiKey: 'k',
      from: 'f@markov.pet',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(await failing.send(message)).toMatchObject({ accepted: false, retryable: true });
  });

  it('backs off between attempts without exceeding four hours', () => {
    expect([1, 2, 3, 4, 5, 9].map(nextAttemptDelayMs)).toEqual([
      60_000, 300_000, 900_000, 3_600_000, 14_400_000, 14_400_000,
    ]);
  });
});
