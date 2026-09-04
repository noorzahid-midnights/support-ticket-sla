import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PRIORITIES, TICKET_STATUSES } from "../../../shared/types.js";
import { allowedTransitions } from "../../../shared/transitions.js";
import { currentUser, requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import {
  addReply,
  assignTicket,
  changePriority,
  createTicket,
  getTicketDetail,
  listTickets,
  transitionTicket,
} from "../services/ticket.service.js";

export const ticketRouter: Router = Router();

ticketRouter.use(requireAuth);

/**
 * Parses a comma-separated query param into a typed array, silently dropping
 * anything that is not a member of the enum. A junk filter value should narrow
 * the result set, not 400 the whole request.
 */
const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v): T[] | undefined =>
      v ? v.split(",").filter((s): s is T => (values as readonly string[]).includes(s)) : undefined,
    );

const listQuery = z.object({
  status: csv(TICKET_STATUSES),
  priority: csv(PRIORITIES),
  assignedAgent: z.string().optional(),
  breached: z.coerce.boolean().optional(),
  atRisk: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sort: z.enum(["urgency", "created"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  /** Agents use this to get just their own queue. */
  mine: z.coerce.boolean().optional(),
});

ticketRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const me = currentUser(req);

    // Authorisation is expressed as a filter rather than a post-hoc check: a
    // customer simply cannot express a query that returns someone else's
    // tickets, so there is no path where one leaks through.
    const scoped = {
      ...q,
      breachedOnly: q.breached,
      atRiskOnly: q.atRisk,
      customer: me.role === "customer" ? String(me.id) : undefined,
      assignedAgent: q.mine ? String(me.id) : me.role === "customer" ? undefined : q.assignedAgent,
    };

    res.json(await listTickets(scoped));
  }),
);

ticketRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const me = currentUser(req);
    const detail = await getTicketDetail(req.params.id!);

    if (me.role === "customer" && detail.customer.id !== String(me.id)) {
      // 404 rather than 403: a customer should not be able to confirm that a
      // ticket id exists at all.
      throw new HttpError(404, "Ticket not found.", "not_found");
    }

    res.json({
      ...detail,
      allowedTransitions: allowedTransitions(detail.status, me.role),
    });
  }),
);

const createBody = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(1).max(20_000),
  priority: z.enum(PRIORITIES).optional(),
  /** Staff raising a ticket on behalf of a customer. */
  customerId: z.string().optional(),
});

ticketRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createBody.parse(req.body);
    const me = currentUser(req);

    // A customer can only ever file as themselves, and cannot hand-pick a
    // priority — that is what the routing rules are for.
    const customerId =
      me.role === "customer" || !input.customerId ? me.id : new mongoose.Types.ObjectId(input.customerId);

    const ticket = await createTicket({
      subject: input.subject,
      body: input.body,
      customerId,
      priority: me.role === "customer" ? undefined : input.priority,
    });

    res.status(201).json(ticket);
  }),
);

ticketRouter.post(
  "/:id/replies",
  asyncHandler(async (req, res) => {
    const { body } = z.object({ body: z.string().min(1).max(20_000) }).parse(req.body);
    const me = currentUser(req);

    if (me.role === "customer") {
      const detail = await getTicketDetail(req.params.id!);
      if (detail.customer.id !== String(me.id)) throw new HttpError(404, "Ticket not found.", "not_found");
    }

    res.json(await addReply({ ticketId: req.params.id!, body, actor: { id: me.id, role: me.role } }));
  }),
);

ticketRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(TICKET_STATUSES) }).parse(req.body);
    const me = currentUser(req);

    if (me.role === "customer") {
      const detail = await getTicketDetail(req.params.id!);
      if (detail.customer.id !== String(me.id)) throw new HttpError(404, "Ticket not found.", "not_found");
    }

    res.json(await transitionTicket({ ticketId: req.params.id!, to: status, actor: { id: me.id, role: me.role } }));
  }),
);

ticketRouter.patch(
  "/:id/priority",
  requireRole("agent", "admin"),
  asyncHandler(async (req, res) => {
    const { priority } = z.object({ priority: z.enum(PRIORITIES) }).parse(req.body);
    const me = currentUser(req);
    res.json(await changePriority({ ticketId: req.params.id!, priority, actorId: me.id }));
  }),
);

ticketRouter.patch(
  "/:id/assignee",
  requireRole("agent", "admin"),
  asyncHandler(async (req, res) => {
    const { agentId } = z.object({ agentId: z.string().nullable() }).parse(req.body);
    const me = currentUser(req);
    res.json(await assignTicket(req.params.id!, agentId, me.id));
  }),
);
