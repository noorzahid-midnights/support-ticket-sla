"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, API_MODE } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/hooks/use-tickets";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, accountsByRole } from "@/lib/demo-accounts";

/**
 * Demo affordance: hop between the seeded accounts without signing out.
 *
 * Offers the whole roster, grouped by role, rather than a hand-picked subset —
 * an agent you cannot view as is an agent whose queue you cannot check, and Chi
 * in particular owns the weekend ticket that proves the roll-forward.
 *
 * Only rendered in mock mode. Against the real API roles come from a signed
 * JWT, where a client-side switcher would be both useless and misleading.
 */
export function RoleSwitcher() {
  const qc = useQueryClient();
  const { data: me } = useMe();

  if (API_MODE !== "mock" || !me) return null;

  return (
    <div className="px-2.5 pb-1 pt-2">
      <p className="pb-1 text-2xs uppercase tracking-wide text-muted-foreground">View as</p>
      <Select
        value={me.email}
        onValueChange={async (email) => {
          await api.auth.login(email, DEMO_PASSWORD);
          // Every cached query belonged to the previous account.
          await qc.resetQueries();
          const account = DEMO_ACCOUNTS.find((a) => a.email === email);
          toast.success(`Now viewing as ${account?.name ?? email}`, {
            description: account ? `${account.role} — ${account.blurb}` : undefined,
          });
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accountsByRole().map((group) => (
            <SelectGroup key={group.role}>
              <SelectLabel className="text-2xs uppercase tracking-wide text-muted-foreground">
                {group.label}
              </SelectLabel>
              {group.accounts.map((account) => (
                <SelectItem key={account.email} value={account.email} className="text-xs">
                  {account.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
