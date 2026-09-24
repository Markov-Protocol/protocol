export interface FormatInstantOptions {
  readonly locale?: string;
  readonly timeZone?: string;
  readonly style?: 'short' | 'long';
}

/** Format an ISO-8601 instant for people, always naming the time zone. */
export function formatInstant(iso: string, options: FormatInstantOptions = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`invalid instant ${JSON.stringify(iso)}`);
  }
  const formatter = new Intl.DateTimeFormat(options.locale ?? 'en-US', {
    timeZone: options.timeZone ?? 'UTC',
    dateStyle: options.style === 'long' ? 'long' : 'medium',
    timeStyle: options.style === 'long' ? 'long' : 'short',
  });
  return formatter.format(date);
}

/** "12 s ago", "5 min ago", "3 h ago", "2 d ago"; "in 30 s" for future instants. */
export function formatRelativeAge(iso: string, now: string | Date = new Date()): string {
  const target = new Date(iso).getTime();
  const reference = typeof now === 'string' ? new Date(now).getTime() : now.getTime();
  if (Number.isNaN(target) || Number.isNaN(reference)) {
    throw new TypeError('invalid instant');
  }
  const deltaSeconds = Math.round((reference - target) / 1000);
  const magnitude = Math.abs(deltaSeconds);
  let text: string;
  if (magnitude < 60) {
    text = `${magnitude} s`;
  } else if (magnitude < 3600) {
    text = `${Math.floor(magnitude / 60)} min`;
  } else if (magnitude < 86_400) {
    text = `${Math.floor(magnitude / 3600)} h`;
  } else {
    text = `${Math.floor(magnitude / 86_400)} d`;
  }
  return deltaSeconds >= 0 ? `${text} ago` : `in ${text}`;
}

export interface Staleness {
  readonly ageMs: number;
  readonly stale: boolean;
}

/** Age of an observation against a freshness threshold. */
export function describeStaleness(
  observedAt: string,
  thresholdMs: number,
  now: string | Date = new Date(),
): Staleness {
  const observed = new Date(observedAt).getTime();
  const reference = typeof now === 'string' ? new Date(now).getTime() : now.getTime();
  if (Number.isNaN(observed) || Number.isNaN(reference)) {
    throw new TypeError('invalid instant');
  }
  const ageMs = Math.max(0, reference - observed);
  return { ageMs, stale: ageMs > thresholdMs };
}
