/**
 * The checkpoint suite. The brief is explicit that the business-hours
 * calculator must be proven correct before anything is built on top of it,
 * because a wrong answer here is invisible: every deadline, escalation and
 * dashboard sort would be quietly off with nothing looking broken.
 *
 * Fixed reference week: Mon 2026-03-02 .. Fri 2026-03-06, with the weekend of
 * Sat 2026-03-07 / Sun 2026-03-08 following it. Asserted in the first test so
 * a mistake in the fixture cannot masquerade as a passing suite.
 */

import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import {
  BusinessTimeError,
  HOUR_MS,
  addBusinessMs,
  businessMsBetween,
  isOpenAt,
  nextOpenMoment,
  subtractBusinessMs,
  validateCalendar,
  type BusinessCalendar,
} from "./business-time.js";

const KHI_TZ = "Asia/Karachi"; // UTC+5 year-round: no DST to confound the base cases.
const NY_TZ = "America/New_York"; // DST, used deliberately for the transition cases.

const NINE_TO_SIX = { start: "09:00", end: "18:00" };

/** Mon-Fri 09:00-18:00 in Karachi. The default calendar for most cases. */
const KHI: BusinessCalendar = {
  timezone: KHI_TZ,
  days: { 0: null, 1: NINE_TO_SIX, 2: NINE_TO_SIX, 3: NINE_TO_SIX, 4: NINE_TO_SIX, 5: NINE_TO_SIX, 6: null },
  holidays: [],
};

/** Open every day, so a Sunday DST transition is actually inside a window. */
const NY_ALL_DAYS: BusinessCalendar = {
  timezone: NY_TZ,
  days: { 0: NINE_TO_SIX, 1: NINE_TO_SIX, 2: NINE_TO_SIX, 3: NINE_TO_SIX, 4: NINE_TO_SIX, 5: NINE_TO_SIX, 6: NINE_TO_SIX },
  holidays: [],
};

/**
 * A 01:00-05:00 window straddling the 02:00 DST transition. This is the only
 * way to actually exercise the offset-per-day logic; a 09:00-18:00 window sits
 * entirely after the transition and would pass even with a broken calculation.
 */
const NIGHT = { start: "01:00", end: "05:00" };
const NY_NIGHT: BusinessCalendar = {
  timezone: NY_TZ,
  days: { 0: NIGHT, 1: NIGHT, 2: NIGHT, 3: NIGHT, 4: NIGHT, 5: NIGHT, 6: NIGHT },
  holidays: [],
};

/** Wall-clock string in Karachi to an instant. */
const khi = (s: string) => fromZonedTime(s, KHI_TZ);
/** Wall-clock string in New York to an instant. */
const ny = (s: string) => fromZonedTime(s, NY_TZ);

/** Deterministic PRNG so a failure is reproducible rather than a flake. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hours = (n: number) => n * HOUR_MS;

describe("fixture sanity", () => {
  it("the reference week really is Mon-Fri", () => {
    // If this fails, every expectation below is measuring the wrong days.
    const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    expect(dow("2026-03-02")).toBe(1); // Monday
    expect(dow("2026-03-06")).toBe(5); // Friday
    expect(dow("2026-03-07")).toBe(6); // Saturday
    expect(dow("2026-03-09")).toBe(1); // the following Monday
  });

  it("the US DST transitions fall where the tests assume", () => {
    // Spring forward 2026-03-08, fall back 2026-11-01, both at 02:00 local.
    const springGap = ny("2026-03-08T03:00:00").getTime() - ny("2026-03-08T01:00:00").getTime();
    expect(springGap).toBe(hours(1)); // two wall-clock hours, one real hour

    // Fall back is the harder direction: 01:00-01:59 happens twice, so
    // "2026-11-01T01:00:00" names two different instants and no library can
    // pick the right one. date-fns-tz resolves the ambiguity to the LATER
    // offset (EST), which is what this asserts. Pinned deliberately: if the
    // library ever changes its mind, this fails first and explains why some
    // once-a-year SLA arithmetic shifted by an hour.
    const fallGap = ny("2026-11-01T03:00:00").getTime() - ny("2026-11-01T01:00:00").getTime();
    expect(fallGap).toBe(hours(2));
  });
});

describe("businessMsBetween", () => {
  it("1. counts a plain within-day interval", () => {
    expect(businessMsBetween(khi("2026-03-02T10:00:00"), khi("2026-03-02T12:00:00"), KHI)).toBe(hours(2));
  });

  it("2. ignores time before opening", () => {
    expect(businessMsBetween(khi("2026-03-02T07:00:00"), khi("2026-03-02T11:00:00"), KHI)).toBe(hours(2));
  });

  it("3. ignores time after closing", () => {
    expect(businessMsBetween(khi("2026-03-02T16:00:00"), khi("2026-03-02T22:00:00"), KHI)).toBe(hours(2));
  });

  it("4. returns zero for an interval entirely before opening", () => {
    expect(businessMsBetween(khi("2026-03-02T06:00:00"), khi("2026-03-02T08:00:00"), KHI)).toBe(0);
  });

  it("5. skips the overnight gap", () => {
    // Tue 17:00 -> Wed 10:00 is 17 wall-clock hours but only 1h + 1h of business time.
    expect(businessMsBetween(khi("2026-03-03T17:00:00"), khi("2026-03-04T10:00:00"), KHI)).toBe(hours(2));
  });

  it("6. skips a whole weekend", () => {
    // Fri 17:00 -> Mon 10:00 is 65 wall-clock hours and 2 business hours.
    expect(businessMsBetween(khi("2026-03-06T17:00:00"), khi("2026-03-09T10:00:00"), KHI)).toBe(hours(2));
  });

  it("7. sums a full business week", () => {
    expect(businessMsBetween(khi("2026-03-02T09:00:00"), khi("2026-03-06T18:00:00"), KHI)).toBe(hours(45));
  });

  it("8. sums three business weeks", () => {
    expect(businessMsBetween(khi("2026-03-02T09:00:00"), khi("2026-03-20T18:00:00"), KHI)).toBe(hours(135));
  });

  it("9. returns zero for identical timestamps", () => {
    const t = khi("2026-03-02T10:00:00");
    expect(businessMsBetween(t, t, KHI)).toBe(0);
  });

  it("10. returns zero rather than a negative when end precedes start", () => {
    // A negative would flow into a deadline and produce a ticket due before it existed.
    expect(businessMsBetween(khi("2026-03-02T12:00:00"), khi("2026-03-02T10:00:00"), KHI)).toBe(0);
  });

  it("11. returns zero for an interval inside a closed day", () => {
    expect(businessMsBetween(khi("2026-03-07T10:00:00"), khi("2026-03-07T16:00:00"), KHI)).toBe(0);
  });

  it("12. treats a holiday as closed", () => {
    const withHoliday: BusinessCalendar = { ...KHI, holidays: ["2026-03-03"] };
    // Mon full + Tue (holiday, 0) + Wed full.
    expect(businessMsBetween(khi("2026-03-02T09:00:00"), khi("2026-03-04T18:00:00"), withHoliday)).toBe(hours(18));
  });

  it("13. honours a mid-week closed day", () => {
    const noWednesday: BusinessCalendar = { ...KHI, days: { ...KHI.days, 3: null } };
    expect(businessMsBetween(khi("2026-03-02T09:00:00"), khi("2026-03-06T18:00:00"), noWednesday)).toBe(hours(36));
  });

  it("14. keeps a 9-hour window at 9 hours on the spring-forward day", () => {
    // The 02:00 transition is outside 09:00-18:00, so the window is unaffected.
    expect(businessMsBetween(ny("2026-03-08T00:00:00"), ny("2026-03-08T23:00:00"), NY_ALL_DAYS)).toBe(hours(9));
  });

  it("15. keeps a 9-hour window at 9 hours on the fall-back day", () => {
    expect(businessMsBetween(ny("2026-11-01T00:00:00"), ny("2026-11-01T23:00:00"), NY_ALL_DAYS)).toBe(hours(9));
  });

  it("16. reports real elapsed time when DST lands inside the window", () => {
    // Window is 01:00-05:00 wall clock, so the 02:00 transition is inside it.
    // Spring forward: 01:00 EST -> 05:00 EDT is only 3 real hours. The window
    // still reads 01:00-05:00 on the wall, which is the semantics we want.
    const spring = businessMsBetween(ny("2026-03-08T00:00:00"), ny("2026-03-08T23:00:00"), NY_NIGHT);
    expect(spring).toBe(hours(3));

    // Fall back: both 01:00 and 05:00 resolve to EST (see the fixture-sanity
    // test), so the repeated hour lands before the window opens and the day
    // measures a plain 4 hours rather than 5. Ambiguous-hour behaviour, pinned
    // rather than worked around: a realistic 09:00-18:00 calendar never
    // straddles a 02:00 transition, so this cannot affect production SLAs.
    const fall = businessMsBetween(ny("2026-11-01T00:00:00"), ny("2026-11-01T23:00:00"), NY_NIGHT);
    expect(fall).toBe(hours(4));
  });

  it("17. throws rather than spinning on an absurd interval", () => {
    expect(() => businessMsBetween(khi("2026-03-02T09:00:00"), khi("2060-03-02T09:00:00"), KHI)).toThrow(
      BusinessTimeError,
    );
  });
});

describe("addBusinessMs", () => {
  it("18. adds within a single day", () => {
    expect(addBusinessMs(khi("2026-03-02T09:00:00"), hours(2), KHI)).toEqual(khi("2026-03-02T11:00:00"));
  });

  it("19. carries over the overnight gap", () => {
    expect(addBusinessMs(khi("2026-03-02T17:00:00"), hours(2), KHI)).toEqual(khi("2026-03-03T10:00:00"));
  });

  it("20. carries over a weekend", () => {
    expect(addBusinessMs(khi("2026-03-06T17:00:00"), hours(2), KHI)).toEqual(khi("2026-03-09T10:00:00"));
  });

  it("21. rolls a start outside business hours forward to the next open moment", () => {
    // A ticket filed 02:00 Saturday starts its clock Monday 09:00, so the
    // deadline is Monday 10:00 rather than a dead-time Saturday 03:00.
    expect(addBusinessMs(khi("2026-03-07T02:00:00"), hours(1), KHI)).toEqual(khi("2026-03-09T10:00:00"));
  });

  it("22. rolls forward even for a zero-length duration", () => {
    expect(addBusinessMs(khi("2026-03-07T02:00:00"), 0, KHI)).toEqual(khi("2026-03-09T09:00:00"));
  });

  it("23. lands exactly on closing time when the duration fills the week", () => {
    expect(addBusinessMs(khi("2026-03-02T09:00:00"), hours(45), KHI)).toEqual(khi("2026-03-06T18:00:00"));
  });

  it("24. handles the low-priority 5-business-day resolution SLA", () => {
    // 45 business hours from Wed 10:00 is the same clock time five business days on.
    expect(addBusinessMs(khi("2026-03-04T10:00:00"), hours(45), KHI)).toEqual(khi("2026-03-11T10:00:00"));
  });

  it("25. skips holidays", () => {
    const withHoliday: BusinessCalendar = { ...KHI, holidays: ["2026-03-03"] };
    // Mon 17:00 + 2h: 1h left on Monday, Tuesday is a holiday, so it lands Wednesday.
    expect(addBusinessMs(khi("2026-03-02T17:00:00"), hours(2), withHoliday)).toEqual(khi("2026-03-04T10:00:00"));
  });

  it("26. rejects a negative duration", () => {
    expect(() => addBusinessMs(khi("2026-03-02T09:00:00"), -1, KHI)).toThrow(BusinessTimeError);
  });
});

describe("isOpenAt / nextOpenMoment", () => {
  it("27. treats the closing instant as closed", () => {
    expect(isOpenAt(khi("2026-03-02T17:59:59"), KHI)).toBe(true);
    expect(isOpenAt(khi("2026-03-02T18:00:00"), KHI)).toBe(false);
    expect(isOpenAt(khi("2026-03-02T09:00:00"), KHI)).toBe(true);
    expect(isOpenAt(khi("2026-03-02T08:59:59"), KHI)).toBe(false);
    expect(isOpenAt(khi("2026-03-07T12:00:00"), KHI)).toBe(false);
  });

  it("28. returns the instant unchanged when already open", () => {
    const t = khi("2026-03-02T10:00:00");
    expect(nextOpenMoment(t, KHI)).toEqual(t);
  });

  it("29. jumps a weekend to Monday opening", () => {
    expect(nextOpenMoment(khi("2026-03-07T12:00:00"), KHI)).toEqual(khi("2026-03-09T09:00:00"));
  });

  it("30. throws when the calendar can never open", () => {
    const holidayForever: BusinessCalendar = {
      ...KHI,
      days: { 0: null, 1: null, 2: null, 3: null, 4: NINE_TO_SIX, 5: null, 6: null },
      // Every Thursday for the next 11 years is a holiday? Cheaper proxy: no open day at all.
    };
    const never: BusinessCalendar = { ...holidayForever, days: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } };
    expect(() => nextOpenMoment(khi("2026-03-02T09:00:00"), never)).toThrow(BusinessTimeError);
  });
});

describe("round-trip property", () => {
  it("31. businessMsBetween(t, addBusinessMs(t, n)) === n for 500 random pairs", () => {
    const rand = mulberry32(20260302);
    const origin = khi("2026-01-01T00:00:00").getTime();
    const yearMs = 365 * 24 * HOUR_MS;

    for (let i = 0; i < 500; i += 1) {
      // Any instant in 2026, open or closed. Closed starts matter most: they
      // exercise the roll-forward, which is where off-by-one bugs hide.
      const t = new Date(origin + Math.floor(rand() * yearMs));
      const n = Math.floor(rand() * hours(60));
      const arrived = addBusinessMs(t, n, KHI);
      expect(businessMsBetween(t, arrived, KHI)).toBe(n);
    }
  });

  it("32. the property also holds across DST with a window straddling the transition", () => {
    const rand = mulberry32(7);
    const origin = ny("2026-02-15T00:00:00").getTime();
    const spanMs = 300 * 24 * HOUR_MS; // covers both the March and November transitions

    for (let i = 0; i < 300; i += 1) {
      const t = new Date(origin + Math.floor(rand() * spanMs));
      const n = Math.floor(rand() * hours(20));
      expect(businessMsBetween(t, addBusinessMs(t, n, NY_NIGHT), NY_NIGHT)).toBe(n);
    }
  });
});

describe("subtractBusinessMs", () => {
  it("39. steps back within a day", () => {
    expect(subtractBusinessMs(khi("2026-03-02T15:00:00"), hours(2), KHI)).toEqual(khi("2026-03-02T13:00:00"));
  });

  it("40. steps back over the overnight gap", () => {
    expect(subtractBusinessMs(khi("2026-03-03T10:00:00"), hours(2), KHI)).toEqual(khi("2026-03-02T17:00:00"));
  });

  it("41. steps back over a weekend", () => {
    expect(subtractBusinessMs(khi("2026-03-09T10:00:00"), hours(2), KHI)).toEqual(khi("2026-03-06T17:00:00"));
  });

  it("42. anchors an after-hours end at the previous close", () => {
    // Sunday noon has no business time; the last business instant before it is
    // Friday 18:00, so one hour back is Friday 17:00.
    expect(subtractBusinessMs(khi("2026-03-08T12:00:00"), hours(1), KHI)).toEqual(khi("2026-03-06T17:00:00"));
  });

  it("43. skips holidays going backwards", () => {
    const withHoliday: BusinessCalendar = { ...KHI, holidays: ["2026-03-03"] };
    expect(subtractBusinessMs(khi("2026-03-04T10:00:00"), hours(2), withHoliday)).toEqual(khi("2026-03-02T17:00:00"));
  });

  it("44. round-trips against businessMsBetween for 500 random pairs", () => {
    const rand = mulberry32(90210);
    const origin = khi("2026-01-05T00:00:00").getTime();
    const yearMs = 300 * 24 * HOUR_MS;

    for (let i = 0; i < 500; i += 1) {
      const t = new Date(origin + Math.floor(rand() * yearMs));
      const n = Math.floor(rand() * hours(60));
      expect(businessMsBetween(subtractBusinessMs(t, n, KHI), t, KHI)).toBe(n);
    }
  });

  it("45. composes with addBusinessMs", () => {
    const t = khi("2026-03-04T14:30:00");
    expect(addBusinessMs(subtractBusinessMs(t, hours(20), KHI), hours(20), KHI)).toEqual(t);
  });

  it("46. rejects a negative duration", () => {
    expect(() => subtractBusinessMs(khi("2026-03-02T09:00:00"), -1, KHI)).toThrow(BusinessTimeError);
  });
});

describe("validateCalendar", () => {
  it("33. accepts the working calendar", () => {
    expect(() => validateCalendar(KHI)).not.toThrow();
  });

  it("34. rejects an unknown timezone", () => {
    expect(() => validateCalendar({ ...KHI, timezone: "Mars/Olympus" })).toThrow(BusinessTimeError);
  });

  it("35. rejects a malformed window", () => {
    expect(() => validateCalendar({ ...KHI, days: { ...KHI.days, 1: { start: "9am", end: "18:00" } } })).toThrow(
      BusinessTimeError,
    );
  });

  it("36. rejects a window that closes before it opens", () => {
    expect(() => validateCalendar({ ...KHI, days: { ...KHI.days, 1: { start: "18:00", end: "09:00" } } })).toThrow(
      /Overnight windows are unsupported/,
    );
  });

  it("37. rejects a calendar with no open days", () => {
    const shut = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
    expect(() => validateCalendar({ ...KHI, days: shut })).toThrow(/no open days/);
  });

  it("38. rejects a malformed holiday", () => {
    expect(() => validateCalendar({ ...KHI, holidays: ["25 Dec 2026"] })).toThrow(BusinessTimeError);
  });
});
