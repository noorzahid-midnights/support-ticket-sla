"use client";

import { useEffect, useState } from "react";
import { businessMsBetween, isOpenAt, nextOpenMoment, type BusinessCalendar } from "@shared/business-time.js";
import type { DeadlineState } from "@shared/types.js";

export interface LiveDeadline {
  /** Business ms remaining right now. Negative means overdue. */
  remainingMs: number | null;
  breached: boolean;
  /** True when the clock is actually running: business hours, and not paused. */
  ticking: boolean;
  /** When the clock will next start moving, if it is not moving now. */
  resumesAt: Date | null;
}

/**
 * A countdown that only counts during business hours.
 *
 * The naive version — decrement every second from the server's number — is
 * wrong in a way that looks right: a ticket left on screen at 17:59 on Friday
 * would bleed out across the weekend and read "breached by 48h" on Monday for
 * time nobody owed. Instead this recomputes from the calendar, using the same
 * `businessMsBetween` the server used to produce the deadline, and simply
 * stops moving when the office is closed or the ticket is paused.
 */
export function useSlaClock(
  deadline: DeadlineState,
  calendar: BusinessCalendar | undefined,
  paused: boolean,
  intervalMs = 1000,
): LiveDeadline {
  const [now, setNow] = useState(() => new Date());

  const frozen = paused || Boolean(deadline.metAt) || !deadline.dueAt;

  useEffect(() => {
    if (frozen) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [frozen, intervalMs]);

  if (!calendar || !deadline.dueAt) {
    return { remainingMs: deadline.remainingMs, breached: deadline.breached, ticking: false, resumesAt: null };
  }

  // A discharged or paused deadline keeps whatever the server measured; there
  // is nothing left to count down.
  if (frozen) {
    return { remainingMs: deadline.remainingMs, breached: deadline.breached, ticking: false, resumesAt: null };
  }

  const due = new Date(deadline.dueAt);
  const open = isOpenAt(now, calendar);
  const overdue = now.getTime() > due.getTime();

  const remainingMs = overdue
    ? -businessMsBetween(due, now, calendar)
    : businessMsBetween(now, due, calendar);

  return {
    remainingMs,
    breached: overdue,
    ticking: open,
    resumesAt: open ? null : nextOpenMoment(now, calendar),
  };
}
