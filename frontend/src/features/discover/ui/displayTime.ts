/**
 * Every date this workspace shows is read in Australian Eastern time.
 *
 * Not the viewer's browser timezone: a retention date is a fact about when
 * the platform will delete something, and two screens disagreeing about it
 * because two people sat in different places is the exact confusion the
 * wording on the Admin page exists to prevent. One zone, named on screen.
 *
 * Sydney observes daylight saving, so the offset moves: AEST (UTC+10) in
 * winter, AEDT (UTC+11) from October to April. That is why the times below
 * are formatted from a real instant rather than by adding a fixed offset, and
 * why the abbreviation is printed beside the clock time.
 */
export const DISPLAY_ZONE = "Australia/Sydney";

/** What to call it on screen — the zone covers more than one city. */
export const DISPLAY_ZONE_LABEL = "Sydney/Melbourne";

function format(when: Date, options: Intl.DateTimeFormatOptions): string {
  return when.toLocaleString("en-AU", { timeZone: DISPLAY_ZONE, ...options });
}

/** "26 Sep 2026, 01:00 pm" — a date somebody can read. */
export function readableDate(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return format(when, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** The same, with the zone spelled out — for a figure read on its own. */
export function readableDateWithZone(iso: string): string {
  if (!iso) return "";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return format(when, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

/**
 * The next instant at which the clock reads `hourUtc`:00 UTC.
 *
 * The next one, not today's, because that is the run being described — and on
 * the two days a year daylight saving moves, today's and tomorrow's occurrence
 * of the same UTC hour are an hour apart locally.
 */
export function nextUtcHour(hourUtc: number, now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** "01:00 pm AEDT" — an hour given in UTC, read on an Australian clock. */
export function utcHourInZone(hourUtc: number): string {
  return format(nextUtcHour(hourUtc), {
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

/** Whole days from now until `iso`, floored at zero. */
export function daysUntil(iso: string): number {
  if (!iso) return 0;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}
