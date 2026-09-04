import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { HOUR_MS, type BusinessCalendar } from "./business-time.js";
import {
  AT_RISK_FRACTION,
  decideBreach,
  pauseClock,
  repriceClock,
  resumeClock,
  snapshot,
  startClock,
} from "./sla.js";
import { DEFAULT_SLA_POLICIES, type SlaPolicy } from "./types.js";

const TZ = "Asia/Karachi";
const W = { start: "09:00", end: "18:00" };
const CAL: BusinessCalendar = {
  timezone: TZ,
  days: { 0: null, 1: W, 2: W, 3: W, 4: W, 5: W, 6: null },
  holidays: [],
};

const at = (s: string) => fromZonedTime(s, TZ);
const hours = (n: number) => n * HOUR_MS;
const policy = (p: string): SlaPolicy => DEFAULT_SLA_POLICIES.find((x) => x.priority === p)!;

const URGENT = policy("urgent"); // 60min first response / 240min resolution
const MEDIUM = policy("medium"); // 480 / 1440
const HIGH = policy("high"); // 120 / 480

// Reference week: Mon 2026-03-02 .. Fri 2026-03-06.
const MON_9 = at("2026-03-02T09:00:00");

describe("startClock", () => {
  it("sets both deadlines in business time", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    expect(clock.firstResponseDueAt).toEqual(at("2026-03-02T10:00:00"));
    expect(clock.resolutionDueAt).toEqual(at("2026-03-02T13:00:00"));
    expect(clock.pausedBusinessMs).toBe(0);
    expect(clock.resolutionBreached).toBe(false);
  });

  it("rolls a weekend ticket forward to Monday rather than starting in dead time", () => {
    const clock = startClock(at("2026-03-07T02:00:00"), URGENT, CAL);
    expect(clock.firstResponseDueAt).toEqual(at("2026-03-09T10:00:00"));
    expect(clock.resolutionDueAt).toEqual(at("2026-03-09T13:00:00"));
  });

  it("spreads a low-priority 5-business-day resolution across the following week", () => {
    const clock = startClock(MON_9, policy("low"), CAL);
    // 2700 business minutes = 45h = five 9-hour days.
    expect(clock.resolutionDueAt).toEqual(at("2026-03-06T18:00:00"));
  });
});

describe("pause and resume", () => {
  it("pushes both deadlines forward by the business time spent paused", () => {
    let clock = startClock(MON_9, URGENT, CAL);
    clock = pauseClock(clock, at("2026-03-02T09:30:00"));
    expect(clock.pausedAt).toEqual(at("2026-03-02T09:30:00"));

    clock = resumeClock(clock, at("2026-03-02T11:30:00"), CAL);
    expect(clock.pausedBusinessMs).toBe(hours(2));
    expect(clock.pausedAt).toBeNull();
    expect(clock.firstResponseDueAt).toEqual(at("2026-03-02T12:00:00"));
    expect(clock.resolutionDueAt).toEqual(at("2026-03-02T15:00:00"));
  });

  it("credits only business time when the pause spans a weekend", () => {
    // Paused Fri 17:00, customer replies Mon 10:00. 65 wall-clock hours, but
    // only 2 business hours were owed, so the agent gains 2 hours, not 65.
    let clock = startClock(at("2026-03-06T16:00:00"), URGENT, CAL);
    expect(clock.resolutionDueAt).toEqual(at("2026-03-09T11:00:00"));

    clock = pauseClock(clock, at("2026-03-06T17:00:00"));
    clock = resumeClock(clock, at("2026-03-09T10:00:00"), CAL);

    expect(clock.pausedBusinessMs).toBe(hours(2));
    expect(clock.resolutionDueAt).toEqual(at("2026-03-09T13:00:00"));
  });

  it("credits nothing for a pause entirely outside business hours", () => {
    let clock = startClock(MON_9, URGENT, CAL);
    const due = clock.resolutionDueAt;
    clock = pauseClock(clock, at("2026-03-07T09:00:00")); // Saturday
    clock = resumeClock(clock, at("2026-03-08T17:00:00"), CAL); // Sunday
    expect(clock.pausedBusinessMs).toBe(0);
    expect(clock.resolutionDueAt).toEqual(due);
  });

  it("ignores a second pause so time cannot be double-counted", () => {
    let clock = startClock(MON_9, URGENT, CAL);
    clock = pauseClock(clock, at("2026-03-02T10:00:00"));
    clock = pauseClock(clock, at("2026-03-02T11:00:00"));
    expect(clock.pausedAt).toEqual(at("2026-03-02T10:00:00"));
  });

  it("ignores a resume on a clock that was never paused", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    expect(resumeClock(clock, at("2026-03-02T11:00:00"), CAL)).toEqual(clock);
  });

  it("accumulates across repeated pause cycles", () => {
    let clock = startClock(MON_9, MEDIUM, CAL);
    clock = resumeClock(pauseClock(clock, at("2026-03-02T10:00:00")), at("2026-03-02T11:00:00"), CAL);
    clock = resumeClock(pauseClock(clock, at("2026-03-02T12:00:00")), at("2026-03-02T15:00:00"), CAL);
    expect(clock.pausedBusinessMs).toBe(hours(4));
  });
});

describe("repriceClock", () => {
  it("rebuilds deadlines from the original anchor under the new policy", () => {
    const clock = startClock(MON_9, MEDIUM, CAL);
    expect(clock.resolutionDueAt).toEqual(at("2026-03-04T15:00:00")); // 24 business hours

    const escalated = repriceClock(clock, { createdAt: MON_9, firstResponseAt: null }, HIGH, CAL);
    expect(escalated.firstResponseDueAt).toEqual(at("2026-03-02T11:00:00")); // 2h
    expect(escalated.resolutionDueAt).toEqual(at("2026-03-02T17:00:00")); // 8h
  });

  it("is idempotent, so a repeated cron pass cannot drift the deadline", () => {
    const clock = startClock(MON_9, MEDIUM, CAL);
    const once = repriceClock(clock, { createdAt: MON_9, firstResponseAt: null }, HIGH, CAL);
    const twice = repriceClock(once, { createdAt: MON_9, firstResponseAt: null }, HIGH, CAL);
    expect(twice).toEqual(once);
  });

  it("preserves pause time already banked", () => {
    let clock = startClock(MON_9, MEDIUM, CAL);
    clock = resumeClock(pauseClock(clock, at("2026-03-02T10:00:00")), at("2026-03-02T12:00:00"), CAL);
    expect(clock.pausedBusinessMs).toBe(hours(2));

    const escalated = repriceClock(clock, { createdAt: MON_9, firstResponseAt: null }, HIGH, CAL);
    // 8 business hours from Mon 09:00 is Mon 17:00; plus 2 banked hours is Tue 10:00.
    expect(escalated.resolutionDueAt).toEqual(at("2026-03-03T10:00:00"));
  });

  it("leaves a discharged first-response deadline frozen", () => {
    const clock = startClock(MON_9, MEDIUM, CAL);
    const firstResponseAt = at("2026-03-02T10:00:00");
    const escalated = repriceClock(clock, { createdAt: MON_9, firstResponseAt }, HIGH, CAL);
    // Rewriting it would rewrite history: the reply either made the old
    // deadline or it did not.
    expect(escalated.firstResponseDueAt).toEqual(clock.firstResponseDueAt);
  });

  it("can leave a ticket already breached, which is the point of escalating", () => {
    const clock = startClock(MON_9, MEDIUM, CAL);
    const escalated = repriceClock(clock, { createdAt: MON_9, firstResponseAt: null }, URGENT, CAL);
    const snap = snapshot(
      escalated,
      { now: at("2026-03-02T14:00:00"), status: "open", firstResponseAt: null, resolvedAt: null, policy: URGENT },
      CAL,
    );
    expect(snap.resolution.breached).toBe(true);
  });
});

describe("snapshot", () => {
  const base = { status: "open" as const, firstResponseAt: null, resolvedAt: null, policy: URGENT };

  it("reports remaining business time, not wall-clock time", () => {
    const clock = startClock(at("2026-03-06T16:00:00"), URGENT, CAL); // resolution due Mon 11:00
    const snap = snapshot(clock, { ...base, now: at("2026-03-06T17:00:00") }, CAL);
    // Friday 17:00 to Monday 11:00 is 65 wall-clock hours and 3 business hours.
    expect(snap.resolution.remainingMs).toBe(hours(3));
  });

  it("flags at-risk inside the final quarter of the window", () => {
    const clock = startClock(MON_9, URGENT, CAL); // resolution window 4h, due 13:00
    const firstResponseAt = at("2026-03-02T09:30:00");

    const safe = snapshot(clock, { ...base, firstResponseAt, now: at("2026-03-02T11:00:00") }, CAL);
    expect(safe.resolution.remainingMs).toBe(hours(2));
    expect(safe.resolution.atRisk).toBe(false);

    const risky = snapshot(clock, { ...base, firstResponseAt, now: at("2026-03-02T12:30:00") }, CAL);
    expect(risky.resolution.remainingMs).toBe(hours(0.5));
    expect(risky.resolution.atRisk).toBe(true);
    // 0.5h left of a 4h window is 12.5%, inside the brief's 25% threshold.
    expect(hours(0.5)).toBeLessThanOrEqual(hours(4) * AT_RISK_FRACTION);
  });

  it("reports a breach as negative remaining time", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const snap = snapshot(clock, { ...base, now: at("2026-03-02T15:00:00") }, CAL);
    expect(snap.resolution.breached).toBe(true);
    expect(snap.resolution.remainingMs).toBe(hours(-2));
    expect(snap.resolution.atRisk).toBe(false); // breached is past at-risk, not still in it
  });

  it("freezes remaining time while the ticket waits on the customer", () => {
    let clock = startClock(MON_9, URGENT, CAL);
    clock = pauseClock(clock, at("2026-03-02T11:00:00"));

    const early = snapshot(clock, { ...base, status: "waiting_on_customer", now: at("2026-03-02T11:30:00") }, CAL);
    const later = snapshot(clock, { ...base, status: "waiting_on_customer", now: at("2026-03-04T16:00:00") }, CAL);

    expect(early.paused).toBe(true);
    expect(early.resolution.remainingMs).toBe(hours(2));
    // Two days later it is still 2 hours: the clock did not run.
    expect(later.resolution.remainingMs).toBe(hours(2));
    expect(later.resolution.breached).toBe(false);
  });

  it("measures a met deadline at the moment it was met, not now", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const snap = snapshot(
      clock,
      { ...base, firstResponseAt: at("2026-03-02T09:45:00"), now: at("2026-03-05T09:00:00") },
      CAL,
    );
    expect(snap.firstResponse.breached).toBe(false); // replied at 09:45, due 10:00
    expect(snap.firstResponse.metAt).toBe(at("2026-03-02T09:45:00").toISOString());
    expect(snap.firstResponse.atRisk).toBe(false);
  });

  it("records a first response that arrived late as breached", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const snap = snapshot(clock, { ...base, firstResponseAt: at("2026-03-02T11:00:00"), now: at("2026-03-02T11:00:00") }, CAL);
    expect(snap.firstResponse.breached).toBe(true);
    expect(snap.firstResponse.remainingMs).toBe(hours(-1));
  });

  it("sorts by the governing deadline", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const now = at("2026-03-02T09:30:00");

    // Before any reply, first response governs: 30 minutes left.
    const awaitingReply = snapshot(clock, { ...base, now }, CAL);
    expect(awaitingReply.urgencyMs).toBe(hours(0.5));

    // Once replied, resolution governs: 3.5 hours left.
    const replied = snapshot(clock, { ...base, now, firstResponseAt: at("2026-03-02T09:20:00") }, CAL);
    expect(replied.urgencyMs).toBe(hours(3.5));

    // Fully discharged tickets sort last.
    const done = snapshot(
      clock,
      { ...base, now, status: "resolved", firstResponseAt: at("2026-03-02T09:20:00"), resolvedAt: at("2026-03-02T09:25:00") },
      CAL,
    );
    expect(done.urgencyMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("decideBreach", () => {
  const args = { status: "open" as const, firstResponseAt: null, resolvedAt: null, policy: URGENT };

  it("reports a breach the first time it is seen", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const snap = snapshot(clock, { ...args, now: at("2026-03-02T15:00:00") }, CAL);
    const decision = decideBreach(clock, snap);
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.newlyBreached).toEqual(["first_response", "resolution"]);
  });

  it("stays silent once the breach is latched, so the sweep cannot escalate twice", () => {
    const clock = { ...startClock(MON_9, URGENT, CAL), firstResponseBreached: true, resolutionBreached: true };
    const snap = snapshot(clock, { ...args, now: at("2026-03-02T15:00:00") }, CAL);
    expect(decideBreach(clock, snap).shouldEscalate).toBe(false);
  });

  it("says nothing about a ticket that is still inside its SLA", () => {
    const clock = startClock(MON_9, URGENT, CAL);
    const snap = snapshot(clock, { ...args, now: at("2026-03-02T09:30:00") }, CAL);
    expect(decideBreach(clock, snap).shouldEscalate).toBe(false);
  });

  it("does not breach a paused ticket however long it waits", () => {
    let clock = startClock(MON_9, URGENT, CAL);
    clock = pauseClock(clock, at("2026-03-02T09:30:00"));
    const snap = snapshot(clock, { ...args, status: "waiting_on_customer", now: at("2026-03-20T12:00:00") }, CAL);
    expect(snap.resolution.breached).toBe(false);
    expect(decideBreach(clock, snap).shouldEscalate).toBe(false);
  });
});
