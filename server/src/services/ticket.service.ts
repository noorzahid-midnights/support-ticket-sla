/**
 * Ticket lifecycle: creation, replies, status and priority changes, assignment
 * — and the audit event each of those writes.
 *
 * The SLA arithmetic itself lives in `shared/sla.ts`; this module's job is to
 * decide *when* to call it and to keep the stored clock consistent with the
 * ticket's status. The invariant worth holding in your head: `sla.pausedAt` is
 * non-null if and only if `status === "waiting_on_customer"`.
 */

import type { BusinessCalendar } from "../../../shared/business-time.js";
import { pauseClock, repriceClock, resumeClock, snapshot, startClock } from "../../../shared/sla.js";
import { checkTransition, pausesClock, resumesClock } from "../../../shared/transitions.js";
import {
  type Priority,
  type Role,
  type SlaClock,
  type SlaPolicy,
  type Ticket as TicketDto,
  type TicketDetail,
  type TicketEvent as TicketEventDto,
  type TicketEventType,
  type TicketStatus,
  type UserRef,
  isTerminal,
} from "../../../shared/types.js";
import mongoose from "mongoose";
import { Ticket, TicketEvent, User, nextTicketReference, type TicketDoc } from "../models/index.js";
import { getCalendar, getPolicies, getPolicy } from "./calendar.service.js";
import { pickAgent, routePriority } from "./routing.service.js";
import { HttpError } from "../middleware/errors.js";

/* ------------------------------------------------------------ serialising */

type PopulatedUser = { _id: mongoose.Types.ObjectId; name: string; email: string; role: Role };

export function toUserRef(user: PopulatedUser | null | undefined): UserRef | null {
  if (!user || !user._id) return null;
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}

/** Mongo subdocument to the engine's clock shape. */
function toClock(doc: TicketDoc): SlaClock {
  const sla = doc.sla ?? ({} as TicketDoc["sla"]);
  return {
    firstResponseDueAt: sla.firstResponseDueAt ?? null,
    resolutionDueAt: sla.resolutionDueAt ?? null,
    pausedAt: sla.pausedAt ?? null,
    pausedBusinessMs: sla.pausedBusinessMs ?? 0,
    firstResponseBreached: sla.firstResponseBreached ?? false,
    resolutionBreached: sla.resolutionBreached ?? false,
    escalationCount: sla.escalationCount ?? 0,
  };
}

export function serializeTicket(
  doc: TicketDoc,
  cal: BusinessCalendar,
  policies: Map<Priority, SlaPolicy>,
  now = new Date(),
): TicketDto {
  const clock = toClock(doc);
  const policy = policies.get(doc.priority as Priority)!;

  const snap = snapshot(
    clock,
    {
      now,
      status: doc.status as TicketStatus,
      firstResponseAt: doc.firstResponseAt ?? null,
      resolvedAt: doc.resolvedAt ?? null,
      policy,
    },
    cal,
  );

  return {
    id: String(doc._id),
    reference: doc.reference,
    subject: doc.subject,
    body: doc.body,
    status: doc.status as TicketStatus,
    priority: doc.priority as Priority,
    customer: toUserRef(doc.customer as unknown as PopulatedUser)!,
    assignedAgent: toUserRef(doc.assignedAgent as unknown as PopulatedUser),
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (doc as unknown as { updatedAt: Date }).updatedAt.toISOString(),
    firstResponseAt: doc.firstResponseAt?.toISOString() ?? null,
    resolvedAt: doc.resolvedAt?.toISOString() ?? null,
    closedAt: doc.closedAt?.toISOString() ?? null,
    priorityAutoAssigned: doc.priorityAutoAssigned ?? false,
    sla: {
      firstResponseDueAt: clock.firstResponseDueAt?.toISOString() ?? null,
      resolutionDueAt: clock.resolutionDueAt?.toISOString() ?? null,
      pausedAt: clock.pausedAt?.toISOString() ?? null,
      pausedBusinessMs: clock.pausedBusinessMs,
      firstResponseBreached: clock.firstResponseBreached,
      resolutionBreached: clock.resolutionBreached,
      escalationCount: clock.escalationCount,
    },
    slaSnapshot: snap,
  };
}

export function serializeEvent(doc: {
  _id: mongoose.Types.ObjectId;
  ticket: mongoose.Types.ObjectId;
  type: string;
  actor: unknown;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  body: string | null;
  createdAt: Date;
}): TicketEventDto {
  return {
    id: String(doc._id),
    ticketId: String(doc.ticket),
    type: doc.type as TicketEventType,
    actor: toUserRef(doc.actor as PopulatedUser),
    field: doc.field,
    oldValue: doc.oldValue,
    newValue: doc.newValue,
    body: doc.body,
    createdAt: doc.createdAt.toISOString(),
  };
}

/* ---------------------------------------------------------------- audit */

interface EventInput {
  ticketId: mongoose.Types.ObjectId;
  type: TicketEventType;
  /** null actor means the system acted — cron escalation, auto-routing. */
  actorId?: mongoose.Types.ObjectId | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  body?: string | null;
}

export async function logEvent(input: EventInput): Promise<void> {
  await TicketEvent.create({
    ticket: input.ticketId,
    type: input.type,
    actor: input.actorId ?? null,
    field: input.field ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    body: input.body ?? null,
    createdAt: new Date(),
  });
}

/** Writes the clock back onto the document without disturbing anything else. */
function applyClock(doc: TicketDoc, clock: SlaClock): void {
  doc.sla = {
    firstResponseDueAt: clock.firstResponseDueAt,
    resolutionDueAt: clock.resolutionDueAt,
    pausedAt: clock.pausedAt,
    pausedBusinessMs: clock.pausedBusinessMs,
    firstResponseBreached: clock.firstResponseBreached,
    resolutionBreached: clock.resolutionBreached,
    escalationCount: clock.escalationCount,
  } as TicketDoc["sla"];
}

/* --------------------------------------------------------------- create */

export interface CreateTicketInput {
  subject: string;
  body: string;
  customerId: mongoose.Types.ObjectId;
  /** An explicit priority skips keyword routing; agents raising a ticket may set one. */
  priority?: Priority;
}

export async function createTicket(input: CreateTicketInput): Promise<TicketDto> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);

  const routed = input.priority ? null : await routePriority(input.subject, input.body);
  const priority: Priority = input.priority ?? routed?.priority ?? "medium";

  const createdAt = new Date();
  const clock = startClock(createdAt, policies.get(priority)!, cal);
  const agent = await pickAgent();
  const reference = await nextTicketReference();

  const doc = await Ticket.create({
    reference,
    subject: input.subject,
    body: input.body,
    status: "open",
    priority,
    customer: input.customerId,
    assignedAgent: agent?._id ?? null,
    priorityAutoAssigned: Boolean(routed),
    sla: {
      firstResponseDueAt: clock.firstResponseDueAt,
      resolutionDueAt: clock.resolutionDueAt,
      pausedAt: null,
      pausedBusinessMs: 0,
      firstResponseBreached: false,
      resolutionBreached: false,
      escalationCount: 0,
    },
    createdAt,
  });

  await logEvent({ ticketId: doc._id, type: "created", actorId: input.customerId });

  // Routing and assignment are recorded as system events so the timeline
  // explains why a ticket arrived urgent and on a particular agent's desk.
  if (routed) {
    await logEvent({
      ticketId: doc._id,
      type: "priority_change",
      actorId: null,
      field: "priority",
      oldValue: null,
      newValue: priority,
      body: `Matched routing rule "${routed.rule.name}"`,
    });
  }
  if (agent) {
    await logEvent({
      ticketId: doc._id,
      type: "reassignment",
      actorId: null,
      field: "assignedAgent",
      oldValue: null,
      newValue: agent.name,
      body: `Auto-assigned: least loaded agent (${agent.openCount} open)`,
    });
  }

  return serializeTicket(await populate(doc._id), cal, policies);
}

async function populate(id: mongoose.Types.ObjectId): Promise<TicketDoc> {
  const doc = await Ticket.findById(id)
    .populate("customer", "name email role")
    .populate("assignedAgent", "name email role");
  if (!doc) throw new HttpError(404, "Ticket not found.", "not_found");
  return doc as TicketDoc;
}

/* ----------------------------------------------------------- transitions */

export interface TransitionInput {
  ticketId: string;
  to: TicketStatus;
  actor: { id: mongoose.Types.ObjectId; role: Role };
}

export async function transitionTicket(input: TransitionInput): Promise<TicketDto> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const doc = await populate(new mongoose.Types.ObjectId(input.ticketId));
  const from = doc.status as TicketStatus;

  const check = checkTransition(from, input.to, input.actor.role);
  if (!check.ok) {
    throw new HttpError(422, check.reason ?? "Invalid transition.", "invalid_transition", {
      from,
      to: input.to,
      allowed: check.allowed,
    });
  }

  await applyStatusChange(doc, input.to, cal, policies.get(doc.priority as Priority)!, input.actor.id);
  return serializeTicket(await populate(doc._id), cal, policies);
}

/**
 * The one place status and SLA clock change together.
 *
 * Kept private and shared by every caller (agent action, customer reply, cron)
 * so the pausedAt/status invariant cannot be broken by one path forgetting a
 * step — which is exactly the bug that makes a paused clock leak time.
 */
async function applyStatusChange(
  doc: TicketDoc,
  to: TicketStatus,
  cal: BusinessCalendar,
  policy: SlaPolicy,
  actorId: mongoose.Types.ObjectId | null,
): Promise<void> {
  const from = doc.status as TicketStatus;
  const now = new Date();
  let clock = toClock(doc);

  if (resumesClock(from, to)) clock = resumeClock(clock, now, cal);
  if (pausesClock(to)) clock = pauseClock(clock, now);

  if (to === "resolved") {
    doc.resolvedAt = now;
  } else if (to === "closed") {
    doc.closedAt = now;
  } else if (to === "reopened") {
    // The obligation is live again, so re-arm the resolution clock from now
    // under the current policy rather than resurrecting the old deadline.
    doc.resolvedAt = null;
    doc.closedAt = null;
    clock = {
      ...clock,
      resolutionDueAt: startClock(now, policy, cal).resolutionDueAt,
      resolutionBreached: false,
    };
  }

  doc.status = to;
  applyClock(doc, clock);
  await doc.save();

  await logEvent({
    ticketId: doc._id,
    type: "status_change",
    actorId,
    field: "status",
    oldValue: from,
    newValue: to,
  });
}

/* --------------------------------------------------------------- replies */

export interface ReplyInput {
  ticketId: string;
  body: string;
  actor: { id: mongoose.Types.ObjectId; role: Role };
}

export async function addReply(input: ReplyInput): Promise<TicketDto> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const doc = await populate(new mongoose.Types.ObjectId(input.ticketId));
  const now = new Date();

  await logEvent({
    ticketId: doc._id,
    type: "reply",
    actorId: input.actor.id,
    body: input.body,
  });

  const isStaff = input.actor.role === "agent" || input.actor.role === "admin";

  if (isStaff && !doc.firstResponseAt) {
    // First agent reply discharges the first-response obligation. The deadline
    // stops being live and becomes a did-we-make-it record.
    doc.firstResponseAt = now;
    await doc.save();
  }

  // A customer reply is what resumes a paused clock: the ball is back with us.
  if (!isStaff && doc.status === "waiting_on_customer") {
    await applyStatusChange(doc, "in_progress", cal, policies.get(doc.priority as Priority)!, input.actor.id);
  } else {
    await doc.save();
  }

  return serializeTicket(await populate(doc._id), cal, policies);
}

/* -------------------------------------------------------------- priority */

export interface PriorityInput {
  ticketId: string;
  priority: Priority;
  actorId: mongoose.Types.ObjectId | null;
  reason?: string;
  /** Escalations bump the counter; a manual change does not. */
  isEscalation?: boolean;
}

export async function changePriority(input: PriorityInput): Promise<TicketDto> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const doc = await populate(new mongoose.Types.ObjectId(input.ticketId));
  const from = doc.priority as Priority;
  if (from === input.priority) return serializeTicket(doc, cal, policies);

  const clock = repriceClock(
    toClock(doc),
    { createdAt: (doc as unknown as { createdAt: Date }).createdAt, firstResponseAt: doc.firstResponseAt ?? null },
    policies.get(input.priority)!,
    cal,
  );

  doc.priority = input.priority;
  applyClock(doc, {
    ...clock,
    escalationCount: clock.escalationCount + (input.isEscalation ? 1 : 0),
  });
  await doc.save();

  await logEvent({
    ticketId: doc._id,
    type: input.isEscalation ? "escalation" : "priority_change",
    actorId: input.actorId,
    field: "priority",
    oldValue: from,
    newValue: input.priority,
    body: input.reason ?? null,
  });

  return serializeTicket(await populate(doc._id), cal, policies);
}

/* ------------------------------------------------------------ assignment */

export async function assignTicket(
  ticketId: string,
  agentId: string | null,
  actorId: mongoose.Types.ObjectId | null,
): Promise<TicketDto> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const doc = await populate(new mongoose.Types.ObjectId(ticketId));

  const previous = toUserRef(doc.assignedAgent as unknown as PopulatedUser);
  let nextName: string | null = null;

  if (agentId) {
    const agent = await User.findById(agentId).lean();
    if (!agent || (agent.role !== "agent" && agent.role !== "admin")) {
      throw new HttpError(422, "Tickets can only be assigned to an agent or admin.", "invalid_assignee");
    }
    doc.assignedAgent = agent._id;
    nextName = agent.name;
  } else {
    doc.assignedAgent = null;
  }

  await doc.save();
  await logEvent({
    ticketId: doc._id,
    type: "reassignment",
    actorId,
    field: "assignedAgent",
    oldValue: previous?.name ?? null,
    newValue: nextName,
  });

  return serializeTicket(await populate(doc._id), cal, policies);
}

/* ---------------------------------------------------------------- reads */

export interface ListFilters {
  status?: TicketStatus[];
  priority?: Priority[];
  assignedAgent?: string;
  customer?: string;
  /** Only tickets that have breached one of their deadlines. */
  breachedOnly?: boolean;
  atRiskOnly?: boolean;
  search?: string;
  sort?: "urgency" | "created";
  page?: number;
  pageSize?: number;
}

/**
 * Cap on rows pulled before sorting by urgency.
 *
 * Urgency cannot be expressed as a Mongo sort: it depends on which deadline is
 * still live, on the pause state, and on business hours between now and the
 * due date. So the correct sort has to happen after the snapshots are built.
 * Fetching a bounded window and sorting it in memory keeps that correctness at
 * demo scale; a real deployment would maintain a precomputed urgency field
 * updated by the same sweep that checks for breaches.
 */
const MAX_SORT_WINDOW = 2000;

export async function listTickets(filters: ListFilters): Promise<{ data: TicketDto[]; total: number; page: number; pageSize: number }> {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);

  const query: mongoose.FilterQuery<TicketDoc> = {};
  if (filters.status?.length) query.status = { $in: filters.status };
  if (filters.priority?.length) query.priority = { $in: filters.priority };
  if (filters.assignedAgent) query.assignedAgent = new mongoose.Types.ObjectId(filters.assignedAgent);
  if (filters.customer) query.customer = new mongoose.Types.ObjectId(filters.customer);
  if (filters.search) {
    const rx = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ subject: rx }, { reference: rx }, { body: rx }];
  }

  const docs = (await Ticket.find(query)
    .populate("customer", "name email role")
    .populate("assignedAgent", "name email role")
    .sort({ createdAt: -1 })
    .limit(MAX_SORT_WINDOW)) as TicketDoc[];

  const now = new Date();
  let rows = docs.map((d) => serializeTicket(d, cal, policies, now));

  if (filters.breachedOnly) {
    rows = rows.filter((t) => t.slaSnapshot.firstResponse.breached || t.slaSnapshot.resolution.breached);
  }
  if (filters.atRiskOnly) {
    rows = rows.filter((t) => t.slaSnapshot.firstResponse.atRisk || t.slaSnapshot.resolution.atRisk);
  }

  if (filters.sort !== "created") {
    // Most at-risk first: smallest (and most negative) remaining time leads.
    rows.sort((a, b) => a.slaSnapshot.urgencyMs - b.slaSnapshot.urgencyMs);
  }

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const total = rows.length;
  const start = (page - 1) * pageSize;

  return { data: rows.slice(start, start + pageSize), total, page, pageSize };
}

export async function getTicketDetail(id: string): Promise<TicketDetail> {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(404, "Ticket not found.", "not_found");
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const doc = await populate(new mongoose.Types.ObjectId(id));

  const events = await TicketEvent.find({ ticket: doc._id })
    .populate("actor", "name email role")
    .sort({ createdAt: 1 })
    .lean();

  return {
    ...serializeTicket(doc, cal, policies),
    events: events.map((e) => serializeEvent(e as never)),
  };
}

/** Non-terminal ticket counts per agent, for the admin workload view. */
export async function agentWorkloads() {
  const [cal, policies] = await Promise.all([getCalendar(), getPolicies()]);
  const agents = await User.find({ role: { $in: ["agent", "admin"] } })
    .sort({ name: 1 })
    .lean();

  const live = (await Ticket.find({ status: { $nin: ["resolved", "closed"] } })
    .populate("customer", "name email role")
    .populate("assignedAgent", "name email role")) as TicketDoc[];

  const now = new Date();
  return agents.map((agent) => {
    const mine = live.filter((t) => String((t.assignedAgent as never as { _id?: unknown })?._id ?? "") === String(agent._id));
    const snaps = mine.map((t) => serializeTicket(t, cal, policies, now).slaSnapshot);
    return {
      agent: { id: String(agent._id), name: agent.name, email: agent.email, role: agent.role },
      openCount: mine.length,
      atRiskCount: snaps.filter((s) => s.firstResponse.atRisk || s.resolution.atRisk).length,
      breachedCount: snaps.filter((s) => s.firstResponse.breached || s.resolution.breached).length,
    };
  });
}

export { isTerminal };
