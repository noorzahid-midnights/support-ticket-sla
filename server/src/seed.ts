/**
 * Demo fixtures.
 *
 * Every ticket here exists to make one Definition-of-Done item visible at a
 * glance, and every timestamp is derived from `now` by walking the business
 * calendar — never hardcoded. Seed it on a Tuesday or a Friday and the
 * breached ticket is still breached, the at-risk one is still amber, and the
 * weekend ticket still proves the roll-forward.
 */

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { HOUR_MS, MINUTE_MS, addBusinessMs, subtractBusinessMs, type BusinessCalendar } from "@shared/business-time.js";
import { startClock } from "@shared/sla.js";
import { DEFAULT_SLA_POLICIES, type Priority, type TicketStatus } from "@shared/types.js";
import { connectDb, disconnectDb } from "./db.js";
import { env } from "./env.js";
import {
  BusinessHours,
  Counter,
  Holiday,
  RoutingRule,
  SlaPolicy,
  Ticket,
  TicketEvent,
  User,
} from "./models/index.js";
import { getCalendar, getPolicies, invalidateSlaConfigCache } from "./services/calendar.service.js";
import { createTicket } from "./services/ticket.service.js";

const PASSWORD = "password123";
const hours = (n: number) => n * HOUR_MS;

async function wipe() {
  await Promise.all([
    User.deleteMany({}),
    Ticket.deleteMany({}),
    TicketEvent.deleteMany({}),
    SlaPolicy.deleteMany({}),
    BusinessHours.deleteMany({}),
    Holiday.deleteMany({}),
    RoutingRule.deleteMany({}),
    Counter.deleteMany({}),
  ]);
}

async function seedConfig() {
  await SlaPolicy.insertMany(DEFAULT_SLA_POLICIES);

  // Mon-Fri 09:00-18:00. Saturday and Sunday are simply absent, which the
  // calendar loader reads as closed.
  await BusinessHours.insertMany(
    [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "18:00", active: true })),
  );

  await RoutingRule.insertMany([
    {
      name: "Outage or total loss of service",
      keywords: ["down", "outage", "offline", "not working at all", "data loss"],
      field: "both",
      priority: "urgent",
      weight: 100,
      active: true,
    },
    {
      name: "Cannot authenticate",
      keywords: ["can't login", "cannot login", "cant login", "locked out", "password reset"],
      field: "both",
      priority: "urgent",
      weight: 90,
      active: true,
    },
    {
      name: "Customer says it is urgent",
      keywords: ["urgent", "asap", "emergency", "critical"],
      field: "both",
      priority: "high",
      weight: 60,
      active: true,
    },
    {
      name: "Billing and invoices",
      keywords: ["invoice", "billing", "charged twice", "refund"],
      field: "both",
      priority: "high",
      weight: 50,
      active: true,
    },
    {
      name: "Question or how-to",
      keywords: ["how do i", "how to", "question", "documentation"],
      field: "both",
      priority: "low",
      weight: 20,
      active: true,
    },
  ]);

  invalidateSlaConfigCache();
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (name: string, email: string, role: string) => ({ name, email, passwordHash, role });

  const [admin, ana, ben, chi, dana, eli, fay] = await User.insertMany([
    mk("Admin Ahmed", "admin@helpdesk.test", "admin"),
    mk("Ana Rivera", "ana@helpdesk.test", "agent"),
    mk("Ben Okafor", "ben@helpdesk.test", "agent"),
    mk("Chi Nakamura", "chi@helpdesk.test", "agent"),
    mk("Dana Whitfield", "dana@customer.test", "customer"),
    mk("Eli Barros", "eli@customer.test", "customer"),
    mk("Fay Osei", "fay@customer.test", "customer"),
  ]);

  return { admin: admin!, ana: ana!, ben: ben!, chi: chi!, dana: dana!, eli: eli!, fay: fay! };
}

interface TicketSpec {
  subject: string;
  body: string;
  priority: Priority;
  status: TicketStatus;
  customer: mongoose.Types.ObjectId;
  agent: mongoose.Types.ObjectId | null;
  /** How long ago the ticket was filed, in business time. */
  agoBusinessMs?: number;
  /** Or an explicit wall-clock instant, for the weekend case. */
  createdAt?: Date;
  /** Business ms after creation that the first agent reply landed. */
  firstResponseAfterMs?: number;
  resolvedAfterMs?: number;
  /** Business ms ago the ticket entered waiting_on_customer. */
  pausedAgoBusinessMs?: number;
  note: string;
}

async function insertTicket(spec: TicketSpec, cal: BusinessCalendar, now: Date, seq: number) {
  const policy = DEFAULT_SLA_POLICIES.find((p) => p.priority === spec.priority)!;
  const createdAt = spec.createdAt ?? subtractBusinessMs(now, spec.agoBusinessMs ?? 0, cal);
  const clock = startClock(createdAt, policy, cal);

  const firstResponseAt =
    spec.firstResponseAfterMs === undefined ? null : addBusinessMs(createdAt, spec.firstResponseAfterMs, cal);
  const resolvedAt = spec.resolvedAfterMs === undefined ? null : addBusinessMs(createdAt, spec.resolvedAfterMs, cal);
  const pausedAt = spec.pausedAgoBusinessMs === undefined ? null : subtractBusinessMs(now, spec.pausedAgoBusinessMs, cal);

  const doc = await Ticket.create({
    reference: `TK-${1000 + seq}`,
    subject: spec.subject,
    body: spec.body,
    status: spec.status,
    priority: spec.priority,
    customer: spec.customer,
    assignedAgent: spec.agent,
    firstResponseAt,
    resolvedAt,
    closedAt: spec.status === "closed" ? resolvedAt : null,
    priorityAutoAssigned: false,
    sla: { ...clock, pausedAt, pausedBusinessMs: 0 },
  });

  // Mongoose stamps createdAt itself, so backdating has to go through the raw
  // driver. Without this every fixture would be "created just now" and the
  // breached ticket would not be breached.
  await Ticket.collection.updateOne(
    { _id: doc._id },
    { $set: { createdAt, updatedAt: pausedAt ?? resolvedAt ?? firstResponseAt ?? createdAt } },
  );

  await TicketEvent.create({ ticket: doc._id, type: "created", actor: spec.customer, createdAt });
  if (spec.agent) {
    await TicketEvent.create({
      ticket: doc._id,
      type: "reassignment",
      actor: null,
      field: "assignedAgent",
      newValue: "auto",
      body: "Auto-assigned: least loaded agent",
      createdAt,
    });
  }
  if (firstResponseAt) {
    await TicketEvent.create({
      ticket: doc._id,
      type: "reply",
      actor: spec.agent,
      body: "Thanks for reporting this, taking a look now.",
      createdAt: firstResponseAt,
    });
  }
  if (pausedAt) {
    await TicketEvent.create({
      ticket: doc._id,
      type: "status_change",
      actor: spec.agent,
      field: "status",
      oldValue: "in_progress",
      newValue: "waiting_on_customer",
      createdAt: pausedAt,
    });
  }
  if (resolvedAt) {
    await TicketEvent.create({
      ticket: doc._id,
      type: "status_change",
      actor: spec.agent,
      field: "status",
      oldValue: "in_progress",
      newValue: "resolved",
      createdAt: resolvedAt,
    });
  }

  return doc;
}

/** The most recent Saturday 02:00 in the SLA timezone: a genuinely closed instant. */
function lastWeekendInstant(now: Date): Date {
  for (let back = 1; back <= 8; back += 1) {
    const candidate = new Date(now.getTime() - back * 24 * HOUR_MS);
    const key = formatInTimeZone(candidate, env.SLA_TIMEZONE, "yyyy-MM-dd");
    if (new Date(`${key}T00:00:00Z`).getUTCDay() === 6) {
      return fromZonedTime(`${key}T02:00:00`, env.SLA_TIMEZONE);
    }
  }
  return new Date(now.getTime() - 3 * 24 * HOUR_MS);
}

async function seedTickets(users: Awaited<ReturnType<typeof seedUsers>>) {
  const cal = await getCalendar();
  const now = new Date();
  const { ana, ben, chi, dana, eli, fay } = users;

  const specs: TicketSpec[] = [
    {
      subject: "Checkout page returns a 500 for every customer",
      body: "Nobody can complete an order. This started about an hour ago and is affecting all users.",
      priority: "high",
      status: "open",
      customer: dana._id,
      agent: ana._id,
      agoBusinessMs: hours(24),
      note: "Breached: no first response in 24 business hours on a 2h/8h SLA. The sweep escalates high to urgent.",
    },
    {
      subject: "Production database is unreachable",
      body: "Connections time out from every region. We are completely down.",
      priority: "urgent",
      status: "in_progress",
      customer: eli._id,
      agent: ana._id,
      agoBusinessMs: hours(20),
      firstResponseAfterMs: 30 * MINUTE_MS,
      note: "Breached resolution while already urgent: flagged for an admin, not escalated further.",
    },
    {
      subject: "Invoice #4471 charged twice",
      body: "We were billed twice for the same seat this month and need one of the charges reversed.",
      priority: "high",
      status: "in_progress",
      customer: fay._id,
      agent: ben._id,
      agoBusinessMs: hours(7),
      firstResponseAfterMs: 25 * MINUTE_MS,
      note: "At risk: 1 business hour left of an 8h resolution window, inside the 25% warning threshold.",
    },
    {
      subject: "Export to CSV drops the last column",
      body: "The exported file is missing the final column. Which column varies by report.",
      priority: "medium",
      status: "waiting_on_customer",
      customer: dana._id,
      agent: ben._id,
      agoBusinessMs: hours(21),
      firstResponseAfterMs: 40 * MINUTE_MS,
      pausedAgoBusinessMs: hours(20),
      note: "Paused: clock frozen for 20 business hours while waiting on the customer, so it has not breached.",
    },
    {
      subject: "Filed over the weekend: password reset email never arrives",
      body: "I requested a reset on Saturday morning and nothing came through.",
      priority: "medium",
      status: "open",
      customer: eli._id,
      agent: chi._id,
      createdAt: lastWeekendInstant(now),
      note: "Filed at 02:00 on a Saturday: the clock starts Monday 09:00, so its deadline is a business-hours instant.",
    },
    {
      subject: "How do I add a second workspace?",
      body: "Looking for the documentation on multi-workspace setup.",
      priority: "low",
      status: "resolved",
      customer: fay._id,
      agent: chi._id,
      agoBusinessMs: hours(6),
      firstResponseAfterMs: 20 * MINUTE_MS,
      resolvedAfterMs: hours(2),
      note: "The happy path: first response and resolution both comfortably inside SLA.",
    },
    {
      subject: "Search returns stale results after an edit",
      body: "Edits take a few minutes to show up in search. Reopening because it happened again.",
      priority: "medium",
      status: "reopened",
      customer: dana._id,
      agent: ana._id,
      agoBusinessMs: hours(30),
      firstResponseAfterMs: 45 * MINUTE_MS,
      note: "Reopened: the resolution clock is re-armed from the reopen, not resurrected from before.",
    },
    {
      subject: "Dark mode toggle resets on reload",
      body: "The preference does not persist between sessions.",
      priority: "low",
      status: "open",
      customer: eli._id,
      agent: ana._id,
      agoBusinessMs: hours(3),
      note: "Filler, so Ana carries the heaviest queue and least-loaded assignment has something to prove.",
    },
    {
      subject: "Timezone shown in reports is wrong",
      body: "Reports render in UTC rather than our local timezone.",
      priority: "medium",
      status: "in_progress",
      customer: fay._id,
      agent: ana._id,
      agoBusinessMs: hours(4),
      firstResponseAfterMs: 30 * MINUTE_MS,
      note: "Filler.",
    },
  ];

  let seq = 1;
  for (const spec of specs) {
    await insertTicket(spec, cal, now, seq);
    console.log(`  TK-${1000 + seq}  ${spec.subject}`);
    console.log(`           ${spec.note}`);
    seq += 1;
  }

  await Counter.findByIdAndUpdate("ticket", { seq: 1000 + seq - 1 }, { upsert: true });

  // The last ticket goes through the real creation path rather than being
  // inserted: it proves the routing rules and least-loaded assignment work in
  // production code, not just in the fixtures.
  console.log("\n  Creating one ticket through the live API path (routing + assignment):");
  const routed = await createTicket({
    subject: "Server is down and I can't login to the dashboard",
    body: "Everything is offline since this morning. Completely blocked.",
    customerId: dana._id,
  });
  console.log(`  ${routed.reference}  ${routed.subject}`);
  console.log(
    `           Routed to ${routed.priority.toUpperCase()} by keyword rule, assigned to ${routed.assignedAgent?.name ?? "nobody"} (least loaded).`,
  );
}

async function main() {
  await connectDb();

  console.log("\nClearing existing data...");
  await wipe();

  console.log("Seeding SLA policies, business hours (Mon-Fri 09:00-18:00) and routing rules...");
  await seedConfig();
  await getPolicies();

  console.log("Seeding users (password for every account: " + PASSWORD + ")");
  const users = await seedUsers();
  console.log("  admin@helpdesk.test        admin");
  console.log("  ana@helpdesk.test          agent");
  console.log("  ben@helpdesk.test          agent");
  console.log("  chi@helpdesk.test          agent");
  console.log("  dana@customer.test         customer");
  console.log("  eli@customer.test          customer");
  console.log("  fay@customer.test          customer");

  console.log("\nSeeding tickets:");
  await seedTickets(users);

  console.log("\nDone. Start the API and run the sweep to watch the breached tickets escalate.");
  await disconnectDb();
}

main().catch(async (error) => {
  console.error("Seed failed:", error);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
