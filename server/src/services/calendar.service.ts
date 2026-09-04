/**
 * Loads the business-hours calendar and the SLA policies out of Mongo and into
 * the plain shapes the pure engine expects.
 *
 * Both are cached: the sweep runs every minute over every live ticket and each
 * deadline calculation needs the calendar, so re-reading two small collections
 * thousands of times an hour would be a self-inflicted wound. The cache is
 * short-lived rather than permanent so an admin editing business hours sees
 * the effect without a restart.
 */

import { validateCalendar, type BusinessCalendar } from "@shared/business-time.js";
import { DEFAULT_SLA_POLICIES, type Priority, type SlaPolicy } from "@shared/types.js";
import { BusinessHours, Holiday, SlaPolicy as SlaPolicyModel } from "../models/index.js";
import { env } from "../env.js";

const CACHE_TTL_MS = 60_000;

let calendarCache: { value: BusinessCalendar; expires: number } | null = null;
let policyCache: { value: Map<Priority, SlaPolicy>; expires: number } | null = null;

/** Drops both caches. Called after any admin write that changes SLA behaviour. */
export function invalidateSlaConfigCache(): void {
  calendarCache = null;
  policyCache = null;
}

export async function getCalendar(): Promise<BusinessCalendar> {
  if (calendarCache && calendarCache.expires > Date.now()) return calendarCache.value;

  const [rows, holidays] = await Promise.all([
    BusinessHours.find({ active: true }).lean(),
    Holiday.find().lean(),
  ]);

  const days: Record<number, { start: string; end: string } | null> = {
    0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null,
  };
  for (const row of rows) {
    days[row.dayOfWeek] = { start: row.startTime, end: row.endTime };
  }

  const calendar: BusinessCalendar = {
    timezone: env.SLA_TIMEZONE,
    days,
    holidays: holidays.map((h) => h.date),
  };

  // Validate here, once per cache fill, so a bad calendar surfaces as a clear
  // startup/admin error rather than as silently wrong deadlines.
  validateCalendar(calendar);

  calendarCache = { value: calendar, expires: Date.now() + CACHE_TTL_MS };
  return calendar;
}

export async function getPolicies(): Promise<Map<Priority, SlaPolicy>> {
  if (policyCache && policyCache.expires > Date.now()) return policyCache.value;

  const rows = await SlaPolicyModel.find().lean();
  const map = new Map<Priority, SlaPolicy>();
  for (const row of rows) {
    map.set(row.priority as Priority, {
      priority: row.priority as Priority,
      firstResponseMinutes: row.firstResponseMinutes,
      resolutionMinutes: row.resolutionMinutes,
    });
  }

  // A missing policy would otherwise mean a ticket with no deadline at all,
  // which is worse than a defaulted one — it would vanish from every breach
  // report rather than showing up wrong.
  for (const fallback of DEFAULT_SLA_POLICIES) {
    if (!map.has(fallback.priority)) map.set(fallback.priority, fallback);
  }

  policyCache = { value: map, expires: Date.now() + CACHE_TTL_MS };
  return map;
}

export async function getPolicy(priority: Priority): Promise<SlaPolicy> {
  return (await getPolicies()).get(priority)!;
}
