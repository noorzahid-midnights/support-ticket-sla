# Deployment

Two Vercel projects from this one repository: the Express API as a serverless
function, and the Next.js UI. The UI proxies `/api/*` to the API, so the browser
only ever talks to one origin.

Everything code-side is already done. What follows is the dashboard work, which
cannot be scripted because environment variables are set through the UI.

---

## Why the UI proxies the API

The auth token lives in an httpOnly cookie. If the browser called the API on its
own domain, every request would be cross-site, the browser would drop the cookie,
and the app would look permanently signed out — with no error anywhere, because
nothing actually failed.

Routing `/api/*` through the UI's own origin keeps the cookie first-party,
`SameSite=Lax` keeps working, and CORS stops being a concern. That is what
`API_ORIGIN` and the `rewrites()` block in `web/next.config.mjs` are for.

---

## 1 · Deploy the API

[vercel.com/new](https://vercel.com/new) → import `support-ticket-sla`.

| Setting | Value |
| --- | --- |
| Project Name | `support-ticket-sla-api` |
| Root Directory | **`.`** (repository root — the function bundles `shared/` too) |
| Framework Preset | **Other** |

`vercel.json` routes every path to `api/index.ts`, so no build command is needed.

Environment variables — take the first three from your local `server/.env`:

| Key | Value |
| --- | --- |
| `MONGODB_URI` | your Atlas connection string, ending `/support_sla` |
| `JWT_SECRET` | the generated secret |
| `CRON_SECRET` | the generated secret |
| `NODE_ENV` | `production` |
| `SLA_TIMEZONE` | `Asia/Karachi` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SAMESITE` | `lax` |
| `SLA_SWEEP_ENABLED` | `0` |
| `WEB_ORIGIN` | the UI's URL — fill in after step 2 |

**`SLA_SWEEP_ENABLED=0` is deliberate.** `node-cron` needs a process that stays
alive between requests, and a serverless function does not have one. Step 3
replaces it.

**`TRUST_PROXY=1` is not optional.** Vercel terminates TLS at its edge and
forwards plain HTTP. Without this, Express refuses to set a `Secure` cookie and
every request after login returns 401 with nothing in the logs to explain it.

Deploy, then check `https://<api-url>/api/health` returns `{"ok":true}`.

## 2 · Deploy the UI

[vercel.com/new](https://vercel.com/new) → import the **same** repository again.

| Setting | Value |
| --- | --- |
| Project Name | `support-ticket-sla` |
| Root Directory | **`web`** |
| Framework Preset | Next.js (auto-detected) |

| Key | Value |
| --- | --- |
| `API_ORIGIN` | the API URL from step 1, e.g. `https://support-ticket-sla-api.vercel.app` |
| `NEXT_PUBLIC_API_MODE` | `http` |
| `NEXT_PUBLIC_API_BASE_URL` | *leave empty* — empty means same-origin, which is the whole point of the proxy |

`NEXT_PUBLIC_*` values are baked in at **build** time, so changing one later
needs a redeploy, not just a restart.

Then go back to the API project and set `WEB_ORIGIN` to this URL.

## 3 · Schedule the breach sweep

Without this, breaches are never detected. The endpoint is idempotent — it
escalates once per breach via latched flags — so a retrying scheduler is safe.

Vercel Cron on the Hobby plan only runs **once a day**, which is useless for an
SLA product. Use an external scheduler instead: [cron-job.org](https://cron-job.org)
is free and does minute-level.

| Field | Value |
| --- | --- |
| URL | `https://<api-url>/api/jobs/sla-sweep` |
| Method | `POST` |
| Header | `x-cron-secret: <your CRON_SECRET>` |
| Schedule | every minute (or every 5 — the sweep is cheap either way) |

Verify by hand first:

```bash
curl -X POST https://<api-url>/api/jobs/sla-sweep -H "x-cron-secret: <secret>"
# {"checked":9,"breached":0,"escalated":0,"atCeiling":0,"details":[]}
```

Omitting the header must return 401. If `CRON_SECRET` is unset the endpoint
refuses everything rather than defaulting to open.

## 4 · Seed production

Once, from your machine, with `server/.env` pointing at the production database:

```bash
npm run seed
```

## 5 · Atlas access list

Serverless functions have no stable egress IP, so **Network Access must include
`0.0.0.0/0`**. Locking it to specific addresses will break the deployment
intermittently and confusingly.

The database user should still be scoped: `readWrite` on `support_sla` only, not
`atlasAdmin`. That way a wrong connection string cannot reach anything else on
the cluster.

---

## Known limits

- **Cold starts.** The first request after idle pays a Mongo connection. The
  promise is cached on `globalThis`, so only the first invocation per container
  pays it — but a burst of cold starts opens several connections at once. The
  pool is capped at 10 per container to keep that well under Atlas's limit.
- **No integration tests over the routes.** The pure SLA engine has 97 unit
  tests; the API layer was verified by hand against a live Atlas cluster. That
  gap is deliberate and worth closing.
- **The sweep depends on an external service.** If cron-job.org is down, breaches
  go undetected until it recovers. A paid Vercel plan or any always-on host would
  let `SLA_SWEEP_ENABLED=1` run the in-process cron instead.
