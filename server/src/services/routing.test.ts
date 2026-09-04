import { describe, expect, it } from "vitest";
import type { RoutingRule } from "../../../shared/types.js";
import { selectPriority } from "./routing.service.js";

const rule = (over: Partial<RoutingRule> & Pick<RoutingRule, "name" | "keywords" | "priority">): RoutingRule => ({
  id: over.name,
  field: "both",
  weight: 10,
  active: true,
  ...over,
});

const OUTAGE = rule({ name: "outage", keywords: ["down", "outage"], priority: "urgent", weight: 100 });
const LOGIN = rule({ name: "login", keywords: ["can't login", "locked out"], priority: "urgent", weight: 90 });
const SHOUTY = rule({ name: "shouty", keywords: ["urgent", "asap"], priority: "high", weight: 60 });
const HOWTO = rule({ name: "howto", keywords: ["how do i"], priority: "low", weight: 20 });

const RULES = [OUTAGE, LOGIN, SHOUTY, HOWTO];

describe("selectPriority", () => {
  it("returns null when nothing matches, so the caller can apply its own default", () => {
    expect(selectPriority(RULES, "Feature request", "It would be nice to have dark mode.")).toBeNull();
  });

  it("matches on the subject", () => {
    const match = selectPriority(RULES, "Checkout is down", "Started an hour ago.");
    expect(match?.priority).toBe("urgent");
    expect(match?.rule.name).toBe("outage");
  });

  it("matches on the body", () => {
    expect(selectPriority(RULES, "Problem", "The whole site is down.")?.priority).toBe("urgent");
  });

  it("respects word boundaries so 'down' does not fire on 'download'", () => {
    // The single most likely false positive in a keyword router, and the reason
    // this is a regex with \b rather than a substring check.
    expect(selectPriority(RULES, "Download link expired", "The download link 404s.")).toBeNull();
  });

  it("matches multi-word keywords with flexible whitespace", () => {
    expect(selectPriority(RULES, "I can't  login", "")?.rule.name).toBe("login");
    expect(selectPriority(RULES, "How do I export?", "")?.priority).toBe("low");
  });

  it("is case insensitive", () => {
    expect(selectPriority(RULES, "TOTAL OUTAGE", "")?.priority).toBe("urgent");
  });

  it("lets the highest weight win when several rules match", () => {
    // "urgent" (weight 60) and "down" (weight 100) both match; the outage wins.
    const match = selectPriority(RULES, "Urgent: the API is down", "");
    expect(match?.rule.name).toBe("outage");
    expect(match?.priority).toBe("urgent");
  });

  it("breaks a weight tie towards the more severe priority", () => {
    // Erring upward is the safer default: a medium ticket treated as high
    // costs some attention, an urgent one treated as medium costs a breach.
    const tied = [
      rule({ name: "a", keywords: ["glitch"], priority: "low", weight: 50 }),
      rule({ name: "b", keywords: ["glitch"], priority: "high", weight: 50 }),
    ];
    expect(selectPriority(tied, "A glitch", "")?.priority).toBe("high");
  });

  it("ignores inactive rules", () => {
    const off = [{ ...OUTAGE, active: false }];
    expect(selectPriority(off, "Everything is down", "")).toBeNull();
  });

  it("honours a subject-only rule", () => {
    const subjectOnly = [rule({ name: "s", keywords: ["down"], priority: "urgent", field: "subject" })];
    expect(selectPriority(subjectOnly, "All good", "but the server is down")).toBeNull();
    expect(selectPriority(subjectOnly, "Server down", "")).not.toBeNull();
  });

  it("reports which keywords matched, for the audit trail", () => {
    const match = selectPriority(RULES, "Site down, total outage", "");
    expect(match?.matched).toEqual(["down", "outage"]);
  });

  it("treats regex metacharacters in a keyword as literal text", () => {
    const weird = [rule({ name: "w", keywords: ["c++"], priority: "high" })];
    // Must not throw, and must not match everything.
    expect(() => selectPriority(weird, "anything", "")).not.toThrow();
    expect(selectPriority(weird, "anything", "")).toBeNull();
  });
});
