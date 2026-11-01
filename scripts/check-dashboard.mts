/**
 * The five dashboard reads in lib/dashboard.ts, run against the real database
 * and rolled back:  npm run check:dashboard
 *
 * They pick rows by condition rather than by id, so a mistake in one does not
 * throw, it returns nothing and the tile is quietly empty. This checks each
 * finds what it should and leaves out what it should not.
 */
import { check, client, newId, run } from "./check.mts";

const {
  adminToday,
  listOwed,
  listRenewals,
  listToday,
  listQuiet,
  monthTake,
  QUIET_DAYS,
} = await import("@/lib/dashboard");

await run(async () => {
  const user = (tag: string, daysOld = 0) =>
    newId(
      `INSERT INTO users (email, password_hash, first_name, last_name, created_at)
       VALUES ($1, 'x', 'Dash', $2, now() - ($3::int * interval '1 day'))
       RETURNING id`,
      [`check-dashboard-${tag}@test.local`, tag, daysOld],
    );
  const plan = (visits: number | null, price: number, interval = "one_time") =>
    newId(
      `INSERT INTO plans (name, price_cents, billing_interval, visits)
       VALUES ('dash plan', $1, $2, $3) RETURNING id`,
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

    const renewed = await user("renewed");
    const monthly = await plan(null, 6000, "monthly");
    await membership(renewed, monthly, null, { startsIn: -60, endsIn: -30 });
    await membership(renewed, monthly, null, { startsIn: -1, endsIn: 29 });

    const after = await listRenewals(client);
    check(
      named(after, lowVisits, "low-visits"),
      "listRenewals finds a pack down to its last visits",
    );
    check(named(after, endingSoon, "ending-soon"), "and a month about to end");
    check(!named(after, plenty, "plenty"), "but not a pack with visits to spare");
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
    await booking(u, s, await membership(u, await plan(10, 6000), 10));
    const other = await user("today-b");
    await booking(
      other,
      s,
      await membership(other, await plan(10, 6000), 10),
      "checked_in",
    );

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

  // ----- the phone's Σήμερα --------------------------------------------
  {
    // now() is fixed for the transaction; every class sits inside today
    // whatever the hour the check runs at.
    const midnight = "current_date::timestamptz";
    const tomorrow = "(current_date + 1)::timestamptz";
    const at = (starts: string, ends: string, status = "scheduled") =>
      newId(
        `INSERT INTO class_sessions (starts_at, ends_at, capacity, status)
         VALUES (${starts}, ${ends}, 8, $1) RETURNING id`,
        [status],
      );
    const sinceMidnight = `(now() - ${midnight})`;
    const early = await at(midnight, `${midnight} + ${sinceMidnight} / 4`);
    const later = await at(`${midnight} + ${sinceMidnight} / 4`, `${midnight} + ${sinceMidnight} / 2`);
    const running = await at("now()", "now() + interval '1 hour'");
    const soon = `now() + (${tomorrow} - now()) / 2`;
    const ahead = await at(soon, `${soon} + interval '1 hour'`);
    const off = await at(soon, `${soon} + interval '1 hour'`, "cancelled");
    const offNow = await at("now()", "now() + interval '1 hour'", "cancelled");

    const pack = await plan(10, 6000);
    const paying = await user("now-paying");
    await booking(paying, running, await membership(paying, pack, 9));
    const promised = await user("now-promised");
    const promise = await membership(promised, pack, 9, { paid: false, amount: 6000 });
    await booking(promised, running, promise);
    const elsewhere = await user("now-owes-elsewhere");
    await booking(elsewhere, early, await membership(elsewhere, pack, 9));
    await membership(elsewhere, pack, 10, { startsIn: 5, paid: false });
    const left = await user("now-left");
    await booking(left, ahead, await membership(left, pack, 9), "cancelled");

    const today = await adminToday(client);
    const ids = (list: { id: string }[]) => list.map((c) => Number(c.id));
    const up = ids(today.upcoming);
    const done = ids(today.finished);
    check(
      done.includes(early) && done.includes(later) && !up.includes(early),
      "Σήμερα puts a class that ended earlier today under finished",
    );
    check(
      done.indexOf(later) !== -1 && done.indexOf(later) < done.indexOf(early),
      "finished classes come newest first",
    );
    check(
      up.indexOf(running) !== -1 &&
        up.indexOf(running) < up.indexOf(ahead) &&
        !done.includes(running),
      "the running class is upcoming, before the ones still to start",
    );
    const cls = (id: number) => today.upcoming.find((c) => Number(c.id) === id);
    check(
      cls(running)?.is_now === true &&
        cls(ahead)?.is_now === false &&
        cls(offNow)?.is_now === false,
      "and only the running one is marked as now, not one cancelled at that hour",
    );
    check(
      cls(off)?.status === "cancelled",
      "a cancelled class is still listed, marked cancelled",
    );

    const flag = (id: number, u: number) =>
      cls(id)?.people.find((p) => Number(p.user_id) === u)?.unpaid;
    check(
      flag(running, paying) === false && flag(running, promised) === true,
      "each class lists who is booked, flagging who is on an unpaid membership",
    );
    check(
      cls(ahead)?.people.length === 0,
      "a cancelled booking is not listed",
    );

    const pay = today.pays.find((p) => Number(p.membership_id) === promise);
    check(
      pay?.member_name === "Dash now-promised" &&
        pay.amount_cents === 6000 &&
        pay.plan_name === "dash plan" &&
        pay.start_time === cls(running)?.start_time,
      "pays lists the member on an unpaid membership with its plan, amount and class time",
    );
    const payers = today.pays.map((p) => p.member_name);
    check(
      !payers.includes("Dash now-paying") && !payers.includes("Dash now-owes-elsewhere"),
      "but not a member booked today on a paid membership, even one who owes for another",
    );
  }

  // ----- Χωρίς προπόνηση -----------------------------------------------
  {
    const before = await listQuiet(client);
    const pack = await plan(10, 6000);
    const old = QUIET_DAYS + 10;

    const lapsed = await user("lapsed", old);
    await membership(lapsed, pack, 10);

    const fresh = await user("fresh", 1);
    await membership(fresh, pack, 10);

    const booked = await user("booked-ahead", old);
    const bookedOn = await membership(booked, pack, 10);
    await booking(booked, await sessionToday("19:00"), bookedOn);

    const gone = await user("gone", old);

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
    check(!named(after, booked, "booked-ahead"), "and not one with a class still to come");
    check(!named(after, gone, "gone"), "and not one with no membership at all");
    check(!named(after, expired, "expired"), "and not one whose coverage has run out");
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
});
