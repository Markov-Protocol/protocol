import type { Cadence } from '@markov/contracts';

/**
 * Cadence math in an IANA time zone (B16). Everything here is pure and uses
 * only `Intl.DateTimeFormat` for zone rules, so a schedule fires at the same
 * wall-clock time before and after a daylight-saving change:
 *
 * - a wall-clock time that does not exist on a change day (the spring gap)
 *   fires at the first instant after the gap;
 * - a wall-clock time that exists twice (the autumn overlap) fires once, at
 *   its first instant;
 * - a monthly day the month lacks (31st in a 30-day month) is clamped to the
 *   month's last day.
 */

export interface LocalDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True when the runtime knows the zone; the contract's pattern is only a shape check. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock of an instant in a zone. */
export function localTimeOf(
  instant: Date,
  timeZone: string,
): LocalDateTime & { readonly second: number; readonly weekday: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '0';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number.parseInt(read('year'), 10),
    month: Number.parseInt(read('month'), 10),
    day: Number.parseInt(read('day'), 10),
    hour: Number.parseInt(read('hour'), 10) % 24,
    minute: Number.parseInt(read('minute'), 10),
    second: Number.parseInt(read('second'), 10),
    weekday: Math.max(0, weekdays.indexOf(read('weekday'))),
  };
}

/** Offset of the zone from UTC at an instant, in minutes (east positive). */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const local = localTimeOf(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant of a wall-clock time in a zone. The offsets in effect a day
 * before, at, and a day after the wall clock cover both sides of any
 * transition; every offset that reproduces the wall clock is a candidate and
 * the earliest wins (an autumn overlap fires once, at its first instant). A
 * wall clock no offset reproduces sits in a spring gap and moves forward by
 * the gap's length, using the offset in effect before the change (02:30
 * becomes 03:30 where clocks jump from 02:00 to 03:00).
 */
export function zonedTimeToUtc(local: LocalDateTime, timeZone: string): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  const day = 86_400_000;
  const offsetBefore = utcOffsetMinutes(new Date(wall - day), timeZone);
  const offsets = new Set([
    offsetBefore,
    utcOffsetMinutes(new Date(wall), timeZone),
    utcOffsetMinutes(new Date(wall + day), timeZone),
  ]);
  let earliest: Date | null = null;
  for (const offset of offsets) {
    const candidate = new Date(wall - offset * 60_000);
    if (sameWallClock(candidate, local, timeZone)) {
      if (earliest === null || candidate.getTime() < earliest.getTime()) {
        earliest = candidate;
      }
    }
  }
  return earliest ?? new Date(wall - offsetBefore * 60_000);
}

function sameWallClock(instant: Date, local: LocalDateTime, timeZone: string): boolean {
  const seen = localTimeOf(instant, timeZone);
  return (
    seen.year === local.year &&
    seen.month === local.month &&
    seen.day === local.day &&
    seen.hour === local.hour &&
    seen.minute === local.minute
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const [hour, minute] = timeOfDay.split(':').map((part) => Number.parseInt(part, 10));
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

/** Days since the epoch of a civil date, for weekday and interval arithmetic without zone effects. */
function civilDayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function civilDateOf(dayNumber: number): { year: number; month: number; day: number } {
  const date = new Date(dayNumber * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * The first occurrence of a cadence at or after `from`, in the zone's wall
 * clock. The anchor of the interval count is `startAt`: every `interval`
 * days/weeks/months from the first occurrence at or after the start.
 */
export function firstOccurrenceAtOrAfter(cadence: Cadence, startAt: Date, from: Date): Date | null {
  const occurrences = occurrencesFrom(cadence, startAt);
  for (const dueAt of occurrences) {
    if (dueAt.getTime() >= from.getTime()) {
      return dueAt;
    }
  }
  return null;
}

/** Hard bound on generated occurrences per query, so a runaway cadence cannot spin. */
const MAX_GENERATED = 20_000;

/**
 * Generates occurrences from the schedule's start in order. The sequence of
 * the n-th yielded instant is n (1-based); callers slice what they need.
 */
export function* occurrencesFrom(cadence: Cadence, startAt: Date): Generator<Date, void, void> {
  const { hour, minute } = parseTimeOfDay(cadence.timeOfDay);
  const startLocal = localTimeOf(startAt, cadence.timeZone);
  let generated = 0;
  if (cadence.unit === 'day') {
    let dayNumber = civilDayNumber(startLocal.year, startLocal.month, startLocal.day);
    while (generated < MAX_GENERATED) {
      const civil = civilDateOf(dayNumber);
      const dueAt = zonedTimeToUtc({ ...civil, hour, minute }, cadence.timeZone);
      if (dueAt.getTime() >= startAt.getTime()) {
        generated += 1;
        yield dueAt;
        dayNumber += cadence.interval;
      } else {
        dayNumber += 1;
      }
    }
    return;
  }
  if (cadence.unit === 'week') {
    const weekday = cadence.weekday ?? 0;
    let dayNumber = civilDayNumber(startLocal.year, startLocal.month, startLocal.day);
    // Move to the first day with the wanted weekday at or after the start day.
    const startWeekday = ((dayNumber % 7) + 11) % 7; // 1970-01-01 was a Thursday (4)
    dayNumber += (weekday - startWeekday + 7) % 7;
    let firstYielded = false;
    while (generated < MAX_GENERATED) {
      const civil = civilDateOf(dayNumber);
      const dueAt = zonedTimeToUtc({ ...civil, hour, minute }, cadence.timeZone);
      if (dueAt.getTime() >= startAt.getTime()) {
        generated += 1;
        firstYielded = true;
        yield dueAt;
        dayNumber += 7 * cadence.interval;
      } else if (!firstYielded) {
        // The wanted weekday on the start day is already past its time: next week.
        dayNumber += 7;
      }
    }
    return;
  }
  const dayOfMonth = cadence.dayOfMonth ?? 1;
  let year = startLocal.year;
  let month = startLocal.month;
  let firstYielded = false;
  while (generated < MAX_GENERATED) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month));
    const dueAt = zonedTimeToUtc({ year, month, day, hour, minute }, cadence.timeZone);
    if (dueAt.getTime() >= startAt.getTime()) {
      generated += 1;
      firstYielded = true;
      yield dueAt;
      month += cadence.interval;
    } else if (!firstYielded) {
      month += 1;
    }
    while (month > 12) {
      month -= 12;
      year += 1;
    }
  }
}

export interface PreviewedOccurrence {
  readonly sequence: number;
  readonly dueAt: Date;
  readonly localTime: string;
  readonly utcOffsetMinutes: number;
}

/** The next `count` occurrences at or after `from`, with their sequence numbers since the start. */
export function previewOccurrences(
  cadence: Cadence,
  startAt: Date,
  from: Date,
  count: number,
  endAt: Date | null = null,
): PreviewedOccurrence[] {
  const out: PreviewedOccurrence[] = [];
  let sequence = 0;
  for (const dueAt of occurrencesFrom(cadence, startAt)) {
    sequence += 1;
    if (endAt !== null && dueAt.getTime() > endAt.getTime()) {
      break;
    }
    if (dueAt.getTime() < from.getTime()) {
      continue;
    }
    out.push({
      sequence,
      dueAt,
      localTime: formatLocal(dueAt, cadence.timeZone),
      utcOffsetMinutes: utcOffsetMinutes(dueAt, cadence.timeZone),
    });
    if (out.length >= count) {
      break;
    }
  }
  return out;
}

export function formatLocal(instant: Date, timeZone: string): string {
  const local = localTimeOf(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.year}-${pad(local.month)}-${pad(local.day)} ${pad(local.hour)}:${pad(local.minute)}`;
}
