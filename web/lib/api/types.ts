/**
 * The client-side API surface.
 *
 * Two implementations satisfy it — `mock` (in-memory fixtures driven by the
 * real SLA engine) and `http` (the Express backend) — and no component or hook
 * calls `fetch` directly. That is what let the entire UI be built and verified
 * before a database existed, and it makes swapping in the real API a
 * shape-fixing exercise rather than a rewrite.
 */

import type {
  AgentWorkload,
  BusinessCalendar,
  Paginated,
  Priority,
  Role,
  SlaPolicy,
  Ticket,
  TicketDetail,
  TicketStatus,
  UserRef,
} from "@shared/index.js";
import type { Transition } from "@shared/transitions.js";

export interface TicketQuery {
  status?: TicketStatus[];
  priority?: Priority[];
  assignedAgent?: string;
  mine?: boolean;
  breached?: boolean;
  atRisk?: boolean;
  search?: string;
  sort?: "urgency" | "created";
  page?: number;
  pageSize?: number;
}

export interface TicketDetailResponse extends TicketDetail {
  allowedTransitions: Transition[];
}

export interface CreateTicketInput {
  subject: string;
  body: string;
  priority?: Priority;
}

export interface CalendarMeta {
  calendar: BusinessCalendar;
  policies: SlaPolicy[];
}

/** A person in the Team view, with the queue they are carrying. */
export interface TeamMember extends UserRef {
  openTickets: number;
  createdAt: string | null;
}

export interface RoleChangeResult {
  id: string;
  name?: string;
  role: Role;
  previous?: Role;
  /** Open tickets the person still holds — a demotion does not reassign them. */
  openTickets?: number;
  changed: boolean;
}

export interface HelpdeskApi {
  auth: {
    me(): Promise<UserRef>;
    login(email: string, password: string): Promise<UserRef>;
    /** Self-registration. Always creates a customer — staff are provisioned, never self-served. */
    register(input: { name: string; email: string; password: string }): Promise<UserRef>;
    /** Update your own profile. Cannot change role — that is admin-only, on the Team page. */
    updateMe(input: { name?: string; email?: string; currentPassword?: string; newPassword?: string }): Promise<UserRef>;
    logout(): Promise<void>;
  };
  meta: {
    calendar(): Promise<CalendarMeta>;
  };
  tickets: {
    list(query: TicketQuery): Promise<Paginated<Ticket>>;
    get(id: string): Promise<TicketDetailResponse>;
    create(input: CreateTicketInput): Promise<Ticket>;
    reply(id: string, body: string): Promise<Ticket>;
    setStatus(id: string, status: TicketStatus): Promise<Ticket>;
    setPriority(id: string, priority: Priority): Promise<Ticket>;
    assign(id: string, agentId: string | null): Promise<Ticket>;
  };
  admin: {
    breaches(): Promise<Paginated<Ticket>>;
    workload(): Promise<AgentWorkload[]>;
    agents(): Promise<UserRef[]>;
    /** Everyone, not just staff — the Team page needs customers too, to promote them. */
    users(): Promise<TeamMember[]>;
    setRole(userId: string, role: Role): Promise<RoleChangeResult>;
    deleteUser(userId: string): Promise<void>;
    runSweep(): Promise<SweepResult>;
  };
}

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
