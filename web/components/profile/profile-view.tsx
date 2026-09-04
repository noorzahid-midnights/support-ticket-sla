"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { ApiError, type UserRef } from "@shared/types.js";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/page-header";
import { useMe } from "@/hooks/use-tickets";
import { queryKeys } from "@/lib/query-keys";
import { initials } from "@/lib/format";

const ROLE_BLURB: Record<UserRef["role"], string> = {
  admin: "You can see every ticket, the breach report, workload and the team.",
  agent: "You work a queue of assigned tickets and receive auto-assignment.",
  customer: "You can raise tickets and follow your own.",
};

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 shadow-card sm:p-6">
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-sla-critical/25 bg-sla-critical-bg px-3 py-2 text-xs text-sla-critical"
    >
      {message(error)}
    </p>
  );
}

/**
 * Your own account: name, email and password.
 *
 * Role is shown but not editable. Roles are only ever changed by an admin on
 * the Team page, so putting the control here would be the one place a person
 * could promote themselves.
 */
export function ProfileView() {
  const qc = useQueryClient();
  const { data: me, isPending } = useMe();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatch, setMismatch] = useState(false);

  // Seed the fields once the account arrives, and re-seed if it changes under
  // us (signing in as someone else without a full reload).
  //
  // Depending on the object rather than its fields is safe here: react-query's
  // structural sharing keeps the reference stable when a refetch returns the
  // same values, so a background refetch cannot wipe a half-typed edit.
  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setEmail(me.email);
  }, [me]);

  const details = useMutation({
    mutationFn: (input: { name: string; email: string }) => api.auth.updateMe(input),
    onSuccess: (user) => {
      qc.setQueryData(queryKeys.me, user);
      qc.invalidateQueries({ queryKey: queryKeys.admin.users });
      toast.success("Profile updated");
    },
  });

  const password = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => api.auth.updateMe(input),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed", { description: "Use the new one the next time you sign in." });
    },
  });

  if (isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!me) return null;

  const detailsChanged = name.trim() !== me.name || email.trim().toLowerCase() !== me.email.toLowerCase();

  function submitDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!detailsChanged || name.trim().length < 2 || !email.trim()) return;
    details.mutate({ name: name.trim(), email: email.trim() });
  }

  function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    // Checked here as well as on the server: a typo in the confirmation is a
    // slip, not a failed request worth a round trip.
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    password.mutate({ currentPassword, newPassword });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Your account" description="Change your name, email address or password." />

      <Card className="flex flex-wrap items-center gap-4 p-5 shadow-card sm:p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary ring-1 ring-inset ring-primary/20">
          {initials(me.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold tracking-tight">{me.name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email}</p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-2xs leading-relaxed text-muted-foreground">
            <strong className="font-medium capitalize text-foreground">{me.role}</strong> — {ROLE_BLURB[me.role]}
            <br />
            Only an admin can change a role, on the Team page.
          </span>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          icon={UserRound}
          title="Details"
          description="Your name is what colleagues and customers see on every ticket you touch."
        >
          <form onSubmit={submitDetails} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(details.error)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(details.error)}
              />
              <p className="text-2xs text-muted-foreground">This is also what you sign in with.</p>
            </div>

            <FormError error={details.error} />

            <Button
              type="submit"
              disabled={details.isPending || !detailsChanged || name.trim().length < 2 || !email.trim()}
            >
              {details.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </Section>

        <Section
          icon={KeyRound}
          title="Password"
          description="Your current password is required, so an unattended signed-in browser cannot lock you out of your own account."
        >
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                aria-invalid={Boolean(password.error)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={Boolean(password.error)}
              />
              <p className="text-2xs text-muted-foreground">At least 8 characters.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setMismatch(false);
                }}
                aria-invalid={mismatch}
              />
            </div>

            {mismatch ? (
              <p
                role="alert"
                className="rounded-lg border border-sla-critical/25 bg-sla-critical-bg px-3 py-2 text-xs text-sla-critical"
              >
                The two new passwords do not match.
              </p>
            ) : (
              <FormError error={password.error} />
            )}

            <Button
              type="submit"
              disabled={password.isPending || !currentPassword || newPassword.length < 8 || !confirmPassword}
            >
              {password.isPending ? "Changing…" : "Change password"}
            </Button>
          </form>
        </Section>
      </div>
    </div>
  );
}
