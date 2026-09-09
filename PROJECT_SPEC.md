# CrossFit Gym App - Project Spec

_Working document. Captures every decision made so far._

---

## 1. What we're building

A custom, branded web + mobile app for **one CrossFit gym** - ours. Not a
product for gyms in general; a product for this gym.

**Members (mobile app):** book classes and see the daily WOD. Score logging
and the leaderboard follow after the MVP.

**Gym staff (web dashboard):** manage the schedule, program WODs, manage
members and memberships, take cash at the desk, check people in, chase what is
owed.

The retention engine is score logging → leaderboard; that lands post-MVP.
Friendly rivalry is what keeps CrossFit members showing up. Until then the MVP
earns its keep on booking and attendance, which is what keeps them paying.

**Everyone in the database is a member.** There are no guests, no drop-in
strangers, no public sign-ups. What varies is not *who* the person is but
*how a given booking is paid for* - see §8. Accounts are created by staff,
never by the person themselves - see §10.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Database | **PostgreSQL 17** (switched from MySQL early; nothing deployed yet) |
| Backend + Web | **Next.js** (App Router) - dashboard *and* API route handlers in one codebase |
| DB access | Plain SQL via the `pg` driver - no ORM |
| Mobile | **React Native + Expo**, local **SQLite** (`expo-sqlite`) |
| Auth storage (mobile) | `expo-secure-store` (device keychain) |
| Language | TypeScript end to end |
| Local dev | Postgres in **Docker**, Next.js via `npm run dev` (faster hot reload) |
| Production | **Own VPS**, everything in Docker, **Caddy** reverse proxy (auto HTTPS) |
| Payments | **Manual entry only.** No payment processor; no Stripe columns |
| Email | Transactional only - welcome credentials. Transport not yet chosen; see §10 |

**Architecture shape:** one API, two clients - the same pattern as a
yii2 + Ionic setup, with TypeScript everywhere.

**Code organisation rule:** business logic lives in service files
(`services/bookings.ts`, etc.); route handlers stay thin and just call them.
Keeps logic portable and testable.

### Rejected alternatives (and why)

- **Buying Wodify / PushPress** - user wants their own brand and product.
- **NestJS as a separate backend** - Next.js route handlers cover it; one
  codebase, one deployment. Trade-off accepted: less enforced structure.
- **Prisma / an ORM** - user knows SQL well; plain SQL removes a layer.
  (`Kysely` is the fallback if typed queries are ever missed.)
- **Supabase** - we are barely using the features that make it special. We have
  custom auth and custom sync, which is most of what you'd adopt Supabase *for*.
  (It is open source and self-hostable, but self-hosting means running a
  constellation of services.)
- **Railway / Neon** - fine managed Postgres, but the user prefers a VPS.
  Note: Railway is *not* open source; the open-source part that matters is
  Postgres itself, which is identical everywhere. No lock-in either way.

---

## 3. One gym, one database

One Postgres database holds everything - users, bookings, WODs, payments. No
tenant concept, no routing. The app opens straight to a login screen, and JWTs
carry the user id and role, nothing else.

Gym identity is environment configuration (`GYM_NAME`, `GYM_TIMEZONE`,
`GYM_CURRENCY`) or simply the app's design. Booking rules staff need to change
without a deploy - cutoff, cancellation window, the unpaid-booking allowance -
get a one-row `settings` table in the migration that brings bookings.

---

## 4. The database (`crossfit_gym`)

`db/migrations/001_init_schema.sql`

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | members and admins (role enum) |
| 2 | `plans` | membership products; `one_time` + `visits` = visit pack |
| 3 | `memberships` | user ↔ plan *and* the money for that period (§8); several per user |
| 4 | `class_types` | WOD, Open Gym, Foundations (seeded) |
| 5 | `class_sessions` | a concrete class on the calendar |
| 6 | `bookings` | user ↔ session, status lifecycle + entitlement source |
| 7 | `wods` | programmed workout for a date; `published_at` = draft/live |

Landing with bookings: `settings` (one row) and `closures` (§8).

`002_drop_banned_status.sql` removed `banned` from `user_status`: a member
either has access or does not, so `active` / `inactive` covers it. Postgres has
no `ALTER TYPE ... DROP VALUE`, so that migration rebuilds the enum and
re-points the column - the pattern to copy if another enum ever loses a value.

`003_unique_lower_email.sql` made email uniqueness case-insensitive.
`004_drop_emergency_contact.sql` dropped `users.emergency_contact`: the member
form no longer collects it and nothing read it.

`012_fold_payments_into_memberships.sql` **deleted the `payments` table** and
moved `amount_cents`, `method`, `paid_on` and `recorded_by` onto `memberships`.
The two were strictly 1:1 and modelling them apart let them disagree: within a
day of use the live data already held a payment attached to no period and a
period with no payment, so "has this member paid?" had no single answer. With
the money on the row, no row means no payment and no coverage, by construction.
`payment_status` went with it - cash is taken or it is not.

`013_membership_paid_on_nullable.sql` let `paid_on` be NULL again. `012` had
assumed every membership was typed in by staff with cash in hand; §8's unpaid
membership is written before the money exists. NULL is the promise to pay.

`014_unpaid_membership_owes_something.sql` added
`CHECK (paid_on IS NOT NULL OR amount_cents > 0)`: zero stays a legitimate
price for a comp or a trial, but only once the money question is settled.

**Deferred to post-MVP: `wod_scores`.** Scores, the leaderboard and benchmarks
are out of the MVP, so the table was dropped rather than left empty. The design
work is not lost - see "Scores, when they return" below.

**Design decisions baked in:**

- **Money as integer cents.** Never floats.
- **Bookings have a status lifecycle**, not just exists/doesn't:
  `booked → waitlisted → checked_in → no_show → cancelled`. This one table
  powers attendance, waitlist promotion, no-show tracking, and churn alerts.
- **Unique (user, session)** on bookings. Cancel-then-rebook is therefore an
  `UPDATE`, so the booking service is upsert-shaped - there is never a second
  row.
- **`bookings.entitlement_source`** (`subscription` | `visit`) records *how*
  each booking was paid for, so cancellation knows whether to refund a visit.
  The third value, `unpaid`, is now dead: §8 puts the debt on the membership
  instead, so every booking is covered by one, paid or owed.
- **Capacity is not a DB constraint** - it is a count across rows. The booking
  transaction must `SELECT ... FOR UPDATE` the session row, or concurrent
  requests will oversell the class. Entitlement resolution happens in that
  same transaction.
- **Guard rails that cost nothing:** no negative visits, no zero-or-negative
  capacity, and `ends_at > starts_at` on every session.
- **Waitlist position is derived, not stored.** `ROW_NUMBER() OVER (PARTITION
  BY class_session_id ORDER BY booked_at)` over waitlisted rows. A stored
  column plus a partial unique index breaks on promotion (renumbering 2→1 and
  3→2 in one statement trips the index mid-statement, and partial indexes
  cannot be `DEFERRABLE`), and it can drift. Derived cannot.
- **Soft deletes on synced tables.** `wods`, `class_sessions` and
  `class_types` carry `deleted_at` and are never hard-deleted. `GET /sync?since=`
  can say "this row changed" but has no way to say "this row is gone", so a
  hard delete would linger on every device forever.
- **`wods.published_at`** gives admins draft programming ahead of time.
- **All timestamps `TIMESTAMPTZ`, stored UTC**, rendered in `GYM_TIMEZONE`.
  Cheap discipline now, miserable to retrofit.
- **Every table has `updated_at` + a trigger.** The mobile client pulls with
  `GET /sync?since=`, so a table without one can never reach a device.
- **Cut from the MVP: scores, leaderboard, benchmarks.** All three ship later
  as their own migration - which is exactly the update path in §6.

### Scores, when they return

Dropped from `001`, but these decisions were already made and should be reused
rather than re-litigated:

- **Typed columns, not a generic value:** `time_seconds`, `rounds`, `reps`,
  `load_kg`. A per-WOD `score_type` (`time | reps | rounds_reps | load | none`)
  tells the leaderboard which to sort by - `time` ASC, `reps` DESC,
  `rounds_reps` → rounds DESC then reps DESC, `load` DESC. No `amrap`: AMRAP is
  a workout *format*, scored either as rounds+reps or as total reps.
- **`scaling` is an enum** (`rx_plus`, `rx`, `scaled`), never a boolean. Rx+ is
  real programming, and a boolean cannot express three tiers. Declared in that
  order, Postgres sorts the enum by declaration order, so the leaderboard's
  primary sort is a plain `ORDER BY scaling`.
- **`finished_within_cap`** sorts capped scores last. `wods.time_cap_seconds`
  was kept in `001` for exactly this - the cap is programming information worth
  showing even with no score to compare it against.
- **Unique (wod, user)**, and **no `ON DELETE CASCADE` from `wods`** - deleting
  a programmed WOD must not destroy logged results that devices have synced.
- **`client_uuid`** makes offline score sync idempotent (see §7).
- **Still open when this lands:** a `score_type = 'none'` WOD collides with a
  "no score row without a score" CHECK. If attendance-with-no-result should be
  loggable, that CHECK needs an exemption for `none` WODs.

---

## 5. Mobile local database (SQLite)

`db/migrations.ts` (expo-sqlite)

Mirrors **only member-facing data**: `wods`, `class_sessions`, `class_types`,
own `bookings`, plus `sync_state`. Admin data (payments, memberships) stays
server-only - this keeps the sync surface small.

With scores deferred, nothing on the device is created offline, so there is no
`pending_ops` outbox and no local `members` table yet - both return with the
leaderboard.

SQLite has no ENUM → `TEXT` + `CHECK`. Timestamps are ISO-8601 TEXT (UTC).

---

## 6. The "never force a logout" rule

**Requirement:** no app update, and no schema change, may ever force a user to
log out or lose their data. Three rules guarantee it:

1. **Auth never lives in the database.** JWTs go in `expo-secure-store`.
   Even a full local-DB rebuild leaves the session intact - the app just
   silently re-downloads data.
2. **The local DB migrates itself, never resets.** `PRAGMA user_version` +
   an append-only `MIGRATIONS[]` array. On launch the app applies only what
   the device hasn't seen, inside a transaction. The future benchmarks update
   is just `MIGRATIONS[1]`: user updates, opens the app, tables appear in
   milliseconds, background sync fills them, user notices nothing.
3. **Server changes are additive; the client tolerates unknowns.** Add columns
   and tables - never rename or repurpose. (A rename = new column + backfill,
   retire the old one only once all app versions using it are gone; mobile
   users update slowly.) Clients parse only the fields they know and ignore
   extras. Result: old app + new server works, new app + old server works.

---

## 7. Sync & offline

- **Pull:** `GET /sync?since=<timestamp>` returns rows changed after that time
  (every table has `updated_at` for exactly this), upserted into SQLite.
  `sync_state` tracks the last successful sync per entity. Soft-deleted rows
  come back too, so the device can remove them locally.
- **Push: nothing to push.** Scores were the only thing ever created offline,
  and they are deferred, so sync is **pull-only** - no outbox, no
  `client_uuid`, no FIFO flush, no local/server id reconciliation. A whole half
  of the sync engine does not need building for the MVP.
- **Bookings are online-only** - booking needs a real-time capacity *and
  entitlement* check, and an offline "booking" that silently fails hours later
  is worse UX than an honest "you're offline" at tap time. The local
  `bookings` table is a read-only mirror of confirmed bookings.

**When scores land, push comes with them:** offline writes go into local tables
immediately (marked `sync_status = 'pending'`, so they show on screen at once)
**and** into a `pending_ops` outbox. On next open with connectivity the outbox
flushes FIFO; the server upserts on `client_uuid` and returns the real
`server_id`; the local row is marked synced and the op deleted. Idempotency
comes from a client-generated UUID per row with a unique constraint
server-side, so a retried request is a no-op rather than a duplicate. Unsynced
data is lost on uninstall - accepted, not engineered around, since the sync
window is minutes.

---

## 8. Paying for a booking

**There is no payment processor.** Staff record payments by hand (default
method `cash`) and renewals are marked manually. The Stripe columns that once
sat unused were dropped - adding a processor later is an additive
`ALTER TABLE ADD COLUMN`, which §6 rule 3 already permits, so there was
nothing to gain by carrying five dead columns.

**The membership period is the source of truth for coverage**, not the payment
history. One predicate decides it, `coversDate()` in `lib/memberships.ts`, and
all three columns matter:

```sql
status = 'active' AND starts_on <= <date>
  AND (ends_on IS NULL OR ends_on >= <date>)
```

`ends_on` is derived from the plan, never typed: a monthly plan runs to the
same day of the next month (10 March to 10 April), and Postgres clamps the
short months, so 31 January becomes 28 February. A `one_time` visit pack has
no end date at all - it is consumed by count. `visits_remaining` is seeded from
`plans.visits` the same way, and a blank field on the update form re-seeds from
the plan rather than writing NULL, which would silently mean unlimited.

**Everything the app calls "today" means today in Athens.** The Postgres
container defaults to UTC and Greece is UTC+3 in summer, so between midnight
and 03:00 local `current_date` was still yesterday: for three hours every night
a membership that had ended still read Active, and one starting that morning
read Scheduled. Migration `009` pins the timezone on the database itself, so it
survives a container rebuild and applies to `psql` and the app alike;
`docker-compose.yml` sets `TZ`/`PGTZ` to match on a fresh container. On the
app side `todayInGym()` in `lib/gym-time.ts` asks for the date in an explicit
zone, which also stops a server-rendered date default disagreeing with its
browser hydration when the two machines sit in different zones.

Both ends are inclusive, so a renewal starting on the exact end date would
share that one day. Renewals are recorded by hand whenever the member next
pays, which is rarely the day the last period ended, so periods in practice
have gaps rather than overlaps and the boundary is not worth engineering
around. Revisit if renewal is ever automated.

**The grid shows a derived state, not the stored status.** One column,
computed on every read by `membershipState()`, from the same three columns:
`Active`, `Completed` (period passed), `Scheduled` (not begun), `Inactive`
(set by staff). `active` is exactly `coversDate()` being true, by construction,
so the badge and the booking service can never disagree. Nothing writes it, so
there is no nightly job to run and nothing to go stale - a membership reads as
Completed the morning after its period ends, on its own.

**`membership_status` is `active` / `inactive` only** (migration `007`).
`on_hold`, `past_due` and `expired` were all read as "not active" by the rule
above, which made them labels rather than behaviour - `past_due` now falls out
of `ends_on` being in the past. Stripe subscription states can be added back
with `ALTER TYPE ... ADD VALUE` when there is a webhook to set them.

### Entitlement resolution

Every member is a member; the only question is what covers *this* booking.
Resolved inside the booking transaction, in this order:

1. **Active subscription** covering the session date, unlimited → book.
2. **Visits remaining** on an active plan → decrement, book.
3. **Neither** → offer an **unpaid membership** (below), then book against it.

The order matters: check subscription *first*, or a member holding both a
subscription and a leftover visit pack silently burns pack visits.

**Cancellation** reads `entitlement_source`: a `visit` booking returns the
visit, a `subscription` one does nothing. An unpaid membership is not a third
case - the booking that created it is a `visit` or `subscription` booking like
any other, and cancelling it returns the visit to a pack that is still owed
for.

### Booking with no coverage: the unpaid membership

The gym takes cash, in person, but bookings happen online the night before. At
the moment someone books there is no way for money to have changed hands. So a
member whose visits or month have run out is not cheating when they book - they
are promising to pay on arrival, which is the only order of events a cash gym
can actually have. Nobody pays first and trains three days later.

**The rule: booking with no coverage creates the next membership, unpaid.**

A member out of visits taps a class. The app tells them plainly that they are
out, that they may book this one, and that they will pay when they arrive. On
confirm, one transaction writes two rows: a new membership on the plan they
last held, priced from that plan with `paid_on` left NULL, and the booking,
consuming one visit from it.

**One rule guards it: a member with an unpaid membership cannot book again.**
Not a visit count, not a calendar - the debt itself is the gate. The pack keeps
its full remaining visits and they simply cannot be spent until the money
arrives. When staff record the payment, everything left on it unlocks at once.

**`paid_on` is the whole mechanism.** `amount_cents` is what the period costs;
`paid_on` is when it was collected, and NULL means not yet. `membershipState()`
reads the two together and returns `unpaid`, so nothing has to be written when
the cash arrives beyond the date itself - no status to flip, nothing to go
stale, no nightly job. Migration `013` made the column nullable for exactly
this; `012` had assumed every membership was typed in by staff with cash in
hand.

**`coversDate()` deliberately ignores `paid_on`.** An unpaid period *is*
coverage: the member may train on the promise. What they may not do is make a
second promise, so the booking service asks two separate questions - "is this
date covered" and "do you already owe me" - rather than one confused one.

**The badge is not a coverage check.** The relationship runs one way only:
`active` is `coversDate()` being true *and* the money collected, so coverage
implies `active` or `unpaid`, never the reverse. `membershipState()` tests
`paid_on` *before* the dates, so a row that is unpaid and scheduled, or unpaid
and long finished, still reads `Unpaid` - deliberately, because a debt has to
stay visible in the ledger until someone collects it. Anything deciding
whether a member may train calls `coversDate()` or `hasCoverageToday()`; a
screen that counts `Active` badges instead will tell a member training on a
promise that they have no coverage.

**Which plan gets created:** the one they last held. A monthly member gets an
unpaid month, a pack member an unpaid pack, and neither needs a choice in the
app. A person who has never held a membership has no plan to copy, so the app
cannot offer this and staff set them up at the desk - which matches §10, where
accounts are created by staff anyway.

**Deleting an unpaid membership is allowed**, and is the only membership delete
that is. `paid_on` being set is the whole test, and the dates have nothing to
do with it: a prepaid month starting next week is as much a record of cash as
one that started today, and destroying either destroys the only copy. Set it
inactive instead. An unpaid row records money that never arrived, so a member
who booked on a promise, never came and never paid leaves one staff can void.
A paid row entered by mistake is edited, or has its date cleared first, which
is the right amount of friction for deleting a receipt. The guard is the
`DELETE`'s own `WHERE`, so nothing can change between deciding and deleting.

**A zero-priced plan is created paid, never unpaid.** There is nothing to
collect, so `paid_on` is set at creation. Migration `014` enforces it -
`CHECK (paid_on IS NOT NULL OR amount_cents > 0)` - because a row owing zero
that nobody has paid is not a state worth being able to write. This is not a
hypothetical branch: the gym already sells 'Friends of the gym' at 0 cents.

**`recorded_by` exists exactly when `paid_on` does.** It means the admin who
took the money, so an unpaid row has none, and whoever settles it later gets
stamped then. Clearing the date takes the recorder with it. One `CASE` says so
in both the insert and the update rather than two rules drifting apart. (Not a
database constraint: `012` backfilled `paid_on` for periods with no payment
row, so one live row has a date and no recorder, and enforcing the pairing
would mean inventing a recorder for cash nobody recorded.)

**Staff view:** the memberships grid shows `Unpaid` as a solid badge with the
amount owed, and it filters like any other state. That list is the debt ledger;
there is no separate payments screen, because there is no separate payments
table.

### What this replaced

The original design gave every member **one unpaid booking per calendar
month**, tracked on `bookings.entitlement_source = 'unpaid'` and settled
against a `payments` row. It was dropped for three reasons:

- **It never cleared when they paid.** Cancelling an unpaid booking freed the
  slot; settling it did not. A member who booked on the 3rd and paid the same
  evening stayed blocked until the 1st, despite owing nothing.
- **The calendar month tracked nothing real.** The question is "does this
  person owe me money right now", and a date has no opinion on it.
- **It needed machinery.** A `settings` key for the allowance, a join from
  `bookings` to `class_sessions` inside the booking transaction just to work
  out which month a class fell in, and somewhere to record the settling cash
  once `payments` was folded into `memberships` by `012`.

The replacement needs none of that: one nullable column, already there.
**Consequence: `entitlement_source = 'unpaid'` is now dead.** Every booking is
covered by a membership, paid or owed. Drop the value with the `002` pattern
when the booking service lands, or leave it as a harmless spare.

Note the rule cannot be a database constraint either way: it spans memberships
and bookings and needs the transaction that capacity already requires. Service
layer, same as before.

### Check-in

Check-in exists for three reasons, and entitlement is not one of them: it is
the moment cash is collected from a member who owes, it turns a booking into
attendance history, and it is what marks a no-show.

**Visits are deducted at booking, never at check-in.** Booking is the only
moment the system can say no. If a visit were only spent on arrival, a member
with one left could hold Monday, Tuesday and Wednesday against it, and
`visits_remaining` would stop being a real number in a column and become a
calculation - remaining minus outstanding bookings - that every caller would
have to repeat and keep in step. Deducting at booking keeps the counter always
true. Cancelling in time returns the visit; not turning up burns it, which is
the incentive that makes people cancel.

**A walk-in is a check-in that creates the booking**, consuming a visit the
same way, so there is one accounting path rather than two.

**Staff check-in is the one that matters** and ships first, because the whole
unpaid design rests on someone at the desk seeing `Unpaid` beside a name and
asking for the money.

**Member self-check-in from the app is deferred.** It is convenience, not
control - a member can tap it from the car park, and if they do the prompt to
collect their debt never appears. If it lands later, the cheap guard is a time
window (from fifteen minutes before the class until it ends), not geofencing or
QR codes.

### The two admin calendars

`/schedule` is a **management** grid: build the week, create and edit and copy
classes. It knows about sessions, not people.

Check-in needs a second screen, a **day view**: pick a date, see that day's
classes, open one and get the roster - who booked, in what order, waitlist
included, with a check-in control and an `Unpaid` flag beside each name. This
is the same calendar members see in the app, plus the attendance controls, and
it is where staff will spend opening hours.

**They stay two screens.** The week grid answers "what is the gym running this
week"; the day view answers "who is standing in front of me". Different people,
different times of day. Merging them produces a page cluttered for both jobs.

Staff also need to book a member onto a class from that day view, since not
every member will use the app, and a booking made by staff resolves entitlement
through exactly the same path as one made from the phone - including creating
an unpaid membership when there is no coverage.

### Visit pacing: one hard rule, one soft one

The monthly visit count is the budget. A 12-visit plan sold as "3 times a
week" is deliberately semi-strict: a member who trains twice this week has 10
left and may train four times next week. Note that 3/week over an average
month is about 13, so **the monthly count already bites before the weekly rate
does** - a weekly cap on top would enforce a limit stricter than the one being
charged for. Two rules instead:

- **One booking per member per calendar day - hard, refused.** Nobody attends
  two classes in a day. Enforced in the booking transaction beside the capacity
  check, not as a unique index: the day comes from `class_sessions.starts_at`,
  so an index would mean denormalising the date onto `bookings` and risking
  drift when a session is rescheduled - the same reasoning as the monthly
  allowance above.
- **More than 3 bookings in a rolling 7 days - soft, flagged.** The booking
  still goes through; the member appears in a **Dashboard table** so staff can
  see who is pacing hot. A flag, not a block, because the budget already caps
  the month and a hard weekly cap would punish someone catching up after
  missing a week. The threshold belongs in `settings` so it can change without
  a deploy.

Both need `bookings` rows to exist, so both are built with the booking service
in step 5, not before.

**Staff view:** the memberships grid filtered to `Unpaid` (§8). Without
somewhere that lists what is owed, booking on a promise is leakage rather than
a convenience.

### Visit packs - the August case

The gym closes 2-3 weeks in August. A member who wants 2-3 sessions in that
period should not carry a subscription for it.

**Answer: a visit pack.** A plan with `billing_interval = 'one_time'` and
`visits = 3`, priced for the period. Member pays cash, staff create the
membership row, booking decrements visits normally. **Zero new schema** - this
is the punch-card path the design already had. A member pausing a subscription
sets it to `inactive` and holds a pack alongside it; the resolution order above
decides which applies.

The rejected alternative was an "open tab": lift the monthly cap during a
declared closure and accrue a per-visit charge staff settle at the end. More
faithful to "he just shows up and pays", but it needs a closure-aware pricing
concept and charge accrual - real machinery for a few weeks a year.

**Consequence:** `memberships` is genuinely many-rows-per-user, not
one-active-at-a-time. Already legal in the schema, but every entitlement query
must assume it, and the dashboard shows coverage as a list, not a single badge.

### `closures` - deferred, not built

Originally planned as a table (start date, end date, reason, note). It was
never created, and on reflection it is not needed yet: **an empty day is a
closed day.** The schedule greys those days and labels them "No classes",
which takes no stored data, because the page already knows a day has nothing
on it.

The generator does not need it either. "Copy last week" is pressed per week by
a human, so a closed week is simply one nobody copies into.

What a table would add is a *reason* - "Closed 1-21 August" rather than
"No classes" - plus a name for reporting to group by. Both matter only once
**members** see the schedule in the mobile app, where a blank week is
ambiguous between "the gym is shut" and "next week is not published yet". To
an admin looking at their own schedule it never is. Revisit with the mobile
app; adding the table then is additive and breaks nothing.

---

## 9. Environment & deployment

### Local

- `docker-compose.yml` runs **Postgres only**; Next.js runs on the host via
  `npm run dev` (faster hot reload, no node_modules-in-container pain).
- Port mapping is `host:container` - Postgres always listens on **5432**
  inside the container, so `"1013:5432"` publishes it on host port 1013.
- Postgres reads `POSTGRES_USER`/`POSTGRES_PASSWORD` **only on first init**.
  Changing them later requires `docker compose down -v` (wipes the volume).
- Expo runs on the host and points at the local API - Docker not involved.

**Daily commands:** `up -d` (start), `ps` (check), `logs -f postgres`,
`stop` / `down` (keep data), `down -v` (**deletes** data).
`--build` is a no-op here - nothing is built from a Dockerfile yet.

### Production (VPS)

Same compose file plus **Caddy** (auto HTTPS, two lines of config - chosen over
nginx for that reason). Deploy = pull/build image + `docker compose up -d`.
A €10-20/month VPS (e.g. Hetzner) is far more than this needs.

Non-negotiables:

- **Offsite backups.** Nightly `pg_dump` of the one database, shipped off the
  VPS (any S3-compatible store; Backblaze B2 costs cents). Test a restore
  before trusting it.
- Postgres **not** published in production - the app reaches it over the
  internal Docker network.
- Firewall: 80/443/SSH only. SSH keys only. Unattended security updates.

The mobile app never touches the VPS - Expo/EAS builds it and the stores
distribute it; the server only serves the API.

### Git

`master` = production, `develop` = integration, `feature/*` → `develop`.
Confirm `.env.local` is gitignored before the first push.
(Windows PowerShell 5.1 doesn't support `&&` - run commands one per line,
or install PowerShell 7 / use Git Bash.)

---

## 10. Accounts and onboarding

**Nobody signs themselves up.** There is no registration form, no public
sign-up, no invite-accept flow. The only route into the database is an admin
creating the account. The app has exactly one unauthenticated screen: the
login form.

- **Admins** are created directly by the gym owner as a database row - no UI,
  no seeding script. `node lib/password.ts "the password"` prints a hash to
  paste into `users.password_hash`. There is no "promote to admin" button in
  the MVP: two roles and a handful of admins do not justify one.
- **Members** are created by an admin on the members screen. The create form
  generates a random password and carries a **Send welcome email** checkbox.
  When it is ticked the member receives an email containing their email
  address and that generated password. The generated password is never shown
  in the dashboard: the email is the only way it reaches the member, which is
  why the send has to happen inside the create action while the plaintext
  still exists in memory. If it was never sent, an admin sets a fresh one with
  the **New password** field on the update form, which leaves the existing
  password alone when left blank.
- **Changing the password is optional.** A member may change it from the
  mobile app; nothing forces them to.

**Deleting a member is a real delete, refused when it would destroy history.**
Two guards, in this order:

1. **An active membership blocks it** - checked explicitly so the message can
   say so: end the membership first.
2. **Anything else that references the row blocks it too.** Five foreign keys
   point at `users` (`bookings`, `memberships` twice - as the member and as
   `recorded_by`, the admin who took the money - `class_sessions.coach_id`,
   `wods.created_by`), all `NO ACTION`, so the `DELETE` raises `23503` and the
   action turns that into "has bookings, sessions, WODs or membership history
   and cannot be deleted" rather than a 500.

The second guard is what stops attendance and payment records being orphaned;
the first exists to give the common case a message that says what to do about
it. An admin cannot delete their own account. A member with history who has
left the gym is set to `status = 'inactive'` on the edit form instead - the
column stays, and the login action still refuses inactive accounts.

**The trade-off, recorded deliberately.** A generated password sent by email
sits in the member's inbox indefinitely, and email is not a secure channel.
Accepted here: this is one gym, the worst case is a stranger seeing someone's
class bookings, and there is no payment data or card on file anywhere in the
app. The cheap upgrade if that ever stops being true is a
`must_change_password` boolean on `users`, set at creation and cleared on
first change, which turns the generated password into a one-time credential.
Additive column, permitted by §6 rule 3.

**What this needs: no schema change.** `users.password_hash` already exists,
and the checkbox is a form option rather than stored state. Deliberately left
out of the MVP: recording whether the welcome email was sent
(`welcome_email_sent_at`), password-reset links, and email verification. All
three are additive later; none is needed to open the doors.

**Still open - the email transport.** Nothing in the stack sends email yet.
Do not run a mail server on the VPS: deliverability is a full-time job and a
fresh IP lands in spam. Two sane options, both a few lines of code. SMTP
through the mailbox the gym already sends mail from (Google Workspace,
Fastmail, whatever it is) via `nodemailer` adds no new account. A
transactional provider (Resend, Postmark, SES) costs an API key but gives
delivery logs and survives the mailbox password changing. Decide before the
members screen ships.

---

## 11. Files so far

| File | Role | Status |
|---|---|---|
| `db/migrations/001_init_schema.sql` | the schema, 8 tables | applied |
| `db/migrations/002_drop_banned_status.sql` | `user_status` loses `banned` | applied |
| `db/migrations/003_unique_lower_email.sql` | case-insensitive email uniqueness | applied |
| `db/migrations/004_drop_emergency_contact.sql` | drops `users.emergency_contact` | applied |
| `db/migrations/005-011_*.sql` | plan, membership and schedule refinements | applied |
| `db/migrations/012_fold_payments_into_memberships.sql` | drops `payments`; money moves onto `memberships` | applied |
| `db/migrations/013_membership_paid_on_nullable.sql` | `paid_on` NULL = owed, not paid (§8) | applied |
| `db/migrations/014_unpaid_membership_owes_something.sql` | an unpaid period must owe something | applied |
| `lib/db.ts` | single pool + `withTransaction` | done |
| `scripts/migrate.mjs` | migration runner (`--dry-run`) | done |
| `app/api/health/route.ts` | connectivity smoke test | done |
| `app/page.tsx` | redirects to `/dashboard` | done |
| `lib/password.ts` | scrypt hash/verify; run directly to mint a hash | done |
| `lib/session.ts` | JWT cookie sign/verify, `requireAdmin()` - the real gate | done |
| `lib/rate-limit.ts` | in-memory login throttle | done |
| `proxy.ts` | optimistic route guard (Next 16 renamed `middleware`) | done |
| `app/actions/auth.ts` | `login` / `logout` Server Actions | done |
| `lib/members.ts` | member queries, id validation | done |
| `app/actions/members.ts` | create / update / delete, with delete guards | done |
| `app/(admin)/members/*` | list, view, create, update | done |
| `components/member-form.tsx` | shared create/update form | done |
| `components/members-toolbar.tsx` | live filters, reset, add | done |
| `components/delete-member-button.tsx` | delete with confirm and guard messages | done |
| `app/login/login-form.tsx` | client form, `useActionState` errors | done |
| `app/login/page.tsx` | login card | done |
| `app/(admin)/layout.tsx` | sidebar shell; deliberately holds **no** auth check | done |
| `app/(admin)/dashboard/page.tsx` | calls `requireAdmin()`; otherwise a stub | stub |
| `components/app-sidebar.tsx` | nav + sign out; links to unbuilt routes | done |
| `components/ui/*` | shadcn/ui primitives | done |
| `lib/utils.ts` | `cn()` class helper | done |
| `db/migrations.ts` | mobile SQLite migrations + runner | not written |

**Why the auth check is not in `app/(admin)/layout.tsx`.** Layouts do not
re-render on client-side navigation, so a check there silently stops running
after the first page load. `proxy.ts` does a cheap cookie check to keep logged
-out users out, and every admin page and Server Action calls `requireAdmin()`
itself - a Server Action is its own entry point and a page-level check does not
cover it.

**`lib/db.ts` notes:** the pool is cached on `globalThis` because Next.js
hot-reload re-evaluates modules and would otherwise leak a new pool on every
file save. `db()` is the entry point every API route starts from.

**Migration runner note:** `pg` has no `multipleStatements` flag - multi-statement
strings work only over the simple query protocol, i.e. `client.query(sql)` with
**no** parameter array. Send each file whole; never split on semicolons (the
`$$`-quoted trigger body would shred). Postgres DDL is transactional, so
wrapping each file in `BEGIN`/`COMMIT` genuinely rolls back a half-applied
migration.

**Schema file convention:** comments sit *above* the column they describe and
the trigger function body is single-quoted rather than `$$`-quoted, because an
editor SQL formatter reflows this file on save and mangles both otherwise.

---

## 12. Build order

**MVP (web first):**

1. **Done** - Local environment: Postgres in Docker, Next.js scaffolded
2. **Done** - Schema + migration runner + connection manager + `/api/health`
3. **Done** - **Auth**: login form wired, JWT session cookie, `proxy.ts` guard,
   `requireAdmin()`, login throttling, sign out
4. **Mostly done** - **Members**: paginated list (20 a page) with live
   filtering, clickable rows, per-row view/update/delete actions, plus create
   and update forms. Outstanding: the welcome email, which is blocked on the
   transport decision in §10. Bookings need members to exist, so this comes
   before the schedule.
5. Schedule + bookings - capacity, waitlists, entitlement resolution and the
   unpaid membership (§8); brings `settings` and the session generator
6. Check-in - the admin **day view**: a date, its classes, each class's roster
   with a check-in control and the `Unpaid` flag staff collect against. Staff
   booking a member on from the same screen. Member self-check-in deferred
7. WODs - program, publish, show on the schedule

**Then:** mobile app (Expo) → pull sync → scores + leaderboard (brings push sync with them) → push notifications → benchmarks.

### Settled details

- **`users.email` / `password_hash` are `NOT NULL`.** Everyone has an account,
  created by staff with a generated password (§10). (Revisit only if staff must
  hand-enter bookings for members who will never open the app.)
- **Two roles only: `member` and `admin`.** No `coach` role. Admins run the web
  dashboard; members only ever use the mobile app. Authorisation is therefore
  one check - "is this user an admin" - not a permission matrix. The login
  action enforces it: a `member` who submits correct credentials on the web
  form is refused, and gets the same generic message as a wrong password.
  `class_sessions.coach_id` stays as "who is running this class", now pointing
  at an admin user.
- **Session generation:** no template table. A "copy last week" generator
  writes plain rows, is **idempotent** (skips a session that already exists at
  the same start time and class type, so double-clicking cannot duplicate a
  week), and **skips `closures`**.

### Still open

- **The soft-delete columns above do not exist yet.** §4 says `wods`,
  `class_sessions` and `class_types` carry `deleted_at`, but `001` never added
  it. Nothing can be deleted safely until it does - a hard delete lingers on
  every device forever. Options: a `deleted_at` timestamp, or fold it into the
  existing `is_active` / `session_status` columns those tables already have.
  Decide before the mobile app ships; harmless while the MVP is web-only.
