"use client";

import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shell/empty-state";
import { ErrorState } from "@/components/shell/error-state";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkload } from "@/hooks/use-tickets";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function WorkloadView() {
  const { data, isPending, isError, error, refetch } = useWorkload();
  const rows = data ?? [];
  const busiest = Math.max(1, ...rows.map((r) => r.openCount));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent workload"
        description="Open tickets per agent. New tickets are auto-assigned to whoever is carrying the least."
      />

      <Card className="overflow-hidden shadow-card">
        {isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load workload" error={error as Error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No agents" description="Add an agent to start assigning tickets." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="w-[280px]">Open tickets</TableHead>
                  <TableHead className="w-[110px] text-right">At risk</TableHead>
                  <TableHead className="w-[110px] text-right">Breached</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.agent.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-2xs font-semibold">
                          {initials(row.agent.name)}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{row.agent.name}</p>
                          <p className="text-2xs capitalize text-muted-foreground">{row.agent.role}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      {/* A bar rather than a bare number: the point of this page
                          is the comparison between agents, not the count. */}
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.breachedCount > 0 ? "bg-sla-critical" : row.atRiskCount > 0 ? "bg-sla-warn" : "bg-primary",
                            )}
                            style={{ width: `${Math.round((row.openCount / busiest) * 100)}%` }}
                          />
                        </div>
                        <span className="w-6 text-right text-xs font-medium tabular">{row.openCount}</span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "text-xs tabular",
                          row.atRiskCount > 0 ? "font-semibold text-sla-warn" : "text-muted-foreground",
                        )}
                      >
                        {row.atRiskCount}
                      </span>
                    </TableCell>

                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "text-xs tabular",
                          row.breachedCount > 0 ? "font-semibold text-sla-critical" : "text-muted-foreground",
                        )}
                      >
                        {row.breachedCount}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
