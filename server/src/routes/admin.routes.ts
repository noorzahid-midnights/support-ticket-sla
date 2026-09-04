import { Router } from "express";
import { z } from "zod";
import { PRIORITIES } from "../../../shared/types.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";
import { BusinessHours, Holiday, RoutingRule, SlaPolicy, User } from "../models/index.js";
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
