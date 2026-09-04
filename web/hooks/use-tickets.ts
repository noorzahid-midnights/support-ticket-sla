"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Priority, TicketStatus, UserRef } from "@shared/types.js";
import { api } from "@/lib/api";
import type { CreateTicketInput, TicketQuery } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

/** Anything that changes a ticket also changes the breach report and workload. */
function invalidateTicketViews(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: queryKeys.tickets.all });
  qc.invalidateQueries({ queryKey: queryKeys.admin.breaches });
  qc.invalidateQueries({ queryKey: queryKeys.admin.workload });
  if (id) qc.invalidateQueries({ queryKey: queryKeys.tickets.detail(id) });
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * The business calendar. Cached hard because the countdown component reads it
 * on every tick, and it changes about as often as the office moves.
 */
export function useCalendar() {
  return useQuery({
    queryKey: queryKeys.calendar,
    queryFn: () => api.meta.calendar(),
    staleTime: 30 * 60_000,
  });
}

export function useTickets(query: TicketQuery) {
  return useQuery({
    queryKey: queryKeys.tickets.list(query),
    queryFn: () => api.tickets.list(query),
    // Stops the table blanking on every keystroke while a filter is typed.
    placeholderData: keepPreviousData,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: queryKeys.tickets.detail(id),
    queryFn: () => api.tickets.get(id),
    enabled: Boolean(id),
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => api.tickets.create(input),
    onSuccess: (ticket) => {
      invalidateTicketViews(qc);
      toast.success(`${ticket.reference} created`, {
        description: ticket.priorityAutoAssigned
          ? `Routed to ${ticket.priority} automatically and assigned to ${ticket.assignedAgent?.name ?? "nobody"}.`
          : `Assigned to ${ticket.assignedAgent?.name ?? "nobody"}.`,
      });
    },
    onError: (error: Error) => toast.error("Could not create the ticket", { description: error.message }),
  });
}

export function useReply(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.tickets.reply(ticketId, body),
    onSuccess: () => {
      invalidateTicketViews(qc, ticketId);
      toast.success("Reply sent");
    },
    onError: (error: Error) => toast.error("Could not send the reply", { description: error.message }),
  });
}

export function useSetStatus(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TicketStatus) => api.tickets.setStatus(ticketId, status),
    onSuccess: (ticket) => {
      invalidateTicketViews(qc, ticketId);
      toast.success(`Moved to ${ticket.status.replace(/_/g, " ")}`, {
        description: ticket.slaSnapshot.paused
          ? "The SLA clock is paused while you wait on the customer."
          : undefined,
      });
    },
    // The server rejects illegal transitions with a message naming the legal
    // ones, so surfacing it verbatim is more useful than a generic failure.
    onError: (error: Error) => toast.error("Could not change the status", { description: error.message }),
  });
}

export function useSetPriority(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priority: Priority) => api.tickets.setPriority(ticketId, priority),
    onSuccess: (ticket) => {
      invalidateTicketViews(qc, ticketId);
      toast.success(`Priority set to ${ticket.priority}`, { description: "SLA deadlines have been recalculated." });
    },
    onError: (error: Error) => toast.error("Could not change the priority", { description: error.message }),
  });
}

export function useAssign(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string | null) => api.tickets.assign(ticketId, agentId),
    onSuccess: () => {
      invalidateTicketViews(qc, ticketId);
      toast.success("Ticket reassigned");
    },
    onError: (error: Error) => toast.error("Could not reassign the ticket", { description: error.message }),
  });
}

export function useBreaches() {
  return useQuery({ queryKey: queryKeys.admin.breaches, queryFn: () => api.admin.breaches() });
}

export function useWorkload() {
  return useQuery({ queryKey: queryKeys.admin.workload, queryFn: () => api.admin.workload() });
}

export function useAgents() {
  return useQuery<UserRef[]>({
    queryKey: queryKeys.admin.agents,
    queryFn: () => api.admin.agents(),
    staleTime: 5 * 60_000,
  });
}

export function useRunSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.runSweep(),
    onSuccess: (result) => {
      invalidateTicketViews(qc);
      if (result.breached === 0) {
        toast.success("Sweep complete", {
          description: `Checked ${result.checked} live tickets. Nothing newly breached.`,
        });
      } else {
        toast.warning(`${result.breached} newly breached`, {
          description: `${result.escalated} escalated, ${result.atCeiling} already at the highest priority.`,
        });
      }
    },
    onError: (error: Error) => toast.error("Sweep failed", { description: error.message }),
  });
}
