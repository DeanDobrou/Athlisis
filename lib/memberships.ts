import "server-only";

import { db, likeLiteral } from "@/lib/db";
import {
  isMembershipState,
  type BillingInterval,
  type MembershipState,
  type MembershipStatus,
} from "@/lib/enums";

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
  state: MembershipState;
};

/**
 * The one definition of "this membership covers this date". All three columns
 * matter: an inactive row is not coverage, a row that has not begun is not
 * coverage, and a row that has run out is not coverage. A NULL ends_on is an
 * open-ended period, so it never completes.
 *
 * membershipState() above splits the false cases into scheduled / completed /
 * inactive for display; this returns the plain yes-or-no the booking service
 * needs.
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
 * The display state, derived from the same three columns as coversDate(). The
 * order matters: a status an admin set to inactive wins over the dates, and a
 * membership that has not begun reads as scheduled rather than completed.
 *
 * 'active' here is exactly coversDate() being true, by construction, so the
 * column shown in the grid and the answer the booking service gets can never
 * disagree.
 */
export function membershipState(alias = "m"): string {
  return `CASE
    WHEN ${alias}.status <> 'active' THEN 'inactive'
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
 * Both ends are inclusive, so a renewal starting on the end date would share
 * that one day. Renewals are recorded by hand whenever the member next pays,
 * which is rarely the exact day the last period ended, so back-to-back periods
 * do not arise in practice.
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

const COLUMNS = `m.id, m.user_id, m.plan_id, p.name AS plan_name,
  u.first_name || ' ' || u.last_name AS member_name,
  p.billing_interval, m.status,
  to_char(m.starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(m.ends_on, 'YYYY-MM-DD') AS ends_on,
  m.visits_remaining,
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

export function parseMembershipId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getMembership(
  rawId: string,
): Promise<Membership | null> {
  const id = parseMembershipId(rawId);
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
      `((u.first_name || ' ' || u.last_name) ILIKE $${values.length} ESCAPE '\\'
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
