import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EmailMessage, EmailProvider } from '@markov/contracts';
import { emailMessageSchema } from '@markov/contracts';
import { appPathOf, type RoutedNotification } from './routing.js';

/**
 * Email (B16): rendering without credentials, the adapter contract, a
 * recording fixture and a configured HTTP provider. A message is sent only
 * to an address the owner entered and verified, and only for categories
 * the owner turned on. No message carries a sign-in link or a code that
 * grants anything beyond confirming the address it was sent to.
 */

export const EMAIL_FOOTER =
  'Markov never asks for keys, seed phrases or codes by email, and this message contains no sign-in link. Open the app yourself to act on anything.';

export interface RenderOptions {
  /** Origin of the app the owner opens (for example https://markov.pet); paths are appended. */
  readonly appOrigin: string;
}

export function renderNotificationEmail(
  notification: RoutedNotification & { readonly notificationId: string },
  address: string,
  options: RenderOptions,
): EmailMessage {
  const path = appPathOf(notification.link);
  const lines = [
    notification.title,
    '',
    notification.body,
    ...(path === null ? [] : ['', `Open in the app: ${options.appOrigin}${path}`]),
    '',
    EMAIL_FOOTER,
  ];
  return emailMessageSchema.parse({
    to: address,
    subject: `Markov: ${notification.title}`.slice(0, 200),
    text: lines.join('\n').slice(0, 4000),
    idempotencyKey: `notification:${notification.notificationId}:email`,
  });
}

export function renderVerificationEmail(
  address: string,
  code: string,
  expiresAt: Date,
  attemptKey: string,
): EmailMessage {
  return emailMessageSchema.parse({
    to: address,
    subject: 'Markov: confirm this email address',
    text: [
      `Enter this code in the app to confirm ${address} for Markov notifications: ${code}`,
      '',
      `The code expires at ${expiresAt.toISOString()} and only confirms the address; it grants nothing else.`,
      'If you did not ask for this, ignore it: nothing will be sent again unless someone with your account asks.',
      '',
      EMAIL_FOOTER,
    ].join('\n'),
    idempotencyKey: `verification:${attemptKey}`,
  });
}

/** Six digits from a uniform random source; the caller supplies the randomness. */
export function verificationCodeFrom(randomInt: (max: number) => number): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

export function hashVerificationCode(code: string, pepper: string, salt: string): string {
  return createHmac('sha256', pepper).update(`${salt}:${code}`).digest('hex');
}

export function verificationCodesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export type EmailSendResult =
  | { readonly accepted: true; readonly providerMessageId: string }
  | { readonly accepted: false; readonly retryable: boolean; readonly detail: string };

export interface EmailAdapter {
  readonly provider: EmailProvider;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface FixtureEmailAdapter extends EmailAdapter {
  readonly provider: 'fixture';
  /** Every message the fixture accepted, oldest first. */
  readonly sent: EmailMessage[];
  /** Every message the fixture refused, with the outcome it reported. */
  readonly refused: Array<{ readonly message: EmailMessage; readonly retryable: boolean }>;
}

/**
 * The deterministic fixture (local and test only): records what it is
 * handed and fails on request, so delivery, retry and dead-letter paths can
 * be exercised without a provider.
 */
export function createFixtureEmailAdapter(options?: {
  readonly fail?: (message: EmailMessage) => 'retryable' | 'permanent' | null;
}): FixtureEmailAdapter {
  const sent: EmailMessage[] = [];
  const refused: Array<{ message: EmailMessage; retryable: boolean }> = [];
  let counter = 0;
  return {
    provider: 'fixture',
    sent,
    refused,
    async send(message) {
      const parsed = emailMessageSchema.parse(message);
      const failure = options?.fail?.(parsed) ?? null;
      if (failure !== null) {
        refused.push({ message: parsed, retryable: failure === 'retryable' });
        return {
          accepted: false,
          retryable: failure === 'retryable',
          detail: failure === 'retryable' ? 'fixture: temporary failure' : 'fixture: rejected',
        };
      }
      counter += 1;
      sent.push(parsed);
      return { accepted: true, providerMessageId: `fixture-${counter}` };
    },
  };
}

export interface ConfiguredEmailOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly from: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * A configured HTTP provider speaking the Markov email contract: one JSON
 * POST per message with the idempotency key, answered by `{ messageId }`.
 * 5xx answers, timeouts and network errors are retryable; other refusals
 * are not. The provider's terms and data handling are recorded before it is
 * configured (docs/markov/provider-capabilities.md).
 */
export function createConfiguredEmailAdapter(options: ConfiguredEmailOptions): EmailAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    provider: 'configured',
    async send(message) {
      const parsed = emailMessageSchema.parse(message);
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
            'idempotency-key': parsed.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from,
            to: parsed.to,
            subject: parsed.subject,
            text: parsed.text,
            idempotencyKey: parsed.idempotencyKey,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return {
          accepted: false,
          retryable: true,
          detail: `request failed: ${error instanceof Error ? error.name : 'error'}`.slice(0, 300),
        };
      }
      if (response.status >= 500) {
        return { accepted: false, retryable: true, detail: `provider answered ${response.status}` };
      }
      if (response.status >= 400) {
        return { accepted: false, retryable: false, detail: `provider refused ${response.status}` };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { accepted: false, retryable: true, detail: 'provider answered without JSON' };
      }
      const messageId =
        body !== null &&
        typeof body === 'object' &&
        typeof (body as { messageId?: unknown }).messageId === 'string'
          ? (body as { messageId: string }).messageId
          : null;
      if (messageId === null) {
        return {
          accepted: false,
          retryable: false,
          detail: 'provider answered without a messageId',
        };
      }
      return { accepted: true, providerMessageId: messageId.slice(0, 200) };
    },
  };
}

/** Backoff between delivery attempts: 1, 5, 15, 60 and then 240 minutes. */
export function nextAttemptDelayMs(attempt: number): number {
  const minutes = [1, 5, 15, 60, 240];
  return (minutes[Math.min(Math.max(attempt, 1), minutes.length) - 1] ?? 240) * 60_000;
}
