"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, PauseCircle, Timer } from "lucide-react";
import type { BusinessCalendar } from "@shared/business-time.js";
import type { Ticket } from "@shared/types.js";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityBadge, StatusBadge } from "@/components/sla/sla-badges";
import { formatBusinessDuration, formatInCalendarTz, initials, overallHealth } from "@/lib/format";
import { SLA_HEALTH_META } from "@/lib/statuses";
import { cn } from "@/lib/utils";

type ColumnKey = "breached" | "at_risk" | "paused" | "ok" | "done";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  hint: string;
  icon: typeof AlertTriangle;
  /**
   * Accent classes, all drawn from the reserved status palette.
   *
   * `band` tints the whole header rather than leaving a hairline rail, which is
   * what makes it read as a section heading instead of one more card in the
   * stack. The count sits in a solid pill using `text-background`, so it flips
   * to a readable ink in either theme without a second set of tokens.
   */
  band: string;
  text: string;
  iconChip: string;
  countPill: string;
}

/**
 * Columns in severity order, so the eye lands on the worst first and the board
 * reads left-to-right as "what needs me now" → "what is finished".
 */
const COLUMNS: ColumnDef[] = [
  {
    key: "breached",
    label: "Breached",
    hint: "past deadline · escalated",
    icon: AlertTriangle,
    band: "bg-sla-critical-bg border-sla-critical/25",
    text: "text-sla-critical",
    iconChip: "bg-sla-critical/15 text-sla-critical",
    countPill: "bg-sla-critical text-background",
  },
  {
    key: "at_risk",
    label: "At risk",
    hint: "under 25% of the window left",
    icon: Timer,
    band: "bg-sla-warn-bg border-sla-warn/30",
    text: "text-sla-warn",
    iconChip: "bg-sla-warn/15 text-sla-warn",
    countPill: "bg-sla-warn text-background",
  },
  {
    key: "paused",
    label: "Waiting on customer",
    hint: "clock paused",
    icon: PauseCircle,
    band: "bg-sla-paused-bg border-sla-paused/25",
    text: "text-sla-paused",
    iconChip: "bg-sla-paused/15 text-sla-paused",
    countPill: "bg-sla-paused text-background",
  },
  {
    key: "ok",
    label: "On track",
    hint: "inside both deadlines",
    icon: CheckCircle2,
    band: "bg-sla-ok-bg border-sla-ok/25",
    text: "text-sla-ok",
    iconChip: "bg-sla-ok/15 text-sla-ok",
    countPill: "bg-sla-ok text-background",
  },
  {
    key: "done",
    label: "Resolved",
    hint: "no clock running",
    icon: CheckCircle2,
    band: "bg-secondary border-border",
    text: "text-muted-foreground",
    iconChip: "bg-muted-foreground/15 text-muted-foreground",
    countPill: "bg-muted-foreground text-background",
  },
];

/**
 * Which column a ticket belongs in.
 *
 * Resolved and closed tickets go to "Resolved" even if they breached along the
 * way, so every other column means "still open and in this state" — i.e. every
 * card in Breached is one an agent can still act on. The historical record of
 * breaches lives in the admin breach report, which is what that page is for.
 * A card that missed its SLA still says so.
 */
function columnFor(ticket: Ticket): ColumnKey {
  if (ticket.status === "resolved" || ticket.status === "closed") return "done";
  const health = overallHealth(ticket.slaSnapshot);
  if (health === "breached") return "breached";
  if (health === "at_risk") return "at_risk";
  if (health === "paused") return "paused";
  return "ok";
}

/** The deadline an agent is actually working to. */
function governing(ticket: Ticket) {
  return ticket.firstResponseAt ? ticket.slaSnapshot.resolution : ticket.slaSnapshot.firstResponse;
}

function TicketCard({
  ticket,
  calendar,
  showAssignee,
}: {
  ticket: Ticket;
  calendar: BusinessCalendar | undefined;
  showAssignee: boolean;
}) {
  const deadline = governing(ticket);
  const meta = SLA_HEALTH_META[overallHealth(ticket.slaSnapshot)];
  const terminal = ticket.status === "resolved" || ticket.status === "closed";
  const overdue = deadline.remainingMs !== null && deadline.remainingMs < 0;
  const missed = terminal && (ticket.slaSnapshot.firstResponse.breached || ticket.slaSnapshot.resolution.breached);

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="group block rounded-xl border border-border bg-card p-4 shadow-xs transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-card"
    >
      {/* The countdown leads. It is the number the agent acts on, so it gets
          the largest type on the card — the subject tells you *what* it is,
          but this tells you whether to open it now. */}
      <div className="flex items-start justify-between gap-2">
        {terminal ? (
          <span className={cn("text-base font-bold leading-none", missed ? "text-sla-critical" : "text-sla-ok")}>
            {missed ? "Missed SLA" : "Met SLA"}
          </span>
        ) : (
          <span className={cn("text-lg font-bold leading-none tabular", meta.text)}>
            {deadline.remainingMs === null ? (
              "—"
            ) : (
              <>
                {formatBusinessDuration(deadline.remainingMs)}
                <span className="ml-1 text-2xs font-semibold uppercase tracking-wide opacity-70">
                  {overdue ? "over" : "left"}
                </span>
              </>
            )}
          </span>
        )}
        <PriorityBadge priority={ticket.priority} showLabel={false} className="mt-0.5" />
      </div>

      <p className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:underline">
        {ticket.subject}
      </p>

      <p className="mt-1.5 text-2xs text-muted-foreground">
        <span className="font-mono">{ticket.reference}</span> · {ticket.customer.name}
      </p>

      {!terminal && deadline.dueAt && (
        <p className="mt-1 text-2xs text-muted-foreground/75">
          due {calendar ? formatInCalendarTz(deadline.dueAt, calendar.timezone) : "—"}
        </p>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border pt-3">
        <StatusBadge status={ticket.status} />
        <div className="flex items-center gap-1.5">
          {ticket.sla.escalationCount > 0 && (
            <span
              className="rounded-full bg-sla-critical-bg px-1.5 py-0.5 text-2xs font-semibold text-sla-critical"
              title={`Auto-escalated ${ticket.sla.escalationCount} time(s)`}
            >
              ↑{ticket.sla.escalationCount}
            </span>
          )}
          {showAssignee && (
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground ring-1 ring-inset ring-border"
              title={ticket.assignedAgent?.name ?? "Unassigned"}
            >
              {ticket.assignedAgent ? initials(ticket.assignedAgent.name) : "—"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function TicketBoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
      {COLUMNS.map((column) => (
        <div key={column.key} className="min-w-[242px] flex-1 space-y-2">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function TicketBoard({
  tickets,
  calendar,
  showAssignee = true,
}: {
  tickets: Ticket[];
  calendar: BusinessCalendar | undefined;
  showAssignee?: boolean;
}) {
  // `tickets` arrives already sorted by SLA urgency, so bucketing preserves
  // "most at-risk first" inside every column.
  const buckets = new Map<ColumnKey, Ticket[]>(COLUMNS.map((c) => [c.key, []]));
  for (const ticket of tickets) buckets.get(columnFor(ticket))!.push(ticket);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
      {COLUMNS.map((column) => {
        const rows = buckets.get(column.key)!;
        const Icon = column.icon;

        return (
          <section key={column.key} className="flex min-w-[242px] flex-1 flex-col" aria-label={column.label}>
            {/* A tinted band in the column's own status colour. The earlier
                version was a white card with a hairline rail, which read as one
                more card in the stack rather than as the heading over it. */}
            <header
              className={cn(
                "mb-2.5 rounded-xl border px-3.5 py-3",
                column.band,
                rows.length === 0 && "opacity-60",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", column.iconChip)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <h3 className={cn("min-w-0 flex-1 truncate text-sm font-bold tracking-tight", column.text)}>
                  {column.label}
                </h3>
                <span
                  className={cn(
                    "grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-xs font-bold tabular",
                    column.countPill,
                  )}
                >
                  {rows.length}
                </span>
              </div>
              <p className={cn("mt-1.5 text-2xs font-medium opacity-70", column.text)}>{column.hint}</p>
            </header>

            <div className="space-y-2.5">
              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-2xs text-muted-foreground">
                  Nothing here
                </p>
              ) : (
                rows.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    calendar={calendar}
                    showAssignee={showAssignee}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
