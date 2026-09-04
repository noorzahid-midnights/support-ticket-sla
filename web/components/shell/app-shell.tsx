"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Inbox, LayoutDashboard, Users, type LucideIcon } from "lucide-react";
import { useMe } from "@/hooks/use-tickets";
import { BusinessHoursIndicator } from "@/components/sla/business-hours-indicator";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import { RoleSwitcher } from "./role-switcher";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: ("admin" | "agent" | "customer")[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "agent", "customer"] },
  { href: "/tickets", label: "All tickets", icon: Inbox, roles: ["admin", "agent"] },
  { href: "/admin/breaches", label: "SLA breaches", icon: AlertTriangle, roles: ["admin"] },
  { href: "/admin/agents", label: "Agent workload", icon: Users, roles: ["admin"] },
];

function useIsActive(href: string) {
  const pathname = usePathname();
  // Nullable once a pages/ router is present in the app.
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function NavLink({ item }: { item: NavItem }) {
  const active = useIsActive(item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-card font-medium text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
      )}
    >
      {/* A short accent rail rather than a full highlight: marks the active item
          without turning the whole row into a coloured block. */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      {item.label}
    </Link>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 px-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        {/* A dial with a hand pointing past the mark: the whole product in a glyph. */}
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
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const role = me?.role ?? "customer";
  const items = NAV.filter((item) => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-plane">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-border bg-panel md:flex">
        <div className="flex h-header items-center">
          <Wordmark />
        </div>

        <div className="px-2 pb-2">
          <BusinessHoursIndicator />
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-1">
          {items.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        <div className="space-y-2 border-t border-border p-2">
          <UserMenu />
          <RoleSwitcher />
          <ThemeToggle />
        </div>
      </aside>

      <div className="md:pl-sidebar">
        {/* No drawer on mobile: four destinations fit in a row, and a drawer
            would be more machinery than the navigation needs. */}
        <header className="sticky top-0 z-20 flex h-header items-center gap-2 border-b border-border bg-plane/90 px-3 backdrop-blur md:hidden">
          <Wordmark />
          <nav className="ml-auto flex items-center gap-0.5">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground"
                >
                  <Icon className="size-4" aria-hidden />
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="plane-grid">
          <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-8 md:py-9">{children}</main>
        </div>
      </div>
    </div>
  );
}
