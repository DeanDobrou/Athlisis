import "server-only";

import type { Queryable } from "@/lib/bookings";
import { db, greekFold, likeLiteral } from "@/lib/db";
import {
  isMembershipState,
  type BillingInterval,
  type MembershipState,
  type MembershipStatus,
  type PaymentMethod,
} from "@/lib/enums";
import { formatDate } from "@/lib/gym-time";
import { parseId } from "@/lib/utils";

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
    WHEN ${alias}.ends_on IS NOT NULL AND ${alias}.ends_on < current_date
      THEN 'completed'
    ELSE 'active'
  END`;
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

export const PAGE_SIZE = 20;

export type MembershipFilter = {
  q?: string;
  state?: string;
  plan?: string;
  page?: string;
};

export type MembershipPage = {
  rows: Membership[];
  total: number;
  page: number;
  pageCount: number;
};

export async function listMemberships(
  filter: MembershipFilter = {},
): Promise<MembershipPage> {
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

  const fetchPage = async (p: number) => {
    const { rows } = await db().query<Membership & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER () AS total
       ${from}
       ORDER BY m.starts_on DESC, m.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, PAGE_SIZE, (p - 1) * PAGE_SIZE],
    );
    return rows;
  };

  let page = Math.max(1, Math.floor(Number(filter.page)) || 1);
  let rows = await fetchPage(page);

  if (rows.length === 0 && page > 1) {
    const { rows: counted } = await db().query<{ total: string }>(
      `SELECT count(*) AS total ${from}`,
      values,
    );
    const total = Number(counted[0].total);
    if (total > 0) {
      page = Math.ceil(total / PAGE_SIZE);
      rows = await fetchPage(page);
    }
  }

  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
