/**
 * The whole API, mounted inside the Next.js app.
 *
 * Every request to /api/* lands here and is handed to the same Express app the
 * standalone server uses — one set of routes, one middleware stack, no
 * duplication.
 *
 * Why this rather than a separate service:
 *
 *  - Vercel detects Express in a standalone project and selects its Container
 *    preset, which expects a prebuilt image and fails. A Next.js project has no
 *    such ambiguity.
 *  - The UI and API share an origin, so the auth cookie is first-party by
 *    construction. Split across two domains it would be cross-site, silently
 *    dropped by the browser, and the app would look permanently signed out with
 *    nothing in the logs.
 *  - No CORS, no proxy rewrite, no second set of environment variables.
 *
 * This is a `pages/api` route rather than an App Router handler on purpose:
 * App Router handlers deal in Web `Request`/`Response`, whereas Express needs
 * Node's `req`/`res` — which is exactly what `pages/api` provides. Next
 * supports both routers in one app.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { connectDb } from "../../../server/src/db.js";
import { createApp } from "../../../server/src/index.js";

export const config = {
  api: {
    /**
     * Express parses its own bodies. Leaving Next's parser on would consume the
     * stream first, and every POST would arrive at the routes with an empty
     * body — which reads like a validation bug rather than a plumbing one.
     */
    bodyParser: false,
    externalResolver: true,
  },
};

// Built once per container and reused across warm invocations; rebuilding the
// middleware stack per request would be pure waste.
const app = createApp();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Resolves instantly once warm — the connection promise is cached in db.ts.
  await connectDb();
  return (app as unknown as (q: NextApiRequest, s: NextApiResponse) => void)(req, res);
}
