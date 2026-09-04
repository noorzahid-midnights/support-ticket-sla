/**
 * SLA clock lifecycle: starting deadlines, pausing and resuming them around
 * `waiting_on_customer`, repricing them when priority changes, and reporting
 * live state for the dashboard.
 *
 * Pure, like business-time.ts. Nothing here reads a database or a clock — the
 * caller supplies `now`, which is what makes the pause/resume arithmetic
 * testable at a hundred specific instants instead of "whenever the test ran".
 */

import { MINUTE_MS, addBusinessMs, businessMsBetween, type BusinessCalendar } from "./business-time.js";
import type { DeadlineState, SlaClock, SlaPolicy, SlaSnapshot, TicketStatus } from "./types.js";

/** The brief's warning threshold: flag once the final quarter of the window is left. */
export const AT_RISK_FRACTION = 0.25;

/** Deadlines for a brand-new ticket. */
export function startClock(createdAt: Date, policy: SlaPolicy, cal: BusinessCalendar): SlaClock {
  return {
    firstResponseDueAt: addBusinessMs(createdAt, policy.firstResponseMinutes * MINUTE_MS, cal),
    resolutionDueAt: addBusinessMs(createdAt, policy.resolutionMinutes * MINUTE_MS, cal),
    pausedAt: null,
    pausedBusinessMs: 0,
    firstResponseBreached: false,
    resolutionBreached: false,
    escalationCount: 0,
  };
}

/**
 * Enter `waiting_on_customer`.
 *
 * Deadlines are deliberately left alone here — we do not yet know how long the
 * pause will last. What matters is that `pausedAt` is set, because the
 * escalation sweep skips paused tickets and a paused clock therefore cannot
 * breach while the customer, not the agent, is the one holding things up.
 */
export function pauseClock(clock: SlaClock, at: Date): SlaClock {
  if (clock.pausedAt) return clock; // already paused; pausing twice must not double-count
  return { ...clock, pausedAt: at };
}

/**
 * Leave `waiting_on_customer`.
 *
 * Both live deadlines move forward by the *business* time spent paused. Using
 * business time rather than wall time is the subtle part: a ticket that sat
 * with the customer over a weekend consumed no agent-owed time and must gain
 * nothing, whereas a raw wall-clock push would hand the agent 48 free hours.
 */
export function resumeClock(clock: SlaClock, at: Date, cal: BusinessCalendar): SlaClock {
  if (!clock.pausedAt) return clock;
  const delta = businessMsBetween(clock.pausedAt, at, cal);

  return {
    ...clock,
    firstResponseDueAt: clock.firstResponseDueAt ? addBusinessMs(clock.firstResponseDueAt, delta, cal) : null,
    resolutionDueAt: clock.resolutionDueAt ? addBusinessMs(clock.resolutionDueAt, delta, cal) : null,
    pausedBusinessMs: clock.pausedBusinessMs + delta,
    pausedAt: null,
  };
}

/** Freeze the first-response deadline: it becomes a historical record, not a live clock. */
export function markFirstResponse(clock: SlaClock): SlaClock {
  return clock;
}

/**
 * Recompute deadlines after a priority change (manual or via escalation).
 *
 * Rebuilt from the original `createdAt` anchor under the new policy, then
 * pushed forward by the pause time already banked. Deriving from the anchor
 * rather than adjusting the existing deadline makes this idempotent — running
 * it twice gives the same answer, which matters because the cron sweep can
 * touch the same ticket repeatedly.
 *
 * Escalation *shortens* an SLA, so a ticket can come out of this already
 * breached under its new priority. That is intended: it is precisely the
 * situation the admin breach report exists to surface.
 */
export function repriceClock(
  clock: SlaClock,
  args: { createdAt: Date; firstResponseAt: Date | null },
  policy: SlaPolicy,
  cal: BusinessCalendar,
): SlaClock {
  const banked = clock.pausedBusinessMs;

  // Once the first reply is sent the deadline stops being live, so repricing
  // it would rewrite history rather than change an obligation.
  const firstResponseDueAt = args.firstResponseAt
    ? clock.firstResponseDueAt
    : addBusinessMs(
        addBusinessMs(args.createdAt, policy.firstResponseMinutes * MINUTE_MS, cal),
        banked,
        cal,
      );

  const resolutionDueAt = addBusinessMs(
    addBusinessMs(args.createdAt, policy.resolutionMinutes * MINUTE_MS, cal),
    banked,
    cal,
  );

  return { ...clock, firstResponseDueAt, resolutionDueAt };
}

function deadlineState(
  dueAt: Date | null,
  metAt: Date | null,
  reference: Date,
  windowMs: number,
  cal: BusinessCalendar,
): DeadlineState {
  if (!dueAt) {
    return { dueAt: null, remainingMs: null, breached: false, atRisk: false, metAt: metAt?.toISOString() ?? null };
  }

  // Measure from when the obligation was discharged if it was, otherwise from
  // now (or from the moment the clock paused, which is the same thing).
  const at = metAt ?? reference;
  const overdue = at.getTime() > dueAt.getTime();
  const remainingMs = overdue
    ? -businessMsBetween(dueAt, at, cal)
    : businessMsBetween(at, dueAt, cal);

  return {
    dueAt: dueAt.toISOString(),
    remainingMs,
    breached: overdue,
    // A discharged obligation is never "at risk" — it is finished.
    atRisk: !overdue && !metAt && remainingMs <= windowMs * AT_RISK_FRACTION,
    metAt: metAt?.toISOString() ?? null,
  };
}

export interface SnapshotArgs {
  now: Date;
  status: TicketStatus;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  policy: SlaPolicy;
}

/**
 * Live SLA state. Computed on every read, never stored — a stored `atRisk`
 * flag would depend on when the cron last ran rather than on what time it is.
 */
export function snapshot(clock: SlaClock, args: SnapshotArgs, cal: BusinessCalendar): SlaSnapshot {
  // While paused the clock is frozen, so every measurement is taken as of the
  // instant the pause began rather than now.
  const reference = clock.pausedAt ?? args.now;

  const firstResponse = deadlineState(
    clock.firstResponseDueAt,
    args.firstResponseAt,
    reference,
    args.policy.firstResponseMinutes * MINUTE_MS,
    cal,
  );

  const resolution = deadlineState(
    clock.resolutionDueAt,
    args.resolvedAt,
    reference,
    args.policy.resolutionMinutes * MINUTE_MS,
    cal,
  );

  // Sort key for "most at-risk first". The governing deadline is whichever
  // obligation is still outstanding; a fully discharged ticket sorts last.
  let urgencyMs = Number.POSITIVE_INFINITY;
  if (!args.firstResponseAt && firstResponse.remainingMs !== null) {
    urgencyMs = firstResponse.remainingMs;
  } else if (!args.resolvedAt && resolution.remainingMs !== null) {
    urgencyMs = resolution.remainingMs;
  }

  return { firstResponse, resolution, paused: Boolean(clock.pausedAt), urgencyMs };
}

export interface BreachDecision {
  /** Breaches crossed on this pass, i.e. not already latched. */
  newlyBreached: ("first_response" | "resolution")[];
  shouldEscalate: boolean;
}

/**
 * What the sweep should do about one ticket.
 *
 * Escalation keys off the *transition into* breach, not the breached state, so
 * a ticket is promoted once and then left alone. Without the latch a minute-ly
 * cron would walk a low-priority ticket up to urgent in four minutes.
 */
export function decideBreach(clock: SlaClock, snap: SlaSnapshot): BreachDecision {
  const newlyBreached: ("first_response" | "resolution")[] = [];

  if (snap.firstResponse.breached && !clock.firstResponseBreached && !snap.firstResponse.metAt) {
    newlyBreached.push("first_response");
  }
  if (snap.resolution.breached && !clock.resolutionBreached && !snap.resolution.metAt) {
    newlyBreached.push("resolution");
  }

  return { newlyBreached, shouldEscalate: newlyBreached.length > 0 };
}
