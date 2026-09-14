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
(`lib/bookings.ts`, etc.); route handlers and Server Actions stay thin and just
call them. Keeps logic portable and testable - `lib/bookings.ts` is exercised
against the real database by `npm run check:bookings` (§8).

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

One Postgres database holds everything - users, memberships, bookings, WODs. No
tenant concept, no routing. The app opens straight to a login screen, and JWTs
carry the user id and role, nothing else.

Gym identity is environment configuration (`GYM_NAME`, `GYM_TIMEZONE`,
`GYM_CURRENCY`) or simply the app's design. Booking rules staff need to change
without a deploy - booking cutoff, late-cancellation window, the pacing
threshold - get a one-row `settings` table. Not built yet: none of them matters
while only staff book, from the web, so it lands with member self-booking (§8).

---

## 4. The database (`crossfit_gym`)

`db/migrations/001_init_schema.sql`

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | members and admins (role enum) |
| 2 | `plans` | membership products; `one_time` + `visits` = visit pack |
| 3 | `memberships` | user ↔ plan *and* the money for that period (§8); several per user |
| 4 | `class_types` | training modalities such as Metcon and Engine (seeded) |
| 5 | `class_sessions` | a concrete class on the calendar |
| 6 | `class_session_types` | which modalities a class is; one class can be several |
| 7 | `bookings` | user ↔ session, status lifecycle + the membership that paid |
| 8 | `wods` | programmed workout for a date; `published_at` = draft/live |

Still to land: `settings` (one row, with member self-booking) and `closures`
(§8).

**One file is the schema.** `001_init_schema.sql` was squashed on 14 September
2026 from the sixteen migrations that built it, so a fresh database runs one
readable file instead of replaying a history. A database that already ran them
has `001_init_schema.sql` in its ledger under the same name, so it skips the
new file and applies only what comes after. The old files, and why each change
was made, are in git history. Two lessons from them are worth keeping:

- **Removing an enum value means rebuilding the type.** Postgres has no
  `ALTER TYPE ... DROP VALUE`, so `user_status` lost `banned`, and
  `membership_status` lost three values, by renaming the old type, creating the
  new one, re-pointing the column and dropping the old type.
- **There is no `payments` table.** It was folded into `memberships`, which
  carries `amount_cents`, `method`, `paid_on` and `recorded_by`. The two were
  strictly 1:1 and modelling them apart let them disagree: within a day of use
  the live data already held a payment attached to no period and a period with
  no payment, so "has this member paid?" had no single answer. With the money
  on the row, no row means no payment and no coverage, by construction.

**A database that never reached the last old migration cannot take the
squash.** Its ledger already has `001_init_schema.sql`, so it would skip
everything the squash added. `002` fails there on the foreign key it drops,
and because deploys migrate at boot the app stops rather than running on a
wrong schema. Deploy the commit before the squash first, then this one.

After the squash:

- `002_booking_membership_belongs_to_member.sql` replaced the single foreign
  key from `bookings.membership_id` with a composite one,
  `(membership_id, user_id)` onto `memberships (id, user_id)`. The update form
  could move a membership to another member while its bookings still pointed
  at it, and cancelling one then returned the visit to someone else's pack. A
  membership with bookings now cannot change hands; one with none still can,
  which is how picking the wrong member gets fixed.
- `003_demo_admin.sql` adds the admin `demo@admin.com`, so a fresh database
  has someone who can log in (§10).
- `004_monthly_plan_unlimited.sql` removes the visit limit from the 60 euro
  monthly plan and from the memberships still running on it. The only limit
  left is one class a day.

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
- **`bookings.membership_id`** records *which* membership paid for each
  booking, so cancellation returns the visit to the right pack when a member
  holds several. The membership's plan already says whether it was a
  subscription or a pack, so there is no separate category column: a second
  way to say the same thing would only be free to disagree with the first.
  `NOT NULL`, because every booking is covered by a membership, paid or owed
  (§8). This spec once described a `bookings.entitlement_source` column
  instead; no migration ever created it, and `membership_id` took its place.
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
own `bookings`, plus `sync_state`. Admin data (memberships and their money) stays
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
read Scheduled. `001_init_schema.sql` pins the timezone on the database itself, so it
survives a container rebuild and applies to `psql` and the app alike;
`docker-compose.yml` sets `TZ`/`PGTZ` to match on a fresh container. On the
app side `todayInGym()` in `lib/gym-time.ts` asks for the date in an explicit
zone, which also stops a server-rendered date default disagreeing with its
browser hydration when the two machines sit in different zones.

**Two periods of one member may not overlap.** Without a rule, staff could
record 8 September to 8 October and then 9 September to 9 October, selling the
same weeks twice. `findOverlap()` in `lib/memberships.ts` refuses it, for the
membership form and for the booking that creates a period on a promise alike,
and names the period in the way. Only periods take part - a dated month or
year, or an unlimited pass with no end - so a visit pack can still sit beside
anything. Only a period the member can still use blocks: a member who spends
all twelve visits by the 20th starts the next month then, and that is a
renewal, not a mistake. Both ends of a period are inclusive and the check
compares them end-exclusive, so a renewal may start on the day the last one
ends and share that one day, but no more.

It is not an exclusion constraint, because it reads `visits_remaining`: a
cancellation hands a visit back to the old period, and a constraint would then
fail the cancellation. It runs under the member lock instead, like every other
per-member rule. The update form checks only a change to the period itself -
member, plan, start or status - so recording the money on a row never trips
it.

**The grid shows a derived state, not the stored status.** One column,
computed on every read by `membershipState()`, from the same three columns plus
`paid_on`: `Active`, `Unpaid` (money not collected), `Completed` (period
passed), `Scheduled` (not begun), `Inactive` (set by staff). It is not a
coverage check - see "The badge is not a coverage check" below. Nothing writes
it, so there is no nightly job to run and nothing to go stale - a membership
reads as Completed the morning after its period ends, on its own.

**`membership_status` is `active` / `inactive` only.**
`on_hold`, `past_due` and `expired` were all read as "not active" by the rule
above, which made them labels rather than behaviour - `past_due` now falls out
of `ends_on` being in the past. Stripe subscription states can be added back
with `ALTER TYPE ... ADD VALUE` when there is a webhook to set them.

### Entitlement resolution

Every member is a member; the only question is what covers *this* booking.
Resolved inside the booking transaction, in this order:

1. **Unlimited membership** covering the session date → book.
2. **Visits remaining** on a membership covering the date → decrement, book.
   With several packs, the one that runs out soonest pays first.
3. **Neither** → create an **unpaid membership** (below), then book against it.

The order matters: check unlimited *first*, or a member holding both a
subscription and a leftover visit pack silently burns pack visits.

**Cancellation** returns the visit to the membership recorded on the booking,
`bookings.membership_id`; an unlimited one has nothing to return. An unpaid
membership is not a special case - the booking that created it drew a visit
from it like any other, and cancelling gives the visit back to a pack that is
still owed for. Only a `booked` booking can be cancelled; one that was checked
in or missed has already happened.

When that leaves an unpaid membership with nothing booked on it - the one
booking made on a promise, cancelled - the membership still blocks every
booking the member tries. `cancelBooking` reports what is owed on it, and the
board's toast says so and points to Συνδρομές to void it if it will not be
paid. It is not voided automatically: staff may have typed that row in, and
whether it is still owed is a person's call.

### How booking is enforced

All of it lives in `lib/bookings.ts` - `bookMember`, `cancelBooking`,
`moveBooking` and `voidUnpaidMembership` - so the web dashboard now and the
mobile API later can only ever book one way. Each takes a client already inside
a transaction: Server Actions wrap it in `withTransaction`, and
`npm run check:bookings` wraps it in one it always rolls back, running every
rule in this section against the real database. The read the board uses,
`listWeekBookings` in `lib/class-sessions.ts`, takes an optional query runner
for the same reason: the check passes its transaction so it reads rows it
seeded, which the pool cannot see. That parameter is not dead, because removing
it takes the bookings of the week out of the check.

**Locks are taken member first, then class.** Locking the member row
serialises everything done to one member - two bookings, a booking and a
cancellation, a void - which is what makes the per-member rules safe without
locking more, and the fixed order is what stops two transactions deadlocking.
The class row is locked as well, because capacity is a count across rows.

**The checks run in this order:** the member exists and is active; the class
exists and is not cancelled; the member is not already booked on it; the
member does not owe money, unless a paid membership covers the day; no other
class that day; the class is not full; then entitlement. Paid coverage is
looked up before the debt gate, not after it. The other way round, click order
decided whether a paid month could still be used: booking a day past the month
created an unpaid one, which then refused a day still inside it.

**A full class is refused, not waitlisted.** A waitlist needs promotion, and
promotion has to re-run every rule above for someone who may have started
owing money since they joined it. The two land together.

**Staff may book a class that has started or ended** - that is how a walk-in
gets recorded. The cutoff that stops members doing the same, and a
late-cancellation window that keeps the visit, both belong in `settings` with
member self-booking. Until then a staff cancellation always returns the visit.

**A class with bookings cannot be deleted.** The bookings foreign key refuses,
which is the point - deleting it would take attendance history with it - and
the action says to cancel the class instead. Delete lives on the class's edit
page, away from the everyday buttons on the schedule.

**Cancelling a class gives back what its bookings spent.** The gym called it
off, not the members. `cancelSession` in `lib/bookings.ts` cancels every
booking not yet attended through `cancelBooking`, so each visit returns to the
membership that paid, and voids an unpaid membership whose only live booking
was this class, since that promise was for this class alone. A checked-in
booking stays: that member trained. Cancelling is a button on the schedule that
asks first, not a status on the class form, because a save should never cancel
a class's bookings without a word. A cancelled class shows a restore button in
its place, which brings the class back but none of its bookings.

**A move updates the booking; it does not cancel and rebook.** `moveBooking`
changes only which class the booking is on: the membership that paid and the
visit it spent stay exactly as they were. That is why a member who owes money
can still be moved - a move is not a new promise to pay, so the unpaid gate
does not apply. The destination must still be running, have a free place, and
leave the member one class that day, counting every booking except the one
being moved, so changing the hour on the same day works. Two more rules follow
from keeping the membership: it must cover the new day, or the move is refused
and staff cancel and book instead; and a cancellation the member once left on
the destination class is deleted first, since a booking is unique per member
and class. Only a booking that has not happened yet moves.

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
consuming one visit from it. The membership starts on the class's own day, so
it always covers the class it was made for, however far ahead that is. If
that period would overlap one the member already holds and can still use -
next month, paid in advance, starting after this class - the booking is
refused and names it, rather than selling the same weeks twice (see "Two
periods of one member may not overlap" above).

**One rule guards it: a member with an unpaid membership cannot book again.**
Not a visit count, not a calendar - the debt itself is the gate. The pack keeps
its full remaining visits and they simply cannot be spent until the money
arrives. When staff record the payment, everything left on it unlocks at once.
The one exception is a day a paid membership still covers: spending a period
already paid for is not a second promise, so a member who owes for October can
still book the last days of a paid September.

**`paid_on` is the whole mechanism.** `amount_cents` is what the period costs;
`paid_on` is when it was collected, and NULL means not yet. `membershipState()`
reads the two together and returns `unpaid`, so nothing has to be written when
the cash arrives beyond the date itself - no status to flip, nothing to go
stale, no nightly job. The column is nullable for exactly this.

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
that is. `paid_on` being set is the first test, and the dates have nothing to
do with it: a prepaid month starting next week is as much a record of cash as
one that started today, and destroying either destroys the only copy. Set it
inactive instead. An unpaid row records money that never arrived, so a member
who booked on a promise, never came and never paid leaves one staff can void.
A paid row entered by mistake is edited, or has its date cleared first, which
is the right amount of friction for deleting a receipt.

**Voiding takes the promise's bookings with it** - an unkept promise should
free the class spot it was holding - but only bookings nobody attended. If the
member already checked in on it, they trained on the promise: that is a debt
and attendance history, so the void is refused and staff record the payment
instead. `voidUnpaidMembership` locks the member, re-reads `paid_on` under the
lock, and deletes only bookings that were not checked in. If a check-in commits
in the narrow gap, that booking survives and the membership delete fails on the
bookings foreign key, which the action reports instead of losing the check-in.

**A zero-priced plan is never created by booking.** With no coverage the
booking copies the plan last held, and on a free plan there is no promise to
make: nothing is collected at the door. Copying it also quietly undid the
owner. A 'Friends of the gym' pass set to inactive, the pause this spec
recommends, came back paid, active and open-ended the next time staff added
the friend to a class, under a toast saying an unpaid membership had been
created. So `bookMember` refuses, and staff recreate a free membership on the
memberships screen on purpose. `memberships_unpaid_owes_something` still stands for that screen -
`CHECK (paid_on IS NOT NULL OR amount_cents > 0)` - because a row owing zero
that nobody has paid is not a state worth being able to write.

**`recorded_by` exists exactly when `paid_on` does.** It means the admin who
took the money, so an unpaid row has none, and whoever settles it later gets
stamped then. Clearing the date takes the recorder with it. One `CASE` says so
in both the insert and the update rather than two rules drifting apart. (Not a
database constraint: folding `payments` into `memberships` backfilled `paid_on` for periods with no payment
row, so one live row has a date and no recorder, and enforcing the pairing
would mean inventing a recorder for cash nobody recorded.)

**Staff view:** the memberships grid shows `Unpaid` as a solid badge with the
amount owed, and it filters like any other state. That list is the debt ledger;
there is no separate payments screen, because there is no separate payments
table.

### What this replaced

The original design gave every member **one unpaid booking per calendar
month**, to be tracked on a `bookings.entitlement_source = 'unpaid'` value and
settled against a `payments` row. Neither the column nor the value was ever
created. It was dropped for three reasons:

- **It never cleared when they paid.** Cancelling an unpaid booking freed the
  slot; settling it did not. A member who booked on the 3rd and paid the same
  evening stayed blocked until the 1st, despite owing nothing.
- **The calendar month tracked nothing real.** The question is "does this
  person owe me money right now", and a date has no opinion on it.
- **It needed machinery.** A `settings` key for the allowance, a join from
  `bookings` to `class_sessions` inside the booking transaction just to work
  out which month a class fell in, and somewhere to record the settling cash
  once `payments` was folded into `memberships`.

The replacement needs none of that: one nullable column, already there. Every
booking is covered by a membership, paid or owed, and the booking itself
records which one, as `membership_id`.

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

`/schedule` (Πρόγραμμα) is a **management** grid: build the week, create and
edit and copy classes. It knows about sessions, not people.

`/bookings` (Κρατήσεις) is a **board**: rows are the gym's five fixed slots,
columns are Monday to Friday, and each class shows its members right on it, so
staff never open a class to see who is coming. A class is titled with its time
and its places as plain text - `18:30-19:30 6/8` - with the count read through
`HOLDS_A_PLACE`, the same rule that refuses a booking. A member who owes money
carries a dot, which is `membershipState()` reading Unpaid, the same definition
the memberships grid uses.

**Moving a member is a drag.** Dropping a member on another class updates that
booking in place through `moveBooking`: same booking, same membership, same
visit. It shows at once and settles when the server answers; a refusal puts the
member back with the reason. While dragging, a class that would refuse dims and
says why before the drop. An Undo follows every move.

**Tapping a member cancels.** A tap asks to confirm, naming the member and the
class, then cancels that booking and returns its visit. The confirmation is
also the guard against a tap that was meant to be a drag. Moving is only ever a
drag: there is deliberately no second way to move from a list. A checked-in
member is not tappable.

**Check-in is not on the chip - each class carries its own button.** Every
class on the board has a roll-call button beside its `+`, opening
`/bookings/[id]` for that class: every member in it, one full-width row each
with a tick. One button marks the whole class present; Save writes it and Πίσω
leaves it, and both return to the board. Save only leaves on success, because
navigating away from a save that did not happen would throw the roll call away
at the one moment it still matters.

**Per class, not per day.** Check-in happens at the door of one class, at the
hour that class runs, so the screen holds exactly the eight names in front of
you rather than the day's forty. It also means the roll call needs no date
handling at all: the class id is the whole address.

The first attempt put a small tick inside the board chip and it was wrong on a
phone twice over. The target was 20px, and it sat *inside* the draggable, so a
press held past the touch drag delay started a drag and swallowed the tap: a
quick tap checked someone in, a slow one did not. The chip's two gestures were
already spoken for - drag to move, tap to cancel - so the third action needed
its own surface rather than a third way to press the same thing.

**A page, not a dialog.** The ticks are unsaved state, and every dialog in this
app closes on an outside click and on Escape - which is right for the confirm
dialog, where closing means "no", and wrong here, where it would throw a
half-finished roll call away. Keeping them would mean a dialog that refuses to
close, which is a dialog apologising for not being a page. A page also gives
the full width of a phone to rows that have to be hit while someone stands at
the door, survives a reload, and can be reopened by link.

**Save sends who is present, not what changed.** The diff is worked out on the
server against what the database holds, so two admins saving the same class
cannot talk past each other about a booking one of them never saw. A booking
cancelled or moved while the page was open is refused by name and the rest of
the save still stands - losing a whole class's ticks because one member left
would be worse than reporting the one. Nothing is confirmed first, because
nothing here is destructive: no visit moves in either direction, since the
visit was spent at booking, so a mis-tick is untapped and saved again.

**The `+` in a class opens a sheet** - from the right on a computer, from the
bottom on a phone - with a searchable member list. A booking made there
resolves entitlement through exactly the same path as one made from the phone,
including creating an unpaid membership when there is no coverage.

**Why a member is a plain button, not a menu.** The app's menus are Base UI,
which opens a menu on mouse-down. A member that was both draggable and a menu
trigger would pop its menu open the moment a drag started. A plain button's
click only fires when no drag happened. On touch screens a drag starts after a
short press, so a quick tap asks to cancel and a swipe still scrolls.

**Moving needs a pointer.** With moving drag-only, a keyboard alone cannot move
a member. If that ever matters, dnd-kit's keyboard sensor can pick a member up
with the space bar; it would need cell-to-cell steps added, since by default it
moves by pixels.

**Drag and drop is `@dnd-kit/core`**, chosen for its built-in touch and pointer
dragging. Calendar libraries such as FullCalendar and Schedule-X were rejected
for this: their dragging moves whole classes through time, and they have no
concept of members inside a class to drag between classes.

**They stay two screens.** The schedule answers "what is the gym running this
week"; Κρατήσεις answers "who is coming". Merging them would put edit, copy,
delete and booking on every class.

**Not the shadcn Calendar.** That component is a date picker - a month of day
numbers to click - with no hours and no events inside a day, so it cannot draw a
week of classes. It is used where it fits: the week picker opens it to jump to a
week.

Deliberately left out: a view organised by member, searching the board for one
member across the week, moving several members at once, and moving from a list
instead of by dragging.

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
  drift when a session is rescheduled. Enforced in `bookMember`.
- **More than 3 bookings in a rolling 7 days - soft, flagged.** The booking
  still goes through; the member appears in a **Dashboard table** so staff can
  see who is pacing hot. A flag, not a block, because the budget already caps
  the month and a hard weekly cap would punish someone catching up after
  missing a week. The threshold belongs in `settings` so it can change without
  a deploy.

The hard rule is built, in `bookMember`. The soft flag waits for the dashboard
that shows it, and its threshold for `settings`.

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

- **Admins** are created directly as a database row - no UI.
  `003_demo_admin.sql` seeds one, `demo@admin.com`, so a fresh database can be
  logged into. Only its scrypt hash is in the repo, but migrations run on every
  deploy, so it exists in production too: change its password there on the
  member update form before real data goes in. Any other admin is a row the
  owner inserts; `node lib/password.ts "the password"` prints a hash to paste
  into `users.password_hash`. There is no "promote to admin" button in the
  MVP: two roles and a handful of admins do not justify one.
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
| `db/migrations/001_init_schema.sql` | the whole schema, 8 tables, squashed from the first sixteen migrations | applied |
| `db/migrations/002_booking_membership_belongs_to_member.sql` | a booking's membership is the booking member's own | applied |
| `db/migrations/003_demo_admin.sql` | the admin `demo@admin.com` | applied |
| `db/migrations/004_monthly_plan_unlimited.sql` | the 60 euro monthly plan has no visit limit | applied |
| `lib/db.ts` | single pool, `withTransaction`, `greekFold()` | done |
| `lib/bookings.ts` | booking rules: book, cancel, move, check in, void an unpaid membership (§8) | done |
| `scripts/check-bookings.mts` | `npm run check:bookings`: every booking rule against the real database, rolled back | done |
| `app/(admin)/bookings/page.tsx` | Κρατήσεις: loads the week and renders the board | done |
| `components/booking-board.tsx` | the board: drag to move, tap to cancel, `+` to add, Undo | done |
| `app/(admin)/bookings/[id]/page.tsx` | Παρουσίες: one class's roll call | done |
| `components/session-check-in.tsx` | the roll call: tick, all-present, Save and Πίσω | done |
| `app/actions/bookings.ts` | book, cancel, move, and save a class's check-ins | done |
| `components/week-picker.tsx` | week jumper shared by both week pages (`basePath`) | done |
| `components/session-status-button.tsx` | cancel a class after asking, or restore a cancelled one | done |
| `scripts/migrate.mjs` | migration runner (`--dry-run`) | done |
| `app/api/health/route.ts` | connectivity smoke test | done |
| `app/page.tsx` | redirects to `/dashboard` | done |
| `lib/password.ts` | scrypt hash/verify; run directly to mint a hash | done |
| `lib/session.ts` | JWT cookie sign/verify, `requireAdmin()` - the real gate | done |
| `lib/rate-limit.ts` | in-memory login throttle | done |
| `proxy.ts` | optimistic route guard (Next 16 renamed `middleware`) | done |
| `app/actions/auth.ts` | `login` / `logout` Server Actions | done |
| `lib/members.ts` | member queries | done |
| `app/actions/members.ts` | create / update / delete, with delete guards | done |
| `app/(admin)/members/*` | list, view, create, update | done |
| `components/member-form.tsx` | shared create/update form | done |
| `components/members-toolbar.tsx` | live filters, reset, add | done |
| `components/delete-button.tsx` | every delete: asks first, a refusal shows as a toast | done |
| `components/action-form.tsx` | every create/update form: errors under their field or at the top | done |
| `components/confirm-dialog.tsx` | the app's replacement for the browser's `confirm()` | done |
| `components/toaster.tsx` | toasts for button results; mounted in the admin layout | done |
| `app/login/login-form.tsx` | client form on `ActionForm`, errors at the top | done |
| `app/login/page.tsx` | login card | done |
| `app/(admin)/layout.tsx` | sidebar shell; deliberately holds **no** auth check | done |
| `app/(admin)/dashboard/page.tsx` | calls `requireAdmin()`; otherwise a stub | stub |
| `components/app-sidebar.tsx` | nav + sign out; links to unbuilt routes | done |
| `components/ui/*` | shadcn/ui primitives | done |
| `lib/utils.ts` | `cn()` class helper, and `parseId()` for every id taken from a URL or form | done |
| `db/migrations.ts` | mobile SQLite migrations + runner | not written |

**Why the auth check is not in `app/(admin)/layout.tsx`.** Layouts do not
re-render on client-side navigation, so a check there silently stops running
after the first page load. `proxy.ts` does a cheap cookie check to keep logged
-out users out, and every admin page and Server Action calls `requireAdmin()`
itself - a Server Action is its own entry point and a page-level check does not
cover it.

**How the app reports a refusal.** The Server Action is the only validator:
forms set `noValidate`, so every message is the server's, in Greek. An action
refuses with `{ field, error }`; `ActionForm` puts the message under that field
and outlines its input red, puts an error with no field in an alert at the top,
and moves focus to whichever it is. It submits through `onSubmit` rather than
`<form action>`, because React resets a form after its action runs and a refused
save would lose everything typed. Buttons that are not forms - deletes, the
schedule's copy buttons, the bookings board - report through toasts. Anything
that cannot be undone asks first in `ConfirmDialog`, never the browser's
`confirm()`.

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
5. **Done** - **Bookings.** The week schedule with "copy last week"; the booking
   service in `lib/bookings.ts` - capacity, entitlement resolution, the unpaid
   membership, one class a day, cancellation, moving and voiding - checked by
   `npm run check:bookings`; and the **Κρατήσεις** board, where staff drag
   members between classes and tap to cancel or add. Deferred: waitlists and
   `settings` (§8)
6. **Done** - **Check-in.** A roll call per class at `/bookings/[id]`, opened
   from that class on the board: big rows, an "all present" button, and one
   Save. `checkInBooking`, `undoCheckIn` and `saveSessionCheckIns` in
   `lib/bookings.ts`, checked by `npm run check:bookings`. No schema change was
   needed - `checked_in` and `checked_in_at` have been there since `001`.
   Member self-check-in deferred, and so is marking a no-show
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
