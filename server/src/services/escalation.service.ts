/**
 * The SLA breach sweep.
 *
 * Exported as a plain async function rather than being welded to the cron
 * schedule, so it can be unit-tested and triggered on demand from the admin UI
 * without waiting a minute for a tick.
 */

import { decideBreach, snapshot } from "@shared/sla.js";
import { nextPriorityUp, type Priority, type TicketStatus } from "@shared/types.js";
import { Ticket, type TicketDoc } from "../models/index.js";
import { getCalendar, getPolicies } from "./calendar.service.js";
import { changePriority, logEvent } from "./ticket.service.js";

export interface SweepResult {
  checked: number;
  breached: number;
  escalated: number;
  atCeiling: number;
  details: {
    reference: string;
    subject: string;
    breached: string[];
    from: Priority;
    to: Priority;
    escalated: boolean;
  }[];
}

/**
 * Notifies an admin about a breach.
 *
 * A console log, which the brief explicitly permits. Isolated behind a
 * function so swapping in email later is one edit and not a hunt through the
 * sweep loop.
 */
function notifyAdmin(message: string): void {
  console.warn(`[sla] ${message}`);
}

/**
 * One pass over every live ticket.
 *
 * The query excludes resolved and closed tickets (no clock runs) and paused
 * ones (the customer, not the agent, is holding things up — a paused clock
 * must never breach). Between that filter and the latched breach flags, the
 * sweep is idempotent: running it twice in a row escalates nothing the second
 * time, which matters because a minute-ly cron would otherwise walk a
 * low-priority ticket up to urgent in four minutes flat.
 */
export async function runSlaSweep(now = new Date()): Promise<SweepResult> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);

  const live = (await Ticket.find({
    status: { $nin: ["resolved", "closed"] },
    "sla.pausedAt": null,
  })) as TicketDoc[];

  const result: SweepResult = { checked: live.length, breached: 0, escalated: 0, atCeiling: 0, details: [] };

  for (const doc of live) {
    const clock = {
      firstResponseDueAt: doc.sla?.firstResponseDueAt ?? null,
      resolutionDueAt: doc.sla?.resolutionDueAt ?? null,
      pausedAt: doc.sla?.pausedAt ?? null,
      pausedBusinessMs: doc.sla?.pausedBusinessMs ?? 0,
      firstResponseBreached: doc.sla?.firstResponseBreached ?? false,
      resolutionBreached: doc.sla?.resolutionBreached ?? false,
      escalationCount: doc.sla?.escalationCount ?? 0,
    };

    const priority = doc.priority as Priority;
    const snap = snapshot(
      clock,
      {
        now,
        status: doc.status as TicketStatus,
        firstResponseAt: doc.firstResponseAt ?? null,
        resolvedAt: doc.resolvedAt ?? null,
        policy: policies.get(priority)!,
      },
      cal,
    );

    const decision = decideBreach(clock, snap);
    if (!decision.shouldEscalate) continue;

    result.breached += 1;

    // Latch first, so a crash midway through the loop cannot cause the same
    // breach to escalate again on the next tick.
    if (decision.newlyBreached.includes("first_response")) doc.sla!.firstResponseBreached = true;
    if (decision.newlyBreached.includes("resolution")) doc.sla!.resolutionBreached = true;
    await doc.save();

    const kinds = decision.newlyBreached.join(" and ").replace(/_/g, " ");
    await logEvent({
      ticketId: doc._id,
      type: "sla_breach",
      actorId: null,
      field: "sla",
      newValue: decision.newlyBreached.join(","),
      body: `Breached ${kinds} SLA.`,
    });

    const promoted = nextPriorityUp(priority);
    const atCeiling = promoted === priority;

    if (atCeiling) {
      // Already urgent. Flag it and tell an admin, but do not pretend to
      // escalate into a priority that does not exist.
      result.atCeiling += 1;
      notifyAdmin(
        `${doc.reference} breached its ${kinds} SLA and is already at the highest priority. Needs manual attention: "${doc.subject}"`,
      );
    } else {
      await changePriority({
        ticketId: String(doc._id),
        priority: promoted,
        actorId: null,
        isEscalation: true,
        reason: `Auto-escalated after breaching the ${kinds} SLA.`,
      });
      result.escalated += 1;
      notifyAdmin(`${doc.reference} breached its ${kinds} SLA — escalated ${priority} to ${promoted}: "${doc.subject}"`);
    }

    result.details.push({
      reference: doc.reference,
      subject: doc.subject,
      breached: decision.newlyBreached,
      from: priority,
      to: atCeiling ? priority : promoted,
      escalated: !atCeiling,
    });
  }

  return result;
}
