# Support Ticket System — SLA Engine

A helpdesk where the hard part is the SLA engine: response and resolution deadlines that
count **business hours only**, **pause** while a ticket waits on the customer, and
**auto-escalate** when breached.

Next.js + Tailwind + shadcn/ui · Express + Mongoose · node-cron · JWT with three roles.

---

## The thing that matters

An SLA of "4 hours" means four hours of *business* time. A ticket filed at 17:00 on Friday
with a 4-hour clock is not due at 21:00 Friday — it is due at **12:00 on Monday**.
Subtracting two timestamps cannot tell you that; you have to walk the calendar.

Get that wrong and nothing looks broken. Every deadline, every escalation and every
dashboard sort is quietly off, and the only symptom is agents being paged about tickets
that were never late. So the calculator was built and proven **first**, before anything
was built on top of it.

It lives in [`shared/business-time.ts`](shared/business-time.ts) — pure functions, no
database, no clock reads, no framework:

```ts
businessMsBetween(start, end, calendar)   // elapsed business time
addBusinessMs(start, ms, calendar)        // a duration → a real, storable deadline
subtractBusinessMs(end, ms, calendar)     // the inverse, used for exact seeding
isOpenAt(t, calendar)  ·  nextOpenMoment(t, calendar)  ·  previousOpenMoment(t, calendar)
```

Both the Express server and the browser import this same file, so the countdown on screen
and the deadline in the database cannot disagree.

### Three decisions worth explaining

**Timezone.** Business hours are wall-clock times; timestamps are UTC. Each day's window is
resolved independently through `fromZonedTime`, which applies the offset in force *on that
date*. Precomputing one offset for a whole range breaks across DST. The day cursor also
advances by calendar day in the target zone, never by `+86_400_000`, which would drift an
hour across a transition and eventually skip or repeat a day.

**Roll-forward.** `addBusinessMs` moves a start that is outside business hours to the next
open moment before counting. A ticket filed at 02:00 Saturday gets a clock that starts
Monday 09:00. Without this its deadline lands in dead time and every weekend ticket shows
up already breached on Monday morning, before an agent could possibly have seen it.

**Negative time.** `businessMsBetween` returns `0`, never a negative, when `end` precedes
`start` — a negative would flow into a deadline and produce a ticket due before it existed.

### The ambiguous hour

During a fall-back transition, 01:00–01:59 happens twice, so `"2026-11-01T01:00:00"` names
two different instants and no library can pick the right one. `date-fns-tz` resolves it to
the later (standard-time) offset. That behaviour is **pinned by a test** rather than worked
around, so if the library ever changes its mind the suite fails first and says why. A
realistic 09:00–18:00 calendar never straddles a 02:00 transition, so it cannot affect
production SLAs — but the tests exercise a 01:00–05:00 window that does, to prove the
per-day offset logic is actually doing something.

---

## Verified

```
shared    88 tests   business-time (48) · sla (28) · transitions (12)
server    12 tests   routing rules
```

All 100 pass; `tsc --noEmit` is clean across all three packages and `next build` succeeds.

The business-hours suite covers same-day, before-open, after-close, overnight, weekend,
multi-week, zero-length, reversed, closed days, holidays, both DST transitions, a window
that straddles one, and the iteration guard. Two **property tests** assert the round trip
`businessMsBetween(t, addBusinessMs(t, n)) === n` over 800 seeded random pairs, and a third
does the same for `subtractBusinessMs` — that is what catches the boundary bugs hand-written
cases miss.

Exercised end to end against a live **MongoDB Atlas** cluster — Express API, Mongoose
models, JWT auth and the node-cron sweep, not just the pure engine:

| Requirement | Verified against the running stack |
| --- | --- |
| Deadlines respect business hours | TK-1005, filed 02:00 Saturday, came due **Monday 11:00** |
| Sorted by SLA urgency | `GET /api/tickets?mine=true` returned −22h, −16h, −6h, +20h, +21h — ascending, worst first |
| Clock pauses on `waiting_on_customer` | TK-1004 held `pausedAt` set and did not breach while frozen |
| **Clock resumes on customer reply** | **~65 wall-clock hours** paused → **20.02 business hours** credited. Deadline moved Fri 4 Sep 12:54 → Tue 8 Sep 14:54, exactly 20 business hours later. The weekend contributed nothing. |
| Auto-escalation on breach | The **cron fired unprompted**: `high→urgent`, two `medium→high`, and the already-urgent ticket **flagged for an admin** rather than promoted into a priority that does not exist |
| Escalation does not repeat | The sweep has run every minute since; escalation counts are still 1. Two further manual sweeps: `newlyBreached=0` |
| Illegal transitions rejected | `PATCH /status` to `closed` from `waiting_on_customer` → **422**, naming the legal next states |
| Priority auto-routing | TK-1010 created through the live API: matched a DB-stored keyword rule → **urgent**, auto-assigned to the least-loaded agent |
| Credentials cannot be enumerated | Wrong password and unknown email return the **identical** message |
| Role scoping | Enforced server-side as a query filter; a customer cannot express a request that returns another customer's tickets |

The one deliberate gap: there are **no integration tests** over the Express routes. The
pure engine is covered exhaustively by unit tests, and the stack above was verified by
hand. Automating that pass is the obvious next piece of work.

---

## Run it

Requires Node 18.18+ (developed on 24.19).

```bash
npm install
```

### Full stack

Needs a MongoDB Atlas connection string.

1. Create a free M0 cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → add a user. Give it **Specific Privileges**: role `readWrite`,
   database `support_sla`, collection left blank. A scoped user means a mistyped URI
   cannot reach anything else on the cluster — worth the extra thirty seconds if the
   cluster hosts anything you care about.
3. **Network Access** → add your IP, or `0.0.0.0/0` for a demo.
4. **Connect → Drivers**, copy the string, and put it in `server/.env` as `MONGODB_URI`.
   Replace **both** `<db_username>` and `<db_password>`, and insert `/support_sla` before
   the `?`. Use an alphanumeric password: anything containing `@ : / ? # [ ] %` must be
   percent-encoded, and getting that wrong surfaces as a generic auth failure that looks
   exactly like a wrong password.
5. Seed and run:

```bash
npm run seed        # wipes and reseeds only the collections it owns
npm run dev:server  # API on :4000, cron sweep every minute
npm run dev:web     # UI on :3000
```

`web/.env.local` needs `NEXT_PUBLIC_API_MODE=http` (it ships that way).

Every seeded account uses the password `password123` — `admin@helpdesk.test`,
`ana@helpdesk.test` (agent), `dana@customer.test` (customer), and four more listed on the
sign-in screen.

The one-click roster and that password are printed on the sign-in screen **only in mock
mode**. Against a real API the login page offers nothing but the form, since a working
password on a public login page is a hole rather than a convenience. See
[Handing it over](#handing-it-over) for what to do with the seeded accounts on a real
deployment.

### Frontend only — no database

Set `NEXT_PUBLIC_API_MODE=mock` in `web/.env.local` and run `npm run dev:web` alone.

The whole UI then runs on in-memory fixtures **driven by the real SLA engine** — the mock
imports `shared/sla.ts` and `shared/business-time.ts`, so the deadlines, pauses and
escalations are computed by the same code the server uses. That is what let the entire
frontend be built and demonstrated before the database existed without the demo being a
fiction. A **View as** switcher appears in the sidebar for hopping between accounts, and
`__helpdeskReset()` in the console reseeds.

---

## How the SLA clock is modelled

Deadlines are **materialised** on the ticket rather than recomputed from the event log on
every read. Recomputation is more obviously correct, but the brief demands an agent
dashboard *sorted* by urgency and an admin report *querying* breaches — both need an
indexed due date. The event log remains the audit trail and the source a repair routine can
rebuild from.

```ts
sla: {
  firstResponseDueAt, resolutionDueAt,
  pausedAt,                 // non-null exactly while status is waiting_on_customer
  pausedBusinessMs,         // accumulated across every past pause
  firstResponseBreached,    // latched, so escalation fires once per breach
  resolutionBreached,
  escalationCount,
}
```

`atRisk` is **computed on read, never stored** — a stored flag would depend on when the cron
last ran rather than on what time it is.

| Event | Effect |
| --- | --- |
| Created | Both deadlines = `addBusinessMs(createdAt, policy)` |
| First agent reply | `firstResponseAt` set; that deadline freezes into a did-we-make-it record |
| → `waiting_on_customer` | `pausedAt = now`. Deadlines untouched; the sweep skips paused tickets, so a paused clock cannot breach |
| ← customer replies | Both deadlines move forward by `businessMsBetween(pausedAt, now)` — *business* time, so a weekend spent waiting credits nothing |
| Priority changes | Rebuilt from the original `createdAt` under the new policy, then pushed forward by banked pause time. Deriving from the anchor makes it idempotent, which matters because the cron can touch the same ticket repeatedly |
| → `reopened` | Resolution clock re-armed from now, not resurrected |

Escalation *shortens* an SLA, so a ticket can come out of it already breached. That is
intended — it is exactly what the admin breach report exists to surface.

### State machine

Expressed as data in [`shared/transitions.ts`](shared/transitions.ts) so the API and the UI
read the same source: the status dropdown offers exactly what the server will accept, which
is the only way to avoid a UI that presents an option and then 422s on it.

`waiting_on_customer → closed` is **absent by design** — the brief's own example. A ticket
still waiting on the customer must pass through `resolved` first, so somebody records what
the resolution actually was. A customer's only levers anywhere in the table are replying
(which moves the ticket to `in_progress`) and reopening.

---

## Auto-routing and assignment

**Priority** comes from a `RoutingRule` collection an admin can edit — data, not code, so
"add *outage* to the urgent list" is not a redeploy. Every active rule whose keyword matches
contributes its weight; highest weight wins, ties break towards the more severe priority.
Erring upward is the safer default: a medium ticket treated as high costs some attention, an
urgent one treated as medium costs a breach. Keywords match on **word boundaries**, so
"down" does not fire on "download" — the single most likely false positive in a keyword
router, and a tested case.

**Assignment is least-loaded**, not round-robin. Round-robin assumes tickets are
interchangeable units of work, and they are not: an agent who happens to draw three urgent
incidents in a row keeps being handed more while a colleague sitting on two closed tickets
gets nothing. Least-loaded targets present workload, which is what actually determines
whether an SLA gets met — and it is the same aggregation the admin workload view already
needs, so there is no second source of truth. Ties break towards the least-recently
assigned agent, recovering round-robin's one real virtue when load is genuinely equal.

## The escalation sweep

**node-cron, not BullMQ.** BullMQ needs Redis — a second piece of infrastructure to
provision and keep alive for what is one indexed query a minute over a small collection. The
honest trade-off: this runs in-process, so two server instances would each sweep and would
need a lock (or a real queue) before it scales horizontally.

The pass itself is [`escalation.service.ts`](server/src/services/escalation.service.ts),
exported as a plain async function so it can be tested and triggered from the admin UI
without waiting for a tick. It skips resolved, closed and paused tickets, and keys off the
*transition into* breach via the latched flags — without that, a minute-ly cron would walk a
low-priority ticket up to urgent in four minutes flat. An already-urgent ticket is flagged
and logged, never promoted into a priority that does not exist.

---

## Layout

```
shared/     the SLA engine + domain types. Pure, imported by both sides.
server/     Express · routes → services → models. No business rules in the models.
web/        Next.js App Router. No component calls fetch; everything goes through lib/api.
```

`web/lib/api` has two implementations behind one interface, which is why the entire UI was
built and demonstrated before a database existed, and why switching to the real backend is a
shape-fixing exercise rather than a rewrite.

The typeface is **self-hosted** in `web/app/fonts/`. `next/font/google` fetches at build
time and, when that fetch fails, silently substitutes a metric-matched system font rather
than erroring — so the app renders in the wrong typeface with nothing visibly wrong.

## Design

Deep forest-green brand on sage-tinted surfaces, white cards, big tightly-tracked headline
type, generous space. Light and dark are both *selected* — the dark theme steps from the
same ramps against a dark surface rather than being an automatic flip — and the toggle
offers light / system / dark, with an inline script stamping the saved choice before first
paint so there is no flash.

The part that matters is that a ticket has to communicate three different things at once,
and they get three different kinds of encoding rather than three colours competing for the
same red:

| Dimension | Kind | Encoding |
| --- | --- | --- |
| **SLA health** | a state | The reserved status palette — good / warning / critical / paused. Never reused for anything else, and always shipped with an icon **and** a label, so colour is reinforcement rather than the message. Also drawn as a rail down the left edge of each row, which is the fastest read in the list. |
| **Priority** | a magnitude | A single-hue **ordinal blue ramp** plus a four-step meter glyph. Severity reads from the number of filled bars even in greyscale, which a colour-only pill never manages. |
| **Status** | an identity | A neutral chip with a small coloured dot. Deliberately recessive: status is the least urgent of the three. |

Before that split, "urgent" and "breached" were both red and a scan of the table could not
tell you which you were looking at. The brand green (187°, very dark) and the "on track"
green (120°, vivid) are far apart in both hue and lightness, so a button never reads as a
health signal.

Two pieces of interface do real explanatory work rather than decoration:

- **The SLA ring** on the ticket detail is an arc because the thing being shown is a clock.
  It shows time *remaining*, so a healthy ticket has a full ring that drains — showing
  consumed time instead would render a brand-new urgent ticket as an almost-empty ring, at
  exactly the moment it most needs attention. Settled states fill completely: green for met,
  red for missed.
- **The business-hours indicator** in the sidebar says whether the office is open and when
  it next opens. The premise of the whole app is that clocks only run during business hours,
  and that is invisible until something makes it visible — an agent looking at a frozen
  countdown at 19:00 has the explanation already on screen. Every stopped clock says why it
  stopped, because a frozen number with no explanation reads as a bug.

Hero artwork is a **vector dial motif**, not a photograph: a photo behind live numbers needs
a scrim to stay readable, which muddies the palette, and it says nothing about the product.
The motif is the ticket-detail gauge enlarged, so it costs nothing to ship, themes itself,
and stays crisp at any size.

## Known limits

- Sorting by urgency happens in memory over a bounded window (2000 rows). Urgency cannot be
  expressed as a Mongo sort — it depends on which deadline is live, the pause state, and
  business hours between now and the due date. Real scale would maintain a precomputed
  urgency field updated by the same sweep that checks for breaches.
- The cron holds no distributed lock, so a single instance is assumed.
- Business-hours windows must sit within one calendar day; overnight shifts (22:00–06:00)
  are rejected by `validateCalendar` rather than silently mishandled.
- Admin notification is a console log, which the brief permits. It is isolated behind one
  function so swapping in email is a single edit.

## Handing it over

The seeded roster exists so the system can be demonstrated with a populated queue. Before
real users touch a deployment:

1. Sign in as `admin@helpdesk.test` and open **Your account** (the name in the sidebar).
   Change the email and password to the real administrator's.
2. Ask the real staff to sign up. Sign-up always creates a customer — the role is hardcoded
   server-side, so nobody can grant themselves a queue by posting `role: "admin"`.
3. Promote them on **Team**. An agent starts receiving auto-assignment immediately.
4. Delete the remaining seeded accounts from **Team**. Deletion is refused while somebody
   still owns or is assigned a live ticket, so reassign or close those first — otherwise the
   ticket list would be left pointing at a user that no longer exists.

Two accounts cannot be removed or demoted, by design: your own, and the last remaining
admin. Either would be a one-way door out of the admin area, recoverable only by editing the
database by hand.

## Out of scope

Live chat, email-to-ticket ingestion, knowledge base, CSAT surveys.
