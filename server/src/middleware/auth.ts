/**
 * JWT authentication.
 *
 * The token travels in an httpOnly cookie rather than an Authorization header:
 * it survives a page refresh with no token sitting in localStorage for a
 * script to read. localhost:3000 and localhost:4000 are the same site (ports
 * do not affect site), so SameSite=Lax works in development; the CORS config
 * in index.ts supplies the credentialed-origin half.
 */

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import type { Role } from "../../../shared/types.js";
import { env, isProd } from "../env.js";
import { User } from "../models/index.js";
import { HttpError } from "./errors.js";

export const AUTH_COOKIE = "sla_token";

export interface AuthUser {
  id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: env.COOKIE_SAMESITE,
    // SameSite=None is only honoured on a secure cookie, so it forces HTTPS
    // regardless of NODE_ENV. Getting this pair wrong is the classic
    // "logged out immediately after logging in" deployment bug.
    secure: isProd || env.COOKIE_SAMESITE === "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { path: "/" });
}

/**
 * Populates `req.user` when a valid token is present. Does not reject — that
 * is `requireAuth`'s job — so public endpoints can still see who is calling.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) return next();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string };
    if (!payload.sub || !mongoose.Types.ObjectId.isValid(payload.sub)) return next();

    const user = await User.findById(payload.sub).lean();
    if (user) {
      req.user = { id: user._id, name: user.name, email: user.email, role: user.role as Role };
    }
  } catch {
    // An expired or tampered token is simply an unauthenticated request.
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, "You need to sign in.", "unauthenticated"));
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, "You need to sign in.", "unauthenticated"));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, `This action is restricted to: ${roles.join(", ")}.`, "forbidden"));
    }
    next();
  };
}

/** Convenience for handlers that have already passed `requireAuth`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, "You need to sign in.", "unauthenticated");
  return req.user;
}
