/**
 * Runnable check for lib/dashboard.ts against the real database.
 *
 *   npm run check:dashboard
 *
 * Same shape as check-bookings.mts: everything happens inside one transaction
 * that is always rolled back, so it leaves no rows behind.
 *
 * These five queries pick rows by conditions rather than by id, so a mistake
 * in one does not throw - it just returns nothing, and the tile is quietly
 * empty forever. That is what this checks: that each one finds what it should
 * and leaves out what it should not.
 */
import { register } from "node:module";

const root = new URL("../", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try {
        return await next(${JSON.stringify(root)} + specifier.slice(2) + ext, context);
      } catch {}
    }
  }
  return next(specifier, context);
}`),
);

const { db } = await import("@/lib/db");
const {
  listOwed,
  listRenewals,
  listToday,
  listQuiet,
  monthTake,
  QUIET_DAYS,
} = await import("@/lib/dashboard");

const client = await db().connect();
const failed: string[] = [];
let passed = 0;
const check = (ok: boolean, label: string) => {
  if (ok) passed++;
  else failed.push(label);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

try {
  await client.query("BEGIN");

  const one = async <T,>(sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows[0] as T;
  const newId = async (sql: string, params: unknown[]) =>
    Number((await one<{ id: string }>(sql, params)).id);

  /** `daysOld` backdates created_at, which listQuiet uses to spare new members. */
  const user = (tag: string, daysOld = 0) =>
    newId(
      `INSERT INTO users (email, password_hash, first_name, last_name, created_at)
       VALUES ($1, 'x', 'Dash', $2, now() - ($3::int * interval '1 day'))
       RETURNING id`,
      [`check-dashboard-${tag}@test.local`, tag, daysOld],
    );
  const plan = (visits: number | null, price: number, interval = "one_time") =>
    newId(
      `INSERT INTO plans (name, price_cents, currency, billing_interval, visits)
       VALUES ('dash plan', $1, 'EUR', $2, $3) RETURNING id`,
      [price, interval, visits],
    );
  /** startsIn / endsIn are days from today, so every row sits where the query looks. */
  const membership = (
    u: number,
    p: number,
    visits: number | null,
    opts: {
      startsIn?: number;
      endsIn?: number | null;
      paid?: boolean;
      amount?: number;
    } = {},
  ) => {
    const { startsIn = -1, endsIn = null, paid = true, amount = 5000 } = opts;
    return newId(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining,
          amount_cents, paid_on)
       VALUES ($1, $2,
               current_date + $3::int,
               CASE WHEN $4::int IS NULL THEN NULL ELSE current_date + $4::int END,
               $5, $6,
               CASE WHEN $7 THEN current_date ELSE NULL END)
       RETURNING id`,
      [u, p, startsIn, endsIn, visits, amount, paid],
    );
  };
  const sessionToday = (hour: string, capacity = 8) =>
    newId(
      `INSERT INTO class_sessions (starts_at, ends_at, capacity, status)
       VALUES (current_date + $1::time, current_date + $1::time + interval '1 hour', $2, 'scheduled')
       RETURNING id`,
      [hour, capacity],
    );
  const booking = (u: number, s: number, m: number, status = "booked") =>
    newId(
      `INSERT INTO bookings (user_id, class_session_id, membership_id, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [u, s, m, status],
    );

  const named = (rows: { member_name: string }[], id: number, first: string) =>
    rows.some((r) => r.member_name === `Dash ${first}`) && id > 0;

  // ----- Οφειλές -------------------------------------------------------
  {
    const before = await listOwed(client);
    const u = await user("owes");
    await membership(u, await plan(10, 6000), 10, { paid: false, amount: 6000 });
    const after = await listOwed(client);
    check(
      after.length === before.length + 1 && named(after, u, "owes"),
      "listOwed finds an unpaid membership",
    );
    check(
      after.some((r) => r.amount_cents === 6000),
      "and carries the amount owed, so the total can be summed",
    );
  }

  // ----- Ανανεώσεις ----------------------------------------------------
  {
    const before = await listRenewals(client);

    const lowVisits = await user("low-visits");
    await membership(lowVisits, await plan(10, 6000), 1);

    const endingSoon = await user("ending-soon");
    await membership(endingSoon, await plan(null, 6000, "monthly"), null, {
      startsIn: -27,
      endsIn: 3,
    });

    const plenty = await user("plenty");
    await membership(plenty, await plan(10, 6000), 9);

    // Already renewed: the old period ended, but a newer row took over, and
    // only the newest one counts.
    const renewed = await user("renewed");
    const monthly = await plan(null, 6000, "monthly");
    await membership(renewed, monthly, null, { startsIn: -60, endsIn: -30 });
    await membership(renewed, monthly, null, { startsIn: -1, endsIn: 29 });

    const after = await listRenewals(client);
    check(
      named(after, lowVisits, "low-visits"),
      "listRenewals finds a pack down to its last visits",
    );
    check(
      named(after, endingSoon, "ending-soon"),
      "and a month about to end",
    );
    check(
      !named(after, plenty, "plenty"),
      "but not a pack with visits to spare",
    );
    check(
      !named(after, renewed, "renewed"),
      "and not a member who already renewed, since only the newest counts",
    );
    check(after.length === before.length + 2, "so exactly two were added");
  }

  // ----- Σήμερα --------------------------------------------------------
  {
    const s = await sessionToday("18:00", 8);
    const u = await user("today");
    const m = await membership(u, await plan(10, 6000), 10);
    await booking(u, s, m);
    const other = await user("today-b");
    await booking(other, s, m, "checked_in");

    const today = await listToday(client);
    const mine = today.find((c) => Number(c.id) === s);
    check(
      mine !== undefined && mine.booked === 2 && mine.checked_in === 1,
      "listToday counts who holds a place and who has arrived",
    );
    check(
      mine !== undefined && mine.capacity === 8 && mine.start_time === "18:00",
      "and reports the hour and the capacity",
    );
  }

  // ----- Χωρίς προπόνηση -----------------------------------------------
  {
    const before = await listQuiet(client);
    const pack = await plan(10, 6000);
    const old = QUIET_DAYS + 10;

    // Covered and has not trained: the only one the tile is for.
    const lapsed = await user("lapsed", old);
    await membership(lapsed, pack, 10);

    // Covered, but the account is too new to read anything into.
    const fresh = await user("fresh", 1);
    await membership(fresh, pack, 10);

    // Covered, but has a class still to come.
    const booked = await user("booked-ahead", old);
    const bookedOn = await membership(booked, pack, 10);
    await booking(booked, await sessionToday("19:00"), bookedOn);

    // No membership at all: gone, not quiet.
    const gone = await user("gone", old);

    // Had one, and it ran out: renewals covers this person instead.
    const expired = await user("expired", old);
    await membership(expired, await plan(null, 6000, "monthly"), null, {
      startsIn: -60,
      endsIn: -30,
    });

    const after = await listQuiet(client);
    check(
      named(after, lapsed, "lapsed"),
      "listQuiet finds a covered member who has not trained",
    );
    check(
      !named(after, fresh, "fresh"),
      "but not one whose account is younger than the window",
    );
    check(
      !named(after, booked, "booked-ahead"),
      "and not one with a class still to come",
    );
    check(
      !named(after, gone, "gone"),
      "and not one with no membership at all",
    );
    check(
      !named(after, expired, "expired"),
      "and not one whose coverage has run out",
    );
    check(after.length === before.length + 1, "so exactly one was added");
  }

  // ----- Εισπράξεις μήνα -----------------------------------------------
  {
    const before = await monthTake(client);
    const u = await user("paid");
    await membership(u, await plan(10, 4500), 10, { amount: 4500 });
    const after = await monthTake(client);
    check(
      after.cents === before.cents + 4500 &&
        after.payments === before.payments + 1,
      "monthTake adds money collected this month",
    );

    const older = await user("paid-last-month");
    await newId(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining,
          amount_cents, paid_on)
       VALUES ($1, $2, current_date - 40, NULL, 10, 9900,
               date_trunc('month', current_date)::date - 1)
       RETURNING id`,
      [older, await plan(10, 9900)],
    );
    const stillAfter = await monthTake(client);
    check(
      stillAfter.cents === after.cents,
      "and leaves out money collected before this month",
    );
  }
} finally {
  await client.query("ROLLBACK");
  client.release();
  await db().end();
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
