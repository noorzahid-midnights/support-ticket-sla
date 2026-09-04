import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isProd } from "../env.js";

/** An error with an intended HTTP status. Anything else is a 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not do this itself; without it a thrown error inside an async
 * route hangs the request instead of returning a 500.
 */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Single error envelope: `{ error: { message, code, details } }`.
 * The client's ApiError is built from exactly this shape, so every failure
 * — validation, auth, transition, crash — surfaces the same way.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        message: "Request validation failed.",
        code: "validation_failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  // Duplicate key: almost always a repeated email on registration.
  if (typeof err === "object" && err && (err as { code?: number }).code === 11000) {
    res.status(409).json({ error: { message: "That value is already taken.", code: "duplicate" } });
    return;
  }

  console.error("[error]", err);
  res.status(500).json({
    error: {
      message: isProd ? "Something went wrong." : err instanceof Error ? err.message : String(err),
      code: "internal_error",
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: "No such endpoint.", code: "not_found" } });
}
