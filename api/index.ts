/**
 * Serverless entry point for the API.
 *
 * Vercel invokes this per request. `vercel.json` rewrites every path here, so
 * Express still sees the original URL and its own routing table applies
 * unchanged — the same `createApp()` the long-running server uses, with no
 * duplicated route definitions.
 *
 * It lives at the repo root rather than under `server/` because the API also
 * imports `shared/`, and a function can only bundle files at or below its own
 * project root.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { connectDb } from "../server/src/db.js";
import { createApp } from "../server/src/index.js";

// Built once per container and reused across warm invocations. Constructing
// Express per request would rebuild the whole middleware stack every time.
const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Resolves instantly once the container is warm; see the cache in db.ts.
  await connectDb();
  return (app as unknown as (q: IncomingMessage, s: ServerResponse) => void)(req, res);
}
