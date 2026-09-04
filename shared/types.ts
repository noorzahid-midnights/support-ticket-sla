/**
 * Domain vocabulary shared by the Express API and the Next.js client.
 *
 * Enums are declared as `as const` arrays with the union derived from them, so
 * a single declaration gives both a runtime list (for seeding, validation and
 * rendering dropdowns) and a compile-time type.
 */

export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_customer",
  "resolved",
  "closed",
  "reopened",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ROLES = ["admin", "agent", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const EVENT_TYPES = [
  "created",
  "status_change",
  "priority_change",
  "reassignment",
  "reply",
  "escalation",
  "sla_breach",
] as const;
export type TicketEventType = (typeof EVENT_TYPES)[number];

/** Statuses at which no SLA clock runs and the ticket leaves an agent's load. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["resolved", "closed"];

export function isTerminal(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Priority ordered by severity, so escalation is just an index step. */
export function nextPriorityUp(priority: Priority): Priority {
  const i = PRIORITIES.indexOf(priority);
  // `urgent` is the ceiling: a breached urgent ticket is flagged, not promoted
  // into a priority that does not exist.
  return PRIORITIES[Math.min(i + 1, PRIORITIES.length - 1)]!;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface SlaPolicy {
  priority: Priority;
  /** Business minutes allowed before the first agent reply. */
  firstResponseMinutes: number;
  /** Business minutes allowed before the ticket is resolved. */
  resolutionMinutes: number;
}

/**
 * Default policies. The brief fixes the two ends (urgent 1h/4h, low 24h/5d);
 * the middle two interpolate. "5 days" is five *business* days, which on a
 * 9-hour day is 2700 business minutes — not 7200 wall-clock minutes.
 */
export const DEFAULT_SLA_POLICIES: SlaPolicy[] = [
  { priority: "urgent", firstResponseMinutes: 60, resolutionMinutes: 240 },
  { priority: "high", firstResponseMinutes: 120, resolutionMinutes: 480 },
  { priority: "medium", firstResponseMinutes: 480, resolutionMinutes: 1440 },
  { priority: "low", firstResponseMinutes: 1440, resolutionMinutes: 2700 },
];

/**
 * Denormalised SLA state carried on the ticket.
 *
 * Materialised rather than recomputed from the event log on every read,
 * because the brief demands an agent dashboard *sorted* by SLA urgency and an
 * admin report *querying* breaches — both need an indexed due date in the
 * database. The event log remains the audit trail and the source a repair
 * routine can rebuild these fields from if they ever drift.
 *
 * Dates are ISO strings on the wire and `Date` objects in the pure engine;
 * `SlaClock` is the engine-side shape.
 */
export interface SlaClock {
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  /** Non-null exactly while the ticket sits in `waiting_on_customer`. */
  pausedAt: Date | null;
  /** Business ms accumulated across every past pause. */
  pausedBusinessMs: number;
  /** Latched on the transition into breach, so escalation fires once, not every tick. */
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  escalationCount: number;
}

/** Wire form of `SlaClock`: identical, with ISO strings for dates. */
export interface SlaClockDto {
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  pausedAt: string | null;
  pausedBusinessMs: number;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  escalationCount: number;
}

/** One deadline's live state, computed on read — never stored. */
export interface DeadlineState {
  dueAt: string | null;
  /** Business ms left. Negative means overdue by that much business time. */
  remainingMs: number | null;
  breached: boolean;
  /** Within the final 25% of the allotted window. The brief's warning flag. */
  atRisk: boolean;
  /** Set once the obligation is discharged (first reply sent / ticket resolved). */
  metAt: string | null;
}

export interface SlaSnapshot {
  firstResponse: DeadlineState;
  resolution: DeadlineState;
  paused: boolean;
  /**
   * Sort key for "most at-risk first": the remaining business ms of whichever
   * deadline is still live. Lower (and negative) is more urgent.
   */
  urgencyMs: number;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  type: TicketEventType;
  actor: UserRef | null; // null actor = the system (cron escalation, auto-routing)
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  body: string | null; // reply text, for `reply` events
  createdAt: string;
}

export interface Ticket {
  id: string;
  reference: string; // human-quotable, e.g. "TK-1043"
  subject: string;
  body: string;
  status: TicketStatus;
  priority: Priority;
  customer: UserRef;
  assignedAgent: UserRef | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: SlaClockDto;
  /** Computed server-side on every read so the client never has to guess. */
  slaSnapshot: SlaSnapshot;
  /** True when priority was set by a routing rule rather than by a human. */
  priorityAutoAssigned: boolean;
}

export interface TicketDetail extends Ticket {
  events: TicketEvent[];
}

export interface RoutingRule {
  id: string;
  name: string;
  keywords: string[];
  field: "subject" | "body" | "both";
  priority: Priority;
  /** Highest-weight match wins; ties break towards the more severe priority. */
  weight: number;
  active: boolean;
}

export interface AgentWorkload {
  agent: UserRef;
  openCount: number;
  atRiskCount: number;
  breachedCount: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** One error type across both transports, so retry and rollback logic can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = "unknown") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
