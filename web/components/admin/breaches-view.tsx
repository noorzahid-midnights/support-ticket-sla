"use client";

import { CheckCircle2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shell/empty-state";
import { ErrorState } from "@/components/shell/error-state";
import { PageHeader } from "@/components/shell/page-header";
import { TicketTable, TicketTableSkeleton } from "@/components/tickets/ticket-table";
import { useBreaches, useCalendar, useRunSweep } from "@/hooks/use-tickets";
import { formatBusinessDuration } from "@/lib/format";

export function BreachesView() {
  const { data, isPending, isError, error, refetch } = useBreaches();
  const { data: meta } = useCalendar();
  const sweep = useRunSweep();

  const rows = data?.data ?? [];
  const worst = rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA breaches"
        description="Every ticket past its first-response or resolution deadline."
        actions={
          // The same function the cron calls every minute. Running it twice
          // shows that it does not double-escalate.
          <Button onClick={() => sweep.mutate()} disabled={sweep.isPending} variant="outline">
            <PlayCircle className="size-4" aria-hidden />
            {sweep.isPending ? "Sweeping…" : "Run sweep now"}
          </Button>
        }
      />

      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4 shadow-card">
            <p className="text-4xl font-semibold leading-none">{rows.length}</p>
            <p className="mt-1 text-2xs text-muted-foreground">Tickets in breach</p>
          </Card>
          <Card className="p-4 shadow-card">
            <p className="text-4xl font-semibold leading-none text-sla-critical">
              {rows.filter((t) => t.priority === "urgent").length}
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">Already at top priority</p>
          </Card>
          <Card className="p-4 shadow-card">
            <p className="text-4xl font-semibold leading-none">
              {worst?.slaSnapshot.urgencyMs !== undefined && Number.isFinite(worst.slaSnapshot.urgencyMs)
                ? formatBusinessDuration(worst.slaSnapshot.urgencyMs)
                : "—"}
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">Worst overrun (business time)</p>
          </Card>
        </div>
      )}

      <Card className="overflow-hidden shadow-card">
        {isPending ? (
          <TicketTableSkeleton />
        ) : isError ? (
          <ErrorState title="Could not load the breach report" error={error as Error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No SLA breaches"
            description="Every live ticket is inside its first-response and resolution deadlines."
          />
        ) : (
          <TicketTable tickets={rows} calendar={meta?.calendar} />
        )}
      </Card>
    </div>
  );
}
