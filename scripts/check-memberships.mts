/**
 * The membership rules, run against the real database and rolled back:
 * npm run check:memberships
 */
import { check, client, newId, one, run } from "./check.mts";
import {
  book,
  booked,
  count,
  membership,
  MON,
  plan,
  session,
  THU,
  TUE,
  user,
  visitsOf,
  WED,
} from "./fixtures.mts";

const { cancelBooking, visitsAfterEdit, voidUnpaidMembership } = await import(
  "@/lib/bookings"
);
const {
  findOverlap,
  memberHistory,
  memberMemberships,
  membershipState,
  updateMembership,
} = await import("@/lib/memberships");

await run(async () => {
  const pack1 = await plan(1, 1000);
  const pack3 = await plan(3, 3000);
  const pack5 = await plan(5, 3000);
  const pack12 = await plan(12, 6000);
  const month12 = await plan(12, 6000, "monthly");
  const unlimited = await plan(null, 6000, "monthly");
  const free = await plan(null, 0);

  /** A member with a used-up pack who books `day` on a promise: an unpaid 12-pack, 11 left. */
  const promise = async (tag: string, day: string) => {
    const u = await user(tag);
    await membership(u, pack12, 0);
    return { u, ...(await booked(u, await session(day))) };
  };
  const gone = async (m: number) =>
    (await count("FROM memberships WHERE id = $1", [m])) === 0 &&
    (await count("FROM bookings WHERE membership_id = $1", [m])) === 0;

  // ----- deleting an unpaid membership ---------------------------------
  {
    const ahead = await promise("void-ahead", THU);
    check(
      (await voidUnpaidMembership(client, ahead.membershipId)).ok &&
        (await gone(ahead.membershipId)),
      "a promise for a class still to come is deleted with its booking",
    );

    const past = await promise("void-past", "2020-03-04");
    const refused = await voidUnpaidMembership(client, past.membershipId);
    check(
      !refused.ok &&
        refused.error.includes("(04/03)") &&
        refused.error.includes("60,00") &&
        (await count("FROM bookings WHERE membership_id = $1", [past.membershipId])) === 1,
      "one whose class has started is refused with the class date and the debt, even with no check-in",
    );

    const skipped = await promise("void-skipped", "2020-03-04");
    await cancelBooking(client, skipped.bookingId);
    check(
      (await voidUnpaidMembership(client, skipped.membershipId)).ok &&
        (await gone(skipped.membershipId)),
      "a booking cancelled before a past class does not block it, and is deleted with it",
    );

    const early = await promise("void-checked-in", THU);
    await client.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [
      early.bookingId,
    ]);
    check(
      !(await voidUnpaidMembership(client, early.membershipId)).ok,
      "a check-in before the class starts is refused too",
    );

    const paid = await voidUnpaidMembership(
      client,
      await membership(await user("void-paid"), pack12, 0),
    );
    check(
      !paid.ok && paid.error.includes("εισπράχθηκαν"),
      "a paid membership is refused",
    );
  }

  // ----- the state staff read ------------------------------------------
  {
    const u = await user("state");
    const stateOf = async (m: number) =>
      (
        await one<{ state: string }>(
          `SELECT ${membershipState()} AS state FROM memberships m WHERE m.id = $1`,
          [m],
        )
      ).state;
    check(
      (await stateOf(await membership(u, pack5, 0, "2020-01-01"))) === "completed",
      "a paid pack with no visits left reads completed",
    );
    check(
      (await stateOf(await membership(u, pack5, 2, "2020-01-01"))) === "active",
      "one with visits left reads active",
    );
    check(
      (await stateOf(await membership(u, month12, 0, "2020-01-01", "2031-12-31"))) === "active",
      "a month not yet over reads active, even with no visits left",
    );
    check(
      (await stateOf(await membership(u, unlimited, null, "2020-01-01"))) === "active",
      "a pass with no end and no count reads active",
    );
    const owed = await promise("state-owed", MON);
    await client.query("UPDATE memberships SET visits_remaining = 0 WHERE id = $1", [
      owed.membershipId,
    ]);
    check(
      (await stateOf(owed.membershipId)) === "unpaid",
      "an unpaid pack with no visits left still reads unpaid",
    );
  }

  // ----- the visits kept when a membership is edited -------------------
  {
    const p = await promise("switch", MON);
    const after = (planId: number, typed: number | null | undefined) =>
      visitsAfterEdit(client, p.membershipId, planId, typed);
    const gives = async (
      planId: number,
      typed: number | null | undefined,
      want: number | null,
    ) => {
      const r = await after(planId, typed);
      return r.ok && r.visits === want;
    };

    check(
      await gives(pack5, undefined, 4),
      "a new plan with the field left as shown: its count less the booking already on it",
    );
    check(await gives(pack5, null, 4), "the same when staff clear the field");
    check(await gives(pack5, 2, 2), "a number staff typed wins");
    check(await gives(unlimited, undefined, null), "an unlimited plan has no count");
    check(
      await gives(pack12, undefined, 11),
      "the same plan with the field left as shown keeps the stored count",
    );
    check(await gives(pack12, null, 12), "and clearing it gives the plan's count");

    const more = async (day: string) =>
      newId(
        `INSERT INTO bookings (user_id, class_session_id, membership_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [p.u, await session(day), p.membershipId],
      );
    await more(TUE);
    const third = await more(WED);
    const tooFew = await after(pack1, null);
    check(
      !tooFew.ok &&
        tooFew.error.includes("3 κρατήσεις") &&
        tooFew.error.includes("τουλάχιστον 3"),
      "a plan with fewer visits than the bookings on it is refused",
    );
    check(await gives(pack3, null, 0), "one with exactly enough leaves none");
    await cancelBooking(client, third);
    check(await gives(pack3, null, 1), "a cancelled booking does not count");
  }
  {
    const u = await user("switch-race");
    const m = await membership(u, pack12, 12);
    await booked(u, await session(MON));
    // The form loads now, showing 11; the member then books from the phone.
    await booked(u, await session(TUE));
    const kept = await visitsAfterEdit(client, m, pack12, undefined);
    check(
      kept.ok && kept.visits === 10,
      "a booking made while the form was open stays spent when staff save it untouched",
    );
    const pack10 = await plan(10, 5000);
    const moved = await visitsAfterEdit(client, m, pack10, undefined);
    check(
      moved.ok && moved.visits === 8,
      "and a switch counts it too",
    );

    const form: Record<string, string> = {
      user_id: String(u),
      plan_id: String(pack12),
      status: "active",
      starts_on: "2031-01-01",
      amount: "50",
      method: "cash",
      paid_on: "2031-01-01",
      visits_remaining: "11",
      visits_shown: "11",
    };
    const saved = await updateMembership(client, m, (k) => form[k] ?? "", u);
    check(
      !("error" in saved) && (await visitsOf(m)) === 10,
      "saving the edit form with the field untouched keeps the visits the database has",
    );
  }

  // ----- a booking's membership is its member's (migration 002) --------
  {
    const owner = await user("reassign-owner");
    const used = await membership(owner, pack3, 3);
    await booked(owner, await session(MON));
    const other = await user("reassign");
    const reassign = (m: number) =>
      client.query("UPDATE memberships SET user_id = $1 WHERE id = $2", [other, m]);
    await client.query("SAVEPOINT reassign");
    const refusedBy = await reassign(used).then(
      () => "",
      (err: { constraint?: string }) => err.constraint ?? "",
    );
    await client.query("ROLLBACK TO SAVEPOINT reassign");
    check(
      refusedBy === "bookings_membership_belongs_to_member",
      "a membership with bookings cannot move to another member",
    );
    const spare = await membership(owner, pack3, 3);
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

  // ----- a member's own memberships on the phone ----------------------
  {
    const u = await user("own-memberships");
    const upcoming = await membership(u, unlimited, null, "2031-03-01", "2031-04-01");
    const emptyMonth = await membership(u, month12, 0, "2020-01-01", "2031-12-31");
    const usedUp = await membership(u, pack5, 0, "2020-01-01");
    const ended = await membership(u, month12, 3, "2020-01-01", "2020-02-01");
    const forever = await membership(u, unlimited, null, "2020-01-01");
    const owed = await newId(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining, amount_cents)
       VALUES ($1, $2, '2020-01-01', '2020-02-01', 0, 6000) RETURNING id`,
      [u, month12],
    );
    await membership(await user("own-memberships-other"), pack5, 5, "2020-01-01");

    const mine = await memberMemberships(u, client);
    const has = (id: number) => mine.find((m) => Number(m.id) === id);
    check(
      Boolean(has(upcoming)) && Boolean(has(emptyMonth)),
      "a member sees a period not yet over, even with no visits left",
    );
    check(Boolean(has(forever)), "and a pass with no end and no visit count");
    check(
      !has(usedUp) && !has(ended),
      "but not a used-up pack or a period that has ended",
    );
    check(
      has(owed)?.owed_cents === 6000 && has(owed)?.state === "unpaid",
      "an unpaid one stays, with what is owed, even after it ended",
    );
    check(
      mine.length === 4 && has(upcoming)?.owed_cents === null,
      "a paid one owes nothing, and another member's never shows",
    );

    const past = await memberHistory(u, null, client);
    const ids = past?.memberships.map((m) => Number(m.id)) ?? [];
    check(
      ids.length === 2 && ids.includes(usedUp) && ids.includes(ended),
      "history holds exactly the paid ones the phone's list leaves out",
    );
    check(
      past?.next === null && ids[0] === ended,
      "newest first, ties by the later one, with no page after the last",
    );
    const first = await memberHistory(u, null, client, 1);
    const second = first?.next ? await memberHistory(u, first.next, client, 1) : null;
    check(
      Number(first?.memberships[0]?.id) === ended &&
        Number(second?.memberships[0]?.id) === usedUp &&
        second?.next === null,
      "history pages on, one cursor at a time",
    );
    check(
      (await memberHistory(u, "not-a-cursor", client)) === null,
      "a made-up cursor is refused",
    );
  }
});
