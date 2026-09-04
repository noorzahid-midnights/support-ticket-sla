"use client";

import { AlertTriangle, CheckCircle2, Clock, PauseCircle, Timer } from "lucide-react";
import type { BusinessCalendar } from "@shared/business-time.js";
import type { DeadlineState, Priority, SlaSnapshot, TicketStatus } from "@shared/types.js";
import { useSlaClock } from "@/hooks/use-sla-clock";
import { deadlineHealth, formatBusinessDuration, formatInCalendarTz, overallHealth } from "@/lib/format";
import { PRIORITY_META, SLA_HEALTH_META, STATUS_META, type SlaHealth } from "@/lib/statuses";
import { cn } from "@/lib/utils";

const HEALTH_ICON: Record<SlaHealth, typeof AlertTriangle> = {
  breached: AlertTriangle,
  at_risk: Timer,
  paused: PauseCircle,
  met: CheckCircle2,
  ok: CheckCircle2,
};

/** Status is identity, so it gets a neutral chip and a small coloured dot. */
export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/60 px-2 py-0.5 text-2xs font-medium text-secondary-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * Priority as a four-step meter.
 *
 * Severity is a magnitude, so it is drawn as one: filled steps on an ordinal
 * ramp. The count of filled bars carries the meaning even in greyscale, which
 * a colour-only pill never could.
 */
export function PriorityBadge({
  priority,
  className,
  showLabel = true,
}: {
  priority: Priority;
  className?: string;
  showLabel?: boolean;
}) {
  const meta = PRIORITY_META[priority];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={`${meta.label} priority`}
    >
      <span className="flex items-end gap-[2px]" aria-hidden>
        {([1, 2, 3, 4] as const).map((step) => (
          <span
            key={step}
            className={cn(
              "w-[3px] rounded-[1px] transition-colors",
              step === 1 && "h-[5px]",
              step === 2 && "h-[7px]",
              step === 3 && "h-[9px]",
              step === 4 && "h-[11px]",
              step <= meta.rank ? meta.fill : "bg-border",
            )}
          />
        ))}
      </span>
      {showLabel && <span className="text-2xs font-medium text-muted-foreground">{meta.label}</span>}
      <span className="sr-only">{meta.label} priority</span>
    </span>
  );
}

/** One-glance SLA health. Icon plus label, never colour alone. */
export function SlaBadge({ snapshot, className }: { snapshot: SlaSnapshot; className?: string }) {
  const health = overallHealth(snapshot);
  const meta = SLA_HEALTH_META[health];
  const Icon = HEALTH_ICON[health];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-semibold",
        meta.chip,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}

/**
 * A radial gauge for one deadline.
 *
 * An arc rather than a bar because the thing being shown is a clock, and the
 * shape says so before the number is read. The remaining business time sits in
 * the middle as the hero figure.
 */
export function SlaRing({
  label,
  deadline,
  windowMs,
  paused,
  calendar,
}: {
  label: string;
  deadline: DeadlineState;
  windowMs: number;
  paused: boolean;
  calendar: BusinessCalendar | undefined;
}) {
  const live = useSlaClock(deadline, calendar, paused);
  const health = deadlineHealth({ ...deadline, breached: live.breached }, paused);
  const meta = SLA_HEALTH_META[health];
  const Icon = HEALTH_ICON[health];

  const remaining = live.remainingMs;

  /**
   * The arc shows time *remaining*, so a healthy ticket has a full ring that
   * drains as the clock runs. Showing consumed time instead would mean a
   * brand-new urgent ticket rendered as an almost-empty ring, which reads as
   * "nothing here" at exactly the moment it most needs attention.
   *
   * The two settled states fill the ring completely: green for an obligation
   * discharged, red for one missed. A drained ring would otherwise vanish
   * precisely when the ticket is most in trouble.
   */
  const settled = Boolean(deadline.metAt) || (remaining !== null && remaining < 0);
  const fraction = settled
    ? 1
    : remaining === null || windowMs <= 0
      ? 0
      : Math.min(1, Math.max(0, remaining / windowMs));

  const R = 34;
  const CIRC = 2 * Math.PI * R;
  // Three-quarter arc, opened at the bottom so the gap reads as a dial.
  const ARC = 0.75;
  const dash = CIRC * ARC;

  const figure = deadline.metAt
    ? deadline.breached
      ? formatBusinessDuration(deadline.remainingMs ?? 0)
      : "Met"
    : remaining === null
      ? "—"
      : formatBusinessDuration(remaining);

  const caption = deadline.metAt
    ? deadline.breached
      ? "over deadline"
      : "within SLA"
    : remaining !== null && remaining < 0
      ? "overdue"
      : "business time left";

  return (
    <div className="flex items-center gap-3.5">
      <div className="relative shrink-0">
        <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-[225deg]" aria-hidden>
          <circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className="stroke-muted"
            strokeDasharray={`${dash} ${CIRC}`}
          />
          <circle
            cx="42"
            cy="42"
            r={R}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            className={cn(meta.stroke, "transition-[stroke-dasharray] duration-500")}
            strokeDasharray={`${dash * fraction} ${CIRC}`}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center">
          <Icon className={cn("size-4", meta.text)} aria-hidden />
        </span>
      </div>

      <div className="min-w-0">
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("mt-0.5 text-xl font-semibold leading-none", meta.text)}>{figure}</p>
        <p className="mt-1 text-2xs text-muted-foreground">{caption}</p>

        {/* Say why the number is not moving; a frozen counter otherwise reads as a bug. */}
        {paused ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-sla-paused">
            <PauseCircle className="size-3" aria-hidden />
            paused — waiting on customer
          </p>
        ) : deadline.metAt ? null : !live.ticking && live.resumesAt && calendar ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-muted-foreground">
            <Clock className="size-3" aria-hidden />
            outside hours — resumes {formatInCalendarTz(live.resumesAt.toISOString(), calendar.timezone)}
          </p>
        ) : remaining !== null && remaining < 0 ? (
          // Past the deadline the clock is counting *up*, so saying "counting
          // down" beside a red overdue figure would contradict itself.
          <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-sla-critical">
            <span className="size-1.5 rounded-full bg-sla-critical pulse-dot" aria-hidden />
            overrunning
          </p>
        ) : (
          <p className="mt-1.5 inline-flex items-center gap-1 text-2xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-sla-ok pulse-dot" aria-hidden />
            counting down
          </p>
        )}

        <p className="mt-1 text-2xs text-muted-foreground/80">
          Due {calendar ? formatInCalendarTz(deadline.dueAt, calendar.timezone) : "—"}
        </p>
      </div>
    </div>
  );
}
