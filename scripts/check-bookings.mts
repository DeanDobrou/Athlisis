/**
 * Every rule in lib/bookings.ts, run against the real database and rolled
 * back:  npm run check:bookings
 *
 * Fixtures use dates in 2031 so nothing collides with real schedule data.
 */
import { check, client, newId, one, run } from "./check.mts";

const {
  bookMember,
  cancelBooking,
  cancelSession,
  checkInBooking,
  moveBooking,
  saveSessionCheckIns,
  undoCheckIn,
  voidUnpaidMembership,
} = await import("@/lib/bookings");
const { listWeekBookings } = await import("@/lib/class-sessions");
const { findOverlap } = await import("@/lib/memberships");

await run(async () => {
  const user = (tag: string) =>
    newId(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', 'Check', $2) RETURNING id`,
      [`check-bookings-${tag}@test.local`, tag],
    );
  const plan = (visits: number | null, price: number, interval = "one_time") =>
    newId(
      `INSERT INTO plans (name, price_cents, billing_interval, visits)
       VALUES ('check plan', $1, $2, $3) RETURNING id`,
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
  const count = async (from: string, params: unknown[]) =>
    Number((await one<{ n: string }>(`SELECT count(*) AS n ${from}`, params)).n);
  const visitsOf = async (m: number | string) =>
    (
      await one<{ v: number | null }>(
        "SELECT visits_remaining AS v FROM memberships WHERE id = $1",
        [m],
      )
    ).v;
  const bookingRow = (id: number) =>
    one<{ session: string; status: string }>(
      "SELECT class_session_id AS session, status FROM bookings WHERE id = $1",
      [id],
    );
  const statusOf = async (id: number) => (await bookingRow(id)).status;
  const book = (u: number, s: number) => bookMember(client, u, s);
  // A booking a fixture needs to succeed. A refusal there is a broken fixture,
  // not a finding, so it stops the run and names itself.
  const booked = async (u: number, s: number) => {
    const r = await book(u, s);
    if (!r.ok) throw new Error(`fixture booking refused: ${r.error}`);
    return {
      ...r,
      bookingId: Number(r.bookingId),
      membershipId: Number(r.membershipId),
    };
  };

  const pack3 = await plan(3, 3000);
  const pack5 = await plan(5, 3000);
  const pack12 = await plan(12, 6000);
  const month12 = await plan(12, 6000, "monthly");
  const unlimited = await plan(null, 6000, "monthly");
  const free = await plan(null, 0);
  /** A paid unlimited March: the plain "this member is covered" fixture. */
  const unlimitedMarch = (u: number) =>
    membership(u, unlimited, null, "2031-03-01", "2031-04-01");

  const MON = "2031-03-03";
  const TUE = "2031-03-04";
  const WED = "2031-03-05";
  const THU = "2031-03-06";
  const FRI = "2031-03-07";

  // ----- who pays ------------------------------------------------------
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
    const march = await unlimitedMarch(u);
    await membership(u, pack12, 10);
    const r = await book(u, await session(MON));
    check(
      r.ok && Number(r.membershipId) === march,
      "an unlimited membership pays before a pack",
    );
  }

  const packUser = await user("pack");
  const pack = await membership(packUser, pack3, 3);
  const monSession = await session(MON);
  const first = await booked(packUser, monSession);
  check(
    first.membershipId === pack && (await visitsOf(pack)) === 2,
    "a pack pays when nothing unlimited covers, and the booking spends one visit",
  );

  // ----- one place, one class a day ------------------------------------
  {
    const s = await session(TUE);
    await booked(packUser, s);
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
    await booked(a, s);
    const refused = await book(b, s);
    check(
      !refused.ok && refused.error.includes("γεμάτο"),
      "a full class refuses the next member",
    );
  }

  // ----- cancelling ----------------------------------------------------
  {
    const before = Number(await visitsOf(pack));
    const cancelled = await cancelBooking(client, first.bookingId);
    check(
      cancelled.ok &&
        cancelled.unpaidLeftCents === null &&
        (await visitsOf(pack)) === before + 1,
      "cancelling returns the visit to the pack that paid, and reports nothing on a paid one",
    );
    const rebook = await book(packUser, monSession);
    check(
      rebook.ok && Number(rebook.bookingId) === first.bookingId,
      "rebooking a cancelled class reuses the same row",
    );
  }

  // ----- the promise to pay --------------------------------------------
  {
    const u = await user("promise");
    const usedUp = await membership(u, pack12, 0);
    const r = await booked(u, await session(THU));
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
      [r.membershipId],
    );
    check(
      r.createdMembership &&
        made.paid_on === null &&
        made.amount_cents === 6000 &&
        Number(made.plan_id) === pack12 &&
        made.starts_on === THU &&
        made.visits_remaining === 11,
      "no coverage: the booking creates the next membership, unpaid, priced from the plan last held, starting on the class day, one visit spent",
    );

    const gated = await book(u, await session(FRI));
    check(
      !gated.ok && gated.error.includes("χρωστάει"),
      "a member who owes cannot book again",
    );

    await client.query(
      "UPDATE bookings SET status = 'checked_in' WHERE membership_id = $1",
      [r.membershipId],
    );
    const trained = await voidUnpaidMembership(client, r.membershipId);
    check(
      !trained.ok && trained.error.includes("προπονήθηκε"),
      "voiding refuses once the member trained on it",
    );

    await client.query(
      "UPDATE bookings SET status = 'booked' WHERE membership_id = $1",
      [r.membershipId],
    );
    const voided = await voidUnpaidMembership(client, r.membershipId);
    check(
      voided.ok &&
        (await count("FROM bookings WHERE membership_id = $1", [r.membershipId])) === 0 &&
        (await count("FROM memberships WHERE id = $1", [r.membershipId])) === 0,
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
    const pass = await membership(u, free, null);
    await client.query(
      "UPDATE memberships SET status = 'inactive' WHERE id = $1",
      [pass],
    );
    const r = await book(u, await session(MON));
    check(
      !r.ok &&
        r.error.includes("δωρεάν") &&
        (await count("FROM memberships WHERE user_id = $1", [u])) === 1,
      "a revoked free pass is not recreated by booking",
    );
  }
  {
    const u = await user("paid-then-owed");
    const paid = await membership(u, month12, 5, "2031-09-08", "2031-10-08");
    const past = await booked(u, await session("2031-10-09"));
    const inside = await book(u, await session("2031-10-06"));
    check(
      past.createdMembership &&
        inside.ok &&
        Number(inside.membershipId) === paid &&
        (await visitsOf(paid)) === 4,
      "a day past the paid month makes a promise; a day inside it still books on the paid month",
    );
  }
  {
    const u = await user("cancel-last-promise");
    await membership(u, pack12, 0);
    const promised = await booked(u, await session(MON));
    const second = await newId(
      `INSERT INTO bookings (user_id, class_session_id, membership_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [u, await session(TUE), promised.membershipId],
    );
    const oneOfTwo = await cancelBooking(client, promised.bookingId);
    check(
      oneOfTwo.ok && oneOfTwo.unpaidLeftCents === null,
      "cancelling one of two bookings on a promise reports nothing",
    );
    const last = await cancelBooking(client, second);
    check(
      last.ok &&
        last.unpaidLeftCents === 6000 &&
        (await count("FROM memberships WHERE id = $1", [promised.membershipId])) === 1,
      "cancelling the last one reports the unpaid membership left behind, and leaves it for staff",
    );
  }

  // ----- moving --------------------------------------------------------
  {
    const mover = await user("move-pack");
    const moverPack = await membership(mover, pack5, 5);
    const { bookingId: moved } = await booked(mover, await session(WED));
    const toThu = await session(THU);
    const first = await moveBooking(client, moved, toThu);
    const after = await bookingRow(moved);
    check(
      first.ok &&
        Number(after.session) === toThu &&
        after.status === "booked" &&
        (await visitsOf(moverPack)) === 4,
      "a move updates the same booking onto the new class, and neither refunds nor spends a visit",
    );

    const laterThu = await session(THU);
    check(
      (await moveBooking(client, moved, laterThu)).ok,
      "changing the hour on the same day is allowed",
    );
    const noop = await moveBooking(client, moved, laterThu);
    check(
      noop.ok && Number((await bookingRow(moved)).session) === laterThu,
      "dropping onto the class it is already in changes nothing",
    );

    const full = await session(FRI, 1);
    const occupant = await user("move-occupant");
    await unlimitedMarch(occupant);
    await booked(occupant, full);
    const intoFull = await moveBooking(client, moved, full);
    check(
      !intoFull.ok && intoFull.error.includes("γεμάτο"),
      "moving onto a full class is refused",
    );

    await booked(mover, await session(FRI));
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

    const owing = await user("move-owing");
    await membership(owing, pack12, 0);
    const { bookingId: onPromise } = await booked(owing, await session(MON));
    check(
      (await moveBooking(client, onPromise, await session(TUE))).ok,
      "a member who owes money can still be moved",
    );

    const monthly = await user("move-monthly");
    await unlimitedMarch(monthly);
    const { bookingId: inMarch } = await booked(monthly, await session(MON));
    const pastIt = await moveBooking(client, inMarch, await session("2031-04-07"));
    check(
      !pastIt.ok && pastIt.error.includes("δεν καλύπτει"),
      "a move outside the paying membership's cover is refused",
    );

    const returner = await user("move-returner");
    await unlimitedMarch(returner);
    const classA = await session(MON);
    const { bookingId: leftA } = await booked(returner, classA);
    await cancelBooking(client, leftA);
    const { bookingId: onB } = await booked(returner, await session(TUE));
    const backToA = await moveBooking(client, onB, classA);
    check(
      backToA.ok &&
        (await count(
          "FROM bookings WHERE user_id = $1 AND class_session_id = $2",
          [returner, classA],
        )) === 1 &&
        Number((await bookingRow(onB)).session) === classA,
      "an old cancellation on the destination does not block the move",
    );

    await client.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [inMarch]);
    check(
      !(await moveBooking(client, inMarch, await session(TUE))).ok,
      "a checked-in booking cannot be moved",
    );
  }

  // ----- check-in ------------------------------------------------------
  {
    const u = await user("checkin");
    const p = await membership(u, pack5, 5);
    const { bookingId: id } = await booked(u, await session(MON));
    const marked = await checkInBooking(client, id);
    check(
      marked.ok &&
        (await statusOf(id)) === "checked_in" &&
        (await visitsOf(p)) === 4,
      "check-in marks the booking present and moves no visit",
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

    const owing = await user("checkin-owing");
    await membership(owing, pack12, 0);
    const { bookingId: promised } = await booked(owing, await session(TUE));
    check(
      (await checkInBooking(client, promised)).ok,
      "a member who owes money can still be checked in",
    );
  }
  {
    const a = await user("roll-a");
    const b = await user("roll-b");
    await unlimitedMarch(a);
    await unlimitedMarch(b);
    const cls = await session(WED);
    const { bookingId: idA } = await booked(a, cls);
    const { bookingId: idB } = await booked(b, cls);
    await checkInBooking(client, idB);

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

    await cancelBooking(client, idB);
    const withGone = await saveSessionCheckIns(client, cls, new Set([idA, idB]));
    check(
      withGone.refused.length === 0 && (await statusOf(idB)) === "cancelled",
      "a cancelled booking is left out of the class entirely",
    );

    const other = await saveSessionCheckIns(client, await session(THU), new Set([idA]));
    check(
      other.checkedIn === 0 && (await statusOf(idA)) === "checked_in",
      "saving another class leaves this one alone",
    );
  }

  // ----- the board's read ----------------------------------------------
  {
    const paying = await user("week-paying");
    await unlimitedMarch(paying);
    const owing = await user("week-owing");
    await membership(owing, pack12, 0);
    const leaver = await user("week-leaver");
    await unlimitedMarch(leaver);

    const inWeek = await session(WED);
    await booked(paying, inWeek);
    await booked(owing, inWeek);
    await booked(paying, await session("2031-03-10"));
    const left = await booked(leaver, await session(THU));
    await cancelBooking(client, left.bookingId);

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

  // ----- a booking's membership is its member's (migration 002) --------
  {
    const other = await user("reassign");
    const reassign = (m: number) =>
      client.query("UPDATE memberships SET user_id = $1 WHERE id = $2", [other, m]);
    await client.query("SAVEPOINT reassign");
    const refusedBy = await reassign(pack).then(
      () => "",
      (err: { constraint?: string }) => err.constraint ?? "",
    );
    await client.query("ROLLBACK TO SAVEPOINT reassign");
    check(
      refusedBy === "bookings_membership_belongs_to_member",
      "a membership with bookings cannot move to another member",
    );
    const spare = await membership(packUser, pack3, 3);
    check(
      (await reassign(spare)).rowCount === 1,
      "one with no bookings still can, to fix picking the wrong member",
    );
  }

  // ----- two periods may not overlap -----------------------------------
  {
    const u = await user("overlap");
    const sep = await membership(u, month12, 12, "2031-09-08", "2031-10-08");
    const clashes = async (
      start: string,
      p = month12,
      exclude: number | null = null,
    ) => Boolean(await findOverlap(client, u, p, start, exclude));

    check(await clashes("2031-09-09"), "a month starting inside another month is refused");
    check(await clashes("2031-08-20"), "and so is one running into it");
    check(!(await clashes("2031-10-08")), "a renewal may start on the day the last one ends");
    check(!(await clashes("2031-09-09", month12, sep)), "a row being edited is not in its own way");
    check(!(await clashes("2031-09-09", pack5)), "a visit pack may sit beside a month");

    await client.query("UPDATE memberships SET visits_remaining = 0 WHERE id = $1", [sep]);
    check(!(await clashes("2031-09-20")), "a month with no visits left does not block the next");
    await client.query(
      "UPDATE memberships SET visits_remaining = 12, status = 'inactive' WHERE id = $1",
      [sep],
    );
    check(!(await clashes("2031-09-09")), "nor does an inactive month");

    const friend = await user("overlap-pass");
    await membership(friend, free, null, "2031-09-09");
    check(
      Boolean(await findOverlap(client, friend, free, "2031-09-01")),
      "a second unlimited pass is refused",
    );

    const ahead = await user("overlap-ahead");
    await membership(ahead, month12, 12, "2031-03-10", "2031-04-10");
    const early = await book(ahead, await session(MON));
    check(
      !early.ok && early.error.includes("επικαλυπτόταν"),
      "booking before a later month starts does not create an overlapping one",
    );
  }

  // ----- cancelling a class --------------------------------------------
  {
    const cls = await session(TUE);

    const packer = await user("cancel-pack");
    const packed = await membership(packer, pack5, 5);
    await booked(packer, cls);

    const came = await user("cancel-came");
    const cameOn = await membership(came, pack5, 5);
    const { bookingId: attended } = await booked(came, cls);
    await checkInBooking(client, attended);

    const promiser = await user("cancel-promise");
    await membership(promiser, pack12, 0);
    const { membershipId: promiseId } = await booked(promiser, cls);

    const twice = await user("cancel-twice");
    await membership(twice, pack12, 0);
    const { membershipId: sharedId } = await booked(twice, cls);
    await client.query(
      `INSERT INTO bookings (user_id, class_session_id, membership_id)
       VALUES ($1, $2, $3)`,
      [twice, await session(WED), sharedId],
    );

    const r = await cancelSession(client, cls);
    check(
      r.ok && r.cancelled === 2 && r.voided === 1 && (await visitsOf(packed)) === 5,
      "cancelling a class cancels its bookings, returns their visits, and voids a promise made for it alone",
    );
    check(
      (await statusOf(attended)) === "checked_in" && (await visitsOf(cameOn)) === 4,
      "a member who already checked in keeps the booking and the visit spent",
    );
    check(
      (await count("FROM memberships WHERE id = $1", [promiseId])) === 0 &&
        (await count("FROM memberships WHERE id = $1", [sharedId])) === 1,
      "the promise made only for this class goes, one paying for another stays",
    );
    const late = await book(await user("cancel-late"), cls);
    check(
      !late.ok && late.error.includes("ακυρωθεί"),
      "a cancelled class cannot be booked",
    );
  }
});
