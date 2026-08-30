# CrossFit Gym App - Project Spec

_Working document. Captures every decision made so far._

---

## 1. What we're building

A custom, branded web + mobile app for **one CrossFit gym** - ours. Not a
product for gyms in general; a product for this gym.

**Members (mobile app):** book classes and see the daily WOD. Score logging
and the leaderboard follow after the MVP.

**Gym staff (web dashboard):** manage the schedule, program WODs, manage
members and memberships, record payments, track attendance, chase unpaid
bookings.

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
| 2 | `plans` | membership products; `one_time` + `class_credits` = visit pack |
| 3 | `memberships` | user ↔ plan; a user may hold several (see §8) |
| 4 | `class_types` | WOD, Open Gym, Foundations (seeded) |
| 5 | `class_sessions` | a concrete class on the calendar |
| 6 | `bookings` | user ↔ session, status lifecycle + entitlement source |
| 7 | `wods` | programmed workout for a date; `published_at` = draft/live |
| 8 | `payments` | charge log; manual in MVP |

Landing with bookings: `settings` (one row) and `closures` (§8).

`002_drop_banned_status.sql` removed `banned` from `user_status`: a member
either has access or does not, so `active` / `inactive` covers it. Postgres has
no `ALTER TYPE ... DROP VALUE`, so that migration rebuilds the enum and
re-points the column - the pattern to copy if another enum ever loses a value.

`003_unique_lower_email.sql` made email uniqueness case-insensitive.
`004_drop_emergency_contact.sql` dropped `users.emergency_contact`: the member
form no longer collects it and nothing read it.

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
- **`bookings.entitlement_source`** (`subscription` | `credit` | `unpaid`)
  records *how* each booking was paid for. Without it you cannot tell which
  bookings owe money, and cancellation cannot know whether to refund a credit.
- **Capacity is not a DB constraint** - it is a count across rows. The booking
  transaction must `SELECT ... FOR UPDATE` the session row, or concurrent
  requests will oversell the class. Entitlement resolution happens in that
  same transaction.
- **Guard rails that cost nothing:** no negative credits, no zero-or-negative
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
method `cash`), renewals are marked manually, and `past_due` is set by hand
rather than by a webhook. The Stripe columns that once sat unused were
dropped - adding a processor later is an additive `ALTER TABLE ADD COLUMN`,
which §6 rule 3 already permits, so there was nothing to gain by carrying
five dead columns.

### Entitlement resolution

Every member is a member; the only question is what covers *this* booking.
Resolved inside the booking transaction, in this order:

1. **Active subscription** covering the session date, unlimited → book.
2. **Credits remaining** on an active plan → decrement, book.
3. **Neither** → an **unpaid** booking, allowed only if the member has no other
   unpaid booking in the same calendar month.

The order matters: check subscription *first*, or a member holding both a
subscription and a leftover visit pack silently burns pack credits.

**The one-unpaid-per-month allowance** is the grace slot - a member can book
before settling up, once per month. Enforced in the service layer, not as a DB
constraint: the rule spans `bookings` and `class_sessions` (the month comes
from the session date), so a unique index would mean denormalising the date
onto bookings and risking drift when a session is rescheduled. The transaction
already needed for capacity is the right place. The allowance lives in
`settings` so it can be changed without a deploy.

**Cancellation** reads `entitlement_source`: a `credit` booking returns the
credit, an `unpaid` one frees the monthly slot, a `subscription` one does
nothing.

**Staff view:** a dashboard list of members with unpaid bookings. Without it
the grace slot is leakage rather than a convenience.

### Visit packs - the August case

The gym closes 2-3 weeks in August. A member who wants 2-3 sessions in that
period should not carry a subscription for it.

**Answer: a visit pack.** A plan with `billing_interval = 'one_time'` and
`class_credits = 3`, priced for the period. Member pays cash, staff create the
membership row, booking decrements credits normally. **Zero new schema** - this
is the punch-card path the design already had. Members pausing a subscription
put it on `hold` and hold a pack alongside it; the resolution order above
decides which applies.

The rejected alternative was an "open tab": lift the monthly cap during a
declared closure and accrue a per-visit charge staff settle at the end. More
faithful to "he just shows up and pays", but it needs a closure-aware pricing
concept and charge accrual - real machinery for a few weeks a year.

**Consequence:** `memberships` is genuinely many-rows-per-user, not
one-active-at-a-time. Already legal in the schema, but every entitlement query
must assume it, and the dashboard shows coverage as a list, not a single badge.

### `closures`

A small table in `002`: start date, end date, reason, optional note shown in
the app. It stops the session generator creating classes on closed days, tells
members why the schedule is empty, and gives the August period a name that
reporting can group by. Four columns that remove a whole category of "why is
there no class Tuesday" messages.

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
2. **Anything else that references the row blocks it too.** Six foreign keys
   point at `users` (`bookings`, `memberships`, `payments` twice,
   `class_sessions.coach_id`, `wods.created_by`), all `NO ACTION`, so the
   `DELETE` raises `23503` and the action turns that into "has bookings,
   payments or membership history and cannot be deleted" rather than a 500.

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
5. Schedule + bookings - capacity, waitlists, check-in, entitlement
   resolution; brings `settings`, `closures` and the session generator
6. WODs - program, publish, show on the schedule
7. Manual payments dashboard, incl. the unpaid-bookings list

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
