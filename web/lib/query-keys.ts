import type { TicketQuery } from "./api/types";

/**
 * Hierarchical query keys. `all` is the broad invalidation root; anything that
 * changes a ticket also changes the dashboard counts, so mutations invalidate
 * both.
 */
export const queryKeys = {
  me: ["me"] as const,
  calendar: ["calendar"] as const,
  tickets: {
    all: ["tickets"] as const,
    list: (query: TicketQuery) => ["tickets", "list", query] as const,
    detail: (id: string) => ["tickets", "detail", id] as const,
  },
  admin: {
    breaches: ["admin", "breaches"] as const,
    workload: ["admin", "workload"] as const,
    agents: ["admin", "agents"] as const,
  },
};
