/**
 * The mock implementation of `HelpdeskApi`.
 *
 * Adds artificial latency and optional failure injection on top of the store,
 * so loading skeletons and error states are exercisable without a backend.
 */

import { ApiError, type AgentWorkload, type Paginated, type Priority, type Role, type Ticket, type TicketStatus, type UserRef } from "@shared/types.js";
import { allowedTransitions } from "@shared/transitions.js";
import type { CalendarMeta, CreateTicketInput, HelpdeskApi, SweepResult, TicketDetailResponse, TicketQuery } from "../types";
import {
  MOCK_CALENDAR,
  MOCK_POLICIES,
  MOCK_USERS,
  addEvent,
  applyPriority,
  applyStatus,
  checkTransition,
  pickAgent,
  readStore,
  routePriority,
  serialize,
  serializeEvents,
  sweep,
  update,
  userById,
  type MockTicket,
} from "./store";
import { startClock } from "@shared/sla.js";

/** Every seeded account shares this, and the login screen says so. */
export const DEMO_PASSWORD = "password123";

const LATENCY = 140;
const FAIL_READS = Number(process.env.NEXT_PUBLIC_MOCK_FAIL_READS ?? 0);
const FAIL_WRITES = Number(process.env.NEXT_PUBLIC_MOCK_FAIL_WRITES ?? 0);

function settle<T>(value: () => T, failRate: number): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (failRate > 0 && Math.random() < failRate) {
        reject(new ApiError("Injected mock failure", 500, "mock_failure"));
        return;
      }
      try {
        resolve(value());
      } catch (error) {
        reject(error);
      }
    }, LATENCY);
  });
}

/** Reads roll against FAIL_READS; the value is only computed if the roll passes. */
const read = <T,>(fn: () => T) => settle(fn, FAIL_READS);
/** Writes roll first and mutate second, so a "failed" write leaves the store untouched. */
const write = <T,>(fn: () => T) => settle(fn, FAIL_WRITES);

/**
 * The signed-in user, or a 401.
 *
 * The mock has a genuine unauthenticated state rather than silently falling
 * back to a default user — otherwise the login screen and the redirect guard
 * could never be exercised without a running backend.
 */
function currentUser(): UserRef {
  const user = userById(readStore().currentUserId);
  if (!user) throw new ApiError("You need to sign in.", 401, "unauthenticated");
  return user;
}

function requireTicket(tickets: MockTicket[], id: string): MockTicket {
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new ApiError("Ticket not found.", 404, "not_found");
  return t;
}

/** Role scoping, mirroring how the server expresses authorisation as a filter. */
function visible(tickets: MockTicket[], me: UserRef): MockTicket[] {
  return me.role === "customer" ? tickets.filter((t) => t.customerId === me.id) : tickets;
}

export const mockApi: HelpdeskApi = {
  auth: {
    me: () => read(() => currentUser()),

    login: (email, password) =>
      write(() => {
        const typed = email.trim().toLowerCase();

        // Accounts created through sign-up carry their own password; the seeded
        // roster all shares the demo one.
        const signedUp = readStore().registered.find((u) => u.email.toLowerCase() === typed);
        if (signedUp) {
          if (signedUp.password !== password) {
            throw new ApiError("Email or password is incorrect.", 401, "bad_credentials");
          }
          update((data) => {
            data.currentUserId = signedUp.id;
          });
          return { id: signedUp.id, name: signedUp.name, email: signedUp.email, role: signedUp.role };
        }

        const user = MOCK_USERS.find((u) => u.email.toLowerCase() === typed);
        // One message for both branches, so the form cannot be used to work out
        // which addresses are registered.
        if (!user || password !== DEMO_PASSWORD) {
          throw new ApiError("Email or password is incorrect.", 401, "bad_credentials");
        }
        update((data) => {
          data.currentUserId = user.id;
        });
        return user;
      }),

    register: (input) =>
      write(() =>
        update((data) => {
          const email = input.email.trim().toLowerCase();
          const taken =
            MOCK_USERS.some((u) => u.email.toLowerCase() === email) ||
            data.registered.some((u) => u.email.toLowerCase() === email);
          if (taken) throw new ApiError("That email is already registered.", 409, "duplicate");

          // Always a customer, mirroring the server. Staff accounts are
          // provisioned, never self-served — otherwise anyone could grant
          // themselves an agent queue simply by signing up.
          const user = {
            id: `u-new-${data.registered.length + 1}`,
            name: input.name.trim(),
            email,
            role: "customer" as const,
            password: input.password,
          };
          data.registered.push(user);
          data.currentUserId = user.id;
          return { id: user.id, name: user.name, email: user.email, role: user.role };
        }),
      ),

    logout: () =>
      write(() => {
        update((data) => {
          data.currentUserId = null;
        });
      }),
  },

  meta: {
    calendar: () =>
      read<CalendarMeta>(() => ({ calendar: MOCK_CALENDAR, policies: Array.from(MOCK_POLICIES.values()) })),
  },

  tickets: {
    list: (query: TicketQuery) =>
      read<Paginated<Ticket>>(() => {
        const data = readStore();
        const me = currentUser();
        const now = new Date();

        let rows = visible(data.tickets, me).map((t) => serialize(t, now));

        if (query.mine) rows = rows.filter((t) => t.assignedAgent?.id === me.id);
        if (query.assignedAgent) rows = rows.filter((t) => t.assignedAgent?.id === query.assignedAgent);
        if (query.status?.length) rows = rows.filter((t) => query.status!.includes(t.status));
        if (query.priority?.length) rows = rows.filter((t) => query.priority!.includes(t.priority));
        if (query.breached) {
          rows = rows.filter((t) => t.slaSnapshot.firstResponse.breached || t.slaSnapshot.resolution.breached);
        }
        if (query.atRisk) {
          rows = rows.filter((t) => t.slaSnapshot.firstResponse.atRisk || t.slaSnapshot.resolution.atRisk);
        }
        if (query.search) {
          const needle = query.search.toLowerCase();
          rows = rows.filter(
            (t) =>
              t.subject.toLowerCase().includes(needle) ||
              t.reference.toLowerCase().includes(needle) ||
              t.body.toLowerCase().includes(needle),
          );
        }

        if (query.sort === "created") {
          rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        } else {
          rows.sort((a, b) => a.slaSnapshot.urgencyMs - b.slaSnapshot.urgencyMs);
        }

        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 25;
        return {
          data: rows.slice((page - 1) * pageSize, page * pageSize),
          total: rows.length,
          page,
          pageSize,
        };
      }),

    get: (id) =>
      read<TicketDetailResponse>(() => {
        const data = readStore();
        const me = currentUser();
        const t = requireTicket(visible(data.tickets, me), id);
        return {
          ...serialize(t),
          events: serializeEvents(t),
          allowedTransitions: allowedTransitions(t.status, me.role),
        };
      }),

    create: (input: CreateTicketInput) =>
      write<Ticket>(() =>
        update((data) => {
          const me = currentUser();
          const routed = input.priority ? null : routePriority(input.subject, input.body);
          const priority: Priority = input.priority ?? routed?.priority ?? "medium";
          const agent = pickAgent(data.tickets);
          const createdAt = new Date();
          const clock = startClock(createdAt, MOCK_POLICIES.get(priority)!, MOCK_CALENDAR);

          data.seq += 1;
          const t: MockTicket = {
            id: `t-${data.seq}`,
            reference: `TK-${data.seq}`,
            subject: input.subject,
            body: input.body,
            status: "open",
            priority,
            customerId: me.role === "customer" ? me.id : "u-dana",
            agentId: agent.id,
            createdAt: createdAt.toISOString(),
            updatedAt: createdAt.toISOString(),
            firstResponseAt: null,
            resolvedAt: null,
            closedAt: null,
            priorityAutoAssigned: Boolean(routed),
            sla: {
              firstResponseDueAt: clock.firstResponseDueAt?.toISOString() ?? null,
              resolutionDueAt: clock.resolutionDueAt?.toISOString() ?? null,
              pausedAt: null,
              pausedBusinessMs: 0,
              firstResponseBreached: false,
              resolutionBreached: false,
              escalationCount: 0,
            },
            events: [],
          };

          addEvent(t, { type: "created", actorId: t.customerId, field: null, oldValue: null, newValue: null, body: null });
          if (routed) {
            addEvent(t, {
              type: "priority_change",
              actorId: null,
              field: "priority",
              oldValue: null,
              newValue: priority,
              body: `Matched routing rule "${routed.rule.name}"`,
            });
          }
          addEvent(t, {
            type: "reassignment",
            actorId: null,
            field: "assignedAgent",
            oldValue: null,
            newValue: agent.name,
            body: "Auto-assigned: least loaded agent",
          });

          data.tickets.push(t);
          return serialize(t);
        }),
      ),

    reply: (id, body) =>
      write<Ticket>(() =>
        update((data) => {
          const me = currentUser();
          const t = requireTicket(data.tickets, id);
          const now = new Date();

          addEvent(t, { type: "reply", actorId: me.id, field: null, oldValue: null, newValue: null, body });

          const isStaff = me.role === "agent" || me.role === "admin";
          if (isStaff && !t.firstResponseAt) t.firstResponseAt = now.toISOString();

          // A customer reply is what resumes a paused clock.
          if (!isStaff && t.status === "waiting_on_customer") {
            applyStatus(t, "in_progress", me.id, now);
          }
          t.updatedAt = now.toISOString();
          return serialize(t);
        }),
      ),

    setStatus: (id, status: TicketStatus) =>
      write<Ticket>(() =>
        update((data) => {
          const me = currentUser();
          const t = requireTicket(data.tickets, id);
          const check = checkTransition(t.status, status, me.role);
          if (!check.ok) throw new ApiError(check.reason ?? "Invalid transition.", 422, "invalid_transition");
          applyStatus(t, status, me.id);
          return serialize(t);
        }),
      ),

    setPriority: (id, priority: Priority) =>
      write<Ticket>(() =>
        update((data) => {
          const me = currentUser();
          if (me.role === "customer") throw new ApiError("Customers cannot change priority.", 403, "forbidden");
          const t = requireTicket(data.tickets, id);
          applyPriority(t, priority, me.id);
          return serialize(t);
        }),
      ),

    assign: (id, agentId) =>
      write<Ticket>(() =>
        update((data) => {
          const me = currentUser();
          const t = requireTicket(data.tickets, id);
          const previous = userById(t.agentId);
          t.agentId = agentId;
          t.updatedAt = new Date().toISOString();
          addEvent(t, {
            type: "reassignment",
            actorId: me.id,
            field: "assignedAgent",
            oldValue: previous?.name ?? null,
            newValue: userById(agentId)?.name ?? null,
            body: null,
          });
          return serialize(t);
        }),
      ),
  },

  admin: {
    breaches: () =>
      read<Paginated<Ticket>>(() => {
        const now = new Date();
        const rows = readStore()
          .tickets.map((t) => serialize(t, now))
          .filter((t) => t.slaSnapshot.firstResponse.breached || t.slaSnapshot.resolution.breached)
          .sort((a, b) => a.slaSnapshot.urgencyMs - b.slaSnapshot.urgencyMs);
        return { data: rows, total: rows.length, page: 1, pageSize: rows.length };
      }),

    workload: () =>
      read<AgentWorkload[]>(() => {
        const now = new Date();
        const data = readStore();
        return MOCK_USERS.filter((u) => u.role === "agent" || u.role === "admin").map((agent) => {
          const mine = data.tickets.filter(
            (t) => t.agentId === agent.id && t.status !== "resolved" && t.status !== "closed",
          );
          const snaps = mine.map((t) => serialize(t, now).slaSnapshot);
          return {
            agent,
            openCount: mine.length,
            atRiskCount: snaps.filter((s) => s.firstResponse.atRisk || s.resolution.atRisk).length,
            breachedCount: snaps.filter((s) => s.firstResponse.breached || s.resolution.breached).length,
          };
        });
      }),

    agents: () => read<UserRef[]>(() => MOCK_USERS.filter((u) => u.role === "agent" || u.role === "admin")),

    users: () =>
      read(() => {
        const data = readStore();
        const everyone: UserRef[] = [
          ...MOCK_USERS.map((u) => ({ ...u, role: data.roles[u.id] ?? u.role })),
          ...data.registered.map((u) => ({ id: u.id, name: u.name, email: u.email, role: data.roles[u.id] ?? u.role })),
        ];
        return everyone.map((u) => ({
          ...u,
          openTickets: data.tickets.filter(
            (t) => t.agentId === u.id && t.status !== "resolved" && t.status !== "closed",
          ).length,
          createdAt: null,
        }));
      }),

    setRole: (userId, role) =>
      write(() =>
        update((data) => {
          const me = currentUser();
          if (userId === me.id) {
            throw new ApiError("You cannot change your own role. Ask another admin to do it.", 422, "self_role_change");
          }

          const effective = (id: string, base: Role) => data.roles[id] ?? base;
          const all = [
            ...MOCK_USERS.map((u) => ({ id: u.id, name: u.name, role: effective(u.id, u.role) })),
            ...data.registered.map((u) => ({ id: u.id, name: u.name, role: effective(u.id, u.role) })),
          ];

          const target = all.find((u) => u.id === userId);
          if (!target) throw new ApiError("No such user.", 404, "not_found");
          if (target.role === role) return { id: userId, role, changed: false };

          // The last admin cannot be demoted, or nobody can reach this page again.
          if (target.role === "admin" && role !== "admin") {
            const admins = all.filter((u) => u.role === "admin").length;
            if (admins <= 1) {
              throw new ApiError(
                "This is the only admin. Promote someone else before demoting this account.",
                422,
                "last_admin",
              );
            }
          }

          const previous = target.role;
          data.roles[userId] = role;
          const openTickets = data.tickets.filter(
            (t) => t.agentId === userId && t.status !== "resolved" && t.status !== "closed",
          ).length;

          return { id: userId, name: target.name, role, previous, openTickets, changed: true };
        }),
      ),

    runSweep: () => write<SweepResult>(() => update((data) => sweep(data))),
  },
};
