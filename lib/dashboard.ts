import "server-only";

import { HOLDS_A_PLACE, type Queryable } from "@/lib/bookings";
import { db } from "@/lib/db";
import type { MembershipState } from "@/lib/enums";
import { coversDate, membershipState } from "@/lib/memberships";

/**
 * The reads behind "Με μια ματιά". Every one of them answers "who needs me",
 * so each returns names rather than a number: an owner acts on people, and a
 * count with no names is a poster.
 *
 * Nothing here is stored or cached. All of it falls out of columns that
 * already exist, so there is no job to run and nothing to go stale.
 *
 * Each takes an optional runner for the same reason listWeekBookings does: the
 * check seeds rows inside a transaction it rolls back, which the pool cannot
 * see. Four of these five pick rows by conditions that would fail silently as
 * an empty tile, so being able to test them against seeded data is the point.
 */

// ponytail: constants, not settings rows. They belong in `settings` alongside
// the pacing threshold when that table lands; until then changing one costs a
// deploy, the same as DEFAULT_CAPACITY next door.
export const QUIET_DAYS = 7;
export const RENEWAL_DAYS = 7;
export const LOW_VISITS = 2;

export type OwedRow = {
  id: string;
  user_id: string;
  member_name: string;
  amount_cents: number;
  starts_on: string;
};

/**
 * What is owed, oldest first. This is the list section 8 is built around: a
 * booking made on a promise to pay is leakage until someone collects, and the
 * memberships grid only shows it to whoever thinks to filter for it.
 */
export async function listOwed(
  runner: Queryable = db(),
): Promise<OwedRow[]> {
  const { rows } = await runner.query<OwedRow>(
    `SELECT m.id, m.user_id,
            u.first_name || ' ' || u.last_name AS member_name,
            m.amount_cents,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE (${membershipState("m")}) = 'unpaid'
     ORDER BY m.starts_on, m.id`,
  );
  return rows;
}

export type RenewalRow = {
  id: string;
  user_id: string;
  member_name: string;
  plan_name: string;
  ends_on: string | null;
  visits_remaining: number | null;
  state: MembershipState;
};

/**
 * Who is about to run out, by date or by visits. Renewals are recorded by
 * hand, so a month that ended or a pack down to its last visit is invisible
 * until the member books and silently lands on the unpaid path.
 *
 * Only the member's newest membership counts - a renewal is a second row with
 * a later start, and once it exists the old one is history, not a warning. An
 * unpaid row is left out because it is already in the owed list, and an
 * inactive member is not chased at all.
 */
export async function listRenewals(
  runner: Queryable = db(),
): Promise<RenewalRow[]> {
  const { rows } = await runner.query<RenewalRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (m.user_id)
              m.id, m.user_id, m.plan_id, m.ends_on, m.visits_remaining,
              (${membershipState("m")}) AS state
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE u.status = 'active'
       ORDER BY m.user_id, m.starts_on DESC, m.id DESC
     )
     SELECT l.id, l.user_id,
            u.first_name || ' ' || u.last_name AS member_name,
            p.name AS plan_name,
            to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on,
            l.visits_remaining, l.state
     FROM latest l
     JOIN users u ON u.id = l.user_id
     JOIN plans p ON p.id = l.plan_id
     WHERE l.state IN ('active', 'completed')
       AND ((l.ends_on IS NOT NULL AND l.ends_on <= current_date + $1::int)
         OR (l.visits_remaining IS NOT NULL AND l.visits_remaining <= $2::int))
     ORDER BY l.ends_on NULLS LAST, l.visits_remaining NULLS LAST, u.last_name`,
    [RENEWAL_DAYS, LOW_VISITS],
  );
  return rows;
}

export type TodayClass = {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: string;
  booked: number;
  checked_in: number;
};

/**
 * Today's classes with how full each is and how many have arrived, so the
 * morning look and the 18:25 look are the same screen. The counts are cast to
 * int because node-postgres hands back a bigint count as a string.
 */
export async function listToday(
  runner: Queryable = db(),
): Promise<TodayClass[]> {
  const { rows } = await runner.query<TodayClass>(
    `SELECT s.id,
            to_char(s.starts_at, 'HH24:MI') AS start_time,
            to_char(s.ends_at, 'HH24:MI') AS end_time,
            s.capacity, s.status,
            count(b.id) FILTER (
              WHERE b.status IN ${HOLDS_A_PLACE}
            )::int AS booked,
            count(b.id) FILTER (WHERE b.status = 'checked_in')::int AS checked_in
     FROM class_sessions s
     LEFT JOIN bookings b ON b.class_session_id = s.id
     WHERE s.starts_at::date = current_date
     GROUP BY s.id
     ORDER BY s.starts_at`,
  );
  return rows;
}

export type QuietRow = {
  id: string;
  member_name: string;
  last_visit: string | null;
  days_since: number | null;
};

/**
 * Members who are paying and not turning up. Attendance fades weeks before
 * anyone says they are leaving, and with scores and the leaderboard deferred
 * this is the only retention signal the MVP has.
 *
 * Coverage today is required, through coversDate() rather than a second
 * definition of its own. That is what keeps the list finite: somebody with no
 * membership is not quiet, they have gone, and chasing them is a different job
 * with a different message. Without it every member who ever drifted away sits
 * here forever and the tile turns into wallpaper.
 *
 * The one just out of coverage is not lost by this - a period that has ended
 * is already in the renewals list, so the two tiles divide the problem rather
 * than both nagging about the same person.
 *
 * A booking still to come means they have not gone anywhere, so they are left
 * out however long the gap behind them is. Accounts younger than the window
 * are left out too, or every new member would arrive already flagged.
 */
export async function listQuiet(
  runner: Queryable = db(),
): Promise<QuietRow[]> {
  const { rows } = await runner.query<QuietRow>(
    `SELECT u.id,
            u.first_name || ' ' || u.last_name AS member_name,
            to_char(max(s.starts_at), 'YYYY-MM-DD') AS last_visit,
            (current_date - max(s.starts_at)::date) AS days_since
     FROM users u
     LEFT JOIN bookings b
       ON b.user_id = u.id AND b.status IN ${HOLDS_A_PLACE}
     LEFT JOIN class_sessions s
       ON s.id = b.class_session_id AND s.starts_at < now()
     WHERE u.role = 'member' AND u.status = 'active'
       AND u.created_at < now() - ($1::int * interval '1 day')
       AND EXISTS (
         SELECT 1 FROM memberships m
         WHERE m.user_id = u.id AND ${coversDate("current_date")}
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings ub
         JOIN class_sessions us ON us.id = ub.class_session_id
         WHERE ub.user_id = u.id AND ub.status IN ${HOLDS_A_PLACE}
           AND us.starts_at >= now()
       )
     GROUP BY u.id
     HAVING max(s.starts_at) IS NULL
        OR max(s.starts_at)::date <= current_date - $1::int
     ORDER BY max(s.starts_at) NULLS FIRST, u.last_name`,
    [QUIET_DAYS],
  );
  return rows;
}

export type MonthTake = { cents: number; payments: number };

/** Cash collected this month, by paid_on - the date the money arrived. */
export async function monthTake(
  runner: Queryable = db(),
): Promise<MonthTake> {
  const { rows } = await runner.query<MonthTake>(
    `SELECT coalesce(sum(amount_cents), 0)::int AS cents,
            count(*)::int AS payments
     FROM memberships
     WHERE paid_on >= date_trunc('month', current_date)::date`,
  );
  return rows[0];
}
