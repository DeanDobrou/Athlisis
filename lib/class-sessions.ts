import "server-only";

import { HOLDS_A_PLACE, type Queryable } from "@/lib/bookings";
import type { ClassType } from "@/lib/class-types";
import { db } from "@/lib/db";
import type { BookingStatus } from "@/lib/enums";
import { addDays, TRAINING_DAYS, todayInGym } from "@/lib/gym-time";
import { membershipState } from "@/lib/memberships";
import { parseId } from "@/lib/utils";

export type SessionStatus = "scheduled" | "cancelled";

/**
 * ponytail: a constant, not a settings row. Every class holds the same number
 * and it is editable per session anyway. Move it into `settings` when that
 * table lands with member self-booking.
 */
export const DEFAULT_CAPACITY = 8;

export type SessionType = Pick<ClassType, "id" | "name" | "color_hex">;

export type ClassSession = {
  id: string;
  day: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: SessionStatus;
  notes: string | null;
  is_past: boolean;
  types: SessionType[];
};

/**
 * Times are rendered by Postgres in the gym's timezone (set on the database) rather
 * than shipped as instants and formatted in the browser: the schedule must
 * read the same to everyone, and a server-rendered time that reformats on
 * hydration is a mismatch waiting to happen.
 *
 * The types array is aggregated here so the grid does not run a query per
 * session. FILTER keeps a session with no types as [] instead of [null].
 */
const COLUMNS = `s.id,
  to_char(s.starts_at, 'YYYY-MM-DD') AS day,
  to_char(s.starts_at, 'HH24:MI') AS start_time,
  to_char(s.ends_at, 'HH24:MI') AS end_time,
  s.capacity, s.status, s.notes,
  (s.ends_at < now()) AS is_past,
  coalesce(
    json_agg(
      json_build_object(
        -- ::text matters. A bigint inside json_build_object becomes a JSON
        -- number, so these ids would arrive as 5 while every other id in the
        -- app is the string "5" that node-postgres gives for bigint. The
        -- checkbox prefill compares them and silently matched nothing.
        'id', t.id::text, 'name', t.name, 'color_hex', t.color_hex
      )
      ORDER BY t.name
    ) FILTER (WHERE t.id IS NOT NULL),
    '[]'
  ) AS types`;

const FROM = `FROM class_sessions s
  LEFT JOIN class_session_types st ON st.class_session_id = s.id
  LEFT JOIN class_types t ON t.id = st.class_type_id`;

export type MemberClass = Omit<ClassSession, "notes"> & {
  booked: number;
  my_booking: { id: string; status: BookingStatus } | null;
};

/**
 * Every class from 30 days before `today` onward, as a member's phone shows
 * it: how many places are taken, and the member's own booking if they hold
 * one. Staff notes and other members are left out.
 */
export async function memberSchedule(
  userId: number,
  today = todayInGym(),
  runner: Queryable = db(),
): Promise<MemberClass[]> {
  const { rows } = await runner.query<MemberClass>(
    `SELECT c.id, c.day, c.start_time, c.end_time, c.capacity, c.status,
            c.is_past, c.types,
            (SELECT count(*)::int FROM bookings b
             WHERE b.class_session_id = c.id
               AND b.status IN ${HOLDS_A_PLACE}) AS booked,
            (SELECT json_build_object('id', b.id::text, 'status', b.status)
             FROM bookings b
             WHERE b.class_session_id = c.id AND b.user_id = $1
               AND b.status IN ${HOLDS_A_PLACE}) AS my_booking
     FROM (
       SELECT ${COLUMNS}, s.starts_at
       ${FROM}
       WHERE s.starts_at >= $2::date
       GROUP BY s.id
     ) c
     ORDER BY c.starts_at`,
    [userId, addDays(today, -30)],
  );
  return rows;
}

/**
 * Monday to Friday of the week starting `weekStart`. The gym does not train
 * at weekends, and the create action refuses those dates, so nothing is being
 * hidden by the shorter range.
 */
export async function listSessionsForWeek(
  weekStart: string,
): Promise<ClassSession[]> {
  const { rows } = await db().query<ClassSession>(
    `SELECT ${COLUMNS}
     ${FROM}
     WHERE s.starts_at >= $1::date
       AND s.starts_at < $1::date + $2::int
     GROUP BY s.id
     ORDER BY s.starts_at`,
    [weekStart, TRAINING_DAYS],
  );
  return rows;
}

export async function getSession(
  rawId: string,
): Promise<ClassSession | null> {
  const id = parseId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<ClassSession>(
    `SELECT ${COLUMNS} ${FROM} WHERE s.id = $1 GROUP BY s.id`,
    [id],
  );
  return rows[0] ?? null;
}

export type WeekBooking = {
  id: string;
  session_id: string;
  user_id: string;
  member_name: string;
  status: BookingStatus;
  unpaid: boolean;
};

/**
 * Shared by both booking reads below, so the board and the roll call can never
 * disagree about what a booking is. unpaid is the paying membership reading as
 * Unpaid through membershipState(), the same definition the memberships grid
 * uses.
 */
const BOOKING_COLUMNS = `b.id, b.class_session_id AS session_id, b.user_id,
  u.first_name || ' ' || u.last_name AS member_name,
  b.status,
  (${membershipState("m")}) = 'unpaid' AS unpaid`;

const BOOKING_FROM = `FROM bookings b
  JOIN class_sessions s ON s.id = b.class_session_id
  JOIN users u ON u.id = b.user_id
  JOIN memberships m ON m.id = b.membership_id`;

/**
 * Every booking holding a place in the same Monday to Friday week as
 * listSessionsForWeek, for the bookings board. Cancellations are left out: they
 * hold no place, so there is nothing on the board to show or drag. Ordered by
 * when the member booked, so names keep a stable order inside a class.
 */
export async function listWeekBookings(
  weekStart: string,
  runner: Queryable = db(),
): Promise<WeekBooking[]> {
  const { rows } = await runner.query<WeekBooking>(
    `SELECT ${BOOKING_COLUMNS}
     ${BOOKING_FROM}
     WHERE s.starts_at >= $1::date
       AND s.starts_at < $1::date + $2::int
       AND b.status IN ${HOLDS_A_PLACE}
     ORDER BY b.booked_at, b.id`,
    [weekStart, TRAINING_DAYS],
  );
  return rows;
}

/**
 * The one class the check-in page shows, in the order the board lists it, so
 * the roll call reads down the same names in the same places.
 */
export async function listSessionBookings(
  sessionId: string,
): Promise<WeekBooking[]> {
  const { rows } = await db().query<WeekBooking>(
    `SELECT ${BOOKING_COLUMNS}
     ${BOOKING_FROM}
     WHERE b.class_session_id = $1 AND b.status IN ${HOLDS_A_PLACE}
     ORDER BY b.booked_at, b.id`,
    [sessionId],
  );
  return rows;
}
