import "server-only";

import { HOLDS_A_PLACE } from "@/lib/bookings";
import type { ClassType } from "@/lib/class-types";
import { db, hasPgCode, type Queryable, withTransaction } from "@/lib/db";
import type { BookingStatus } from "@/lib/enums";
import {
  addDays,
  isRealDate,
  isWeekend,
  TRAINING_DAYS,
  todayInGym,
} from "@/lib/gym-time";
import { membershipState } from "@/lib/memberships";
import { nextFreeSlot, slotOf, SLOTS } from "@/lib/slots";
import {
  type ActionResult,
  type Fields,
  type FormError,
  parseId,
} from "@/lib/utils";

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

/** How many whole months back a member's phone can page. */
const MEMBER_HISTORY_MONTHS = 12;

/**
 * Every class from the 1st of the month a year before `today` onward, as a
 * member's phone shows it: how many places are taken, and the member's own
 * booking if they hold one. Staff notes and other members are left out.
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
       WHERE s.starts_at >= date_trunc('month', $2::date) - make_interval(months => $3)
       GROUP BY s.id
     ) c
     ORDER BY c.starts_at`,
    [userId, today, MEMBER_HISTORY_MONTHS],
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

/**
 * The times of a class on `day` that overlaps `start`-`end`, as "18:00-19:00",
 * or null. Back-to-back is not an overlap. Cancelled classes count: they keep
 * their place on the schedule until restored or deleted.
 */
export async function overlappingSession(
  runner: Queryable,
  day: string,
  start: string,
  end: string,
  exceptId: number | null = null,
): Promise<string | null> {
  const { rows } = await runner.query<{ times: string }>(
    `SELECT to_char(starts_at, 'HH24:MI') || '-' || to_char(ends_at, 'HH24:MI') AS times
     FROM class_sessions
     WHERE starts_at < $1::date + $3::time AND ends_at > $1::date + $2::time
       AND id IS DISTINCT FROM $4::bigint
     ORDER BY starts_at
     LIMIT 1`,
    [day, start, end, exceptId],
  );
  return rows[0]?.times ?? null;
}

/** A class as insertSession() takes it, and as SESSION_TO_COPY reads one back. */
export type NewSession = {
  day: string;
  start_time: string;
  end_time: string;
  capacity: number;
  notes: string | null;
  type_ids: readonly (number | string)[];
};

/** The columns that read class_sessions `s` back as a NewSession, for copying. */
export const SESSION_TO_COPY = `to_char(s.starts_at, 'YYYY-MM-DD') AS day,
  to_char(s.starts_at, 'HH24:MI') AS start_time,
  to_char(s.ends_at, 'HH24:MI') AS end_time,
  s.capacity, s.notes,
  ARRAY(SELECT t.class_type_id FROM class_session_types t
        WHERE t.class_session_id = s.id) AS type_ids`;

/**
 * Adds a scheduled class with its class types and returns its id. `day` and
 * the HH:MM times are gym-local, so a class keeps its wall-clock time across a
 * clock change.
 */
export async function insertSession(
  runner: Queryable,
  s: NewSession,
): Promise<string> {
  const { rows } = await runner.query<{ id: string }>(
    `INSERT INTO class_sessions (starts_at, ends_at, capacity, status, notes)
     VALUES ($1::date + $2::time, $1::date + $3::time, $4, 'scheduled', $5)
     RETURNING id`,
    [s.day, s.start_time, s.end_time, s.capacity, s.notes],
  );
  await runner.query(
    `INSERT INTO class_session_types (class_session_id, class_type_id)
     SELECT $1, unnest($2::bigint[])`,
    [rows[0].id, s.type_ids],
  );
  return rows[0].id;
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

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

type ParsedSession = {
  day: string;
  startTime: string;
  endTime: string;
  capacity: number;
  notes: string | null;
  typeIds: number[];
};

function parseFields(
  get: Fields,
  rawTypeIds: readonly unknown[],
): ParsedSession | Required<FormError> {
  const value = (key: string) => get(key).trim();

  const day = value("day");
  if (!isRealDate(day)) return { field: "day", error: "Διάλεξε ημερομηνία." };
  if (isWeekend(day)) {
    return { field: "day", error: "Το γυμναστήριο δεν έχει μαθήματα το Σαββατοκύριακο." };
  }

  const startTime = value("start_time");
  const endTime = value("end_time");
  if (!HH_MM.test(startTime)) {
    return { field: "start_time", error: "Δώσε την ώρα σε μορφή HH:MM." };
  }
  if (!HH_MM.test(endTime)) {
    return { field: "end_time", error: "Δώσε την ώρα σε μορφή HH:MM." };
  }
  if (endTime <= startTime) {
    return { field: "end_time", error: "Το μάθημα πρέπει να τελειώνει μετά την έναρξή του." };
  }

  const capacity = Number(value("capacity"));
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    return { field: "capacity", error: "Η χωρητικότητα πρέπει να είναι ακέραιος μεγαλύτερος του μηδενός." };
  }

  const typeIds = rawTypeIds
    .map((v) => Number(String(v)))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  if (typeIds.length === 0) {
    return { field: "class_type_ids", error: "Διάλεξε τουλάχιστον έναν τύπο μαθήματος." };
  }

  return {
    day,
    startTime,
    endTime,
    capacity,
    notes: value("notes").slice(0, 2000) || null,
    typeIds,
  };
}

/** The form error for a time another class on that day already uses. */
const overlapError = (times: string): Required<FormError> => ({
  field: "start_time",
  error: `Εκείνη την ημέρα υπάρχει ήδη μάθημα ${times}, που επικαλύπτεται με αυτή την ώρα.`,
});

/** Adds a class with its class types, or says why not. Returns its day. */
export async function createSession(
  get: Fields,
  typeIds: readonly unknown[],
): Promise<FormError | { day: string }> {
  const f = parseFields(get, typeIds);
  if ("error" in f) return f;

  const failed = await withTransaction(async (client) => {
    const taken = await overlappingSession(client, f.day, f.startTime, f.endTime);
    if (taken) return overlapError(taken);

    await insertSession(client, {
      day: f.day,
      start_time: f.startTime,
      end_time: f.endTime,
      capacity: f.capacity,
      notes: f.notes,
      type_ids: f.typeIds,
    });
    return undefined;
  });
  return failed ?? { day: f.day };
}

/** Saves a class and its class types, or says why not. Returns its day. */
export async function updateSession(
  id: number,
  get: Fields,
  typeIds: readonly unknown[],
): Promise<FormError | { day: string }> {
  const f = parseFields(get, typeIds);
  if ("error" in f) return f;

  const failed = await withTransaction(async (client): Promise<FormError | undefined> => {
    const taken = await overlappingSession(client, f.day, f.startTime, f.endTime, id);
    if (taken) return overlapError(taken);

    // date + time in SQL lands in the gym's timezone, set on the database.
    const { rowCount } = await client.query(
      `UPDATE class_sessions SET
         starts_at = $1::date + $2::time, ends_at = $1::date + $3::time,
         capacity = $4, notes = $5
       WHERE id = $6`,
      [f.day, f.startTime, f.endTime, f.capacity, f.notes, id],
    );
    if (rowCount === 0) return { error: "Άγνωστο μάθημα." };

    await client.query(
      "DELETE FROM class_session_types WHERE class_session_id = $1",
      [id],
    );
    await client.query(
      `INSERT INTO class_session_types (class_session_id, class_type_id)
       SELECT $1, unnest($2::bigint[])`,
      [id, f.typeIds],
    );
    return undefined;
  });
  return failed ?? { day: f.day };
}

/**
 * Brings a cancelled class back. Only the class: the bookings cancelling it
 * gave back stay cancelled, and staff book members onto it again.
 */
export async function restoreSession(id: number): Promise<FormError | undefined> {
  const { rowCount } = await db().query(
    "UPDATE class_sessions SET status = 'scheduled' WHERE id = $1",
    [id],
  );
  return rowCount === 0 ? { error: "Άγνωστο μάθημα." } : undefined;
}

/**
 * Duplicates a class, with its types, capacity and notes, into the next free
 * slot on the same day.
 */
export async function copySession(id: number): Promise<ActionResult> {
  return withTransaction(async (client) => {
    const { rows: found } = await client.query<NewSession>(
      `SELECT ${SESSION_TO_COPY} FROM class_sessions s WHERE s.id = $1`,
      [id],
    );
    if (found.length === 0) return { error: "Άγνωστο μάθημα." };
    const source = found[0];

    const { rows: siblings } = await client.query<{
      start_time: string;
      end_time: string;
    }>(
      `SELECT to_char(starts_at, 'HH24:MI') AS start_time,
              to_char(ends_at, 'HH24:MI') AS end_time
       FROM class_sessions
       WHERE starts_at >= $1::date AND starts_at < $1::date + 1`,
      [source.day],
    );

    const from = slotOf(source);
    const target = nextFreeSlot(siblings, from ? SLOTS.indexOf(from) : -1);
    if (!target) {
      return { error: "Όλες οι ώρες είναι ήδη καλυμμένες για εκείνη την ημέρα." };
    }

    await insertSession(client, {
      ...source,
      start_time: target.start,
      end_time: target.end,
    });
    return undefined;
  });
}

/**
 * Fills `week` from the one before it, skipping any class that would overlap
 * one already there, so running it twice cannot duplicate a week. Dates shift
 * as YYYY-MM-DD strings, so a class keeps its wall-clock time across a clock change.
 */
export async function copyLastWeek(week: string): Promise<ActionResult> {
  if (!isRealDate(week)) return { error: "Άγνωστη εβδομάδα." };

  return withTransaction(async (client): Promise<ActionResult> => {
    const { rows: source } = await client.query<NewSession>(
      `SELECT ${SESSION_TO_COPY}
       FROM class_sessions s
       WHERE s.starts_at >= $1::date AND s.starts_at < $1::date + $2::int
       ORDER BY s.starts_at`,
      [addDays(week, -7), TRAINING_DAYS],
    );
    if (source.length === 0) {
      return { error: "Η προηγούμενη εβδομάδα δεν έχει μαθήματα για αντιγραφή." };
    }

    let added = 0;
    for (const s of source) {
      const day = addDays(s.day, 7);
      if (await overlappingSession(client, day, s.start_time, s.end_time)) continue;

      await insertSession(client, { ...s, day });
      added += 1;
    }

    const skipped = source.length - added;
    if (added === 0) {
      return { notice: "Αυτή η εβδομάδα είναι ήδη ίδια με την προηγούμενη." };
    }
    return {
      notice:
        skipped === 0
          ? `Αντιγράφηκαν μαθήματα: ${added}.`
          : `Αντιγράφηκαν μαθήματα: ${added}. Ώρες που είχαν ήδη μάθημα και έμειναν ως είχαν: ${skipped}.`,
    };
  });
}

/** Deletes a class nobody ever booked, or says why not. */
export async function deleteSession(id: number): Promise<FormError | undefined> {
  const deleted = await db()
    .query("DELETE FROM class_sessions WHERE id = $1", [id])
    .catch((err: unknown) => {
      if (hasPgCode(err, "23503")) return null;
      throw err;
    });
  if (deleted === null) {
    return {
      error:
        "Το μάθημα έχει κρατήσεις και δεν μπορεί να διαγραφεί. Ακύρωσέ το από το πρόγραμμα.",
    };
  }
  return deleted.rowCount === 0 ? { error: "Άγνωστο μάθημα." } : undefined;
}
