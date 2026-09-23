import "server-only";

import type { PoolClient } from "pg";

import {
  coversDate,
  describeOverlap,
  findOverlap,
  periodEndsOn,
} from "@/lib/memberships";
import { formatMoney } from "@/lib/money";

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

export const HOLDS_A_PLACE = "('booked', 'checked_in', 'no_show')";

/** Members may cancel until this many minutes before a class starts. */
export const MEMBER_CANCEL_CUTOFF_MINUTES = 60;
export type Queryable = Pick<PoolClient, "query">;

export const TRAINED_ON_UNPAID_MEMBERSHIP =
  "Το μέλος προπονήθηκε με αυτή τη συνδρομή, οπότε χρωστάει. Κατάγραψε την πληρωμή αντί να τη διαγράψεις.";

type Refused = { ok: false; error: string };

/** The member lock for whoever a row belongs to; only the member row is locked. */
async function lockMemberOf(
  client: PoolClient,
  table: "bookings" | "memberships",
  id: number,
): Promise<string | null> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT r.user_id FROM ${table} r JOIN users u ON u.id = r.user_id
     WHERE r.id = $1 FOR UPDATE OF u`,
    [id],
  );
  return rows[0]?.user_id ?? null;
}

type LockedSession = {
  ok: true;
  capacity: number;
  day: string;
  started: boolean;
};

/** Locks the class row, since capacity is a count across rows; refuses a cancelled one. */
async function lockSession(
  client: PoolClient,
  sessionId: number,
): Promise<LockedSession | Refused> {
  const { rows } = await client.query<{
    capacity: number;
    status: string;
    day: string;
    started: boolean;
  }>(
    `SELECT capacity, status, to_char(starts_at, 'YYYY-MM-DD') AS day,
            starts_at <= now() AS started
     FROM class_sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  if (rows.length === 0) return { ok: false, error: "Άγνωστο μάθημα." };
  if (rows[0].status === "cancelled") {
    return { ok: false, error: "Το μάθημα έχει ακυρωθεί." };
  }
  const { capacity, day, started } = rows[0];
  return { ok: true, capacity, day, started };
}

/**
 * One class a day, and a full class is refused, for a booking and a move
 * alike. `exceptBookingId` keeps the booking being moved out of the day count.
 * The count is a separate statement after the lock on purpose, or it could
 * read a snapshot from before a concurrent booking committed and oversell.
 */
async function placeRefused(
  client: PoolClient,
  userId: number | string,
  sessionId: number,
  session: LockedSession,
  exceptBookingId: number | null,
): Promise<Refused | null> {
  const { rowCount: sameDay } = await client.query(
    `SELECT 1 FROM bookings b
     JOIN class_sessions s ON s.id = b.class_session_id
     WHERE b.user_id = $1 AND b.status <> 'cancelled'
       AND s.starts_at::date = $2::date
       AND b.id IS DISTINCT FROM $3::bigint
     LIMIT 1`,
    [userId, session.day, exceptBookingId],
  );
  if (sameDay) {
    return { ok: false, error: "Το μέλος έχει ήδη κράτηση εκείνη την ημέρα." };
  }

  const { rows: taken } = await client.query<{ count: string }>(
    `SELECT count(*) FROM bookings
     WHERE class_session_id = $1 AND status IN ${HOLDS_A_PLACE}`,
    [sessionId],
  );
  if (Number(taken[0].count) >= session.capacity) {
    return { ok: false, error: "Το μάθημα είναι γεμάτο." };
  }
  return null;
}

export type BookingResult =
  | {
      ok: true;
      bookingId: string;
      membershipId: string;
      createdMembership: boolean;
    }
  | (Refused & { confirmUnpaidCents?: number });

/**
 * Books a member into a class. `asMember` is set when members book themselves
 * from the app: they cannot book a class that has started, and with no
 * coverage they are refused with the price until they confirm.
 */
export async function bookMember(
  client: PoolClient,
  userId: number,
  sessionId: number,
  asMember?: { confirmUnpaid: boolean },
): Promise<BookingResult> {
  const { rows: member } = await client.query<{ status: string }>(
    "SELECT status FROM users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  if (member.length === 0) return { ok: false, error: "Άγνωστο μέλος." };
  if (member[0].status !== "active") {
    return { ok: false, error: "Το μέλος είναι ανενεργό." };
  }

  const session = await lockSession(client, sessionId);
  if (!session.ok) return session;
  if (asMember && session.started) {
    return { ok: false, error: "Το μάθημα έχει ήδη ξεκινήσει." };
  }
  const { day } = session;

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

  const { rows: covering } = await client.query<{ id: string }>(
    `SELECT m.id FROM memberships m
     WHERE m.user_id = $1 AND ${coversDate("$2::date")}
       AND m.paid_on IS NOT NULL
       AND (m.visits_remaining IS NULL OR m.visits_remaining > 0)
     ORDER BY m.visits_remaining IS NULL DESC, m.ends_on ASC NULLS LAST, m.id
     LIMIT 1`,
    [userId, day],
  );

  if (covering.length === 0) {
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
  }

  const refused = await placeRefused(client, userId, sessionId, session, null);
  if (refused) return refused;

  let membershipId: string;
  let createdMembership = false;
  if (covering.length > 0) {
    membershipId = covering[0].id;
  } else {
    const { rows: last } = await client.query<{
      plan_id: string;
      price_cents: number;
    }>(
      `SELECT m.plan_id, p.price_cents
       FROM memberships m JOIN plans p ON p.id = m.plan_id
       WHERE m.user_id = $1
       ORDER BY m.starts_on DESC, m.id DESC LIMIT 1`,
      [userId],
    );
    if (last.length === 0) {
      return {
        ok: false,
        error:
          "Το μέλος δεν είχε ποτέ συνδρομή. Η πρώτη γίνεται από την οθόνη Συνδρομές.",
      };
    }

    if (last[0].price_cents === 0) {
      return {
        ok: false,
        error:
          "Το μέλος δεν έχει κάλυψη και το τελευταίο του πακέτο είναι δωρεάν, οπότε δεν γίνεται κράτηση με υπόσχεση πληρωμής. Αν συνεχίζει, φτιάξε ξανά τη συνδρομή από την οθόνη Συνδρομές.",
      };
    }
    const planId = Number(last[0].plan_id);

    const clash = await findOverlap(client, userId, planId, day);
    if (clash) {
      return {
        ok: false,
        error: `Το μέλος δεν έχει κάλυψη εκείνη την ημέρα και μια νέα συνδρομή θα επικαλυπτόταν με τη ${describeOverlap(clash)}. Διόρθωσε πρώτα την έναρξή της.`,
      };
    }

    if (asMember && !asMember.confirmUnpaid) {
      return {
        ok: false,
        error: `Δεν έχεις κάλυψη για αυτό το μάθημα. Αν κλείσεις θέση, πληρώνεις ${formatMoney(last[0].price_cents)} στην είσοδο.`,
        confirmUnpaidCents: last[0].price_cents,
      };
    }

    // Unpaid by construction: paid_on and recorded_by stay NULL, and the plan
    // is priced above zero, which memberships_unpaid_owes_something requires of an unpaid row.
    const { rows: made } = await client.query<{ id: string }>(
      `INSERT INTO memberships
         (user_id, plan_id, starts_on, ends_on, visits_remaining, amount_cents)
       SELECT $1, p.id, $2::date, ${periodEndsOn("$2")}, p.visits, p.price_cents
       FROM plans p WHERE p.id = $3
       RETURNING id`,
      [userId, day, planId],
    );
    membershipId = made[0].id;
    createdMembership = true;
  }

  await client.query(
    `UPDATE memberships SET visits_remaining = visits_remaining - 1
     WHERE id = $1 AND visits_remaining IS NOT NULL`,
    [membershipId],
  );

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

export type CancelResult =
  | { ok: true; unpaidLeftCents: number | null }
  | Refused;

/**
 * Returns the visit. `unpaidLeftCents` is set when the membership that paid is
 * unpaid with no booking left on it: a promise nobody is keeping, which the
 * caller reports or voids.
 *
 * `byMemberId` is set when members cancel from the app: they can cancel only
 * their own bookings, and only until MEMBER_CANCEL_CUTOFF_MINUTES before the
 * class. Someone else's booking is reported as unknown.
 */
export async function cancelBooking(
  client: PoolClient,
  bookingId: number,
  byMemberId?: number,
): Promise<CancelResult> {
  const owner = await lockMemberOf(client, "bookings", bookingId);
  if (
    owner === null ||
    (byMemberId !== undefined && Number(owner) !== byMemberId)
  ) {
    return { ok: false, error: "Άγνωστη κράτηση." };
  }

  if (byMemberId !== undefined) {
    const { rowCount: inTime } = await client.query(
      `SELECT 1 FROM bookings b
       JOIN class_sessions s ON s.id = b.class_session_id
       WHERE b.id = $1
         AND s.starts_at - now() > make_interval(mins => $2::int)`,
      [bookingId, MEMBER_CANCEL_CUTOFF_MINUTES],
    );
    if (!inTime) {
      return {
        ok: false,
        error: `Η ακύρωση γίνεται έως ${MEMBER_CANCEL_CUTOFF_MINUTES} λεπτά πριν από την έναρξη του μαθήματος.`,
      };
    }
  }

  const { rows: cancelled } = await client.query<{ membership_id: string }>(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = now()
     WHERE id = $1 AND status = 'booked'
     RETURNING membership_id`,
    [bookingId],
  );
  if (cancelled.length === 0) {
    return { ok: false, error: "Η κράτηση δεν είναι ενεργή." };
  }
  const membershipId = cancelled[0].membership_id;

  await client.query(
    `UPDATE memberships SET visits_remaining = visits_remaining + 1
     WHERE id = $1 AND visits_remaining IS NOT NULL`,
    [membershipId],
  );

  const { rows: left } = await client.query<{ amount_cents: number }>(
    `SELECT m.amount_cents FROM memberships m
     WHERE m.id = $1 AND m.status = 'active' AND m.paid_on IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.membership_id = m.id AND b.status <> 'cancelled'
       )`,
    [membershipId],
  );
  return { ok: true, unpaidLeftCents: left[0]?.amount_cents ?? null };
}

/**
 * Check-in and its undo are the same statement with the ends swapped, so they
 * are one function behind the two names below. Neither moves a visit - it was
 * spent at booking - which is what makes a mis-tapped tick safe to take back.
 *
 * The member lock is taken even though one row changes: voidUnpaidMembership
 * holds it while deciding whether the member trained on an unpaid membership,
 * so a check-in cannot land in the middle of a void.
 */
async function setPresence(
  client: PoolClient,
  bookingId: number,
  present: boolean,
): Promise<{ ok: true } | Refused> {
  if ((await lockMemberOf(client, "bookings", bookingId)) === null) {
    return { ok: false, error: "Άγνωστη κράτηση." };
  }

  // The status in the WHERE is the guard: no row means the booking was not in
  // the state this move starts from.
  const { rowCount } = await client.query(
    present
      ? `UPDATE bookings SET status = 'checked_in', checked_in_at = now()
         WHERE id = $1 AND status = 'booked'`
      : `UPDATE bookings SET status = 'booked', checked_in_at = NULL
         WHERE id = $1 AND status = 'checked_in'`,
    [bookingId],
  );
  if (rowCount === 0) {
    return {
      ok: false,
      error: present
        ? "Γίνεται check-in μόνο σε ενεργή κράτηση."
        : "Η κράτηση δεν έχει check-in.",
    };
  }
  return { ok: true };
}

export function checkInBooking(client: PoolClient, bookingId: number) {
  return setPresence(client, bookingId, true);
}

/** Takes a check-in back, for the tap that hit the wrong name. */
export function undoCheckIn(client: PoolClient, bookingId: number) {
  return setPresence(client, bookingId, false);
}

export type CheckInSaveResult = {
  checkedIn: number;
  undone: number;
  refused: string[];
};

/**
 * One class's roll call, saved in one go: every booking on it that is ticked
 * is checked in, every one that is not is returned to a plain booking. The
 * caller sends who is present, not what changed, so the diff is worked out
 * here against what the database actually holds - two admins saving the same
 * class cannot then talk past each other about a booking one of them never
 * saw.
 *
 * Rows are walked in id order so that concurrent saves of the same class take
 * the per-member locks in the same order and cannot deadlock.
 *
 * A booking someone cancelled or moved while the page was open is refused by
 * checkInBooking rather than forced, and its member is named in `refused`. The
 * rest of the save still stands: losing a whole class's ticks because one
 * member left would be worse than reporting the one.
 */
export async function saveSessionCheckIns(
  client: PoolClient,
  sessionId: number,
  present: ReadonlySet<number>,
): Promise<CheckInSaveResult> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    member_name: string;
  }>(
    `SELECT b.id, b.status, u.first_name || ' ' || u.last_name AS member_name
     FROM bookings b
     JOIN users u ON u.id = b.user_id
     WHERE b.class_session_id = $1 AND b.status IN ${HOLDS_A_PLACE}
     ORDER BY b.id`,
    [sessionId],
  );

  const result: CheckInSaveResult = { checkedIn: 0, undone: 0, refused: [] };
  for (const row of rows) {
    const id = Number(row.id);
    const wanted = present.has(id);
    if (wanted === (row.status === "checked_in")) continue;

    const done = wanted
      ? await checkInBooking(client, id)
      : await undoCheckIn(client, id);
    if (!done.ok) result.refused.push(row.member_name);
    else if (wanted) result.checkedIn += 1;
    else result.undone += 1;
  }
  return result;
}

export type MoveResult = { ok: true } | Refused;

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
  const userId = await lockMemberOf(client, "bookings", bookingId);
  if (userId === null) return { ok: false, error: "Άγνωστη κράτηση." };

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

  const target = await lockSession(client, targetSessionId);
  if (!target.ok) return target;

  const refused = await placeRefused(
    client,
    userId,
    targetSessionId,
    target,
    bookingId,
  );
  if (refused) return refused;

  const { rowCount: covered } = await client.query(
    `SELECT 1 FROM memberships m WHERE m.id = $1 AND ${coversDate("$2::date")}`,
    [from.membership_id, target.day],
  );
  if (!covered) {
    return {
      ok: false,
      error:
        "Η συνδρομή αυτής της κράτησης δεν καλύπτει εκείνη την ημέρα. Ακύρωσε και κάνε νέα κράτηση.",
    };
  }

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
): Promise<{ ok: true; userId: string } | Refused> {
  const userId = await lockMemberOf(client, "memberships", membershipId);
  if (userId === null) return { ok: false, error: "Άγνωστη συνδρομή." };

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

  await client.query(
    "DELETE FROM bookings WHERE membership_id = $1 AND status <> 'checked_in'",
    [membershipId],
  );
  await client.query("DELETE FROM memberships WHERE id = $1", [membershipId]);
  return { ok: true, userId };
}

export type CancelSessionResult =
  | { ok: true; cancelled: number; voided: number }
  | Refused;

/**
 * Cancels a class and gives back what its bookings spent. The gym called it
 * off, not the members, so nobody should lose a visit to it or keep owing for
 * a class that never ran: every booking not yet attended is cancelled through
 * cancelBooking, and when that leaves an unpaid membership with nothing on it
 * - a promise made for this class alone - the membership is voided too. A
 * checked-in booking is left alone, because that one happened. Making the
 * class scheduled again brings none of it back: staff book again.
 *
 * The members booked on it are locked before the class row, the house order.
 * Once the class is marked cancelled nobody can book onto it, so the bookings
 * are read after that; one that landed in between is still picked up, and
 * cancelBooking takes its member's lock itself.
 */
export async function cancelSession(
  client: PoolClient,
  sessionId: number,
): Promise<CancelSessionResult> {
  await client.query(
    `SELECT 1 FROM users
     WHERE id IN (
       SELECT user_id FROM bookings
       WHERE class_session_id = $1 AND status = 'booked'
     )
     ORDER BY id FOR UPDATE`,
    [sessionId],
  );

  const { rowCount } = await client.query(
    "UPDATE class_sessions SET status = 'cancelled' WHERE id = $1",
    [sessionId],
  );
  if (rowCount === 0) return { ok: false, error: "Άγνωστο μάθημα." };

  const { rows } = await client.query<{ id: string; membership_id: string }>(
    `SELECT id, membership_id FROM bookings
     WHERE class_session_id = $1 AND status = 'booked'
     ORDER BY id`,
    [sessionId],
  );

  let cancelled = 0;
  let voided = 0;
  for (const b of rows) {
    const r = await cancelBooking(client, Number(b.id));
    if (!r.ok) continue;
    if (
      r.unpaidLeftCents !== null &&
      (await voidUnpaidMembership(client, Number(b.membership_id))).ok
    ) {
      voided += 1;
    } else {
      cancelled += 1;
    }
  }
  return { ok: true, cancelled, voided };
}
