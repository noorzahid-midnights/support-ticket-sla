"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, PauseCircle, Plus, Timer } from "lucide-react";
import type { Ticket } from "@shared/types.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shell/empty-state";
import { ErrorState } from "@/components/shell/error-state";
import { TicketBoard, TicketBoardSkeleton } from "./ticket-board";
import { NewTicketDialog } from "./new-ticket-dialog";
import { HeroDial } from "@/components/sla/hero-dial";
import { useCalendar, useMe, useTickets } from "@/hooks/use-tickets";
import { cn } from "@/lib/utils";

export function DashboardView() {
  const { data: me } = useMe();
  const { data: meta } = useCalendar();
  const [dialogOpen, setDialogOpen] = useState(false);

  const isCustomer = me?.role === "customer";
  const isAdmin = me?.role === "admin";

  const query = isCustomer || isAdmin ? { sort: "urgency" as const } : { mine: true, sort: "urgency" as const };
  const { data, isPending, isError, error, refetch } = useTickets(query);

  const rows: Ticket[] = data?.data ?? [];
  const live = rows.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const breached = live.filter((t) => t.slaSnapshot.firstResponse.breached || t.slaSnapshot.resolution.breached);
  const atRisk = live.filter(
    (t) =>
      !t.slaSnapshot.firstResponse.breached &&
      !t.slaSnapshot.resolution.breached &&
      (t.slaSnapshot.firstResponse.atRisk || t.slaSnapshot.resolution.atRisk),
  );
  const paused = live.filter((t) => t.slaSnapshot.paused);
  const healthy = live.length - breached.length - atRisk.length - paused.length;

  return (
    <div className="space-y-7">
      {/* Tinted hero band, the signature move from the reference layouts: a
          calm sage field carrying the headline and the day's numbers, with the
          working list on the plain plane beneath it. */}
      <section className="hero-band relative -mx-4 -mt-6 overflow-hidden rounded-b-[2rem] border-b border-panel-border px-4 pb-7 pt-8 md:-mx-8 md:-mt-9 md:px-8 md:pb-8 md:pt-11">
        {/* Hero artwork, sitting where the reference layouts put their imagery.
            Bleeds off the right edge and stays behind the content, so it never
            competes with the numbers. */}
        <HeroDial className="pointer-events-none absolute -right-14 top-1/2 hidden size-[360px] -translate-y-1/2 opacity-45 xl:block" />

        {/* Copy stacked over its call to action on the left, artwork on the
            right — the composition both reference layouts use. */}
        <div className="relative max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
            {isCustomer ? "Support" : isAdmin ? "Operations" : "My queue"}
          </p>
          <h1 className="mt-2.5 text-4xl font-bold text-foreground md:text-5xl">
            {isCustomer ? "Your tickets" : isAdmin ? "Everything, worst first" : "Your queue, worst first"}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {isCustomer
              ? "Everything you have raised with support. Priority and assignment are handled for you."
              : "Ordered by SLA urgency. Clocks count business hours only, and pause whenever a ticket is waiting on the customer."}
          </p>

          <Button size="lg" onClick={() => setDialogOpen(true)} className="mt-5">
            <Plus className="size-4" aria-hidden />
            New ticket
          </Button>
        </div>

      </section>

      {breached.length > 0 && !isCustomer && (
        <div className="flex items-start gap-3 rounded-lg border border-sla-critical/25 bg-sla-critical-bg px-4 py-3">
          <AlertTriangle className="mt-px size-4 shrink-0 text-sla-critical" aria-hidden />
          <p className="text-xs leading-relaxed text-sla-critical">
            <span className="font-semibold">
              {breached.length} ticket{breached.length === 1 ? "" : "s"} past the SLA.
            </span>{" "}
            The background sweep escalates each one priority level and notifies an admin — once per breach, not on
            every pass.
          </p>
        </div>
      )}

      {/* The board sits straight on the plane rather than inside a Card: its
          columns are cards already, and an outer `overflow-hidden` wrapper
          would clip the horizontal scroll. */}
      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            By SLA state · most urgent first within each column
          </h2>
          {data && <span className="text-2xs text-muted-foreground tabular">{data.total} total</span>}
        </div>

        {isPending ? (
          <TicketBoardSkeleton />
        ) : isError ? (
          <Card className="shadow-card">
            <ErrorState title="Could not load tickets" error={error as Error} onRetry={() => refetch()} />
          </Card>
        ) : rows.length === 0 ? (
          <Card className="shadow-card">
            <EmptyState
              icon={Inbox}
              title={isCustomer ? "You have no tickets" : "Nothing in your queue"}
              description={
                isCustomer
                  ? "Raise one and it will be routed and assigned automatically."
                  : "New tickets are auto-assigned to whoever is carrying the lightest load."
              }
              action={<Button onClick={() => setDialogOpen(true)}>New ticket</Button>}
            />
          </Card>
        ) : (
          <TicketBoard tickets={rows} calendar={meta?.calendar} showAssignee={!isCustomer} />
        )}
      </div>

      <NewTicketDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
