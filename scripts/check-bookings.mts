/**
 * Runnable check for lib/bookings.ts against the real database.
 *
 *   npm run check:bookings
 *
 * Everything happens inside one transaction that is always rolled back, so it
 * leaves no rows behind and is safe against the dev database at any time.
 * Fixtures use dates in 2031 so nothing collides with real schedule data.
 *
 * It imports the real lib files rather than copies of their SQL. Two things
 * make that work under plain Node: a resolve hook for the @/ alias, and the
 * react-server condition, which turns import "server-only" into a no-op.
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
const { bookMember, cancelBooking, voidUnpaidMembership } = await import(
  "@/lib/bookings"
);

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

  const user = (tag: string) =>
    newId(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', 'Check', $2) RETURNING id`,
      [`check-bookings-${tag}@test.local`, tag],
    );
  const plan = (visits: number | null, price: number, interval = "one_time") =>
    newId(
      `INSERT INTO plans (name, price_cents, currency, billing_interval, visits)
       VALUES ('check plan', $1, 'EUR', $2, $3) RETURNING id`,
      [price, interval, visits],
    );
  const session = (day: string, capacity = 10, status = "scheduled") =>
    newId(
      `INSERT INTO class_sessions (starts_at, ends_at, capacity, status)
       VALUES ($1::date + time '18:00', $1::date + time '19:00', $2, $3)
       RETURNING id`,
      [day, capacity, status],
    );
  const membership = (
    u: number,
    p: number,
    visits: number | null,
    startsOn = "2031-01-01",
    endsOn: string | null = null,
  ) =>
    newId(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining, amount_cents, paid_on)
       VALUES ($1, $2, $3, $4, $5, 5000, '2031-01-01') RETURNING id`,
      [u, p, startsOn, endsOn, visits],
    );
  const visitsOf = async (m: number | string) =>
    (
      await one<{ v: number | null }>(
        "SELECT visits_remaining AS v FROM memberships WHERE id = $1",
        [m],
      )
    ).v;
  const book = (u: number, s: number) => bookMember(client, u, s, null);
  const unlimitedMarch = async (u: number) =>
    membership(
      u,
      await plan(null, 6000, "monthly"),
      null,
      "2031-03-01",
      "2031-04-01",
    );

  const MON = "2031-03-03";
  const TUE = "2031-03-04";
  const WED = "2031-03-05";
  const THU = "2031-03-06";
  const FRI = "2031-03-07";

  {
    const u = await user("never");
    const r = await book(u, await session(MON));
    check(
      !r.ok && r.error.includes("δεν είχε ποτέ"),
      "never held a membership: refused, staff set up the first",
    );
  }

  {
    const u = await user("both");
    const unlimited = await unlimitedMarch(u);
    const pack = await membership(u, await plan(10, 3000), 10);
    const r = await book(u, await session(MON));
    check(
      r.ok && Number(r.membershipId) === unlimited,
      "an unlimited membership pays before a pack",
    );
    check(
      (await visitsOf(pack)) === 10,
      "the pack keeps every visit when unlimited covers the class",
    );
  }

  const packUser = await user("pack");
  const pack = await membership(packUser, await plan(3, 3000), 3);
  const monSession = await session(MON);
  const first = await book(packUser, monSession);
  check(
    first.ok && Number(first.membershipId) === pack && !first.createdMembership,
    "a pack pays when nothing unlimited covers",
  );
  check((await visitsOf(pack)) === 2, "booking spends one visit");
  const firstBooking = first.ok ? Number(first.bookingId) : 0;
  const recorded = await one<{ m: string }>(
    "SELECT membership_id AS m FROM bookings WHERE id = $1",
    [firstBooking],
  );
  check(
    Number(recorded.m) === pack,
    "the booking records which membership paid",
  );

  {
    const s = await session(TUE);
    await book(packUser, s);
    const again = await book(packUser, s);
    check(
      !again.ok && again.error.includes("σε αυτό το μάθημα"),
      "the same class twice: refused",
    );
    const sameDay = await book(packUser, await session(TUE));
    check(
      !sameDay.ok && sameDay.error.includes("εκείνη την ημέρα"),
      "a second class the same day: refused",
    );
  }

  {
    const s = await session(WED, 1);
    const a = await user("cap-a");
    const b = await user("cap-b");
    await unlimitedMarch(a);
    await unlimitedMarch(b);
    const taken = await book(a, s);
    const refused = await book(b, s);
    check(
      taken.ok && !refused.ok && refused.error.includes("γεμάτο"),
      "a full class refuses the next member",
    );
  }

  {
    const before = Number(await visitsOf(pack));
    const cancelled = await cancelBooking(client, firstBooking);
    check(
      cancelled.ok && (await visitsOf(pack)) === before + 1,
      "cancelling returns the visit to the pack that paid",
    );
    const again = await cancelBooking(client, firstBooking);
    check(
      !again.ok,
      "a booking that is no longer active cannot be cancelled again",
    );
    const rebook = await book(packUser, monSession);
    check(
      rebook.ok && Number(rebook.bookingId) === firstBooking,
      "rebooking a cancelled class reuses the same row",
    );
    check((await visitsOf(pack)) === before, "and spends the visit again");
  }

  {
    const u = await user("promise");
    const p = await plan(12, 6000);
    const usedUp = await membership(u, p, 0);
    const r = await book(u, await session(THU));
    check(
      r.ok && r.createdMembership,
      "no coverage: the booking creates the next membership",
    );
    const madeId = r.ok ? r.membershipId : "0";
    const made = await one<{
      paid_on: string | null;
      amount_cents: number;
      starts_on: string;
      plan_id: string;
      visits_remaining: number;
    }>(
      `SELECT paid_on, amount_cents, to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
              plan_id, visits_remaining
       FROM memberships WHERE id = $1`,
      [madeId],
    );
    check(
      made.paid_on === null && made.amount_cents === 6000,
      "it is created unpaid, priced from the plan",
    );
    check(
      Number(made.plan_id) === p && made.starts_on === THU,
      "on the plan last held, starting on the class day",
    );
    check(
      made.visits_remaining === 11,
      "and the booking spends one of its visits",
    );

    const gated = await book(u, await session(FRI));
    check(
      !gated.ok && gated.error.includes("χρωστάει"),
      "a member who owes cannot book again",
    );

    await client.query(
      "UPDATE bookings SET status = 'checked_in', checked_in_at = now() WHERE membership_id = $1",
      [madeId],
    );
    const trained = await voidUnpaidMembership(client, Number(madeId));
    check(
      !trained.ok && trained.error.includes("προπονήθηκε"),
      "voiding refuses once the member trained on it",
    );

    await client.query(
      "UPDATE bookings SET status = 'booked', checked_in_at = NULL WHERE membership_id = $1",
      [madeId],
    );
    const voided = await voidUnpaidMembership(client, Number(madeId));
    const bookingsLeft = await one<{ n: string }>(
      "SELECT count(*) AS n FROM bookings WHERE membership_id = $1",
      [madeId],
    );
    const rowLeft = await one<{ n: string }>(
      "SELECT count(*) AS n FROM memberships WHERE id = $1",
      [madeId],
    );
    check(
      voided.ok && bookingsLeft.n === "0" && rowLeft.n === "0",
      "voiding an unkept promise removes it and its bookings",
    );

    const paid = await voidUnpaidMembership(client, usedUp);
    check(
      !paid.ok && paid.error.includes("εισπράχθηκαν"),
      "voiding refuses a paid membership",
    );
  }

  {
    const u = await user("free");
    await membership(u, await plan(null, 0), null, "2031-01-01", "2031-01-02");
    const r = await book(u, await session(MON));
    const made = await one<{ paid_on: string | null }>(
      "SELECT paid_on FROM memberships WHERE id = $1",
      [r.ok ? r.membershipId : "0"],
    );
    check(
      r.ok && r.createdMembership && made.paid_on !== null,
      "a zero-priced plan is created paid, never unpaid",
    );
  }

  {
    const u = await user("cancelled-class");
    await unlimitedMarch(u);
    const r = await book(u, await session(MON, 10, "cancelled"));
    check(
      !r.ok && r.error.includes("ακυρωθεί"),
      "a cancelled class cannot be booked",
    );
  }
  {
    const { moveBooking } = await import("@/lib/bookings");
    const row = (id: number) =>
      one<{ session: string; status: string }>(
        "SELECT class_session_id AS session, status FROM bookings WHERE id = $1",
        [id],
      );
    const bookingIdOf = (r: Awaited<ReturnType<typeof book>>) =>
      r.ok ? Number(r.bookingId) : 0;

    // An ordinary move: the same row, a new class, the visit untouched.
    const mover = await user("move-pack");
    const moverPack = await membership(mover, await plan(5, 3000), 5);
    const moved = bookingIdOf(await book(mover, await session(WED)));
    const visitsBefore = await visitsOf(moverPack);
    const toThu = await session(THU);
    const first = await moveBooking(client, moved, toThu);
    const afterFirst = await row(moved);
    check(
      first.ok && Number(afterFirst.session) === toThu && afterFirst.status === "booked",
      "a move updates the same booking onto the new class",
    );
    check(
      (await visitsOf(moverPack)) === visitsBefore,
      "a move neither refunds nor spends a visit",
    );

    // The moved booking does not count against one class a day.
    const laterThu = await session(THU);
    const hour = await moveBooking(client, moved, laterThu);
    check(hour.ok, "changing the hour on the same day is allowed");
    const noop = await moveBooking(client, moved, laterThu);
    check(
      noop.ok && Number((await row(moved)).session) === laterThu,
      "dropping onto the class it is already in changes nothing",
    );

    const full = await session(FRI, 1);
    const occupant = await user("move-occupant");
    await unlimitedMarch(occupant);
    await book(occupant, full);
    const intoFull = await moveBooking(client, moved, full);
    check(
      !intoFull.ok && intoFull.error.includes("γεμάτο"),
      "moving onto a full class is refused",
    );

    await book(mover, await session(FRI));
    const clash = await moveBooking(client, moved, await session(FRI));
    check(
      !clash.ok && clash.error.includes("εκείνη την ημέρα"),
      "moving onto a day the member already has a class is refused",
    );

    const intoCancelled = await moveBooking(
      client,
      moved,
      await session(MON, 10, "cancelled"),
    );
    check(
      !intoCancelled.ok && intoCancelled.error.includes("ακυρωθεί"),
      "moving onto a cancelled class is refused",
    );

    // A member who owes can still be moved: a move is not a new promise.
    const owing = await user("move-owing");
    await membership(owing, await plan(12, 6000), 0);
    const onPromise = bookingIdOf(await book(owing, await session(MON)));
    const owingMove = await moveBooking(client, onPromise, await session(TUE));
    check(owingMove.ok, "a member who owes money can still be moved");

    // The membership that paid has to cover the new day.
    const monthly = await user("move-monthly");
    await unlimitedMarch(monthly);
    const inMarch = bookingIdOf(await book(monthly, await session(MON)));
    const pastIt = await moveBooking(client, inMarch, await session("2031-04-07"));
    check(
      !pastIt.ok && pastIt.error.includes("δεν καλύπτει"),
      "a move outside the paying membership's cover is refused",
    );

    // A cancellation left on the destination does not block the move.
    const returner = await user("move-returner");
    await unlimitedMarch(returner);
    const classA = await session(MON);
    const leftA = bookingIdOf(await book(returner, classA));
    await cancelBooking(client, leftA);
    const onB = bookingIdOf(await book(returner, await session(TUE)));
    const backToA = await moveBooking(client, onB, classA);
    const rowsOnA = await one<{ n: string }>(
      "SELECT count(*) AS n FROM bookings WHERE user_id = $1 AND class_session_id = $2",
      [returner, classA],
    );
    check(
      backToA.ok && rowsOnA.n === "1" && Number((await row(onB)).session) === classA,
      "an old cancellation on the destination does not block the move",
    );

    await client.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [inMarch]);
    const attended = await moveBooking(client, inMarch, await session(TUE));
    check(!attended.ok, "a checked-in booking cannot be moved");
  }
  const { checkInBooking, saveSessionCheckIns, undoCheckIn } = await import(
    "@/lib/bookings"
  );
  const statusOf = async (id: number) =>
    (
      await one<{ status: string }>(
        "SELECT status FROM bookings WHERE id = $1",
        [id],
      )
    ).status;
  {
    const u = await user("checkin");
    const p = await membership(u, await plan(5, 3000), 5);
    const booked = await book(u, await session(MON));
    const id = booked.ok ? Number(booked.bookingId) : 0;

    const visitsBefore = await visitsOf(p);
    const marked = await checkInBooking(client, id);
    check(
      marked.ok && (await statusOf(id)) === "checked_in",
      "check-in marks the booking present",
    );
    check(
      (await visitsOf(p)) === visitsBefore,
      "check-in neither spends nor returns a visit",
    );
    check(!(await checkInBooking(client, id)).ok, "checking in twice is refused");
    check(
      !(await cancelBooking(client, id)).ok,
      "a checked-in booking cannot be cancelled",
    );

    const back = await undoCheckIn(client, id);
    check(
      back.ok && (await statusOf(id)) === "booked",
      "undo returns it to a plain booking",
    );
    check(!(await undoCheckIn(client, id)).ok, "undoing twice is refused");

    await cancelBooking(client, id);
    check(
      !(await checkInBooking(client, id)).ok,
      "a cancelled booking cannot be checked in",
    );

    // The member who owes is exactly the one staff check in: that is the
    // moment the cash is collected, so it must never be refused.
    const owing = await user("checkin-owing");
    await membership(owing, await plan(12, 6000), 0);
    const promised = await book(owing, await session(TUE));
    check(
      (await checkInBooking(client, promised.ok ? Number(promised.bookingId) : 0))
        .ok,
      "a member who owes money can still be checked in",
    );
  }
  {
    // Two members on the day, one of them already checked in.
    const a = await user("roll-a");
    const b = await user("roll-b");
    await unlimitedMarch(a);
    await unlimitedMarch(b);
    const cls = await session(WED);
    const bookA = await book(a, cls);
    const bookB = await book(b, cls);
    const idA = bookA.ok ? Number(bookA.bookingId) : 0;
    const idB = bookB.ok ? Number(bookB.bookingId) : 0;
    await checkInBooking(client, idB);

    // Saving marks A present and takes B's check-in back in one go.
    const saved = await saveSessionCheckIns(client, cls, new Set([idA]));
    check(
      saved.checkedIn === 1 &&
        saved.undone === 1 &&
        saved.refused.length === 0 &&
        (await statusOf(idA)) === "checked_in" &&
        (await statusOf(idB)) === "booked",
      "saving a class checks in who is ticked and undoes who is not",
    );

    const again = await saveSessionCheckIns(client, cls, new Set([idA]));
    check(
      again.checkedIn === 0 && again.undone === 0,
      "saving the same roll call again writes nothing",
    );

    // A booking cancelled while the page was open holds no place any more, so
    // it is not part of the class's roll call at all.
    await cancelBooking(client, idB);
    const withGone = await saveSessionCheckIns(
      client,
      cls,
      new Set([idA, idB]),
    );
    check(
      withGone.refused.length === 0 && (await statusOf(idB)) === "cancelled",
      "a cancelled booking is left out of the class entirely",
    );

    const other = await saveSessionCheckIns(
      client,
      await session(THU),
      new Set([idA]),
    );
    check(
      other.checkedIn === 0 && (await statusOf(idA)) === "checked_in",
      "saving another class leaves this one alone",
    );
  }
  {
    const { listWeekBookings } = await import("@/lib/class-sessions");
    const paying = await user("week-paying");
    await unlimitedMarch(paying);
    const owing = await user("week-owing");
    await membership(owing, await plan(12, 6000), 0);
    const leaver = await user("week-leaver");
    await unlimitedMarch(leaver);

    const inWeek = await session(WED);
    await book(paying, inWeek);
    await book(owing, inWeek);
    await book(paying, await session("2031-03-10"));
    const left = await book(leaver, await session(THU));
    if (left.ok) await cancelBooking(client, Number(left.bookingId));

    const week = await listWeekBookings(MON, client);
    const mine = week.filter((w) =>
      [paying, owing, leaver].includes(Number(w.user_id)),
    );
    check(
      mine.length === 2 && mine.every((w) => Number(w.session_id) === inWeek),
      "the week's bookings leave out cancellations and other weeks",
    );
    const flag = (u: number) =>
      mine.find((w) => Number(w.user_id) === u)?.unpaid;
    check(
      flag(owing) === true && flag(paying) === false,
      "and flag who is booked on an unpaid membership",
    );
  }
} finally {
  await client.query("ROLLBACK");
  client.release();
  await db().end();
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
