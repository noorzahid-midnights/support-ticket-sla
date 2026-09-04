/**
 * In-memory helpdesk, persisted to localStorage.
 *
 * This is not a hand-waved stub: every deadline, pause and escalation here is
 * computed by importing `shared/sla.ts` and `shared/business-time.ts` — the
 * exact modules the Express server uses. So the mock cannot drift from the
 * real thing, and the whole UI can be built and demonstrated before a database
 * exists without the demo being a fiction.
 */

import {
  addBusinessMs,
  subtractBusinessMs,
  type BusinessCalendar,
} from "@shared/business-time.js";
import { decideBreach, pauseClock, repriceClock, resumeClock, snapshot, startClock } from "@shared/sla.js";
import { checkTransition, pausesClock, resumesClock } from "@shared/transitions.js";
import {
  DEFAULT_SLA_POLICIES,
  nextPriorityUp,
  type Priority,
  type Role,
  type SlaClock,
  type SlaPolicy,
  type Ticket,
  type TicketEvent,
  type TicketEventType,
  type TicketStatus,
  type UserRef,
} from "@shared/types.js";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

const STORAGE_KEY = "helpdesk.mock.v3";

export const MOCK_CALENDAR: BusinessCalendar = {
  timezone: "Asia/Karachi",
  days: {
    0: null,
    1: { start: "09:00", end: "18:00" },
    2: { start: "09:00", end: "18:00" },
    3: { start: "09:00", end: "18:00" },
    4: { start: "09:00", end: "18:00" },
    5: { start: "09:00", end: "18:00" },
    6: null,
  },
  holidays: [],
};

export const MOCK_POLICIES = new Map<Priority, SlaPolicy>(DEFAULT_SLA_POLICIES.map((p) => [p.priority, p]));

/** Derived from the shared roster so the fixtures cannot drift from the login screen. */
export const MOCK_USERS: UserRef[] = DEMO_ACCOUNTS.map(({ id, name, email, role }) => ({ id, name, email, role }));

export interface RoutingRuleSeed {
  id: string;
  name: string;
  keywords: string[];
  priority: Priority;
  weight: number;
}

export const MOCK_RULES: RoutingRuleSeed[] = [
  { id: "r1", name: "Outage or total loss of service", keywords: ["down", "outage", "offline"], priority: "urgent", weight: 100 },
  { id: "r2", name: "Cannot authenticate", keywords: ["can't login", "cannot login", "locked out", "password reset"], priority: "urgent", weight: 90 },
  { id: "r3", name: "Customer says it is urgent", keywords: ["urgent", "asap", "emergency", "critical"], priority: "high", weight: 60 },
  { id: "r4", name: "Billing and invoices", keywords: ["invoice", "billing", "charged twice", "refund"], priority: "high", weight: 50 },
  { id: "r5", name: "Question or how-to", keywords: ["how do i", "how to", "question"], priority: "low", weight: 20 },
];

export interface MockEvent {
  id: string;
  type: TicketEventType;
  actorId: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  body: string | null;
  createdAt: string;
}

export interface MockTicket {
  id: string;
  reference: string;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: Priority;
  customerId: string;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  priorityAutoAssigned: boolean;
  sla: {
    firstResponseDueAt: string | null;
    resolutionDueAt: string | null;
    pausedAt: string | null;
    pausedBusinessMs: number;
    firstResponseBreached: boolean;
    resolutionBreached: boolean;
    escalationCount: number;
  };
  events: MockEvent[];
}

export interface MockData {
  /** null means signed out — the mock has a real unauthenticated state. */
  currentUserId: string | null;
  /** Accounts created through the sign-up form, kept apart from the seeded roster. */
  registered: (UserRef & { password: string })[];
  tickets: MockTicket[];
  seq: number;
}

/* ------------------------------------------------------------ conversion */

export function toClock(t: MockTicket): SlaClock {
  return {
    firstResponseDueAt: t.sla.firstResponseDueAt ? new Date(t.sla.firstResponseDueAt) : null,
    resolutionDueAt: t.sla.resolutionDueAt ? new Date(t.sla.resolutionDueAt) : null,
    pausedAt: t.sla.pausedAt ? new Date(t.sla.pausedAt) : null,
    pausedBusinessMs: t.sla.pausedBusinessMs,
    firstResponseBreached: t.sla.firstResponseBreached,
    resolutionBreached: t.sla.resolutionBreached,
    escalationCount: t.sla.escalationCount,
  };
}

export function writeClock(t: MockTicket, clock: SlaClock): void {
  t.sla = {
    firstResponseDueAt: clock.firstResponseDueAt?.toISOString() ?? null,
    resolutionDueAt: clock.resolutionDueAt?.toISOString() ?? null,
    pausedAt: clock.pausedAt?.toISOString() ?? null,
    pausedBusinessMs: clock.pausedBusinessMs,
    firstResponseBreached: clock.firstResponseBreached,
    resolutionBreached: clock.resolutionBreached,
    escalationCount: clock.escalationCount,
  };
}

export function userById(id: string | null): UserRef | null {
  const seeded = MOCK_USERS.find((u) => u.id === id);
  if (seeded) return seeded;
  const signedUp = memory?.registered?.find((u) => u.id === id);
  return signedUp ? { id: signedUp.id, name: signedUp.name, email: signedUp.email, role: signedUp.role } : null;
}

export function serialize(t: MockTicket, now = new Date()): Ticket {
  const clock = toClock(t);
  const policy = MOCK_POLICIES.get(t.priority)!;

  return {
    id: t.id,
    reference: t.reference,
    subject: t.subject,
    body: t.body,
    status: t.status,
    priority: t.priority,
    customer: userById(t.customerId)!,
    assignedAgent: userById(t.agentId),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    priorityAutoAssigned: t.priorityAutoAssigned,
    sla: t.sla,
    slaSnapshot: snapshot(
      clock,
      {
        now,
        status: t.status,
        firstResponseAt: t.firstResponseAt ? new Date(t.firstResponseAt) : null,
        resolvedAt: t.resolvedAt ? new Date(t.resolvedAt) : null,
        policy,
      },
      MOCK_CALENDAR,
    ),
  };
}

export function serializeEvents(t: MockTicket): TicketEvent[] {
  return t.events.map((e) => ({
    id: e.id,
    ticketId: t.id,
    type: e.type,
    actor: userById(e.actorId),
    field: e.field,
    oldValue: e.oldValue,
    newValue: e.newValue,
    body: e.body,
    createdAt: e.createdAt,
  }));
}

/* ---------------------------------------------------------------- mutate */

let eventSeq = 0;
export function addEvent(t: MockTicket, event: Omit<MockEvent, "id" | "createdAt"> & { createdAt?: string }): void {
  eventSeq += 1;
  t.events.push({
    id: `e-${Date.now().toString(36)}-${eventSeq}`,
    createdAt: event.createdAt ?? new Date().toISOString(),
    ...event,
  });
}

/**
 * Status change plus the SLA clock effects, in one place — mirroring the
 * server's `applyStatusChange` so the two cannot diverge on the invariant that
 * `pausedAt` is set exactly while the status is `waiting_on_customer`.
 */
export function applyStatus(t: MockTicket, to: TicketStatus, actorId: string | null, now = new Date()): void {
  const from = t.status;
  let clock = toClock(t);

  if (resumesClock(from, to)) clock = resumeClock(clock, now, MOCK_CALENDAR);
  if (pausesClock(to)) clock = pauseClock(clock, now);

  if (to === "resolved") {
    t.resolvedAt = now.toISOString();
  } else if (to === "closed") {
    t.closedAt = now.toISOString();
  } else if (to === "reopened") {
    t.resolvedAt = null;
    t.closedAt = null;
    clock = {
      ...clock,
      resolutionDueAt: startClock(now, MOCK_POLICIES.get(t.priority)!, MOCK_CALENDAR).resolutionDueAt,
      resolutionBreached: false,
    };
  }

  t.status = to;
  t.updatedAt = now.toISOString();
  writeClock(t, clock);
  addEvent(t, { type: "status_change", actorId, field: "status", oldValue: from, newValue: to, body: null });
}

export function applyPriority(
  t: MockTicket,
  priority: Priority,
  actorId: string | null,
  opts: { isEscalation?: boolean; reason?: string } = {},
): void {
  const from = t.priority;
  if (from === priority) return;

  const clock = repriceClock(
    toClock(t),
    { createdAt: new Date(t.createdAt), firstResponseAt: t.firstResponseAt ? new Date(t.firstResponseAt) : null },
    MOCK_POLICIES.get(priority)!,
    MOCK_CALENDAR,
  );

  t.priority = priority;
  writeClock(t, { ...clock, escalationCount: clock.escalationCount + (opts.isEscalation ? 1 : 0) });
  t.updatedAt = new Date().toISOString();

  addEvent(t, {
    type: opts.isEscalation ? "escalation" : "priority_change",
    actorId,
    field: "priority",
    oldValue: from,
    newValue: priority,
    body: opts.reason ?? null,
  });
}

/** Keyword routing, mirroring the server's `selectPriority`. */
export function routePriority(subject: string, body: string): { priority: Priority; rule: RoutingRuleSeed } | null {
  const haystack = `${subject}\n${body}`;
  let best: { priority: Priority; rule: RoutingRuleSeed } | null = null;
  let bestWeight = -Infinity;

  for (const rule of MOCK_RULES) {
    const hit = rule.keywords.some((k) => {
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
    });
    if (hit && rule.weight > bestWeight) {
      bestWeight = rule.weight;
      best = { priority: rule.priority, rule };
    }
  }
  return best;
}

/** Least-loaded assignment, mirroring the server's `pickAgent`. */
export function pickAgent(tickets: MockTicket[]): UserRef {
  const agents = MOCK_USERS.filter((u) => u.role === "agent");
  let best = agents[0]!;
  let bestCount = Infinity;

  for (const agent of agents) {
    const count = tickets.filter(
      (t) => t.agentId === agent.id && t.status !== "resolved" && t.status !== "closed",
    ).length;
    if (count < bestCount) {
      bestCount = count;
      best = agent;
    }
  }
  return best;
}

/** One pass of the breach sweep, mirroring `escalation.service.ts`. */
export function sweep(data: MockData, now = new Date()) {
  const details: {
    reference: string;
    subject: string;
    breached: string[];
    from: Priority;
    to: Priority;
    escalated: boolean;
  }[] = [];
  let breached = 0;
  let escalated = 0;
  let atCeiling = 0;

  const live = data.tickets.filter(
    (t) => t.status !== "resolved" && t.status !== "closed" && t.sla.pausedAt === null,
  );

  for (const t of live) {
    const clock = toClock(t);
    const snap = serialize(t, now).slaSnapshot;
    const decision = decideBreach(clock, snap);
    if (!decision.shouldEscalate) continue;

    breached += 1;
    if (decision.newlyBreached.includes("first_response")) t.sla.firstResponseBreached = true;
    if (decision.newlyBreached.includes("resolution")) t.sla.resolutionBreached = true;

    const kinds = decision.newlyBreached.join(" and ").replace(/_/g, " ");
    addEvent(t, {
      type: "sla_breach",
      actorId: null,
      field: "sla",
      oldValue: null,
      newValue: decision.newlyBreached.join(","),
      body: `Breached ${kinds} SLA.`,
    });

    const from = t.priority;
    const promoted = nextPriorityUp(from);
    if (promoted === from) {
      atCeiling += 1;
    } else {
      applyPriority(t, promoted, null, {
        isEscalation: true,
        reason: `Auto-escalated after breaching the ${kinds} SLA.`,
      });
      escalated += 1;
    }

    details.push({ reference: t.reference, subject: t.subject, breached: decision.newlyBreached, from, to: promoted, escalated: promoted !== from });
  }

  return { checked: live.length, breached, escalated, atCeiling, details };
}

/* ----------------------------------------------------------------- seed */

const hours = (n: number) => n * 3_600_000;
const minutes = (n: number) => n * 60_000;

interface Spec {
  subject: string;
  body: string;
  priority: Priority;
  status: TicketStatus;
  customerId: string;
  agentId: string;
  agoBusinessMs?: number;
  createdAt?: Date;
  firstResponseAfterMs?: number;
  resolvedAfterMs?: number;
  pausedAgoBusinessMs?: number;
}

/** The most recent Saturday 02:00: a genuinely closed instant, for the roll-forward case. */
function lastWeekendInstant(now: Date): Date {
  for (let back = 1; back <= 8; back += 1) {
    const c = new Date(now.getTime() - back * 24 * 3_600_000);
    if (c.getUTCDay() === 6) {
      const key = c.toISOString().slice(0, 10);
      return new Date(`${key}T21:00:00Z`); // 02:00 next day in UTC+5
    }
  }
  return new Date(now.getTime() - 3 * 24 * 3_600_000);
}

export function buildSeed(): MockData {
  const now = new Date();

  const specs: Spec[] = [
    { subject: "Checkout page returns a 500 for every customer", body: "Nobody can complete an order. This started about an hour ago and is affecting all users.", priority: "high", status: "open", customerId: "u-dana", agentId: "u-ana", agoBusinessMs: hours(24) },
    { subject: "Production database is unreachable", body: "Connections time out from every region. We are completely down.", priority: "urgent", status: "in_progress", customerId: "u-eli", agentId: "u-ana", agoBusinessMs: hours(20), firstResponseAfterMs: minutes(30) },
    { subject: "Invoice #4471 charged twice", body: "We were billed twice for the same seat this month and need one of the charges reversed.", priority: "high", status: "in_progress", customerId: "u-fay", agentId: "u-ben", agoBusinessMs: hours(7), firstResponseAfterMs: minutes(25) },
    { subject: "Export to CSV drops the last column", body: "The exported file is missing the final column. Which column varies by report.", priority: "medium", status: "waiting_on_customer", customerId: "u-dana", agentId: "u-ben", agoBusinessMs: hours(21), firstResponseAfterMs: minutes(40), pausedAgoBusinessMs: hours(20) },
    { subject: "Filed over the weekend: password reset email never arrives", body: "I requested a reset on Saturday morning and nothing came through.", priority: "medium", status: "open", customerId: "u-eli", agentId: "u-chi", createdAt: lastWeekendInstant(now) },
    { subject: "How do I add a second workspace?", body: "Looking for the documentation on multi-workspace setup.", priority: "low", status: "resolved", customerId: "u-fay", agentId: "u-chi", agoBusinessMs: hours(6), firstResponseAfterMs: minutes(20), resolvedAfterMs: hours(2) },
    { subject: "Search returns stale results after an edit", body: "Edits take a few minutes to show up in search. Reopening because it happened again.", priority: "medium", status: "reopened", customerId: "u-dana", agentId: "u-ana", agoBusinessMs: hours(30), firstResponseAfterMs: minutes(45) },
    { subject: "Dark mode toggle resets on reload", body: "The preference does not persist between sessions.", priority: "low", status: "open", customerId: "u-eli", agentId: "u-ana", agoBusinessMs: hours(3) },
    { subject: "Timezone shown in reports is wrong", body: "Reports render in UTC rather than our local timezone.", priority: "medium", status: "in_progress", customerId: "u-fay", agentId: "u-ana", agoBusinessMs: hours(4), firstResponseAfterMs: minutes(30) },
  ];

  const tickets: MockTicket[] = specs.map((spec, i) => {
    const createdAt = spec.createdAt ?? subtractBusinessMs(now, spec.agoBusinessMs ?? 0, MOCK_CALENDAR);
    const clock = startClock(createdAt, MOCK_POLICIES.get(spec.priority)!, MOCK_CALENDAR);
    const firstResponseAt =
      spec.firstResponseAfterMs === undefined ? null : addBusinessMs(createdAt, spec.firstResponseAfterMs, MOCK_CALENDAR);
    const resolvedAt =
      spec.resolvedAfterMs === undefined ? null : addBusinessMs(createdAt, spec.resolvedAfterMs, MOCK_CALENDAR);
    const pausedAt =
      spec.pausedAgoBusinessMs === undefined ? null : subtractBusinessMs(now, spec.pausedAgoBusinessMs, MOCK_CALENDAR);

    const t: MockTicket = {
      id: `t-${i + 1}`,
      reference: `TK-${1001 + i}`,
      subject: spec.subject,
      body: spec.body,
      status: spec.status,
      priority: spec.priority,
      customerId: spec.customerId,
      agentId: spec.agentId,
      createdAt: createdAt.toISOString(),
      updatedAt: (pausedAt ?? resolvedAt ?? firstResponseAt ?? createdAt).toISOString(),
      firstResponseAt: firstResponseAt?.toISOString() ?? null,
      resolvedAt: resolvedAt?.toISOString() ?? null,
      closedAt: null,
      priorityAutoAssigned: false,
      sla: {
        firstResponseDueAt: clock.firstResponseDueAt?.toISOString() ?? null,
        resolutionDueAt: clock.resolutionDueAt?.toISOString() ?? null,
        pausedAt: pausedAt?.toISOString() ?? null,
        pausedBusinessMs: 0,
        firstResponseBreached: false,
        resolutionBreached: false,
        escalationCount: 0,
      },
      events: [],
    };

    addEvent(t, { type: "created", actorId: spec.customerId, field: null, oldValue: null, newValue: null, body: null, createdAt: t.createdAt });
    addEvent(t, { type: "reassignment", actorId: null, field: "assignedAgent", oldValue: null, newValue: userById(spec.agentId)?.name ?? null, body: "Auto-assigned: least loaded agent", createdAt: t.createdAt });
    if (firstResponseAt) {
      addEvent(t, { type: "reply", actorId: spec.agentId, field: null, oldValue: null, newValue: null, body: "Thanks for reporting this, taking a look now.", createdAt: firstResponseAt.toISOString() });
    }
    if (pausedAt) {
      addEvent(t, { type: "status_change", actorId: spec.agentId, field: "status", oldValue: "in_progress", newValue: "waiting_on_customer", body: null, createdAt: pausedAt.toISOString() });
    }
    if (resolvedAt) {
      addEvent(t, { type: "status_change", actorId: spec.agentId, field: "status", oldValue: "in_progress", newValue: "resolved", body: null, createdAt: resolvedAt.toISOString() });
    }
    return t;
  });

  // Starts signed out, so the login screen is a real part of the demo rather
  // than a page nobody ever sees.
  return { currentUserId: null, registered: [], tickets, seq: 1000 + specs.length };
}

/* ---------------------------------------------------------- persistence */

let memory: MockData | null = null;

function canPersist(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStore(): MockData {
  if (memory) return memory;

  if (canPersist()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        memory = JSON.parse(raw) as MockData;
        return memory;
      }
    } catch {
      // Corrupt or unreadable storage: reseed rather than crash the app.
    }
  }

  memory = buildSeed();
  persist();
  return memory;
}

function persist(): void {
  if (!canPersist() || !memory) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Quota or private mode: the in-memory copy still works for this session.
  }
}

export function update<T>(fn: (data: MockData) => T): T {
  const data = readStore();
  const result = fn(data);
  persist();
  return result;
}

export function resetStore(): void {
  memory = buildSeed();
  persist();
}

export { checkTransition };

if (typeof window !== "undefined") {
  (window as unknown as { __helpdeskReset: () => void }).__helpdeskReset = () => {
    resetStore();
    window.location.reload();
  };
}
