import { z } from 'zod';
import { idSchema } from './identity.js';

/**
 * Shared event contract for the software and physical Mark I (B15). An
 * event is a fact about the owner's own resources, recorded by the domain
 * service that changed the state, in the same transaction where it can be.
 * It is never a message a person is told to act on by a device: the
 * companion presentation derives its expression from these kinds, and the
 * financial state stays where it is (an intent, a plan, an attempt).
 */
export const MARK_EVENT_KINDS = [
  /** A proposal was created for the owner (by the companion, an agent credential or the owner). */
  'proposal.created',
  /** Something waits for the owner's own review: a proposal, a built plan, an intent needing reconciliation. */
  'review.required',
  /** A signed transaction is on its way: an attempt was persisted before the broadcast. */
  'execution.pending',
  /** The intent reached finality on chain with its fills recorded. */
  'execution.finalized',
  /** The intent stopped without completing (failed, expired, cancelled or partially completed); the payload names the state. */
  'execution.failed',
  /** A read the owner relies on used stale or missing reference data. */
  'data.stale',
  /** A paired device was revoked; it must stop acting for the account. */
  'device.revoked',
] as const;
export const markEventKindSchema = z.enum(MARK_EVENT_KINDS);
export type MarkEventKind = z.infer<typeof markEventKindSchema>;

export const MARK_EVENT_SUBJECT_TYPES = [
  'proposal',
  'intent',
  'plan',
  'device',
  'instrument',
  'instance',
  'run',
] as const;
export const markEventSubjectTypeSchema = z.enum(MARK_EVENT_SUBJECT_TYPES);
export type MarkEventSubjectType = z.infer<typeof markEventSubjectTypeSchema>;

export const MARK_EVENT_PAGE_MAX = 100;

export const markEventSchema = z.object({
  eventId: idSchema,
  /** Strictly increasing per deployment; a reader resumes with `after=<seq>`. */
  seq: z.number().int().nonnegative(),
  kind: markEventKindSchema,
  subject: z.object({ type: markEventSubjectTypeSchema, id: z.string().max(100) }),
  /** Secret-free identifiers and states; never a balance, a key or free text from a model. */
  payload: z.record(z.string().max(60), z.unknown()),
  occurredAt: z.iso.datetime(),
});
export type MarkEvent = z.infer<typeof markEventSchema>;

export const eventQuerySchema = z.object({
  /** Return events with a sequence strictly greater than this (0 from the beginning). */
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(MARK_EVENT_PAGE_MAX).default(50),
  kind: markEventKindSchema.optional(),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;

export const eventListResponseSchema = z.object({
  events: z.array(markEventSchema),
  /** Pass as `after` for the next page; null when this page reached the newest event. */
  nextAfter: z.number().int().nonnegative().nullable(),
  /** The newest sequence the owner has, whatever the filter. */
  latestSeq: z.number().int().nonnegative(),
  note: z.string().max(400),
});
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
