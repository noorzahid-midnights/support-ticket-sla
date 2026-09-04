import { ApiError } from "@shared/types.js";
import type {
  CalendarMeta,
  RoleChangeResult,
  TeamMember,
  CreateTicketInput,
  HelpdeskApi,
  SweepResult,
  TicketDetailResponse,
  TicketQuery,
} from "./types";
import type { AgentWorkload, Paginated, Priority, Role, Ticket, TicketStatus, UserRef } from "@shared/index.js";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // Sends the httpOnly auth cookie. Requires the server's CORS config to
      // name this origin explicitly — a wildcard origin cannot carry credentials.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    // No response at all. Distinct from a 500, and the retry predicate in
    // providers.tsx depends on this throwing rather than resolving.
    throw new ApiError("Could not reach the API. Is the server running on port 4000?", 0, "network");
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      payload?.error?.code ?? "unknown",
    );
  }
  return payload as T;
}

function qs(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const httpApi: HelpdeskApi = {
  auth: {
    me: () => request<UserRef>("/api/auth/me"),
    login: (email, password) =>
      request<UserRef>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    register: (input) =>
      request<UserRef>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
    updateMe: (input) => request<UserRef>("/api/auth/me", { method: "PATCH", body: JSON.stringify(input) }),
    logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  },
  meta: {
    calendar: () => request<CalendarMeta>("/api/meta/calendar"),
  },
  tickets: {
    list: (query: TicketQuery) => request<Paginated<Ticket>>(`/api/tickets${qs(query as Record<string, unknown>)}`),
    get: (id) => request<TicketDetailResponse>(`/api/tickets/${id}`),
    create: (input: CreateTicketInput) =>
      request<Ticket>("/api/tickets", { method: "POST", body: JSON.stringify(input) }),
    reply: (id, body) =>
      request<Ticket>(`/api/tickets/${id}/replies`, { method: "POST", body: JSON.stringify({ body }) }),
    setStatus: (id, status: TicketStatus) =>
      request<Ticket>(`/api/tickets/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    setPriority: (id, priority: Priority) =>
      request<Ticket>(`/api/tickets/${id}/priority`, { method: "PATCH", body: JSON.stringify({ priority }) }),
    assign: (id, agentId) =>
      request<Ticket>(`/api/tickets/${id}/assignee`, { method: "PATCH", body: JSON.stringify({ agentId }) }),
  },
  admin: {
    breaches: () => request<Paginated<Ticket>>("/api/admin/breaches"),
    workload: () => request<AgentWorkload[]>("/api/admin/workload"),
    agents: () => request<UserRef[]>("/api/admin/agents"),
    users: () => request<TeamMember[]>("/api/admin/users"),
    setRole: (userId, role) =>
      request<RoleChangeResult>(`/api/admin/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    deleteUser: (userId) => request<void>(`/api/admin/users/${userId}`, { method: "DELETE" }),
    runSweep: () => request<SweepResult>("/api/admin/sla/sweep", { method: "POST" }),
  },
};
