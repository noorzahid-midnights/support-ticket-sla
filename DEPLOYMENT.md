# Deployment

**One Vercel project.** The Express API runs inside the Next.js app as a
catch-all route at `web/pages/api/[...path].ts`, so the UI and API share an
origin and there is a single thing to deploy.

## Why it is built this way

The API started as a separate service and that failed four times. Vercel sees
`express` in the dependencies, classifies the project as a backend framework,
and selects its **Container** preset — which expects a prebuilt image. The build
then "succeeds" in under 100ms having compiled nothing, and fails at deploy.
Pinning `framework: null` did not settle it either.

Rather than keep fighting the detector, the API moved inside the Next app. Next
is unambiguous to Vercel, and two other problems disappear with it:

- **The auth cookie is first-party by construction.** Split across two domains
  every request is cross-site, the browser silently drops the cookie, and the
  app looks permanently signed out with nothing in the logs.
- **No CORS and no proxy rewrite** — there is only one origin.

It is a `pages/api` route rather than an App Router handler because App Router
handlers deal in Web `Request`/`Response`, while Express needs Node's
`req`/`res` — which is what `pages/api` provides. Next runs both routers in one
app. Next's body parser is disabled there, since Express parses its own; leaving
it on would consume the stream and every POST would arrive with an empty body.

---

## 1 · Import the project

[vercel.com/new](https://vercel.com/new) → import `support-ticket-sla`.

| Setting | Value |
| --- | --- |
| Root Directory | **`web`** |
| Framework Preset | **Next.js** (detected automatically — leave it) |

Nothing else to change. No build command, no output directory.

## 2 · Environment variables

Use **Import .env** with `vercel-web.env` from the repo root — it is generated
locally and gitignored, so it holds real values and is never committed.

| Key | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string ending `/support_sla` |
| `JWT_SECRET` | long random string |
| `CRON_SECRET` | long random string |
| `NEXT_PUBLIC_API_MODE` | `http` |
| `NEXT_PUBLIC_API_BASE_URL` | *empty* — empty means same-origin |
| `SLA_TIMEZONE` | `Asia/Karachi` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SAMESITE` | `lax` |
| `SLA_SWEEP_ENABLED` | `0` |
| `JWT_EXPIRES_IN` | `7d` |

Do **not** set `PORT` — Vercel assigns it.

`TRUST_PROXY=1` is not optional: Vercel terminates TLS at its edge and forwards
plain HTTP, so without it Express refuses to set a `Secure` cookie and every
request after login returns 401 with nothing to explain it.

`NEXT_PUBLIC_*` values are baked in at **build** time, so changing one later
needs a redeploy, not a restart.

## 3 · Deploy and check

`https://<your-app>.vercel.app/api/health` → `{"ok":true}`

Then sign in at `/login` with any seeded account.

## 4 · Schedule the breach sweep

`SLA_SWEEP_ENABLED=0` is deliberate: `node-cron` needs a process that survives
between requests, and a serverless function has none. Without a scheduler,
breaches are never detected.

Vercel Cron on the Hobby plan runs **once a day**, which is useless for an SLA.
Use [cron-job.org](https://cron-job.org) instead — free, minute-level.

| Field | Value |
| --- | --- |
| URL | `https://<your-app>.vercel.app/api/jobs/sla-sweep` |
| Method | `POST` |
| Header | `x-cron-secret: <your CRON_SECRET>` |
| Schedule | every 1–5 minutes |

The sweep escalates once per breach via latched flags, so a retrying scheduler
is safe. Omitting the header must return 401; with `CRON_SECRET` unset the
endpoint refuses everything rather than defaulting to open.

## 5 · Seed and Atlas access

Seed once from your machine with `server/.env` pointing at production:

```bash
npm run seed
```

Serverless functions have no stable egress IP, so Atlas **Network Access must
include `0.0.0.0/0`**. Scope the database user instead: `readWrite` on
`support_sla` only, never `atlasAdmin`. Then a wrong connection string cannot
reach anything else on the cluster.

---

## Running it locally

```bash
npm install
npm run dev:web     # UI and API together on :3000
```

`web/.env.local` carries the same variables as the deployment. `npm run
dev:server` still runs the API standalone on :4000 with the in-process cron,
which is useful for working on the sweep.

## Known limits

- **Cold starts.** The first request after idle pays a Mongo connection. The
  promise is cached on `globalThis`, so only the first invocation per container
  pays it, and the pool is capped at 10 to stay clear of Atlas's limit.
- **No integration tests over the routes.** The pure SLA engine has 97 unit
  tests; the API layer was verified by hand against a live cluster.
- **The sweep depends on an external scheduler.** If it is down, breaches go
  undetected until it recovers. Any always-on host could run
  `SLA_SWEEP_ENABLED=1` instead.
