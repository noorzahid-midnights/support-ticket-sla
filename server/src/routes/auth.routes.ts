import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { ROLES } from "../../../shared/types.js";
import { User } from "../models/index.js";
import { clearAuthCookie, currentUser, requireAuth, setAuthCookie, signToken } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../middleware/errors.js";

export const authRouter: Router = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const registration = credentials.extend({
  name: z.string().min(2),
  // Self-registration only creates customers. Agents and admins are seeded or
  // created by an admin, so nobody can grant themselves a queue by signing up.
  role: z.enum(ROLES).optional(),
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registration.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: "customer",
    });

    setAuthCookie(res, signToken(String(user._id)));
    res.status(201).json({ id: String(user._id), name: user.name, email: user.email, role: user.role });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = credentials.parse(req.body);
    const user = await User.findOne({ email: input.email });

    // One message for both "no such user" and "wrong password", so the
    // endpoint cannot be used to enumerate registered addresses.
    const ok = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !ok) throw new HttpError(401, "Email or password is incorrect.", "bad_credentials");

    setAuthCookie(res, signToken(String(user._id)));
    res.json({ id: String(user._id), name: user.name, email: user.email, role: user.role });
  }),
);

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = currentUser(req);
    res.json({ id: String(me.id), name: me.name, email: me.email, role: me.role });
  }),
);

/**
 * Update your own profile.
 *
 * Deliberately cannot touch `role` — that is only ever changed by an admin on
 * the Team page, so nobody can promote themselves here.
 *
 * Changing the password requires the current one even though the session is
 * already authenticated: it stops an unattended logged-in browser from being
 * used to lock the real owner out of their account.
 */
authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(2).max(80).optional(),
        email: z.string().email().optional(),
        currentPassword: z.string().optional(),
        newPassword: z.string().min(8, "New password must be at least 8 characters.").optional(),
      })
      .parse(req.body);

    const me = currentUser(req);
    const user = await User.findById(me.id);
    if (!user) throw new HttpError(404, "Account not found.", "not_found");

    if (input.newPassword) {
      if (!input.currentPassword) {
        throw new HttpError(400, "Enter your current password to set a new one.", "current_password_required");
      }
      const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!ok) throw new HttpError(401, "Your current password is incorrect.", "bad_credentials");
      user.passwordHash = await bcrypt.hash(input.newPassword, 10);
    }

    if (input.email && input.email.toLowerCase() !== user.email) {
      const taken = await User.findOne({ email: input.email.toLowerCase() });
      if (taken) throw new HttpError(409, "That email is already in use.", "duplicate");
      user.email = input.email.toLowerCase();
    }

    if (input.name) user.name = input.name.trim();

    await user.save();
    res.json({ id: String(user._id), name: user.name, email: user.email, role: user.role });
  }),
);
