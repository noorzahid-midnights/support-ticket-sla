"use client";

import { useState } from "react";
import { AlertTriangle, PauseCircle, Send } from "lucide-react";
import { PRIORITIES, type Priority, type TicketStatus } from "@shared/types.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/shell/error-state";
import { PageHeader } from "@/components/shell/page-header";
import { PriorityBadge, SlaBadge, SlaRing, StatusBadge } from "@/components/sla/sla-badges";
import { TicketTimeline } from "./ticket-timeline";
import {
  useAgents,
  useAssign,
  useCalendar,
  useMe,
  useReply,
  useSetPriority,
  useSetStatus,
  useTicket,
} from "@/hooks/use-tickets";
import { formatDateTime, titleCase } from "@/lib/format";

export function TicketDetailView({ id }: { id: string }) {
  const { data: ticket, isPending, isError, error, refetch } = useTicket(id);
  const { data: meta } = useCalendar();
  const { data: me } = useMe();
  const { data: agents } = useAgents();

  const [draft, setDraft] = useState("");
  const reply = useReply(id);
  const setStatus = useSetStatus(id);
  const setPriority = useSetPriority(id);
  const assign = useAssign(id);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (isError || !ticket) {
    return <ErrorState title="Could not load this ticket" error={error as Error} onRetry={() => refetch()} />;
  }

  const isStaff = me?.role === "agent" || me?.role === "admin";
  const policy = meta?.policies.find((p) => p.priority === ticket.priority);
  const breached = ticket.slaSnapshot.firstResponse.breached || ticket.slaSnapshot.resolution.breached;

  function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    reply.mutate(draft.trim(), { onSuccess: () => setDraft("") });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={ticket.subject}
        description={`${ticket.reference} · raised by ${ticket.customer.name} on ${formatDateTime(ticket.createdAt)}`}
        backHref={me?.role === "customer" ? "/dashboard" : "/tickets"}
        backLabel="Back to tickets"
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <SlaBadge snapshot={ticket.slaSnapshot} />
        {ticket.priorityAutoAssigned && (
          <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-2xs text-muted-foreground">
            priority auto-routed
          </span>
        )}
        {ticket.sla.escalationCount > 0 && (
          <span className="rounded-full border border-sla-critical/25 bg-sla-critical-bg px-2 py-0.5 text-2xs font-medium text-sla-critical">
            escalated {ticket.sla.escalationCount}×
          </span>
        )}
      </div>

      {breached && (
        <div className="flex items-start gap-3 rounded-lg border border-sla-critical/25 bg-sla-critical-bg px-4 py-3">
          <AlertTriangle className="mt-px size-4 shrink-0 text-sla-critical" aria-hidden />
          <p className="text-xs leading-relaxed text-sla-critical">
            This ticket has breached its SLA. It was escalated automatically and an admin was notified.
          </p>
        </div>
      )}

      {ticket.slaSnapshot.paused && (
        <div className="flex items-start gap-3 rounded-lg border border-sla-paused/25 bg-sla-paused-bg px-4 py-3">
          <PauseCircle className="mt-px size-4 shrink-0 text-sla-paused" aria-hidden />
          <p className="text-xs leading-relaxed text-sla-paused">
            The SLA clock is paused while this waits on the customer. A reply from them resumes it and pushes both
            deadlines forward by the business time spent waiting.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.body}</p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-4 text-sm font-semibold">Activity</h2>
            <TicketTimeline events={ticket.events} />

            <Separator className="my-4" />

            <form onSubmit={send} className="space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder={
                  me?.role === "customer"
                    ? "Reply to support. This resumes the SLA clock if we were waiting on you."
                    : "Reply to the customer. Your first reply meets the first-response SLA."
                }
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={reply.isPending || !draft.trim()}>
                  <Send className="size-3.5" aria-hidden />
                  {reply.isPending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">SLA</h2>
            <SlaRing
              label="First response"
              deadline={ticket.slaSnapshot.firstResponse}
              windowMs={(policy?.firstResponseMinutes ?? 60) * 60_000}
              paused={ticket.slaSnapshot.paused}
              calendar={meta?.calendar}
            />
            <SlaRing
              label="Resolution"
              deadline={ticket.slaSnapshot.resolution}
              windowMs={(policy?.resolutionMinutes ?? 240) * 60_000}
              paused={ticket.slaSnapshot.paused}
              calendar={meta?.calendar}
            />

            {ticket.sla.pausedBusinessMs > 0 && (
              <p className="border-t pt-3 text-2xs text-muted-foreground">
                Deadlines have been extended by{" "}
                <span className="font-medium text-foreground">
                  {Math.round(ticket.sla.pausedBusinessMs / 60_000)} business minutes
                </span>{" "}
                already spent waiting on the customer.
              </p>
            )}
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">Actions</h2>

            <div className="space-y-1.5">
              <label className="text-2xs uppercase tracking-wide text-muted-foreground">Status</label>
              {/* Only transitions the server will actually accept are offered,
                  so the UI can never present an option that 422s. */}
              <Select
                value=""
                onValueChange={(value) => setStatus.mutate(value as TicketStatus)}
                disabled={ticket.allowedTransitions.length === 0 || setStatus.isPending}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={
                      ticket.allowedTransitions.length === 0 ? "No moves available to you" : "Move ticket to…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {ticket.allowedTransitions.map((transition) => (
                    <SelectItem key={transition.to} value={transition.to} className="text-xs">
                      {transition.label} → {titleCase(transition.to)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isStaff && (
              <>
                <div className="space-y-1.5">
                  <label className="text-2xs uppercase tracking-wide text-muted-foreground">Priority</label>
                  <Select
                    value={ticket.priority}
                    onValueChange={(value) => setPriority.mutate(value as Priority)}
                    disabled={setPriority.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p} className="text-xs capitalize">
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs text-muted-foreground">Changing this recalculates both deadlines.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-2xs uppercase tracking-wide text-muted-foreground">Assignee</label>
                  <Select
                    value={ticket.assignedAgent?.id ?? ""}
                    onValueChange={(value) => assign.mutate(value)}
                    disabled={assign.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      {(agents ?? []).map((agent) => (
                        <SelectItem key={agent.id} value={agent.id} className="text-xs">
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
