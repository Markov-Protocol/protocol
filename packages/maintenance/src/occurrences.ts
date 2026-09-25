import type { Cadence, MissedRunPolicy, OccurrenceReason } from '@markov/contracts';
import { occurrencesFrom } from './cadence.js';

/**
 * Which occurrences a scheduler pass decides (B16). An occurrence is due
 * once its instant has passed; it is missed once its review window closed
 * before the scheduler saw it. Missed occurrences are skipped by default so
 * that several missed budgets never become one surprise; `catch_up_latest`
 * proposes only the most recent missed one.
 */

export interface DueQuery {
  readonly cadence: Cadence;
  readonly startAt: Date;
  readonly endAt: Date | null;
  /** Sequence of the last occurrence already decided (0 before the first). */
  readonly lastSequence: number;
  readonly reviewWindowHours: number;
  readonly missedRunPolicy: MissedRunPolicy;
  readonly now: Date;
  /** Most occurrences decided in one pass; the rest wait for the next pass. */
  readonly limit?: number;
}

export interface DueOccurrence {
  readonly sequence: number;
  readonly dueAt: Date;
  readonly windowEndsAt: Date;
  /** `propose` for a live occurrence; otherwise why it is skipped. */
  readonly decision: 'propose' | 'skip';
  readonly reason: OccurrenceReason | null;
}

export function windowEnd(dueAt: Date, reviewWindowHours: number): Date {
  return new Date(dueAt.getTime() + reviewWindowHours * 3_600_000);
}

/** Every occurrence with `sequence > lastSequence` and `dueAt <= now`, decided under the missed-run policy. */
export function dueOccurrences(query: DueQuery): DueOccurrence[] {
  const limit = query.limit ?? 50;
  const due: Array<Omit<DueOccurrence, 'decision' | 'reason'>> = [];
  let sequence = 0;
  for (const dueAt of occurrencesFrom(query.cadence, query.startAt)) {
    sequence += 1;
    if (dueAt.getTime() > query.now.getTime()) {
      break;
    }
    if (query.endAt !== null && dueAt.getTime() > query.endAt.getTime()) {
      break;
    }
    if (sequence <= query.lastSequence) {
      continue;
    }
    due.push({ sequence, dueAt, windowEndsAt: windowEnd(dueAt, query.reviewWindowHours) });
    if (due.length >= limit) {
      break;
    }
  }
  const missed = due.filter((entry) => entry.windowEndsAt.getTime() <= query.now.getTime());
  const latestMissed = missed[missed.length - 1] ?? null;
  return due.map((entry) => {
    const isMissed = entry.windowEndsAt.getTime() <= query.now.getTime();
    if (!isMissed) {
      return { ...entry, decision: 'propose', reason: null };
    }
    if (query.missedRunPolicy === 'catch_up_latest' && entry === latestMissed) {
      return { ...entry, decision: 'propose', reason: null };
    }
    return {
      ...entry,
      decision: 'skip',
      reason:
        query.missedRunPolicy === 'catch_up_latest' ? 'superseded_by_catch_up' : 'missed_window',
    };
  });
}

/** The next occurrence strictly after `lastSequence`, or null when the schedule is over. */
export function nextDueAfter(
  cadence: Cadence,
  startAt: Date,
  endAt: Date | null,
  lastSequence: number,
): Date | null {
  let sequence = 0;
  for (const dueAt of occurrencesFrom(cadence, startAt)) {
    sequence += 1;
    if (endAt !== null && dueAt.getTime() > endAt.getTime()) {
      return null;
    }
    if (sequence > lastSequence) {
      return dueAt;
    }
  }
  return null;
}

/** Stable identity of an occurrence: one proposal per schedule and sequence, whatever restarts happen. */
export function occurrenceDedupKey(scheduleId: string, sequence: number): string {
  return `schedule:${scheduleId}:${sequence}`;
}
