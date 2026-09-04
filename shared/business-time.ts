/**
 * Business-hours time arithmetic.
 *
 * The whole SLA engine rests on this file, so it is deliberately pure: no
 * database, no network, no clock reads. Every function takes its inputs
 * explicitly, which is what makes the edge cases in business-time.test.ts
 * cheap enough to write exhaustively.
 *
 * The problem it solves: an SLA of "4 hours" means four hours of *business*
 * time. A ticket filed at 17:00 Friday with a 4h clock is not due at 21:00
 * Friday, it is due at 12:00 Monday. Subtracting two timestamps cannot tell
 * you that; you have to walk the calendar.
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** A day's opening window in wall-clock time, e.g. { start: "09:00", end: "18:00" }. */
export interface DayWindow {
  start: string;
  end: string;
}

export interface BusinessCalendar {
  /** IANA zone the wall-clock times below are expressed in, e.g. "Asia/Karachi". */
  timezone: string;
  /** Indexed by JS day-of-week: 0 = Sunday .. 6 = Saturday. null = closed. */
  days: Record<number, DayWindow | null>;
  /** Calendar dates closed regardless of weekday, as "YYYY-MM-DD" in `timezone`. */
  holidays: string[];
}

/**
 * Iteration ceiling, ~11 years of days. A malformed calendar (or a caller
 * passing a year-3000 timestamp) should fail loudly rather than pin a CPU
 * inside a cron tick.
 */
const MAX_DAY_ITERATIONS = 4000;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Thrown for calendars this module cannot interpret. Always a programmer error. */
export class BusinessTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessTimeError";
  }
}

/**
 * Validates a calendar once, up front, so the hot paths can assume it is sane.
 * Call it when loading the calendar from the database, not per calculation.
 */
export function validateCalendar(cal: BusinessCalendar): void {
  try {
    formatInTimeZone(new Date(0), cal.timezone, "yyyy-MM-dd");
  } catch {
    throw new BusinessTimeError(`Unknown IANA timezone: ${cal.timezone}`);
  }

  let openDays = 0;
  for (let dow = 0; dow <= 6; dow += 1) {
    const day = cal.days[dow];
    if (!day) continue;
    openDays += 1;
    if (!HHMM.test(day.start) || !HHMM.test(day.end)) {
      throw new BusinessTimeError(
        `Day ${dow} has a malformed window (${day.start}-${day.end}); expected HH:MM 24-hour times.`,
      );
    }
    if (day.start >= day.end) {
      // Lexical comparison is safe for zero-padded HH:MM. Windows that wrap
      // past midnight are not supported: every algorithm here assumes a day's
      // window is contained within its own calendar date.
      throw new BusinessTimeError(
        `Day ${dow} closes at or before it opens (${day.start}-${day.end}). Overnight windows are unsupported.`,
      );
    }
  }
  if (openDays === 0) {
    throw new BusinessTimeError("Calendar has no open days; every SLA would be infinite.");
  }

  for (const holiday of cal.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) {
      throw new BusinessTimeError(`Malformed holiday "${holiday}"; expected YYYY-MM-DD.`);
    }
  }
}

/** The calendar date an instant falls on, as seen from the calendar's timezone. */
function dateKeyIn(t: Date, timezone: string): string {
  return formatInTimeZone(t, timezone, "yyyy-MM-dd");
}

/**
 * The day after a date key.
 *
 * Done as UTC arithmetic on the label itself, never by adding 86_400_000ms to
 * an instant: on a DST boundary that would drift by an hour and eventually
 * repeat or skip a calendar day.
 */
function nextDateKey(key: string): string {
  const asUtc = new Date(`${key}T00:00:00Z`).getTime();
  return new Date(asUtc + 86_400_000).toISOString().slice(0, 10);
}

/** The day before a date key. UTC arithmetic on the label, for the same reason. */
function previousDateKey(key: string): string {
  const asUtc = new Date(`${key}T00:00:00Z`).getTime();
  return new Date(asUtc - 86_400_000).toISOString().slice(0, 10);
}

/** Day-of-week of a date key. Timezone-independent: the label already fixes the date. */
function dayOfWeekForKey(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/**
 * The open/close instants for one calendar date, or null if that date is closed.
 *
 * Each date is resolved independently through `fromZonedTime`, which applies
 * the UTC offset in force *on that date*. This is the DST-correct move: a
 * 09:00-18:00 day is nine hours on the wall clock whatever the offset does,
 * and if a transition lands inside the window the elapsed real time is 8h or
 * 10h, which is exactly what someone reading the clock would say. Precomputing
 * one offset for the whole range would silently get this wrong.
 */
function windowForKey(
  key: string,
  cal: BusinessCalendar,
  holidays: Set<string>,
): { open: Date; close: Date } | null {
  if (holidays.has(key)) return null;
  const day = cal.days[dayOfWeekForKey(key)];
  if (!day) return null;
  return {
    open: fromZonedTime(`${key}T${day.start}:00`, cal.timezone),
    close: fromZonedTime(`${key}T${day.end}:00`, cal.timezone),
  };
}

/** True when `t` falls inside an open window. The closing instant counts as closed. */
export function isOpenAt(t: Date, cal: BusinessCalendar): boolean {
  const holidays = new Set(cal.holidays);
  const w = windowForKey(dateKeyIn(t, cal.timezone), cal, holidays);
  if (!w) return false;
  return t.getTime() >= w.open.getTime() && t.getTime() < w.close.getTime();
}

/**
 * The earliest business instant at or after `t`.
 * Returns `t` unchanged when it is already inside a window.
 */
export function nextOpenMoment(t: Date, cal: BusinessCalendar): Date {
  const holidays = new Set(cal.holidays);
  let key = dateKeyIn(t, cal.timezone);

  for (let i = 0; i < MAX_DAY_ITERATIONS; i += 1) {
    const w = windowForKey(key, cal, holidays);
    if (w) {
      if (t.getTime() < w.open.getTime()) return w.open;
      if (t.getTime() < w.close.getTime()) return t;
    }
    key = nextDateKey(key);
  }
  throw new BusinessTimeError(
    `No open business hours within ${MAX_DAY_ITERATIONS} days of ${t.toISOString()}.`,
  );
}

/**
 * Business milliseconds elapsed between two instants.
 *
 * Returns 0 when `end` is at or before `start` — callers get "no time owed"
 * rather than a negative number that would flow into a deadline and produce a
 * ticket due before it was created.
 *
 * Walks the calendar day by day, clamping each day's window to the interval
 * and summing the overlaps.
 */
export function businessMsBetween(start: Date, end: Date, cal: BusinessCalendar): number {
  const from = start.getTime();
  const to = end.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new BusinessTimeError("businessMsBetween received an invalid Date.");
  }
  if (to <= from) return 0;

  const holidays = new Set(cal.holidays);
  const endKey = dateKeyIn(end, cal.timezone);
  let key = dateKeyIn(start, cal.timezone);
  let total = 0;

  for (let i = 0; i < MAX_DAY_ITERATIONS; i += 1) {
    const w = windowForKey(key, cal, holidays);
    if (w) {
      const lo = Math.max(w.open.getTime(), from);
      const hi = Math.min(w.close.getTime(), to);
      if (hi > lo) total += hi - lo;
    }
    if (key === endKey) return total;
    key = nextDateKey(key);
  }
  throw new BusinessTimeError(
    `Interval ${start.toISOString()}..${end.toISOString()} exceeds ${MAX_DAY_ITERATIONS} days.`,
  );
}

/**
 * The instant reached by consuming `ms` of business time from `start`.
 * The inverse of `businessMsBetween`, and what turns an SLA ("4 hours") into a
 * storable, sortable, queryable deadline.
 *
 * When `start` is outside business hours the clock is rolled forward to the
 * next open moment before counting. A ticket filed at 02:00 on a Saturday gets
 * a clock that starts Monday 09:00 — without the roll-forward its deadline
 * would land in dead time and every weekend ticket would show up already
 * breached on Monday morning, before an agent could possibly have seen it.
 */
export function addBusinessMs(start: Date, ms: number, cal: BusinessCalendar): Date {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new BusinessTimeError(`addBusinessMs needs a non-negative duration, got ${ms}.`);
  }

  const holidays = new Set(cal.holidays);
  let t = nextOpenMoment(start, cal);
  let remaining = ms;
  if (remaining === 0) return t;

  for (let i = 0; i < MAX_DAY_ITERATIONS; i += 1) {
    // `t` is always an open instant here, so the window necessarily exists.
    const w = windowForKey(dateKeyIn(t, cal.timezone), cal, holidays)!;
    const available = w.close.getTime() - t.getTime();
    if (available >= remaining) return new Date(t.getTime() + remaining);
    remaining -= available;
    // At exactly `close` the day is over, so this always advances.
    t = nextOpenMoment(w.close, cal);
  }
  throw new BusinessTimeError(
    `Consuming ${ms}ms of business time from ${start.toISOString()} exceeds ${MAX_DAY_ITERATIONS} days.`,
  );
}

/**
 * The latest business instant at or before `t`.
 *
 * Mirror of `nextOpenMoment`. Because a window's closing instant counts as
 * closed, the anchor returned for an after-hours `t` is the previous day's
 * closing time — the supremum of the business instants below `t`, which is
 * what backwards arithmetic needs.
 */
export function previousOpenMoment(t: Date, cal: BusinessCalendar): Date {
  const holidays = new Set(cal.holidays);
  let key = dateKeyIn(t, cal.timezone);

  for (let i = 0; i < MAX_DAY_ITERATIONS; i += 1) {
    const w = windowForKey(key, cal, holidays);
    if (w) {
      if (t.getTime() >= w.close.getTime()) return w.close;
      // Strictly inside the window. At exactly `open` there is no business
      // time left on this day, so fall through to the previous one.
      if (t.getTime() > w.open.getTime()) return t;
    }
    key = previousDateKey(key);
  }
  throw new BusinessTimeError(
    `No open business hours within ${MAX_DAY_ITERATIONS} days before ${t.toISOString()}.`,
  );
}

/**
 * The instant that is `ms` of business time *before* `end`.
 *
 * The inverse of `addBusinessMs` in the other direction, and what makes
 * seeding exact: "created six business hours ago" is a calendar walk, not a
 * subtraction, and guessing at it would produce fixtures whose breach state
 * depends on the day of the week you happened to run the seed.
 */
export function subtractBusinessMs(end: Date, ms: number, cal: BusinessCalendar): Date {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new BusinessTimeError(`subtractBusinessMs needs a non-negative duration, got ${ms}.`);
  }

  const holidays = new Set(cal.holidays);
  let t = previousOpenMoment(end, cal);
  let remaining = ms;
  if (remaining === 0) return t;

  for (let i = 0; i < MAX_DAY_ITERATIONS; i += 1) {
    const w = windowForKey(dateKeyIn(t, cal.timezone), cal, holidays)!;
    const available = t.getTime() - w.open.getTime();
    if (available >= remaining) return new Date(t.getTime() - remaining);
    remaining -= available;
    // Step to the instant just before this day opened; previousOpenMoment
    // then lands on the previous open day's close.
    t = previousOpenMoment(new Date(w.open.getTime()), cal);
  }
  throw new BusinessTimeError(
    `Reaching back ${ms}ms of business time from ${end.toISOString()} exceeds ${MAX_DAY_ITERATIONS} days.`,
  );
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
