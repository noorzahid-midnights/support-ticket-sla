"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, ShieldCheck, Users } from "lucide-react";
import { ROLES, type Role } from "@shared/types.js";
import { api } from "@/lib/api";
import type { TeamMember } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shell/empty-state";
import { ErrorState } from "@/components/shell/error-state";
import { PageHeader } from "@/components/shell/page-header";
import { useMe } from "@/hooks/use-tickets";
import { queryKeys } from "@/lib/query-keys";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", agent: "Agent", customer: "Customer" };

const ROLE_BLURB: Record<Role, string> = {
  admin: "Every ticket, the breach report, workload and this page",
  agent: "A queue of assigned tickets; receives auto-assignment",
  customer: "Only their own tickets",
};

function RoleChip({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-2xs font-medium",
        role === "admin" && "border-primary/25 bg-primary-subtle text-primary",
        role === "agent" && "border-sla-ok/25 bg-sla-ok-bg text-sla-ok",
        role === "customer" && "border-border bg-secondary text-muted-foreground",
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

export function TeamView() {
  const qc = useQueryClient();
  const { data: me } = useMe();

  const { data, isPending, isError, error, refetch } = useQuery<TeamMember[]>({
    queryKey: queryKeys.admin.users,
    queryFn: () => api.admin.users(),
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.admin.setRole(userId, role),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users });
      qc.invalidateQueries({ queryKey: queryKeys.admin.agents });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workload });
      if (!result.changed) return;

      // A demotion does not reassign anyone's queue, so say what is left behind
      // rather than letting the tickets quietly become invisible to them.
      const orphaned =
        result.previous !== "customer" && result.role === "customer" && (result.openTickets ?? 0) > 0;

      toast.success(`${result.name ?? "User"} is now ${ROLE_LABEL[result.role].toLowerCase()}`, {
        description: orphaned
          ? `They still hold ${result.openTickets} open ticket${result.openTickets === 1 ? "" : "s"}. Reassign those from the ticket page.`
          : result.role === "agent"
            ? "They will start receiving auto-assigned tickets."
            : undefined,
      });
    },
    onError: (e: Error) => toast.error("Could not change the role", { description: e.message }),
  });

  const rows = data ?? [];
  const admins = rows.filter((u) => u.role === "admin").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Who can see what. Staff sign up as customers first, then an admin promotes them here."
      />

      <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Roles are only ever changed here — sign-up always creates a customer, so nobody can grant themselves a
          queue. Promoting someone to <strong className="font-medium text-foreground">Agent</strong> makes them
          eligible for auto-assignment immediately.
        </p>
      </div>

      <Card className="overflow-hidden shadow-card">
        {isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load the team" error={error as Error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="No accounts yet" description="Nobody has signed up." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((user) => {
              const isSelf = user.id === me?.id;
              // The last admin cannot be demoted, or nobody could reach this page.
              const lastAdmin = user.role === "admin" && admins <= 1;
              const locked = isSelf || lastAdmin;

              return (
                <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-2xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
                    {initials(user.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      {isSelf && (
                        <span className="rounded-full bg-secondary px-1.5 py-px text-2xs text-muted-foreground">
                          you
                        </span>
                      )}
                    </div>
                    <p className="truncate text-2xs text-muted-foreground">
                      {user.email}
                      {user.openTickets > 0 && ` · ${user.openTickets} open ticket${user.openTickets === 1 ? "" : "s"}`}
                    </p>
                  </div>

                  <div className="hidden sm:block">
                    <RoleChip role={user.role} />
                  </div>

                  <Select
                    value={user.role}
                    disabled={locked || setRole.isPending}
                    onValueChange={(value) => setRole.mutate({ userId: user.id, role: value as Role })}
                  >
                    <SelectTrigger className="h-8 w-[136px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role} className="text-xs">
                          {ROLE_LABEL[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Say why a control is disabled, rather than leaving it inexplicably grey. */}
      <div className="space-y-2 text-2xs text-muted-foreground">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            You cannot change your own role — demoting yourself is a one-way door, since you would lose this page.
            The only remaining admin cannot be demoted either.
          </span>
        </p>
        <dl className="grid gap-1 pl-5 sm:grid-cols-3">
          {ROLES.map((role) => (
            <div key={role}>
              <dt className="font-medium text-foreground">{ROLE_LABEL[role]}</dt>
              <dd>{ROLE_BLURB[role]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
