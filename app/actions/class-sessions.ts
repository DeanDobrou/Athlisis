"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { cancelSession } from "@/lib/bookings";
import { db, hasPgCode, withTransaction } from "@/lib/db";
import {
  addDays,
  isRealDate,
  isWeekend,
  TRAINING_DAYS,
} from "@/lib/gym-time";
import { nextFreeSlot, slotIndex } from "@/lib/slots";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type SessionFormState = { error: string; field?: string } | undefined;

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
  formData: FormData,
): ParsedSession | { error: string; field: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const day = get("day");
  if (!isRealDate(day)) return { field: "day", error: "Διάλεξε ημερομηνία." };
  if (isWeekend(day)) {
    return { field: "day", error: "Το γυμναστήριο δεν έχει μαθήματα το Σαββατοκύριακο." };
  }

  const startTime = get("start_time");
  const endTime = get("end_time");
  if (!HH_MM.test(startTime)) {
    return { field: "start_time", error: "Δώσε την ώρα σε μορφή HH:MM." };
  }
  if (!HH_MM.test(endTime)) {
    return { field: "end_time", error: "Δώσε την ώρα σε μορφή HH:MM." };
  }
  if (endTime <= startTime) {
    return { field: "end_time", error: "Το μάθημα πρέπει να τελειώνει μετά την έναρξή του." };
  }

  const capacity = Number(get("capacity"));
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    return { field: "capacity", error: "Η χωρητικότητα πρέπει να είναι ακέραιος μεγαλύτερος του μηδενός." };
  }

  const typeIds = formData
    .getAll("class_type_ids")
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
    notes: get("notes").slice(0, 2000) || null,
    typeIds,
  };
}

/**
 * date + time is assembled in SQL, so the result lands in the gym's timezone
 * (set on the database) rather than whatever zone the app process happens to run in.
 */
const STARTS_AT = "($1::date + $2::time)";
const ENDS_AT = "($1::date + $3::time)";

export async function createSession(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO class_sessions
         (starts_at, ends_at, capacity, status, notes)
       VALUES (${STARTS_AT}, ${ENDS_AT}, $4, 'scheduled', $5)
       RETURNING id`,
      [f.day, f.startTime, f.endTime, f.capacity, f.notes],
    );
    await client.query(
      `INSERT INTO class_session_types (class_session_id, class_type_id)
       SELECT $1, unnest($2::bigint[])`,
      [rows[0].id, f.typeIds],
    );
  });

  revalidatePath("/schedule");
  redirect(`/schedule?week=${f.day}`);
}

export async function updateSession(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const found = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE class_sessions SET
         starts_at = ${STARTS_AT}, ends_at = ${ENDS_AT},
         capacity = $4, notes = $5
       WHERE id = $6`,
      [f.day, f.startTime, f.endTime, f.capacity, f.notes, id],
    );
    if (rowCount === 0) return false;

    await client.query(
      "DELETE FROM class_session_types WHERE class_session_id = $1",
      [id],
    );
    await client.query(
      `INSERT INTO class_session_types (class_session_id, class_type_id)
       SELECT $1, unnest($2::bigint[])`,
      [id, f.typeIds],
    );
    return true;
  });
  if (!found) return { error: "Άγνωστο μάθημα." };

  revalidatePath("/schedule");
  redirect(`/schedule?week=${f.day}`);
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Cancels a class and gives back what its bookings spent; the rules are in
 * cancelSession in lib/bookings.ts. Returns what happened, for a toast, since
 * staff should see that the members' bookings went with it.
 */
export async function cancelSessionAction(
  rawId: string,
): Promise<{ error: string } | { notice: string }> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction((client) => cancelSession(client, id));
  if (!result.ok) return { error: result.error };

  // Bookings, visits and unpaid memberships all moved, so every screen that
  // shows one changes.
  revalidatePath("/schedule");
  revalidatePath("/bookings");
  revalidatePath("/memberships");
  revalidatePath("/dashboard");

  const total = result.cancelled + result.voided;
  if (total === 0) return { notice: "Το μάθημα ακυρώθηκε. Δεν είχε κρατήσεις." };
  const voided =
    result.voided > 0
      ? ` Διαγράφηκαν ${count(result.voided, "ανεξόφλητη συνδρομή", "ανεξόφλητες συνδρομές")} που είχαν γίνει μόνο γι' αυτό.`
      : "";
  return {
    notice: `Το μάθημα ακυρώθηκε, μαζί με ${count(total, "κράτηση", "κρατήσεις")}. Οι επισκέψεις επιστράφηκαν.${voided}`,
  };
}

/**
 * Brings a cancelled class back. Only the class: the bookings cancelling it
 * gave back stay cancelled, and staff book members onto it again.
 */
export async function restoreSessionAction(
  rawId: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const { rowCount } = await db().query(
    "UPDATE class_sessions SET status = 'scheduled' WHERE id = $1",
    [id],
  );
  if (rowCount === 0) return { error: "Άγνωστο μάθημα." };

  revalidatePath("/schedule");
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  return undefined;
}

/**
 * Duplicates a class into the next free slot on the same day, carrying its
 * types, capacity and notes across. The gym programmes the same session
 * several times an evening, so this is the common case rather than a
 * convenience.
 */
export async function copySession(
  rawId: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction(async (client) => {
    const { rows: found } = await client.query<{
      day: string;
      start_time: string;
      capacity: number;
      notes: string | null;
    }>(
      `SELECT to_char(starts_at, 'YYYY-MM-DD') AS day,
              to_char(starts_at, 'HH24:MI') AS start_time,
              capacity, notes
       FROM class_sessions WHERE id = $1`,
      [id],
    );
    if (found.length === 0) return { error: "Άγνωστο μάθημα." };
    const source = found[0];

    const { rows: siblings } = await client.query<{ start_time: string }>(
      `SELECT to_char(starts_at, 'HH24:MI') AS start_time
       FROM class_sessions
       WHERE starts_at >= $1::date AND starts_at < $1::date + 1`,
      [source.day],
    );

    const taken = new Set(siblings.map((s) => s.start_time));
    const target = nextFreeSlot(taken, slotIndex(source.start_time));
    if (!target) {
      return { error: "Όλες οι ώρες είναι ήδη καλυμμένες για εκείνη την ημέρα." };
    }

    const { rows: created } = await client.query<{ id: string }>(
      `INSERT INTO class_sessions
         (starts_at, ends_at, capacity, status, notes)
       VALUES ($1::date + $2::time, $1::date + $3::time, $4, 'scheduled', $5)
       RETURNING id`,
      [source.day, target.start, target.end, source.capacity, source.notes],
    );

    // The class types are the point of the copy, so they come across too.
    await client.query(
      `INSERT INTO class_session_types (class_session_id, class_type_id)
       SELECT $1, class_type_id
       FROM class_session_types WHERE class_session_id = $2`,
      [created[0].id, id],
    );

    return undefined;
  });

  if (!result) revalidatePath("/schedule");
  return result;
}

/**
 * Fills a week from the one before it. Idempotent: a slot that already has a
 * class is left alone, so pressing it twice cannot duplicate a week.
 *
 * Dates are shifted as YYYY-MM-DD strings and the wall-clock time re-applied,
 * so a class copied across the October clock change stays at 18:00. Postgres
 * would also get this right with `+ interval '7 days'`, which is calendar
 * aware; it is `interval '168 hours'` that silently lands an hour out. Working
 * from the local date sidesteps the distinction entirely.
 */
export async function copyLastWeek(
  week: string,
): Promise<{ error?: string; message?: string }> {
  await requireAdmin();

  if (!isRealDate(week)) return { error: "Άγνωστη εβδομάδα." };

  const result = await withTransaction(async (client) => {
    const { rows: source } = await client.query<{
      id: string;
      day: string;
      start_time: string;
      end_time: string;
      capacity: number;
      notes: string | null;
    }>(
      `SELECT s.id,
              to_char(s.starts_at, 'YYYY-MM-DD') AS day,
              to_char(s.starts_at, 'HH24:MI') AS start_time,
              to_char(s.ends_at, 'HH24:MI') AS end_time,
              s.capacity, s.notes
       FROM class_sessions s
       WHERE s.starts_at >= $1::date AND s.starts_at < $1::date + $2::int
       ORDER BY s.starts_at`,
      [addDays(week, -7), TRAINING_DAYS],
    );
    if (source.length === 0) {
      return { error: "Η προηγούμενη εβδομάδα δεν έχει μαθήματα για αντιγραφή." };
    }

    const { rows: occupied } = await client.query<{
      day: string;
      start_time: string;
    }>(
      `SELECT to_char(starts_at, 'YYYY-MM-DD') AS day,
              to_char(starts_at, 'HH24:MI') AS start_time
       FROM class_sessions
       WHERE starts_at >= $1::date AND starts_at < $1::date + $2::int`,
      [week, TRAINING_DAYS],
    );
    const taken = new Set(occupied.map((o) => `${o.day} ${o.start_time}`));

    let added = 0;
    for (const s of source) {
      const day = addDays(s.day, 7);
      if (taken.has(`${day} ${s.start_time}`)) continue;

      const { rows: created } = await client.query<{ id: string }>(
        `INSERT INTO class_sessions
           (starts_at, ends_at, capacity, status, notes)
         VALUES ($1::date + $2::time, $1::date + $3::time, $4, 'scheduled', $5)
         RETURNING id`,
        [day, s.start_time, s.end_time, s.capacity, s.notes],
      );
      await client.query(
        `INSERT INTO class_session_types (class_session_id, class_type_id)
         SELECT $1, class_type_id
         FROM class_session_types WHERE class_session_id = $2`,
        [created[0].id, s.id],
      );
      added += 1;
    }

    const skipped = source.length - added;
    if (added === 0) {
      return { message: "Αυτή η εβδομάδα είναι ήδη ίδια με την προηγούμενη." };
    }
    return {
      message:
        skipped === 0
          ? `Copied ${added} classes from the week before.`
          : `Copied ${added} classes, left ${skipped} slot(s) that already had one.`,
    };
  });

  if (!result.error) revalidatePath("/schedule");
  return result;
}

export async function deleteSession(
  rawId: string,
  week: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

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
  if (deleted.rowCount === 0) return { error: "Άγνωστο μάθημα." };

  revalidatePath("/schedule");
  redirect(week ? `/schedule?week=${week}` : "/schedule");
}
