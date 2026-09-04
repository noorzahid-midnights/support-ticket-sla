"use client";

import { useState } from "react";
import { Inbox, SearchX } from "lucide-react";
import { PRIORITIES, TICKET_STATUSES, type Priority, type TicketStatus } from "@shared/types.js";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shell/empty-state";
import { ErrorState } from "@/components/shell/error-state";
import { PageHeader } from "@/components/shell/page-header";
import { TicketTable, TicketTableSkeleton } from "./ticket-table";
import { useCalendar, useTickets } from "@/hooks/use-tickets";
import { useDebounce } from "@/hooks/use-debounce";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "__all__";

export function TicketsView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [priority, setPriority] = useState<string>(ALL);
  const [health, setHealth] = useState<string>(ALL);

  const debounced = useDebounce(search, 250);
  const { data: meta } = useCalendar();

  const query = {
    search: debounced || undefined,
    status: status === ALL ? undefined : ([status] as TicketStatus[]),
    priority: priority === ALL ? undefined : ([priority] as Priority[]),
    breached: health === "breached" || undefined,
    atRisk: health === "at_risk" || undefined,
    sort: "urgency" as const,
    pageSize: 100,
  };

  const { data, isPending, isError, error, refetch, isPlaceholderData } = useTickets(query);
  const rows = data?.data ?? [];
  const filtered = Boolean(debounced) || status !== ALL || priority !== ALL || health !== ALL;

  return (
    <div className="space-y-6">
      <PageHeader
        title="All tickets"
        description="Every ticket in the system, most at-risk first."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, body or reference…"
          className="w-full sm:max-w-xs"
        />

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {titleCase(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p} className="capitalize">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={health} onValueChange={setHealth}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="SLA" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any SLA state</SelectItem>
            <SelectItem value="breached">Breached</SelectItem>
            <SelectItem value="at_risk">Approaching breach</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-xs text-muted-foreground tabular">
          {data ? `${data.total} ticket${data.total === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      <Card className={cn("overflow-hidden shadow-card", isPlaceholderData && "opacity-60 transition-opacity")}>
        {isPending ? (
          <TicketTableSkeleton rows={8} />
        ) : isError ? (
          <ErrorState title="Could not load tickets" error={error as Error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No tickets match those filters"
              description="Try widening the search or clearing a filter."
            />
          ) : (
            <EmptyState icon={Inbox} title="No tickets yet" description="Raised tickets will appear here." />
          )
        ) : (
          <TicketTable tickets={rows} calendar={meta?.calendar} />
        )}
      </Card>
    </div>
  );
}
