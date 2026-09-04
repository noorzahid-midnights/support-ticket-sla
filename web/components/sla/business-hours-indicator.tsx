"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { isOpenAt, nextOpenMoment } from "@shared/business-time.js";
import { useCalendar } from "@/hooks/use-tickets";
import { formatInCalendarTz } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Live "are we open?" indicator.
 *
 * The premise of this whole app is that SLA clocks only run during business
 * hours, and that is invisible until something makes it visible. Showing the
 * office state in the chrome means an agent looking at a frozen countdown at
 * 19:00 has the explanation already on screen.
 */
export function BusinessHoursIndicator({ className }: { className?: string }) {
  const { data: meta } = useCalendar();
  const [now, setNow] = useState<Date | null>(null);

  // Set on mount rather than at render, so the server and the first client
  // paint agree and React does not report a hydration mismatch.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!meta || !now) {
    return <div className={cn("h-[38px] rounded-lg border border-dashed border-border/60", className)} />;
  }

  const open = isOpenAt(now, meta.calendar);

  // Day-of-week has to be read in the calendar's timezone, not the browser's:
  // at 23:00 in Karachi a European viewer is still on the previous day, and
  // would be shown the wrong closing time.
  const dateKey = formatInTimeZone(now, meta.calendar.timezone, "yyyy-MM-dd");
  const day = meta.calendar.days[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        open ? "border-sla-ok/25 bg-sla-ok-bg" : "border-border bg-secondary/50",
        className,
      )}
    >
      {open ? (
        <span className="relative grid size-4 shrink-0 place-items-center" aria-hidden>
          <span className="absolute size-2 rounded-full bg-sla-ok pulse-dot" />
        </span>
      ) : (
        <Moon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <div className="min-w-0 leading-tight">
        <p className={cn("text-2xs font-semibold", open ? "text-sla-ok" : "text-foreground")}>
          {open ? "SLA clocks running" : "Outside business hours"}
        </p>
        <p className="truncate text-2xs text-muted-foreground">
          {open ? (
            <>
              <Sun className="mr-0.5 inline size-2.5 align-[-1px]" aria-hidden />
              closes {day?.end ?? "18:00"} · {meta.calendar.timezone}
            </>
          ) : (
            <>resumes {formatInCalendarTz(nextOpenMoment(now, meta.calendar).toISOString(), meta.calendar.timezone)}</>
          )}
        </p>
      </div>
    </div>
  );
}
