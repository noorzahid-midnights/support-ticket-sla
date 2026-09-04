/**
 * Environment configuration, validated once at boot.
 *
 * Deliberately fails hard and early: a missing JWT secret or a typo'd Mongo
 * URI should stop the process with a readable message, not surface twenty
 * minutes later as an authentication bug or a hanging request.
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required. Copy server/.env.example to server/.env and paste your Atlas connection string."),

  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters."),
  JWT_EXPIRES_IN: z.string().default("7d"),

  /** Origin allowed to send credentialed requests. The Next.js dev server. */
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  /**
   * IANA zone the business-hours windows are expressed in. Business hours are
   * wall-clock times, so they are meaningless without one.
   */
  SLA_TIMEZONE: z.string().default("Asia/Karachi"),

  /** Cron expression for the breach sweep. Every minute by default. */
  SLA_SWEEP_CRON: z.string().default("*/1 * * * *"),

  /**
   * Set to "0" to keep the in-process sweep from starting.
   *
   * Turn it off in any deployment that either sleeps when idle or runs more
   * than one instance, and drive `/api/jobs/sla-sweep` from a platform cron
   * instead — see CRON_SECRET.
   */
  SLA_SWEEP_ENABLED: z
    .enum(["0", "1"])
    .default("1")
    .transform((v) => v === "1"),

  /**
   * Shared secret for the machine-callable sweep endpoint.
   *
   * An external scheduler has no session and cannot log in, so the endpoint is
   * authenticated by this instead of by a cookie. Leave unset and the endpoint
   * refuses every request rather than defaulting to open.
   */
  CRON_SECRET: z.string().min(16).optional(),

  /**
   * Number of proxies in front of the app.
   *
   * Render, Railway and Fly terminate TLS at a proxy and forward plain HTTP.
   * Without this Express sees an insecure connection and silently refuses to
   * set the `Secure` auth cookie, so every request after login looks signed
   * out with nothing in the logs to say why.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  /**
   * Cookie SameSite policy.
   *
   * "lax" is correct when the UI and API share a site — including when the UI
   * proxies /api through itself, which is the recommended deployment. Only use
   * "none" if the browser genuinely calls the API on a different site, and note
   * that "none" additionally requires Secure, so it cannot work over plain HTTP.
   */
  COOKIE_SAMESITE: z.enum(["lax", "none"]).default("lax"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`\nInvalid server environment:\n${problems}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
