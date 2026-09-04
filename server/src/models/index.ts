/**
 * Mongoose schemas. Data shape only — every rule about how a ticket may move
 * between states, or when its SLA clock runs, lives in the pure `shared/`
 * modules and the services that call them. Keeping logic out of the models is
 * what lets the SLA engine be unit-tested without a database.
 */

import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from "mongoose";
import { EVENT_TYPES, PRIORITIES, ROLES, TICKET_STATUSES } from "@shared/types.js";

/* ------------------------------------------------------------------ users */

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true, index: true },
  },
  { timestamps: true },
);

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User: Model<UserAttrs> = mongoose.models.User ?? mongoose.model<UserAttrs>("User", userSchema);

/* ---------------------------------------------------------------- tickets */

const slaClockSchema = new Schema(
  {
    firstResponseDueAt: { type: Date, default: null },
    resolutionDueAt: { type: Date, default: null },
    /** Non-null exactly while the ticket sits in waiting_on_customer. */
    pausedAt: { type: Date, default: null },
    pausedBusinessMs: { type: Number, default: 0 },
    /** Latched so the sweep escalates on the transition into breach, not every tick. */
    firstResponseBreached: { type: Boolean, default: false },
    resolutionBreached: { type: Boolean, default: false },
    escalationCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: "open", index: true },
    priority: { type: String, enum: PRIORITIES, default: "medium", index: true },
    customer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedAgent: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    priorityAutoAssigned: { type: Boolean, default: false },
    sla: { type: slaClockSchema, default: () => ({}) },
  },
  { timestamps: true },
);

// The sweep's hot query: live tickets, unpaused, ordered by the nearest deadline.
ticketSchema.index({ status: 1, "sla.pausedAt": 1, "sla.resolutionDueAt": 1 });
// The agent dashboard: my queue, most at-risk first.
ticketSchema.index({ assignedAgent: 1, status: 1, "sla.resolutionDueAt": 1 });

export type TicketAttrs = InferSchemaType<typeof ticketSchema>;
export type TicketDoc = HydratedDocument<TicketAttrs>;
export const Ticket: Model<TicketAttrs> = mongoose.models.Ticket ?? mongoose.model<TicketAttrs>("Ticket", ticketSchema);

/* ----------------------------------------------------------- ticket events */

const ticketEventSchema = new Schema({
  ticket: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
  type: { type: String, enum: EVENT_TYPES, required: true },
  /** null means the system acted: cron escalation, auto-routing, auto-assignment. */
  actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  field: { type: String, default: null },
  oldValue: { type: String, default: null },
  newValue: { type: String, default: null },
  body: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

export type TicketEventAttrs = InferSchemaType<typeof ticketEventSchema>;
export type TicketEventDoc = HydratedDocument<TicketEventAttrs>;
export const TicketEvent: Model<TicketEventAttrs> =
  mongoose.models.TicketEvent ?? mongoose.model<TicketEventAttrs>("TicketEvent", ticketEventSchema);

/* ------------------------------------------------------------ sla policies */

const slaPolicySchema = new Schema({
  priority: { type: String, enum: PRIORITIES, required: true, unique: true },
  /** Business minutes, not wall-clock minutes. */
  firstResponseMinutes: { type: Number, required: true, min: 1 },
  resolutionMinutes: { type: Number, required: true, min: 1 },
});

export type SlaPolicyAttrs = InferSchemaType<typeof slaPolicySchema>;
export type SlaPolicyDoc = HydratedDocument<SlaPolicyAttrs>;
export const SlaPolicy: Model<SlaPolicyAttrs> =
  mongoose.models.SlaPolicy ?? mongoose.model<SlaPolicyAttrs>("SlaPolicy", slaPolicySchema);

/* ---------------------------------------------------------- business hours */

const businessHoursSchema = new Schema({
  /** 0 = Sunday .. 6 = Saturday. */
  dayOfWeek: { type: Number, required: true, unique: true, min: 0, max: 6 },
  startTime: { type: String, required: true }, // "09:00"
  endTime: { type: String, required: true }, // "18:00"
  active: { type: Boolean, default: true },
});

export type BusinessHoursAttrs = InferSchemaType<typeof businessHoursSchema>;
export type BusinessHoursDoc = HydratedDocument<BusinessHoursAttrs>;
export const BusinessHours: Model<BusinessHoursAttrs> =
  mongoose.models.BusinessHours ?? mongoose.model<BusinessHoursAttrs>("BusinessHours", businessHoursSchema);

const holidaySchema = new Schema({
  /** "YYYY-MM-DD" in the configured SLA timezone. */
  date: { type: String, required: true, unique: true },
  name: { type: String, required: true },
});

export type HolidayAttrs = InferSchemaType<typeof holidaySchema>;
export type HolidayDoc = HydratedDocument<HolidayAttrs>;
export const Holiday: Model<HolidayAttrs> =
  mongoose.models.Holiday ?? mongoose.model<HolidayAttrs>("Holiday", holidaySchema);

/* ----------------------------------------------------------- routing rules */

const routingRuleSchema = new Schema({
  name: { type: String, required: true },
  keywords: { type: [String], required: true },
  field: { type: String, enum: ["subject", "body", "both"], default: "both" },
  priority: { type: String, enum: PRIORITIES, required: true },
  /** Highest-weight match wins. Ties break towards the more severe priority. */
  weight: { type: Number, default: 10 },
  active: { type: Boolean, default: true },
});

export type RoutingRuleAttrs = InferSchemaType<typeof routingRuleSchema>;
export type RoutingRuleDoc = HydratedDocument<RoutingRuleAttrs>;
export const RoutingRule: Model<RoutingRuleAttrs> =
  mongoose.models.RoutingRule ?? mongoose.model<RoutingRuleAttrs>("RoutingRule", routingRuleSchema);

/* --------------------------------------------------------------- counters */

const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 1000 },
});

export const Counter: Model<{ _id: string; seq: number }> =
  mongoose.models.Counter ?? mongoose.model("Counter", counterSchema);

/**
 * Human-quotable ticket reference. Uses an atomic $inc rather than a document
 * count, which would collide the moment two tickets are created in the same
 * millisecond.
 */
export async function nextTicketReference(): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    "ticket",
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return `TK-${counter!.seq}`;
}
