"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export const THEME_KEY = "helpdesk.theme";

/**
 * Three-state theme control.
 *
 * "System" is a real option rather than an implicit default: it stamps nothing
 * on the root element and lets `prefers-color-scheme` decide, while light and
 * dark stamp `data-theme`, which the CSS gives precedence over the media query
 * in both directions.
 *
 * The stored preference is written *only* in the click handler. Writing it from
 * an effect instead looks equivalent and is not: on mount the effect would run
 * once with the default "system" and overwrite whatever the user had chosen
 * before the value read back from storage had a chance to land.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // Starts as "system" to match what the server rendered; the real value is
  // adopted after hydration, and the inline script in the layout has already
  // painted the correct colours by then.
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
    } catch {
      // Storage unavailable: the control still works for this session.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice just does not survive a reload.
    }
  }

  return (
    <div
      className={cn("flex items-center gap-0.5 rounded-lg border bg-secondary/40 p-0.5", className)}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            onClick={() => choose(option.value)}
            className={cn(
              "grid h-6 flex-1 place-items-center rounded-md transition-colors",
              active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
