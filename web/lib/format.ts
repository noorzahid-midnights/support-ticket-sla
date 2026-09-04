import { format, formatDistanceToNow, isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { DeadlineState, SlaSnapshot } from "@shared/types.js";
import type { SlaHealth } from "./statuses";

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? d : null;
}

/** "12 Mar 2026" — unambiguous, no 03/04 US-vs-EU trap. */
export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  const d = toDate(iso);
  return d ? format(d, "d MMM yyyy") : fallback;
}

export function formatDateTime(iso: string | null | undefined, fallback = "—"): string {
  const d = toDate(iso);
  return d ? format(d, "d MMM yyyy, HH:mm") : fallback;
}

/** Renders an instant in the SLA calendar's timezone, which is where deadlines live. */
export function formatInCalendarTz(iso: string | null | undefined, timezone: string, fallback = "—"): string {
  const d = toDate(iso);
  return d ? formatInTimeZone(d, timezone, "EEE d MMM, HH:mm") : fallback;
}

export function formatRelative(iso: string | null | undefined, fallback = "—"): string {
  const d = toDate(iso);
  return d ? formatDistanceToNow(d, { addSuffix: true }) : fallback;
}

/**
 * A span of business time as "2d 3h" / "4h 20m" / "12m".
 *
 * Business days are 9 hours, not 24, so a raw day conversion would read "1d"
 * for something due tomorrow lunchtime and mislead an agent about how much
 * working time they actually have.
 */
export function formatBusinessDuration(ms: number, businessDayMs = 9 * 3_600_000): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return "under a minute";

  const days = Math.floor(abs / businessDayMs);
  const hours = Math.floor((abs % businessDayMs) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && !days) parts.push(`${minutes}m`);
  return parts.join(" ") || "0m";
}

/** "3h 20m left" / "overdue by 2h" / "paused". */
export function formatRemaining(deadline: DeadlineState, paused: boolean): string {
  if (deadline.metAt) return deadline.breached ? "missed" : "met";
  if (deadline.remainingMs === null) return "—";
  if (deadline.remainingMs < 0) return `overdue by ${formatBusinessDuration(deadline.remainingMs)}`;
  return `${formatBusinessDuration(deadline.remainingMs)} left${paused ? " (paused)" : ""}`;
}

export function deadlineHealth(deadline: DeadlineState, paused: boolean): SlaHealth {
  if (deadline.breached) return "breached";
  if (deadline.metAt) return "met";
  if (paused) return "paused";
  if (deadline.atRisk) return "at_risk";
  return "ok";
}

/** The single worst thing about a ticket's SLA, for a one-badge summary. */
export function overallHealth(snap: SlaSnapshot): SlaHealth {
  if (snap.firstResponse.breached || snap.resolution.breached) return "breached";
  if (snap.paused) return "paused";
  if (snap.firstResponse.atRisk || snap.resolution.atRisk) return "at_risk";
  if (snap.firstResponse.metAt && snap.resolution.metAt) return "met";
  return "ok";
}

/** Fraction of the window consumed, clamped to 0..1, for a progress bar. */
export function consumedFraction(deadline: DeadlineState, windowMs: number): number {
  if (deadline.remainingMs === null || windowMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - deadline.remainingMs / windowMs));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
