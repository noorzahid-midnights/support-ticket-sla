"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-tickets";
import { initials } from "@/lib/format";

export function UserMenu() {
  const { data: me, isPending } = useMe();
  const router = useRouter();
  const qc = useQueryClient();

  const signOut = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      // Clear the cache before navigating, so nothing of the previous session
      // is left for the next person to sign in on this browser.
      qc.clear();
      router.replace("/login");
    },
    onError: (error: Error) => toast.error("Could not sign out", { description: error.message }),
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="flex items-center gap-1 rounded-lg px-1.5 py-2">
      {/* The identity block is the way to the account page — a separate nav
          item for one screen you visit twice a year would only crowd the list. */}
      <Link
        href="/profile"
        title="Your account"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-card"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-2xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
          {initials(me.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{me.name}</span>
          <span className="block truncate text-2xs capitalize text-muted-foreground">{me.role}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50"
      >
        <LogOut className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
