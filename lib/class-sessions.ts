import "server-only";

import type { ClassType } from "@/lib/class-types";
import { db } from "@/lib/db";
import { TRAINING_DAYS } from "@/lib/gym-time";

export type SessionStatus = "scheduled" | "cancelled";

/**
 * ponytail: a constant, not a settings row. Every class holds the same number
 * and it is editable per session anyway. Move it into `settings` when bookings
 * arrive and that table exists for the unpaid allowance.
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
 * Times are rendered by Postgres in the gym's timezone (migration 009) rather
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

export function parseSessionId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getSession(
  rawId: string,
): Promise<ClassSession | null> {
  const id = parseSessionId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<ClassSession>(
    `SELECT ${COLUMNS} ${FROM} WHERE s.id = $1 GROUP BY s.id`,
    [id],
  );
  return rows[0] ?? null;
}
