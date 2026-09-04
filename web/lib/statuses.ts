/**
 * Presentation metadata for the three things a ticket row has to communicate.
 *
 * They are deliberately given three *different* kinds of encoding, because they
 * are three different kinds of information:
 *
 *   SLA health — a state. Reserved status palette, always with an icon + label.
 *   Priority   — a magnitude. Ordinal single-hue ramp plus a four-step meter
 *                glyph, so severity reads even in greyscale.
 *   Status     — an identity. Neutral chip with a small coloured dot; recessive,
 *                so it does not compete with the SLA signal.
 *
 * Before this split, "urgent" and "breached" were both red and a scan of the
 * table could not tell you which one you were looking at.
 */

import type { Priority, TicketStatus } from "@shared/types.js";

export interface StatusMeta {
  value: TicketStatus;
  label: string;
  /** Identity dot. Carries no severity meaning. */
  dot: string;
  terminal: boolean;
}

export const STATUS_META: Record<TicketStatus, StatusMeta> = {
  open: { value: "open", label: "Open", dot: "bg-prio-3", terminal: false },
  in_progress: { value: "in_progress", label: "In progress", dot: "bg-prio-2", terminal: false },
  waiting_on_customer: {
    value: "waiting_on_customer",
    label: "Waiting on customer",
    dot: "bg-sla-paused",
    terminal: false,
  },
  resolved: { value: "resolved", label: "Resolved", dot: "bg-sla-ok", terminal: true },
  closed: { value: "closed", label: "Closed", dot: "bg-muted-foreground", terminal: true },
  reopened: { value: "reopened", label: "Reopened", dot: "bg-sla-warn", terminal: false },
};

export interface PriorityMeta {
  value: Priority;
  label: string;
  /** Ramp step, 1 (lightest / lowest) to 4. */
  rank: 1 | 2 | 3 | 4;
  fill: string;
  text: string;
}

export const PRIORITY_META: Record<Priority, PriorityMeta> = {
  low: { value: "low", label: "Low", rank: 1, fill: "bg-prio-1", text: "text-prio-4" },
  medium: { value: "medium", label: "Medium", rank: 2, fill: "bg-prio-2", text: "text-prio-4" },
  high: { value: "high", label: "High", rank: 3, fill: "bg-prio-3", text: "text-prio-4" },
  urgent: { value: "urgent", label: "Urgent", rank: 4, fill: "bg-prio-4", text: "text-prio-4" },
};

export type SlaHealth = "met" | "paused" | "breached" | "at_risk" | "ok";

export interface HealthMeta {
  label: string;
  /** Chip background + text + hairline. */
  chip: string;
  /** Solid fill for meters, rings and rails. */
  bar: string;
  /** Text-only variant. */
  text: string;
  /** Stroke colour for SVG arcs. */
  stroke: string;
}

export const SLA_HEALTH_META: Record<SlaHealth, HealthMeta> = {
  breached: {
    label: "Breached",
    chip: "bg-sla-critical-bg text-sla-critical border-sla-critical/25",
    bar: "bg-sla-critical",
    text: "text-sla-critical",
    stroke: "stroke-sla-critical",
  },
  at_risk: {
    label: "At risk",
    chip: "bg-sla-warn-bg text-sla-warn border-sla-warn/30",
    bar: "bg-sla-warn",
    text: "text-sla-warn",
    stroke: "stroke-sla-warn",
  },
  paused: {
    label: "Paused",
    chip: "bg-sla-paused-bg text-sla-paused border-sla-paused/25",
    bar: "bg-sla-paused",
    text: "text-sla-paused",
    stroke: "stroke-sla-paused",
  },
  met: {
    label: "Met",
    chip: "bg-sla-ok-bg text-sla-ok border-sla-ok/25",
    bar: "bg-sla-ok",
    text: "text-sla-ok",
    stroke: "stroke-sla-ok",
  },
  ok: {
    label: "On track",
    chip: "bg-sla-ok-bg text-sla-ok border-sla-ok/25",
    bar: "bg-sla-ok",
    text: "text-sla-ok",
    stroke: "stroke-sla-ok",
  },
};

export function isTerminalStatus(status: TicketStatus): boolean {
  return STATUS_META[status].terminal;
}
