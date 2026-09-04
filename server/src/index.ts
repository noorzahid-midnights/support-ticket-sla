import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { connectDb } from "./db.js";
import { env, isProd } from "./env.js";
import { attachUser, requireAuth } from "./middleware/auth.js";
import { HttpError, errorHandler, notFoundHandler } from "./middleware/errors.js";
import { startSlaSweep } from "./jobs/sla-sweep.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { ticketRouter } from "./routes/ticket.routes.js";
import { getCalendar, getPolicies } from "./services/calendar.service.js";
import { runSlaSweep } from "./services/escalation.service.js";

export function createApp() {
  const app = express();

  /**
   * Behind a TLS-terminating proxy Express sees plain HTTP and refuses to set
   * the `Secure` auth cookie, which presents as "login succeeds, every later
   * request is 401" with nothing in the logs. Set TRUST_PROXY=1 on Render,
   * Railway, Fly and friends.
   */
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  app.use(helmet());

  // A concrete origin, never "*": a wildcard origin cannot carry credentials,
  // and the auth cookie is the credential.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  /**
   * The calendar the client needs to tick its countdowns correctly: without it
   * a timer would bleed a ticket out over the weekend and scream breach on
   * Monday for time nobody owed.
   */
  app.get("/api/meta/calendar", requireAuth, async (_req, res, next) => {
    try {
      res.json({ calendar: await getCalendar(), policies: [...(await getPolicies()).values()] });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Machine-callable breach sweep, for a platform cron.
   *
   * The in-process `node-cron` schedule dies whenever the host sleeps an idle
   * free-tier service, and double-fires if the host runs more than one
   * instance — so a deployment should disable it and drive this instead. The
   * sweep is idempotent by design, which is what makes an external trigger
   * safe to retry.
   *
   * Authenticated by a shared secret because a scheduler has no session. If
   * CRON_SECRET is unset the endpoint refuses everything rather than
   * defaulting to open.
   */
  const cronLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.post("/api/jobs/sla-sweep", cronLimiter, async (req, res, next) => {
    try {
      const provided = req.get("x-cron-secret");
      if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
        throw new HttpError(401, "Invalid or missing cron secret.", "unauthenticated");
      }
      res.json(await runSlaSweep());
    } catch (error) {
      next(error);
    }
  });

  /**
   * Login is the one endpoint worth throttling: it is the only place an
   * attacker can test a password, and bcrypt makes each attempt expensive for
   * us as well as for them.
   */
  app.use(
    "/api/auth/login",
    rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/tickets", ticketRouter);
  app.use("/api/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function main() {
  await connectDb();

  // Fail at boot on a bad calendar rather than on the first ticket created.
  await getCalendar();

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`[api] listening on port ${env.PORT}`);
    console.log(`[api] accepting credentialed requests from ${env.WEB_ORIGIN}`);
    console.log(`[api] cookies: sameSite=${env.COOKIE_SAMESITE} secure=${isProd || env.COOKIE_SAMESITE === "none"}`);
    if (env.TRUST_PROXY > 0) console.log(`[api] trusting ${env.TRUST_PROXY} proxy hop(s)`);
    startSlaSweep();
    if (!env.SLA_SWEEP_ENABLED) {
      console.log("[sla] in-process sweep is off — drive POST /api/jobs/sla-sweep from a scheduler");
    }
  });
}

main().catch((error) => {
  console.error("[api] failed to start:", error);
  process.exit(1);
});
