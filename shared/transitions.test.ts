import { describe, expect, it } from "vitest";
import { allowedTransitions, checkTransition, pausesClock, resumesClock } from "./transitions.js";

describe("checkTransition", () => {
  it("rejects waiting_on_customer -> closed, the brief's illegal move", () => {
    const result = checkTransition("waiting_on_customer", "closed", "agent");
    expect(result.ok).toBe(false);
    // The message has to name the legal alternatives, or the caller is stuck guessing.
    expect(result.reason).toMatch(/Valid next states are: in_progress, resolved/);
  });

  it("allows the same ticket to be closed once it has been resolved", () => {
    expect(checkTransition("waiting_on_customer", "resolved", "agent").ok).toBe(true);
    expect(checkTransition("resolved", "closed", "agent").ok).toBe(true);
  });

  it("permits the ordinary agent workflow", () => {
    expect(checkTransition("open", "in_progress", "agent").ok).toBe(true);
    expect(checkTransition("in_progress", "waiting_on_customer", "agent").ok).toBe(true);
    expect(checkTransition("in_progress", "resolved", "agent").ok).toBe(true);
    expect(checkTransition("closed", "reopened", "agent").ok).toBe(true);
    expect(checkTransition("reopened", "in_progress", "agent").ok).toBe(true);
  });

  it("lets a customer resume the clock by replying", () => {
    expect(checkTransition("waiting_on_customer", "in_progress", "customer").ok).toBe(true);
  });

  it("lets a customer reopen a resolved ticket but not a closed one", () => {
    expect(checkTransition("resolved", "reopened", "customer").ok).toBe(true);
    const closed = checkTransition("closed", "reopened", "customer");
    expect(closed.ok).toBe(false);
    expect(closed.reason).toMatch(/A customer cannot/);
  });

  it("stops a customer resolving or closing their own ticket", () => {
    expect(checkTransition("open", "resolved", "customer").ok).toBe(false);
    expect(checkTransition("resolved", "closed", "customer").ok).toBe(false);
    expect(checkTransition("open", "in_progress", "customer").ok).toBe(false);
  });

  it("separates an impossible move from a forbidden one", () => {
    // Impossible for anyone: the transition is not in the table at all.
    expect(checkTransition("open", "closed", "admin").reason).toMatch(/Cannot move a ticket/);
    // Possible, but not for this role.
    expect(checkTransition("open", "resolved", "customer").reason).toMatch(/A customer cannot/);
  });

  it("rejects a no-op transition", () => {
    const result = checkTransition("open", "open", "agent");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already open/);
  });

  it("gives an admin everything an agent has", () => {
    for (const from of ["open", "in_progress", "waiting_on_customer", "resolved", "closed", "reopened"] as const) {
      const agent = allowedTransitions(from, "agent").map((t) => t.to);
      const admin = allowedTransitions(from, "admin").map((t) => t.to);
      expect(admin).toEqual(expect.arrayContaining(agent));
    }
  });
});

describe("allowedTransitions", () => {
  it("returns only what the role may actually do, so the UI cannot offer a 422", () => {
    expect(allowedTransitions("waiting_on_customer", "customer").map((t) => t.to)).toEqual(["in_progress"]);
    expect(allowedTransitions("waiting_on_customer", "agent").map((t) => t.to)).toEqual(["in_progress", "resolved"]);
    expect(allowedTransitions("closed", "customer")).toEqual([]);
  });
});

describe("clock pause helpers", () => {
  it("identifies the pausing status", () => {
    expect(pausesClock("waiting_on_customer")).toBe(true);
    expect(pausesClock("in_progress")).toBe(false);
  });

  it("identifies a resume only when leaving waiting_on_customer", () => {
    expect(resumesClock("waiting_on_customer", "in_progress")).toBe(true);
    expect(resumesClock("waiting_on_customer", "resolved")).toBe(true);
    expect(resumesClock("open", "in_progress")).toBe(false);
  });
});
