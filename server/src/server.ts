/**
 * Long-running server bootstrap.
 *
 * Separate from index.ts so that importing the app factory has no side
 * effects — the serverless entry point in api/ imports createApp() and must
 * not start a listener or connect eagerly.
 */

import { connectDbOrExit } from "./db.js";
import { env, isProd } from "./env.js";
import { createApp } from "./index.js";
import { startSlaSweep } from "./jobs/sla-sweep.js";
import { getCalendar } from "./services/calendar.service.js";

async function main() {
  await connectDbOrExit();

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
