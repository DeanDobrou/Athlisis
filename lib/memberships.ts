import "server-only";

import type { PoolClient } from "pg";

import { visitsAfterEdit } from "@/lib/bookings";
import {
  db,
  greekFold,
  hasPgCode,
  likeLiteral,
  type Page,
  paginate,
  type Queryable,
} from "@/lib/db";
import {
  isMembershipState,
  isMembershipStatus,
  isPaymentMethod,
  type BillingInterval,
  type MembershipState,
  type MembershipStatus,
  type PaymentMethod,
} from "@/lib/enums";
import { formatDate, isRealDate } from "@/lib/gym-time";
import { parsePriceToCents } from "@/lib/money";
import { type Fields, type FormError, parseId } from "@/lib/utils";

export type Membership = {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string;
  member_name: string;
  billing_interval: BillingInterval;
  status: MembershipStatus;
  starts_on: string;
  ends_on: string | null;
  visits_remaining: number | null;
  amount_cents: number;
  method: PaymentMethod;
  paid_on: string | null;
  state: MembershipState;
};

/**
 * The one definition of "this membership covers this date". All three columns
 * matter: an inactive row is not coverage, a row that has not begun is not
 * coverage, and a row that has run out is not coverage. A NULL ends_on is an
 * open-ended period, so it never completes.
 *
 * membershipState() below turns the same columns plus paid_on into the badge
 * staff read. It answers a different question and must never be used as a
 * substitute for this one - see the note there.
 *
 * paid_on is deliberately not read here. An unpaid period is still coverage:
 * the member may train on the promise to pay. What they may not do is make a
 * second promise, and that is a separate rule in the booking service, not a
 * question about whether today is covered.
 *
 * `param` is a placeholder or SQL date expression supplied by the caller,
 * never user input.
 */
export function coversDate(param: string, alias = "m"): string {
  return `(${alias}.status = 'active'
    AND ${alias}.starts_on <= ${param}
    AND (${alias}.ends_on IS NULL OR ${alias}.ends_on >= ${param}))`;
}

/** Whether a membership is money the member still owes: active and not paid. */
export function owes(alias = "m"): string {
  return `(${alias}.status = 'active' AND ${alias}.paid_on IS NULL)`;
}

/**
 * The display state, derived from the same columns as coversDate() plus
 * paid_on. The order matters: a status an admin set to inactive wins over
 * everything, money owed wins over the dates because it is the thing staff
 * must act on, and a membership that has not begun reads as scheduled rather
 * than completed.
 *
 * The relationship to coversDate() runs one way only. 'active' is coversDate()
 * being true *and* the money collected, so coverage implies 'active' or
 * 'unpaid' - never the reverse. An unpaid row is not tested against the dates
 * at all, so one that is scheduled, or whose period ended months ago, still
 * reads Unpaid. That is deliberate: a debt has to stay visible in the ledger
 * until someone collects it.
 *
 * So the badge is not a coverage check. Anything deciding whether a member may
 * train calls coversDate() (or hasCoverageToday()), never this.
 */
export function membershipState(alias = "m"): string {
  return `CASE
    WHEN ${alias}.status <> 'active' THEN 'inactive'
    WHEN ${alias}.paid_on IS NULL THEN 'unpaid'
    WHEN ${alias}.starts_on > current_date THEN 'scheduled'
    WHEN ${finished(alias)} THEN 'completed'
    ELSE 'active'
  END`;
}

/** Whether a membership is over: its period has ended, or it is a pack with no visits left. */
function finished(alias = "m"): string {
  return `CASE WHEN ${alias}.ends_on IS NOT NULL THEN ${alias}.ends_on < current_date
               ELSE ${alias}.visits_remaining IS NOT DISTINCT FROM 0 END`;
}

/**
 * The one definition of a membership period: 10 March runs to 10 April, the
 * same day of the next month. Postgres clamps the short months, so 31 January
 * ends 28 February rather than overflowing into March.
 *
 * Both ends are inclusive, so a renewal starting on the end date shares that
 * one day with the period before it. findOverlap() allows exactly that much
 * and no more.
 *
 * A one_time plan gets no end date - a visit pack is consumed by count, not by
 * the calendar.
 *
 * `startParam` is a placeholder or SQL date expression supplied by the caller,
 * never user input. The query must join `plans` under `alias`.
 */
export function periodEndsOn(startParam: string, alias = "p"): string {
  return `CASE ${alias}.billing_interval
    WHEN 'monthly' THEN (${startParam}::date + interval '1 month')::date
    WHEN 'yearly'  THEN (${startParam}::date + interval '1 year')::date
    ELSE NULL
  END`;
}

export type Overlap = {
  plan_name: string;
  starts_on: string;
  ends_on: string | null;
};

/**
 * The membership a new period would overlap, if any: `planId` starting on
 * `startsOn` for this member. Two periods of one member must not overlap, or
 * the same weeks are sold twice. The membership form and the booking that
 * creates a period on a promise both ask this, so the web and the app can only
 * ever decide it one way. Callers hold the member lock, like every other
 * per-member rule.
 *
 * Only periods take part: a dated month or year, or an unlimited pass with no
 * end. A visit pack is consumed by count, not by the calendar, so it may sit
 * beside anything - the August case in section 8.
 *
 * Only a period the member can still use blocks: active, and unlimited or with
 * visits left. A member who spends all twelve visits by the 20th starts the
 * next month then, on a promise or in cash, and that is a renewal, not a
 * mistake. That is also why this is not an exclusion constraint: a cancellation
 * hands a visit back to the old period, and a constraint reading
 * visits_remaining would then fail the cancellation.
 *
 * Periods are compared end-exclusive, so a renewal may start on the day the
 * last one ends. `excludeId` leaves out the row being edited.
 */
export async function findOverlap(
  runner: Queryable,
  userId: number,
  planId: number,
  startsOn: string,
  excludeId: number | null = null,
): Promise<Overlap | null> {
  const { rows } = await runner.query<Overlap>(
    `SELECT p.name AS plan_name,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     JOIN plans np ON np.id = $2
     WHERE m.user_id = $1 AND m.id IS DISTINCT FROM $4::bigint
       AND m.status = 'active'
       AND (m.ends_on IS NOT NULL OR m.visits_remaining IS NULL)
       AND (m.visits_remaining IS NULL OR m.visits_remaining > 0)
       AND (np.billing_interval <> 'one_time' OR np.visits IS NULL)
       AND daterange(m.starts_on, m.ends_on, '[)')
           && daterange($3::date, ${periodEndsOn("$3", "np")}, '[)')
     ORDER BY m.starts_on
     LIMIT 1`,
    [userId, planId, startsOn, excludeId],
  );
  return rows[0] ?? null;
}

/** The period in the way, as staff read it: 3 per week 07/09/2026 - 07/10/2026. */
export function describeOverlap(o: Overlap): string {
  const end = o.ends_on ? formatDate(o.ends_on) : "χωρίς λήξη";
  return `${o.plan_name} ${formatDate(o.starts_on)} - ${end}`;
}

const COLUMNS = `m.id, m.user_id, m.plan_id, p.name AS plan_name,
  u.first_name || ' ' || u.last_name AS member_name,
  p.billing_interval, m.status,
  to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
  m.visits_remaining,
  m.amount_cents, m.method,
  to_char(m.paid_on, 'YYYY-MM-DD') AS paid_on,
  ${membershipState()} AS state`;

export async function listMembershipsForMember(
  userId: number,
): Promise<Membership[]> {
  const { rows } = await db().query<Membership>(
    `SELECT ${COLUMNS}
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     JOIN users u ON u.id = m.user_id
     WHERE m.user_id = $1
     ORDER BY m.starts_on DESC, m.id DESC`,
    [userId],
  );
  return rows;
}

export async function getMembership(rawId: string): Promise<Membership | null> {
  const id = parseId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<Membership>(
    `SELECT ${COLUMNS}
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     JOIN users u ON u.id = m.user_id
     WHERE m.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function countMemberships(userId: number): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    "SELECT count(*) AS count FROM memberships WHERE user_id = $1",
    [userId],
  );
  return Number(rows[0].count);
}

export async function hasCoverageToday(userId: number): Promise<boolean> {
  const { rows } = await db().query<{ covered: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM memberships m
       WHERE m.user_id = $1 AND ${coversDate("current_date")}
     ) AS covered`,
    [userId],
  );
  return rows[0].covered;
}

export type MemberMembership = {
  id: string;
  plan_name: string;
  starts_on: string;
  ends_on: string | null;
  visits_remaining: number | null;
  owed_cents: number | null;
  state: MembershipState;
};

/**
 * A member's own memberships as their phone shows them: a period not yet
 * over, a pack with visits left, and anything still owed. Ended periods,
 * used-up packs and inactive rows are left out.
 */
export async function memberMemberships(
  userId: number,
  runner: Queryable = db(),
): Promise<MemberMembership[]> {
  const { rows } = await runner.query<MemberMembership>(
    `SELECT m.id, p.name AS plan_name,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
            m.visits_remaining,
            CASE WHEN m.paid_on IS NULL THEN m.amount_cents END AS owed_cents,
            ${membershipState()} AS state
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = $1 AND m.status = 'active'
       AND (m.paid_on IS NULL OR NOT ${finished()})
     ORDER BY m.starts_on, m.id`,
    [userId],
  );
  return rows;
}

export type MemberPastMembership = {
  id: string;
  plan_name: string;
  starts_on: string;
  ends_on: string | null;
  visits_remaining: number | null;
  amount_cents: number;
  method: PaymentMethod;
  paid_on: string;
};

export const HISTORY_PAGE_SIZE = 20;

/**
 * A member's own past memberships for their phone, newest first: the paid
 * ones memberMemberships() leaves out, so a period that has ended or a pack
 * used up. An unpaid one stays in memberMemberships() until it is collected.
 *
 * Pages by keyset: pass the `next` of one page as `before` to get the page
 * after it; `next` is null on the last page. Null for a `before` that is not
 * a cursor this returned.
 */
export async function memberHistory(
  userId: number,
  before: string | null,
  runner: Queryable = db(),
  limit = HISTORY_PAGE_SIZE,
): Promise<{ memberships: MemberPastMembership[]; next: string | null } | null> {
  const cursor = before === null ? null : /^(\d{4}-\d{2}-\d{2})_(\d+)$/.exec(before);
  if (before !== null && !cursor) return null;

  const { rows } = await runner.query<MemberPastMembership>(
    `SELECT m.id, p.name AS plan_name,
            to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
            to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
            m.visits_remaining, m.amount_cents, m.method,
            to_char(m.paid_on, 'YYYY-MM-DD') AS paid_on
     FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     WHERE m.user_id = $1 AND m.status = 'active'
       AND m.paid_on IS NOT NULL AND ${finished()}
       AND ($2::date IS NULL OR (m.starts_on, m.id) < ($2::date, $3::bigint))
     ORDER BY m.starts_on DESC, m.id DESC
     LIMIT $4`,
    [userId, cursor?.[1] ?? null, cursor?.[2] ?? null, limit + 1],
  );

  const memberships = rows.slice(0, limit);
  const last = memberships[memberships.length - 1];
  return {
    memberships,
    next: rows.length > limit && last ? `${last.starts_on}_${last.id}` : null,
  };
}

export type MembershipFilter = {
  q?: string;
  state?: string;
  plan?: string;
  page?: string;
};

export async function listMemberships(
  filter: MembershipFilter = {},
): Promise<Page<Membership>> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (filter.q) {
    values.push(`%${likeLiteral(filter.q)}%`);
    where.push(
      `(${greekFold("u.first_name || ' ' || u.last_name")} ILIKE ${greekFold(`$${values.length}`)} ESCAPE '\\'
        OR u.email ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (filter.state && isMembershipState(filter.state)) {
    values.push(filter.state);
    where.push(`${membershipState()} = $${values.length}`);
  }
  const planId = Number(filter.plan);
  if (Number.isSafeInteger(planId) && planId > 0) {
    values.push(planId);
    where.push(`m.plan_id = $${values.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM memberships m
     JOIN plans p ON p.id = m.plan_id
     JOIN users u ON u.id = m.user_id
     ${whereSql}`;

  return paginate<Membership>(
    COLUMNS,
    from,
    "m.starts_on DESC, m.id DESC",
    values,
    filter.page,
  );
}

type ParsedMembership = {
  userId: number;
  planId: number;
  status: string;
  startsOn: string;
  amountCents: number;
  method: string;
  paidOn: string | null;
};

function parseFields(get: Fields): ParsedMembership | Required<FormError> {
  const value = (key: string) => get(key).trim();

  const userId = parseId(value("user_id"));
  if (userId === null) return { field: "user_id", error: "Διάλεξε μέλος." };

  const planId = parseId(value("plan_id"));
  if (planId === null) return { field: "plan_id", error: "Διάλεξε πακέτο." };

  const status = value("status");
  if (!isMembershipStatus(status)) {
    return { field: "status", error: "Διάλεξε κατάσταση." };
  }

  const startsOn = value("starts_on");
  if (!isRealDate(startsOn)) {
    return { field: "starts_on", error: "Δώσε υπαρκτή ημερομηνία έναρξης." };
  }

  // Zero is allowed and means granted rather than sold.
  const amountCents = parsePriceToCents(value("amount"));
  if (amountCents === null) {
    return { field: "amount", error: "Δώσε ποσό όπως 60 ή 60,50." };
  }

  const method = value("method");
  if (!isPaymentMethod(method)) {
    return { field: "method", error: "Διάλεξε τρόπο πληρωμής." };
  }

  // Blank is the money not collected yet, which reads as Unpaid.
  const paidOn = value("paid_on");
  if (paidOn && !isRealDate(paidOn)) {
    return { field: "paid_on", error: "Δώσε υπαρκτή ημερομηνία πληρωμής ή καθάρισέ τη αν είναι ανεξόφλητη." };
  }

  if (amountCents === 0 && !paidOn) {
    return { field: "paid_on", error: "Μια δωρεάν περίοδος δεν έχει τίποτα να εισπραχθεί. Όρισε ημερομηνία πληρωμής." };
  }

  return {
    userId,
    planId,
    status,
    startsOn,
    amountCents,
    method,
    paidOn: paidOn || null,
  };
}

function overlapRefusal(clash: Overlap): Required<FormError> {
  return {
    field: "starts_on",
    error: `Επικαλύπτεται με τη συνδρομή ${describeOverlap(clash)}. Άλλαξε την έναρξη ή κάνε εκείνη ανενεργή.`,
  };
}

const UNKNOWN_MEMBER = { field: "user_id", error: "Άγνωστο μέλος." };

/**
 * Records a membership, with `adminId` as who took the money when it is paid.
 * `client` must already be inside a transaction.
 */
export async function createMembership(
  client: PoolClient,
  get: Fields,
  adminId: number,
): Promise<FormError | { userId: number }> {
  const f = parseFields(get);
  if ("error" in f) return f;

  const { rowCount: found } = await client.query(
    "SELECT 1 FROM users WHERE id = $1 FOR UPDATE",
    [f.userId],
  );
  if (!found) return UNKNOWN_MEMBER;

  if (f.status === "active") {
    const clash = await findOverlap(client, f.userId, f.planId, f.startsOn);
    if (clash) return overlapRefusal(clash);
  }

  const { rowCount } = await client.query(
    `INSERT INTO memberships
       (user_id, plan_id, status, starts_on, ends_on, visits_remaining,
        amount_cents, method, paid_on, recorded_by)
     SELECT $2, p.id, $3, $1::date, ${periodEndsOn("$1")}, p.visits,
            $5, $6, $7::date,
            CASE WHEN $7::date IS NULL THEN NULL ELSE $8::bigint END
     FROM plans p WHERE p.id = $4`,
    [
      f.startsOn,
      f.userId,
      f.status,
      f.planId,
      f.amountCents,
      f.method,
      f.paidOn,
      adminId,
    ],
  );
  return rowCount === 0
    ? { field: "plan_id", error: "Άγνωστο πακέτο." }
    : { userId: f.userId };
}

/**
 * Saves a membership. Visits typed by staff win; a field still holding
 * `visits_shown` counts as untouched. Returns the member it now belongs to and
 * the one it belonged to before. `client` must already be inside a transaction.
 */
export async function updateMembership(
  client: PoolClient,
  id: number,
  get: Fields,
  adminId: number,
): Promise<FormError | { userId: number; previousUserId: string }> {
  const f = parseFields(get);
  if ("error" in f) return f;

  const rawVisits = get("visits_remaining").trim();
  const untouched = rawVisits === get("visits_shown").trim();
  let visitsRemaining: number | null | undefined = untouched ? undefined : null;
  if (rawVisits && !untouched) {
    const n = Number(rawVisits);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { field: "visits_remaining", error: "Οι υπόλοιπες επισκέψεις πρέπει να είναι μηδέν ή ακέραιος αριθμός." };
    }
    visitsRemaining = n;
  }

  const { rowCount: found } = await client.query(
    "SELECT 1 FROM users WHERE id = $1 FOR UPDATE",
    [f.userId],
  );
  if (!found) return UNKNOWN_MEMBER;

  const { rows: before } = await client.query<{
    user_id: string;
    plan_id: string;
    status: string;
    starts_on: string;
  }>(
    `SELECT user_id, plan_id, status,
            to_char(starts_on, 'YYYY-MM-DD') AS starts_on
     FROM memberships WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (before.length === 0) return { error: "Άγνωστη συνδρομή." };
  const was = before[0];

  const periodChanged =
    was.user_id !== String(f.userId) ||
    was.plan_id !== String(f.planId) ||
    was.starts_on !== f.startsOn ||
    was.status !== f.status;
  if (f.status === "active" && periodChanged) {
    const clash = await findOverlap(client, f.userId, f.planId, f.startsOn, id);
    if (clash) return overlapRefusal(clash);
  }

  const visits = await visitsAfterEdit(client, id, f.planId, visitsRemaining);
  if (!visits.ok) return { field: "plan_id", error: visits.error };

  let rowCount: number | null;
  try {
    ({ rowCount } = await client.query(
      `UPDATE memberships m SET
         user_id = $2, plan_id = $4, status = $3, starts_on = $1::date,
         ends_on = ${periodEndsOn("$1")},
         visits_remaining = $5,
         amount_cents = $7, method = $8, paid_on = $9::date,
         recorded_by = CASE WHEN $9::date IS NULL THEN NULL
                            ELSE COALESCE(m.recorded_by, $10::bigint) END
       FROM plans p
       WHERE p.id = $4 AND m.id = $6`,
      [
        f.startsOn,
        f.userId,
        f.status,
        f.planId,
        visits.visits,
        id,
        f.amountCents,
        f.method,
        f.paidOn,
        adminId,
      ],
    ));
  } catch (err) {
    // The failed UPDATE aborts the transaction, so the caller's COMMIT rolls it back.
    if (
      hasPgCode(err, "23503") &&
      (err as { constraint?: string }).constraint ===
        "bookings_membership_belongs_to_member"
    ) {
      return {
        field: "user_id",
        error: "Η συνδρομή έχει ήδη κρατήσεις, οπότε δεν μπορεί να περάσει σε άλλο μέλος. Φτιάξε νέα συνδρομή για το σωστό μέλος.",
      };
    }
    throw err;
  }
  if (rowCount === 0) return { error: "Άγνωστη συνδρομή." };
  return { userId: f.userId, previousUserId: was.user_id };
}
