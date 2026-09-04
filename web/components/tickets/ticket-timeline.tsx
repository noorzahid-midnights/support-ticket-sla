"use client";

import {
  AlertTriangle,
  ArrowUpCircle,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { TicketEvent } from "@shared/types.js";
import { formatDateTime, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  created: PlusCircle,
  status_change: RefreshCw,
  priority_change: ArrowUpCircle,
  reassignment: UserCog,
  reply: MessageSquare,
  escalation: ArrowUpCircle,
  sla_breach: AlertTriangle,
};

function describe(event: TicketEvent): string {
  switch (event.type) {
    case "created":
      return "raised this ticket";
    case "status_change":
      return `changed status from ${titleCase(event.oldValue ?? "?")} to ${titleCase(event.newValue ?? "?")}`;
    case "priority_change":
      return event.oldValue
        ? `changed priority from ${event.oldValue} to ${event.newValue}`
        : `set priority to ${event.newValue}`;
    case "escalation":
      return `escalated priority from ${event.oldValue} to ${event.newValue}`;
    case "reassignment":
      return event.oldValue ? `reassigned from ${event.oldValue} to ${event.newValue}` : `assigned to ${event.newValue}`;
    case "sla_breach":
      return "SLA breached";
    case "reply":
      return "replied";
    default:
      return event.type;
  }
}

/**
 * The audit trail. A null actor means the system acted — the cron sweep, the
 * routing rules, the auto-assigner — and it is labelled as such, because "who
 * escalated this?" is the first question anyone asks of a priority that moved
 * on its own.
 */
export function TicketTimeline({ events }: { events: TicketEvent[] }) {
  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const Icon = ICONS[event.type] ?? RefreshCw;
        const isSystem = event.actor === null;
        const isAlert = event.type === "sla_breach" || event.type === "escalation";
        const isLast = index === events.length - 1;

        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && <span className="absolute left-[11px] top-7 h-[calc(100%-1.25rem)] w-px bg-border" aria-hidden />}

            <span
              className={cn(
                "z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
                isAlert
                  ? "border-sla-critical/30 bg-sla-critical-bg text-sla-critical"
                  : isSystem
                    ? "border-border bg-secondary text-muted-foreground"
                    : "border-border bg-card text-muted-foreground",
              )}
            >
              <Icon className="size-3" aria-hidden />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="font-medium">
                  {isSystem ? (
                    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1 py-px text-2xs uppercase tracking-wide">
                      System
                    </span>
                  ) : (
                    event.actor!.name
                  )}
                </span>{" "}
                <span className={cn(isAlert ? "font-medium text-sla-critical" : "text-muted-foreground")}>
                  {describe(event)}
                </span>
                <span className="ml-1.5 text-2xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
              </p>

              {event.body && event.type === "reply" && (
                <div className="mt-1.5 flex gap-2 rounded-md border bg-card px-3 py-2">
                  {event.actor && (
                    <span className="grid size-6 shrink-0 place-items-center self-start rounded-full bg-secondary text-[10px] font-semibold">
                      {initials(event.actor.name)}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{event.body}</p>
                </div>
              )}

              {event.body && event.type !== "reply" && (
                <p className="mt-1 text-2xs italic text-muted-foreground">{event.body}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
