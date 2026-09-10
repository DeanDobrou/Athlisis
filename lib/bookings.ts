import "server-only";

import type { PoolClient } from "pg";

import { coversDate, periodEndsOn } from "@/lib/memberships";

/**
 * The booking rules, in one place, so the web dashboard today and the mobile
 * API later can only ever book one way. Every write takes a client that is
 * already inside a transaction: actions wrap it in withTransaction, and
 * scripts/check-bookings.mts wraps it in one that is rolled back.
 *
 * Locks are always taken member first, then class. Locking the member
 * serialises everything done to one member at a time - two bookings, a
 * booking and a cancellation, a move, a void - which is what makes the
 * per-member rules (one class a day, the unpaid gate, visit counting) safe
 * without locking more. Taking them in a fixed order is what stops two
 * transactions deadlocking on each other.
 */

/**
 * The statuses that hold a place in a class: anything but cancelled. A no-show
 * held the place whether or not they came, and waitlisted is not written yet.
 * One definition, for the capacity check and for every count a screen shows.
 */
export const HOLDS_A_PLACE = "('booked', 'checked_in', 'no_show')";

/**
 * Anything that can run a query: the pool, or a client inside a transaction.
 * The week queries in lib/class-sessions.ts take one so
 * scripts/check-bookings.mts can run them against rows it seeded in its
 * rolled-back transaction, which the pool cannot see.
 */
export type Queryable = Pick<PoolClient, "query">;

export const TRAINED_ON_UNPAID_MEMBERSHIP =
  "Το μέλος προπονήθηκε με αυτή τη συνδρομή, οπότε χρωστάει. Κατάγραψε την πληρωμή αντί να τη διαγράψεις.";

export type BookingResult =
  | {
      ok: true;
      bookingId: string;
      membershipId: string;
      createdMembership: boolean;
    }
  | { ok: false; error: string };

// ponytail: staff may book a class that has already started or ended - that
// is how a walk-in gets recorded. The booking cutoff that stops members doing
// the same belongs in settings, with member self-booking.
export async function bookMember(
  client: PoolClient,
  userId: number,
  sessionId: number,
  actingAdminId: number | null,
): Promise<BookingResult> {
  const { rows: member } = await client.query<{ status: string }>(
    "SELECT status FROM users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  if (member.length === 0) return { ok: false, error: "Άγνωστο μέλος." };
  if (member[0].status !== "active") {
    return { ok: false, error: "Το μέλος είναι ανενεργό." };
  }

  // Capacity is a count across rows, not a constraint, so the class row is
  // locked before counting or two staff could both take the last spot.
  const { rows: session } = await client.query<{
    capacity: number;
    status: string;
    day: string;
  }>(
    `SELECT capacity, status, to_char(starts_at, 'YYYY-MM-DD') AS day
     FROM class_sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  if (session.length === 0) return { ok: false, error: "Άγνωστο μάθημα." };
  if (session[0].status === "cancelled") {
    return { ok: false, error: "Το μάθημα έχει ακυρωθεί." };
  }
  const { capacity, day } = session[0];

  const { rows: existing } = await client.query<{ status: string }>(
    "SELECT status FROM bookings WHERE user_id = $1 AND class_session_id = $2",
    [userId, sessionId],
  );
  if (existing.length > 0 && existing[0].status !== "cancelled") {
    return {
      ok: false,
      error: "Το μέλος έχει ήδη κράτηση σε αυτό το μάθημα.",
    };
  }

  // A member who owes cannot book again, whatever else they hold: the debt is
  // the gate, not a visit count. Inactive rows are left out because that is
  // staff setting a membership aside, which the grid shows as Inactive.
  const { rowCount: owes } = await client.query(
    `SELECT 1 FROM memberships
     WHERE user_id = $1 AND status = 'active' AND paid_on IS NULL LIMIT 1`,
    [userId],
  );
  if (owes) {
    return {
      ok: false,
      error: "Το μέλος χρωστάει για συνδρομή. Νέα κράτηση μόλις πληρώσει.",
    };
  }

  // Nobody attends two classes in a day. The day is the class's own date in
  // the gym's timezone (migration 009), the same one the schedule shows.
  const { rowCount: sameDay } = await client.query(
    `SELECT 1 FROM bookings b
     JOIN class_sessions s ON s.id = b.class_session_id
     WHERE b.user_id = $1 AND b.status <> 'cancelled'
       AND s.starts_at::date = $2::date AND b.class_session_id <> $3
     LIMIT 1`,
    [userId, day, sessionId],
  );
  if (sameDay) {
    return { ok: false, error: "Το μέλος έχει ήδη κράτηση εκείνη την ημέρα." };
  }

  // ponytail: a full class is refused, not waitlisted. A waitlist needs
  // promotion, and promotion has to re-run every rule above for someone who
  // may have started owing money since they joined it. Add the two together.
  //
  // This count is its own statement, after the lock, on purpose: folded into
  // the locking SELECT it could read a snapshot from before a concurrent
  // booking committed, and oversell the class it was meant to protect.
  const { rows: taken } = await client.query<{ count: string }>(
    `SELECT count(*) FROM bookings
     WHERE class_session_id = $1 AND status IN ${HOLDS_A_PLACE}`,
    [sessionId],
  );
  if (Number(taken[0].count) >= capacity) {
    return { ok: false, error: "Το μάθημα είναι γεμάτο." };
  }

  // What pays: an unlimited membership covering the day first, then the pack
  // that runs out soonest. Unlimited first, or a member holding a subscription
  // and a leftover pack silently burns pack visits. Every active membership
  // left here is paid, because the gate above refused anyone who owes.
  const { rows: covering } = await client.query<{ id: string }>(
    `SELECT m.id FROM memberships m
     WHERE m.user_id = $1 AND ${coversDate("$2::date")}
       AND (m.visits_remaining IS NULL OR m.visits_remaining > 0)
     ORDER BY m.visits_remaining IS NULL DESC, m.ends_on ASC NULLS LAST, m.id
     LIMIT 1`,
    [userId, day],
  );

  let membershipId: string;
  let createdMembership = false;
  if (covering.length > 0) {
    membershipId = covering[0].id;
  } else {
    // No coverage: the booking is a promise to pay, so it creates the next
    // membership on the plan the member last held, priced, with paid_on left
    // empty. It starts on the class's own day, so it always covers the class
    // it was made for however far ahead that is. A zero-priced plan has
    // nothing to collect and is created paid - migration 014 refuses an
    // unpaid row that owes nothing.
    const { rows: made } = await client.query<{ id: string }>(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining,
          amount_cents, paid_on, recorded_by)
       SELECT $1, p.id, $2::date, ${periodEndsOn("$2")}, p.visits,
              p.price_cents,
              CASE WHEN p.price_cents = 0 THEN current_date END,
              CASE WHEN p.price_cents = 0 THEN $3::bigint END
       FROM plans p
       WHERE p.id = (
         SELECT plan_id FROM memberships WHERE user_id = $1
         ORDER BY starts_on DESC, id DESC LIMIT 1
       )
       RETURNING id`,
      [userId, day, actingAdminId],
    );
    if (made.length === 0) {
      return {
        ok: false,
        error:
          "Το μέλος δεν είχε ποτέ συνδρομή. Η πρώτη γίνεται από την οθόνη Συνδρομές.",
      };
    }
    membershipId = made[0].id;
    createdMembership = true;
  }

  // Visits are spent at booking, never at check-in: this is the only moment
  // the system can refuse, and it keeps visits_remaining a real count rather
  // than remaining-minus-outstanding. Unlimited is NULL and left alone.
  await client.query(
    `UPDATE memberships SET visits_remaining = visits_remaining - 1
     WHERE id = $1 AND visits_remaining IS NOT NULL`,
    [membershipId],
  );

  // Cancel then rebook the same class reuses the row, unique per member and
  // class, so this is an upsert. The check above means any row it collides
  // with is a cancelled one.
  const { rows: booking } = await client.query<{ id: string }>(
    `INSERT INTO bookings (user_id, class_session_id, membership_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, class_session_id) DO UPDATE
       SET status = 'booked', membership_id = EXCLUDED.membership_id,
           booked_at = now(), cancelled_at = NULL, checked_in_at = NULL
     RETURNING id`,
    [userId, sessionId, membershipId],
  );

  return {
    ok: true,
    bookingId: booking[0].id,
    membershipId,
    createdMembership,
  };
}

export async function cancelBooking(
  client: PoolClient,
  bookingId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rows: found } = await client.query<{ user_id: string }>(
    "SELECT user_id FROM bookings WHERE id = $1",
    [bookingId],
  );
  if (found.length === 0) return { ok: false, error: "Άγνωστη κράτηση." };
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [
    found[0].user_id,
  ]);

  // ponytail: a staff cancellation always returns the visit. A late-cancel
  // window that keeps it belongs in settings, with member self-booking.
  const { rows: cancelled } = await client.query<{ membership_id: string }>(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = now()
     WHERE id = $1 AND status = 'booked'
     RETURNING membership_id`,
    [bookingId],
  );
  if (cancelled.length === 0) {
    return { ok: false, error: "Η κράτηση δεν είναι ενεργή." };
  }

  await client.query(
    `UPDATE memberships SET visits_remaining = visits_remaining + 1
     WHERE id = $1 AND visits_remaining IS NOT NULL`,
    [cancelled[0].membership_id],
  );
  return { ok: true };
}

export type MoveResult = { ok: true } | { ok: false; error: string };

/**
 * Moves a booking to another class by updating it in place: the same booking,
 * the same membership and the same visit, on a different class. Nothing is
 * refunded or spent, so this is not a cancel and a rebook - and a member who
 * owes money can still be moved, because a move is not a new promise to pay.
 *
 * The destination still has to meet the rules a booking meets: the class is
 * running and has a free place, and the member has no other class that day.
 * The membership that paid must also cover the new day. When it does not, the
 * move is refused rather than quietly charging a different membership, and
 * staff cancel and book instead.
 */
export async function moveBooking(
  client: PoolClient,
  bookingId: number,
  targetSessionId: number,
): Promise<MoveResult> {
  const { rows: found } = await client.query<{ user_id: string }>(
    "SELECT user_id FROM bookings WHERE id = $1",
    [bookingId],
  );
  if (found.length === 0) return { ok: false, error: "Άγνωστη κράτηση." };
  const userId = found[0].user_id;
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);

  // Re-read under the member lock: it may have been cancelled or moved since.
  const { rows: booking } = await client.query<{
    status: string;
    class_session_id: string;
    membership_id: string;
  }>(
    `SELECT status, class_session_id, membership_id
     FROM bookings WHERE id = $1 FOR UPDATE`,
    [bookingId],
  );
  if (booking.length === 0) return { ok: false, error: "Άγνωστη κράτηση." };
  const from = booking[0];
  if (from.status !== "booked") {
    return {
      ok: false,
      error: "Μετακινείται μόνο κράτηση που δεν έχει γίνει ακόμη.",
    };
  }
  if (Number(from.class_session_id) === targetSessionId) return { ok: true };

  const { rows: target } = await client.query<{
    capacity: number;
    status: string;
    day: string;
  }>(
    `SELECT capacity, status, to_char(starts_at, 'YYYY-MM-DD') AS day
     FROM class_sessions WHERE id = $1 FOR UPDATE`,
    [targetSessionId],
  );
  if (target.length === 0) return { ok: false, error: "Άγνωστο μάθημα." };
  if (target[0].status === "cancelled") {
    return { ok: false, error: "Το μάθημα έχει ακυρωθεί." };
  }
  const { capacity, day } = target[0];

  // One class a day, measured against every other booking the member holds.
  // The one being moved does not count, which is what lets staff change the
  // hour on the same day.
  const { rowCount: sameDay } = await client.query(
    `SELECT 1 FROM bookings b
     JOIN class_sessions s ON s.id = b.class_session_id
     WHERE b.user_id = $1 AND b.id <> $2 AND b.status <> 'cancelled'
       AND s.starts_at::date = $3::date
     LIMIT 1`,
    [userId, bookingId, day],
  );
  if (sameDay) {
    return { ok: false, error: "Το μέλος έχει ήδη κράτηση εκείνη την ημέρα." };
  }

  // Its own statement after the lock, for the same reason as in bookMember.
  const { rows: taken } = await client.query<{ count: string }>(
    `SELECT count(*) FROM bookings
     WHERE class_session_id = $1 AND status IN ${HOLDS_A_PLACE}`,
    [targetSessionId],
  );
  if (Number(taken[0].count) >= capacity) {
    return { ok: false, error: "Το μάθημα είναι γεμάτο." };
  }

  const { rowCount: covered } = await client.query(
    `SELECT 1 FROM memberships m WHERE m.id = $1 AND ${coversDate("$2::date")}`,
    [from.membership_id, day],
  );
  if (!covered) {
    return {
      ok: false,
      error:
        "Η συνδρομή αυτής της κράτησης δεν καλύπτει εκείνη την ημέρα. Ακύρωσε και κάνε νέα κράτηση.",
    };
  }

  // A booking is unique per member and class. A cancellation the member left
  // on the destination would collide with the update, and it records nothing
  // worth keeping once they are booked there again, so it goes first.
  await client.query(
    `DELETE FROM bookings
     WHERE user_id = $1 AND class_session_id = $2 AND status = 'cancelled'`,
    [userId, targetSessionId],
  );
  await client.query(
    "UPDATE bookings SET class_session_id = $1 WHERE id = $2",
    [targetSessionId, bookingId],
  );

  return { ok: true };
}

/**
 * Deletes an unpaid membership and the bookings made against it: a promise
 * nobody kept should free the class spot it was holding. Refused for a paid
 * membership, which is the only record that cash was taken, and for one the
 * member already trained on, which is a debt and attendance history.
 */
export async function voidUnpaidMembership(
  client: PoolClient,
  membershipId: number,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const { rows: owner } = await client.query<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE id = $1",
    [membershipId],
  );
  if (owner.length === 0) return { ok: false, error: "Άγνωστη συνδρομή." };
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [
    owner[0].user_id,
  ]);

  // Re-read under the member lock: it could have been paid since.
  const { rows: row } = await client.query<{ paid: boolean }>(
    "SELECT paid_on IS NOT NULL AS paid FROM memberships WHERE id = $1 FOR UPDATE",
    [membershipId],
  );
  if (row.length === 0) return { ok: false, error: "Άγνωστη συνδρομή." };
  if (row[0].paid) {
    return {
      ok: false,
      error:
        "Η συνδρομή καταγράφει χρήματα που εισπράχθηκαν. Κάνε την ανενεργή αντί να τη διαγράψεις.",
    };
  }

  const { rowCount: attended } = await client.query(
    "SELECT 1 FROM bookings WHERE membership_id = $1 AND status = 'checked_in' LIMIT 1",
    [membershipId],
  );
  if (attended) return { ok: false, error: TRAINED_ON_UNPAID_MEMBERSHIP };

  // The status guard repeats the check above on purpose. A check-in landing
  // between the two statements would otherwise be deleted with the rest;
  // with it, that booking survives, and the membership delete below fails on
  // the bookings foreign key instead, which the action reports.
  await client.query(
    "DELETE FROM bookings WHERE membership_id = $1 AND status <> 'checked_in'",
    [membershipId],
  );
  await client.query("DELETE FROM memberships WHERE id = $1", [membershipId]);
  return { ok: true, userId: owner[0].user_id };
}
