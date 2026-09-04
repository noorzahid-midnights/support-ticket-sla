/**
 * Auto-routing: what priority a new ticket gets, and whose desk it lands on.
 *
 * Both rules live in data rather than code — the keyword list is a Mongo
 * collection an admin can edit, which is what the brief asks for and what
 * stops "add "outage" to the urgent list" from being a redeploy.
 */

import { PRIORITIES, type Priority, type RoutingRule as RoutingRuleDto } from "@shared/types.js";
import { RoutingRule, Ticket, User } from "../models/index.js";

export interface RoutingMatch {
  priority: Priority;
  rule: RoutingRuleDto;
  matched: string[];
}

/** Escapes a keyword for use inside a word-boundary regex. */
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Word boundaries stop "down" firing on "download" and "won" on "wonderful".
  // Multi-word keywords ("can't login") still work: \b anchors the ends only.
  return new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i");
}

/**
 * Picks a priority from the keyword rules.
 *
 * Every active rule that matches contributes its weight; the highest weight
 * wins, and equal weights break towards the more severe priority. Erring
 * upward is the safer default: a medium ticket wrongly treated as high costs
 * an agent some attention, whereas an urgent one wrongly treated as medium
 * costs a breach.
 *
 * Returns null when nothing matches, so the caller can apply its own default
 * and record that the priority was *not* auto-assigned.
 */
export function selectPriority(rules: RoutingRuleDto[], subject: string, body: string): RoutingMatch | null {
  let best: RoutingMatch | null = null;
  let bestWeight = -Infinity;

  for (const rule of rules) {
    if (!rule.active) continue;

    const haystack = rule.field === "subject" ? subject : rule.field === "body" ? body : `${subject}\n${body}`;
    const matched = rule.keywords.filter((k) => keywordPattern(k).test(haystack));
    if (matched.length === 0) continue;

    const severity = PRIORITIES.indexOf(rule.priority);
    const bestSeverity = best ? PRIORITIES.indexOf(best.priority) : -1;

    if (rule.weight > bestWeight || (rule.weight === bestWeight && severity > bestSeverity)) {
      bestWeight = rule.weight;
      best = { priority: rule.priority, rule, matched };
    }
  }

  return best;
}

/** Database-backed wrapper. The decision itself lives in `selectPriority`. */
export async function routePriority(subject: string, body: string): Promise<RoutingMatch | null> {
  const rules = await RoutingRule.find({ active: true }).lean();
  if (rules.length === 0) return null;

  return selectPriority(
    rules.map((r) => ({
      id: String(r._id),
      name: r.name,
      keywords: r.keywords,
      field: r.field as RoutingRuleDto["field"],
      priority: r.priority as Priority,
      weight: r.weight,
      active: r.active,
    })),
    subject,
    body,
  );
}

export interface AgentPick {
  _id: unknown;
  name: string;
  openCount: number;
}

/**
 * Chooses the agent for a new ticket: **least loaded**, by count of
 * non-terminal assigned tickets.
 *
 * The brief asks for a documented reason to prefer this over round-robin.
 * Round-robin assumes tickets are interchangeable units of work, and they are
 * not — an agent who happens to draw three urgent incidents in a row keeps
 * being handed more while a colleague sitting on two already-closed tickets
 * gets nothing. Least-loaded targets present workload directly, which is the
 * thing that actually determines whether an SLA gets met.
 *
 * It also costs nothing extra: this is the same aggregation the admin workload
 * view already needs, so there is no second source of truth to keep in step.
 *
 * Ties break towards the agent who was assigned least recently, which recovers
 * round-robin's one genuine virtue — fair rotation — in the case where load is
 * genuinely equal.
 */
export async function pickAgent(): Promise<AgentPick | null> {
  const agents = await User.find({ role: "agent" }).sort({ _id: 1 }).lean();
  if (agents.length === 0) return null;

  const counts = await Ticket.aggregate<{ _id: unknown; count: number; lastAssigned: Date }>([
    { $match: { status: { $nin: ["resolved", "closed"] }, assignedAgent: { $ne: null } } },
    { $group: { _id: "$assignedAgent", count: { $sum: 1 }, lastAssigned: { $max: "$updatedAt" } } },
  ]);

  const byId = new Map(counts.map((c) => [String(c._id), c]));

  let best: AgentPick | null = null;
  let bestCount = Infinity;
  let bestLast = Infinity;

  for (const agent of agents) {
    const stat = byId.get(String(agent._id));
    const count = stat?.count ?? 0;
    const last = stat?.lastAssigned ? new Date(stat.lastAssigned).getTime() : 0;

    if (count < bestCount || (count === bestCount && last < bestLast)) {
      bestCount = count;
      bestLast = last;
      best = { _id: agent._id, name: agent.name, openCount: count };
    }
  }

  return best;
}
