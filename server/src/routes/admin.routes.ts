import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PRIORITIES, ROLES } from "../../../shared/types.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import { BusinessHours, Holiday, RoutingRule, SlaPolicy, Ticket, User } from "../models/index.js";
import { getCalendar, invalidateSlaConfigCache } from "../services/calendar.service.js";
import { agentWorkloads, listTickets } from "../services/ticket.service.js";
import { runSlaSweep } from "../services/escalation.service.js";

export const adminRouter: Router = Router();

adminRouter.use(requireAuth, requireRole("admin"));

/** Every ticket currently in breach of either deadline. */
adminRouter.get(
  "/breaches",
  asyncHandler(async (_req, res) => {
    const result = await listTickets({ breachedOnly: true, sort: "urgency", pageSize: 100 });
    res.json(result);
  }),
);

adminRouter.get(
  "/workload",
  asyncHandler(async (_req, res) => {
    res.json(await agentWorkloads());
  }),
);

/**
 * Runs the breach sweep on demand.
 *
 * The same function the cron calls, so triggering it here proves the real
 * thing rather than a demo shim — and running it twice demonstrates that it
 * does not double-escalate.
 */
adminRouter.post(
  "/sla/sweep",
  asyncHandler(async (_req, res) => {
    res.json(await runSlaSweep());
  }),
);

/* --------------------------------------------------------- routing rules */

adminRouter.get(
  "/routing-rules",
  asyncHandler(async (_req, res) => {
    const rules = await RoutingRule.find().sort({ weight: -1 }).lean();
    res.json(
      rules.map((r) => ({
        id: String(r._id),
        name: r.name,
        keywords: r.keywords,
        field: r.field,
        priority: r.priority,
        weight: r.weight,
        active: r.active,
      })),
    );
  }),
);

const ruleBody = z.object({
  name: z.string().min(2),
  keywords: z.array(z.string().min(1)).min(1),
  field: z.enum(["subject", "body", "both"]).default("both"),
  priority: z.enum(PRIORITIES),
  weight: z.number().int().default(10),
  active: z.boolean().default(true),
});

adminRouter.post(
  "/routing-rules",
  asyncHandler(async (req, res) => {
    const rule = await RoutingRule.create(ruleBody.parse(req.body));
    res.status(201).json({ id: String(rule._id) });
  }),
);

adminRouter.patch(
  "/routing-rules/:id",
  asyncHandler(async (req, res) => {
    await RoutingRule.findByIdAndUpdate(req.params.id, ruleBody.partial().parse(req.body));
    res.status(204).end();
  }),
);

adminRouter.delete(
  "/routing-rules/:id",
  asyncHandler(async (req, res) => {
    await RoutingRule.findByIdAndDelete(req.params.id);
    res.status(204).end();
  }),
);

/* ---------------------------------------------------- sla config + hours */

adminRouter.get(
  "/sla-policies",
  asyncHandler(async (_req, res) => {
    res.json(await SlaPolicy.find().lean());
  }),
);

adminRouter.patch(
  "/sla-policies/:priority",
  asyncHandler(async (req, res) => {
    const body = z
      .object({ firstResponseMinutes: z.number().int().positive(), resolutionMinutes: z.number().int().positive() })
      .parse(req.body);

    await SlaPolicy.findOneAndUpdate({ priority: req.params.priority }, body, { upsert: true });
    // Existing tickets keep the deadlines they were given; changing a policy
    // retroactively would rewrite obligations that agents already worked to.
    invalidateSlaConfigCache();
    res.status(204).end();
  }),
);

adminRouter.get(
  "/business-hours",
  asyncHandler(async (_req, res) => {
    const [rows, holidays] = await Promise.all([
      BusinessHours.find().sort({ dayOfWeek: 1 }).lean(),
      Holiday.find().sort({ date: 1 }).lean(),
    ]);
    res.json({ days: rows, holidays, calendar: await getCalendar() });
  }),
);

adminRouter.put(
  "/business-hours/:dayOfWeek",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        active: z.boolean().default(true),
      })
      .parse(req.body);

    await BusinessHours.findOneAndUpdate({ dayOfWeek: Number(req.params.dayOfWeek) }, body, { upsert: true });
    invalidateSlaConfigCache();
    // Re-read through getCalendar so an invalid combination fails here, loudly,
    // rather than inside the next deadline calculation.
    res.json(await getCalendar());
  }),
);

adminRouter.get(
  "/agents",
  asyncHandler(async (_req, res) => {
    const agents = await User.find({ role: { $in: ["agent", "admin"] } }).sort({ name: 1 }).lean();
    res.json(agents.map((a) => ({ id: String(a._id), name: a.name, email: a.email, role: a.role })));
  }),
);

/* ------------------------------------------------------------------- team */

/**
 * Everyone, with the open-ticket count each person is carrying.
 *
 * The count is what makes a demotion an informed decision rather than a
 * guess: taking someone's agent role does not reassign their queue.
 */
adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await User.find().sort({ role: 1, name: 1 }).lean();

    // Two counts, because deletion is refused on either: an agent's live queue,
    // and every ticket a customer ever raised — a resolved ticket still points
    // at whoever filed it.
    const [open, raised] = await Promise.all([
      Ticket.aggregate<{ _id: unknown; count: number }>([
        { $match: { status: { $nin: ["resolved", "closed"] }, assignedAgent: { $ne: null } } },
        { $group: { _id: "$assignedAgent", count: { $sum: 1 } } },
      ]),
      Ticket.aggregate<{ _id: unknown; count: number }>([{ $group: { _id: "$customer", count: { $sum: 1 } } }]),
    ]);
    const byId = new Map(open.map((o) => [String(o._id), o.count]));
    const raisedById = new Map(raised.map((o) => [String(o._id), o.count]));

    res.json(
      users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        openTickets: byId.get(String(u._id)) ?? 0,
        raisedTickets: raisedById.get(String(u._id)) ?? 0,
        createdAt: (u as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? null,
      })),
    );
  }),
);

/**
 * Change someone's role.
 *
 * Roles are only ever changed here, never at sign-up — registration hardcodes
 * "customer" so nobody can grant themselves a queue.
 *
 * Two refusals worth having:
 *
 *  - An admin cannot change their own role. Demoting yourself is a one-way
 *    door: you immediately lose the page that would let you undo it.
 *  - The last admin cannot be demoted by anyone. Otherwise a single click
 *    locks every human out of the admin area, recoverable only by editing the
 *    database by hand.
 */
adminRouter.patch(
  "/users/:id/role",
  asyncHandler(async (req, res) => {
    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);
    const me = currentUser(req);

    if (!mongoose.Types.ObjectId.isValid(req.params.id!)) {
      throw new HttpError(404, "No such user.", "not_found");
    }
    if (String(me.id) === req.params.id) {
      throw new HttpError(
        422,
        "You cannot change your own role. Ask another admin to do it.",
        "self_role_change",
      );
    }

    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "No such user.", "not_found");
    if (user.role === role) return res.json({ id: String(user._id), role: user.role, changed: false });

    if (user.role === "admin" && role !== "admin") {
      const admins = await User.countDocuments({ role: "admin" });
      if (admins <= 1) {
        throw new HttpError(
          422,
          "This is the only admin. Promote someone else before demoting this account.",
          "last_admin",
        );
      }
    }

    const previous = user.role;
    user.role = role;
    await user.save();

    // A demoted agent keeps their assignments; nothing is silently reassigned.
    const openTickets =
      previous === "agent" || previous === "admin"
        ? await Ticket.countDocuments({ assignedAgent: user._id, status: { $nin: ["resolved", "closed"] } })
        : 0;

    console.log(`[admin] ${me.email} changed ${user.email} from ${previous} to ${role}`);
    res.json({ id: String(user._id), name: user.name, role: user.role, previous, openTickets, changed: true });
  }),
);

/**
 * Delete an account. Mainly so the seeded demo users can be removed at handover.
 *
 * Refused when the account still owns or is assigned to a live ticket: deleting
 * it would leave tickets pointing at a user that no longer exists, and the
 * ticket list would break on a null customer. Reassign or close them first —
 * the message says which.
 *
 * Same two protections as a role change: not yourself, and not the last admin.
 */
adminRouter.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const me = currentUser(req);
    if (!mongoose.Types.ObjectId.isValid(req.params.id!)) {
      throw new HttpError(404, "No such user.", "not_found");
    }
    if (String(me.id) === req.params.id) {
      throw new HttpError(422, "You cannot delete your own account.", "self_delete");
    }

    const user = await User.findById(req.params.id);
    if (!user) throw new HttpError(404, "No such user.", "not_found");

    if (user.role === "admin") {
      const admins = await User.countDocuments({ role: "admin" });
      if (admins <= 1) {
        throw new HttpError(422, "This is the only admin. Promote someone else first.", "last_admin");
      }
    }

    const raised = await Ticket.countDocuments({ customer: user._id });
    const assigned = await Ticket.countDocuments({
      assignedAgent: user._id,
      status: { $nin: ["resolved", "closed"] },
    });

    if (raised > 0 || assigned > 0) {
      const parts = [
        raised > 0 ? `raised ${raised} ticket${raised === 1 ? "" : "s"}` : null,
        assigned > 0 ? `are assigned ${assigned} open ticket${assigned === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      throw new HttpError(
        422,
        `Cannot delete ${user.name}: they ${parts.join(" and ")}. Reassign or close those first.`,
        "has_tickets",
      );
    }

    await user.deleteOne();
    console.log(`[admin] ${me.email} deleted ${user.email}`);
    res.status(204).end();
  }),
);
