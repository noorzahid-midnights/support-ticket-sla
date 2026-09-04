"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, PauseCircle } from "lucide-react";
import type { BusinessCalendar } from "@shared/business-time.js";
import type { Ticket } from "@shared/types.js";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge, SlaBadge, StatusBadge } from "@/components/sla/sla-badges";
import { formatBusinessDuration, formatInCalendarTz, formatRelative, initials, overallHealth } from "@/lib/format";
import { SLA_HEALTH_META } from "@/lib/statuses";
import { cn } from "@/lib/utils";

/**
 * The governing deadline for a row: first response while it is still
 * outstanding, then resolution. Showing both would double the table's width to
 * display one number an agent actually acts on.
 */
function governing(ticket: Ticket) {
  return ticket.firstResponseAt ? ticket.slaSnapshot.resolution : ticket.slaSnapshot.firstResponse;
}

export function TicketTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * A ticket row.
 *
 * Deliberately not a dense data table: the job here is triage, so each row is
 * scannable in one pass — a coloured urgency rail down the left edge, the
 * subject, and the one deadline that matters, right-aligned where the eye
 * finishes.
 */
function TicketRow({ ticket, calendar, showAssignee }: { ticket: Ticket; calendar: BusinessCalendar | undefined; showAssignee: boolean }) {
  const deadline = governing(ticket);
  const health = overallHealth(ticket.slaSnapshot);
  const meta = SLA_HEALTH_META[health];
  const paused = ticket.slaSnapshot.paused;
  const overdue = deadline.remainingMs !== null && deadline.remainingMs < 0;
  const done = Boolean(ticket.slaSnapshot.resolution.metAt);

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="group relative flex items-center gap-4 py-3.5 pl-5 pr-4 transition-colors hover:bg-secondary/40"
    >
      {/* Urgency rail: the fastest possible read of SLA health, before any text. */}
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", meta.bar)} aria-hidden />

      <span
        className={cn(
          "hidden size-8 shrink-0 place-items-center rounded-full text-2xs font-semibold sm:grid",
          "bg-secondary text-muted-foreground ring-1 ring-inset ring-border",
        )}
        aria-hidden
      >
        {initials(ticket.customer.name)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground group-hover:underline">
            {ticket.subject}
          </span>
          <ArrowUpRight
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span className="font-mono">{ticket.reference}</span>
          <span aria-hidden>·</span>
          <span>{ticket.customer.name}</span>
          <span aria-hidden>·</span>
          <span>{formatRelative(ticket.createdAt)}</span>
          {showAssignee && (
            <>
              <span aria-hidden>·</span>
              <span>{ticket.assignedAgent?.name ?? "Unassigned"}</span>
            </>
          )}
          {ticket.sla.escalationCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sla-critical-bg px-1.5 py-px font-medium text-sla-critical">
              <AlertTriangle className="size-2.5" aria-hidden />
              escalated {ticket.sla.escalationCount}×
            </span>
          )}
          {ticket.priorityAutoAssigned && (
            <span className="rounded-full bg-secondary px-1.5 py-px">auto-routed</span>
          )}
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-3 lg:flex">
        <PriorityBadge priority={ticket.priority} showLabel={false} />
        <StatusBadge status={ticket.status} />
      </div>

      <div className="w-[132px] shrink-0 text-right">
        <SlaBadge snapshot={ticket.slaSnapshot} className="mb-1" />
        <p
          className={cn(
            "text-2xs tabular",
            overdue ? "font-semibold text-sla-critical" : paused ? "text-sla-paused" : "text-muted-foreground",
          )}
        >
          {done ? (
            "closed out"
          ) : deadline.remainingMs === null ? (
            "—"
          ) : overdue ? (
            `${formatBusinessDuration(deadline.remainingMs)} over`
          ) : paused ? (
            <span className="inline-flex items-center gap-1">
              <PauseCircle className="size-2.5" aria-hidden />
              {formatBusinessDuration(deadline.remainingMs)} left
            </span>
          ) : (
            `${formatBusinessDuration(deadline.remainingMs)} left`
          )}
        </p>
        <p className="text-2xs text-muted-foreground/70">
          {calendar ? formatInCalendarTz(deadline.dueAt, calendar.timezone) : "—"}
        </p>
      </div>
    </Link>
  );
}

export function TicketTable({
  tickets,
  calendar,
  showAssignee = true,
}: {
  tickets: Ticket[];
  calendar: BusinessCalendar | undefined;
  showAssignee?: boolean;
}) {
  return (
    <div className="divide-y divide-border">
      {tickets.map((ticket) => (
        <TicketRow key={ticket.id} ticket={ticket} calendar={calendar} showAssignee={showAssignee} />
      ))}
    </div>
  );
}
