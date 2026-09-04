/**
 * The ticket state machine, expressed as data.
 *
 * Kept as a table rather than a chain of `if`s so the API and the UI read the
 * same source: the status dropdown offers exactly the transitions the server
 * will accept, which is the only way to avoid a UI that presents an option and
 * then 422s on it.
 */

import type { Role, TicketStatus } from "./types.js";

export interface Transition {
  to: TicketStatus;
  /** Roles permitted to make this move. */
  roles: readonly Role[];
  /** Shown in the UI and in the rejection message. */
  label: string;
}

/**
 * Allowed moves out of each status.
 *
 * Note what is deliberately absent: `waiting_on_customer -> closed`. That is
 * the brief's own example of an illegal transition — a ticket still waiting on
 * the customer has to pass through `resolved` first, so somebody records what
 * the resolution actually was. A customer's only levers anywhere in this table
 * are replying (which moves the ticket back to `in_progress`) and reopening.
 */
export const TRANSITIONS: Record<TicketStatus, readonly Transition[]> = {
  open: [
    { to: "in_progress", roles: ["agent", "admin"], label: "Start work" },
    { to: "waiting_on_customer", roles: ["agent", "admin"], label: "Wait on customer" },
    { to: "resolved", roles: ["agent", "admin"], label: "Resolve" },
  ],
  in_progress: [
    { to: "open", roles: ["agent", "admin"], label: "Return to queue" },
    { to: "waiting_on_customer", roles: ["agent", "admin"], label: "Wait on customer" },
    { to: "resolved", roles: ["agent", "admin"], label: "Resolve" },
  ],
  waiting_on_customer: [
    { to: "in_progress", roles: ["customer", "agent", "admin"], label: "Customer replied" },
    { to: "resolved", roles: ["agent", "admin"], label: "Resolve" },
  ],
  resolved: [
    { to: "closed", roles: ["agent", "admin"], label: "Close" },
    { to: "reopened", roles: ["customer", "agent", "admin"], label: "Reopen" },
  ],
  closed: [{ to: "reopened", roles: ["agent", "admin"], label: "Reopen" }],
  reopened: [
    { to: "in_progress", roles: ["agent", "admin"], label: "Start work" },
    { to: "waiting_on_customer", roles: ["agent", "admin"], label: "Wait on customer" },
    { to: "resolved", roles: ["agent", "admin"], label: "Resolve" },
  ],
};

export interface TransitionCheck {
  ok: boolean;
  /** Why it was refused, phrased for an API response body. */
  reason?: string;
  /** What the actor could legally do instead. */
  allowed: TicketStatus[];
}

/** Transitions `role` may perform from `from`. Drives the status dropdown. */
export function allowedTransitions(from: TicketStatus, role: Role): Transition[] {
  return [...(TRANSITIONS[from] ?? [])].filter((t) => t.roles.includes(role));
}

/**
 * Validates a status change. Separates "that move does not exist" from "that
 * move exists but not for you", because the two need different messages: the
 * first is a workflow error, the second is a permissions error.
 */
export function checkTransition(from: TicketStatus, to: TicketStatus, role: Role): TransitionCheck {
  const allowedForRole = allowedTransitions(from, role).map((t) => t.to);

  if (from === to) {
    return { ok: false, reason: `Ticket is already ${from}.`, allowed: allowedForRole };
  }

  const transition = (TRANSITIONS[from] ?? []).find((t) => t.to === to);
  if (!transition) {
    const anyRole = (TRANSITIONS[from] ?? []).map((t) => t.to);
    return {
      ok: false,
      reason:
        `Cannot move a ticket from ${from} to ${to}. ` +
        (anyRole.length ? `Valid next states are: ${anyRole.join(", ")}.` : `${from} is a final state.`),
      allowed: allowedForRole,
    };
  }

  if (!transition.roles.includes(role)) {
    return {
      ok: false,
      reason: `A ${role} cannot move a ticket from ${from} to ${to}.`,
      allowed: allowedForRole,
    };
  }

  return { ok: true, allowed: allowedForRole };
}

/** True when this move starts an SLA pause. */
export function pausesClock(to: TicketStatus): boolean {
  return to === "waiting_on_customer";
}

/** True when this move ends an SLA pause. */
export function resumesClock(from: TicketStatus, to: TicketStatus): boolean {
  return from === "waiting_on_customer" && to !== "waiting_on_customer";
}
