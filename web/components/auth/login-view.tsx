"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, PauseCircle, ShieldCheck } from "lucide-react";
import { ApiError } from "@shared/types.js";
import { api, API_MODE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HeroDial } from "@/components/sla/hero-dial";
import { cn } from "@/lib/utils";
import { DEMO_PASSWORD, accountsByRole } from "@/lib/demo-accounts";

function Highlight({ icon: Icon, title, body }: { icon: typeof Clock3; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

/**
 * The seeded roster, one click each.
 *
 * Rendered only in mock mode: printing a working password on the login page of
 * a real deployment is a hole rather than a convenience, and on a real
 * deployment these accounts should be deleted at handover anyway.
 */
function DemoAccounts({ onPick, disabled }: { onPick: (email: string) => void; disabled: boolean }) {
  return (
    <div className="mt-8">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span className="text-2xs uppercase tracking-wide text-muted-foreground">Demo accounts</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>

      {/* The whole seeded roster, grouped by role. Offering a subset was
          how the login screen and the sidebar switcher drifted out of
          step in the first place. */}
      <div className="mt-4 space-y-4">
        {accountsByRole().map((group) => (
          <div key={group.role}>
            <p className="pb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-1.5">
              {group.accounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    onClick={() => onPick(account.email)}
                    disabled={disabled}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors",
                      "hover:border-primary/30 hover:bg-primary-subtle/40 disabled:opacity-60",
                    )}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-2xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
                      {account.name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-tight">{account.name}</span>
                      <span className="block truncate text-2xs leading-tight text-muted-foreground">
                        {account.blurb}
                      </span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-4 text-2xs text-muted-foreground">
        Every seeded account uses the password{" "}
        <code className="rounded bg-secondary px-1 py-0.5 font-mono">{DEMO_PASSWORD}</code>.
      </p>
    </div>
  );
}

export function LoginView() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Where the guard bounced them from, so a deep link survives signing in.
  // `useSearchParams` is nullable once a pages/ router is present in the app.
  const next = params?.get("next") ?? null;

  // Both endpoints set the auth cookie on success, so registering signs you in.
  const goTo = async () => {
    // Drop every cached query: the previous occupant's data must not be
    // visible for even a frame after a different user signs in.
    await qc.resetQueries();
    router.replace(next && next.startsWith("/") ? next : "/dashboard");
  };

  const signIn = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.auth.login(input.email, input.password),
    onSuccess: goTo,
  });

  const signUp = useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) => api.auth.register(input),
    onSuccess: goTo,
  });

  const active = mode === "signin" ? signIn : signUp;
  const error = active.error instanceof ApiError ? active.error.message : active.error?.message;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;

    if (mode === "signin") {
      signIn.mutate({ email: email.trim(), password });
    } else {
      if (name.trim().length < 2 || password.length < 8) return;
      signUp.mutate({ name: name.trim(), email: email.trim(), password });
    }
  }

  function switchMode(to: "signin" | "signup") {
    setMode(to);
    // Clear the previous mode's error, so a failed sign-in does not sit under
    // the sign-up form complaining about credentials.
    signIn.reset();
    signUp.reset();
  }

  function signInAs(accountEmail: string) {
    setMode("signin");
    setEmail(accountEmail);
    setPassword(DEMO_PASSWORD);
    signIn.mutate({ email: accountEmail, password: DEMO_PASSWORD });
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Left: the pitch, on the sage band. Hidden on small screens, where the
          form is the only thing worth the space. */}
      <section className="hero-band relative hidden flex-col justify-between overflow-hidden border-r border-panel-border p-10 lg:flex">
        <HeroDial className="pointer-events-none absolute -right-24 top-16 size-[460px] opacity-40" />

        <div className="relative flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="42 14" />
              <path d="M12 7v5.5l3.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Helpdesk</p>
            <p className="text-2xs text-muted-foreground">SLA engine</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-[1.08] text-foreground xl:text-5xl">
            Deadlines that
            <br />
            count the hours
            <br />
            you actually work
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A four-hour SLA on a ticket filed at 17:00 Friday is not due at 21:00 Friday. It is due at noon on Monday.
          </p>
        </div>

        <ul className="relative space-y-4">
          <Highlight
            icon={Clock3}
            title="Business hours only"
            body="Nights, weekends and holidays never count against the clock."
          />
          <Highlight
            icon={PauseCircle}
            title="Pauses on the customer"
            body="Waiting on a reply freezes the timer, and resuming credits back only the business time spent waiting."
          />
          <Highlight
            icon={ShieldCheck}
            title="Escalates on breach"
            body="A background sweep raises priority one level and notifies an admin — once per breach, never twice."
          />
        </ul>
      </section>

      {/* Right: the form. */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {API_MODE === "mock"
              ? "Running on local fixtures. Pick a demo account below, or type the credentials."
              : "Use your helpdesk account."}
          </p>

          {/* One form, two modes. A separate route would duplicate the layout
              and lose whatever the person had already typed. */}
          <div className="mt-6 flex rounded-lg border border-border bg-secondary/40 p-0.5" role="tablist">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                  mode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dana Whitfield"
                  aria-invalid={Boolean(error)}
                  autoFocus
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-invalid={Boolean(error)}
                autoFocus={mode === "signin"}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                aria-invalid={Boolean(error)}
              />
              {mode === "signup" && (
                <p className="text-2xs text-muted-foreground">At least 8 characters.</p>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-sla-critical/25 bg-sla-critical-bg px-3 py-2 text-xs text-sla-critical">
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={
                active.isPending ||
                !email.trim() ||
                !password ||
                (mode === "signup" && (name.trim().length < 2 || password.length < 8))
              }
            >
              {active.isPending
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
              {!active.isPending && <ArrowRight className="size-4" aria-hidden />}
            </Button>

            {mode === "signup" && (
              <p className="text-2xs leading-relaxed text-muted-foreground">
                New accounts are customers, so you can raise tickets and track your own. Agent and admin access is
                granted by an administrator.
              </p>
            )}
          </form>

          {API_MODE === "mock" && (
            <DemoAccounts onPick={signInAs} disabled={signIn.isPending} />
          )}
        </div>
      </section>
    </main>
  );
}
