import "server-only";

import { db, likeLiteral } from "@/lib/db";
import type { Role } from "@/lib/session";

export type MemberStatus = "active" | "inactive";

export type Member = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: Role;
  status: MemberStatus;
  date_of_birth: string | null;
  created_at: string;
};

const COLUMNS = `id, email, first_name, last_name, phone, role, status,
  to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
  to_char(created_at, 'YYYY-MM-DD') AS created_at`;

export const PAGE_SIZE = 20;

export type MemberFilter = {
  q?: string;
  status?: string;
  role?: string;
  page?: string;
};

export type MemberPage = {
  rows: Member[];
  total: number;
  page: number;
  pageCount: number;
};

export async function listMembers(filter: MemberFilter): Promise<MemberPage> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (filter.q) {
    values.push(`%${likeLiteral(filter.q)}%`);
    where.push(
      `((first_name || ' ' || last_name) ILIKE $${values.length} ESCAPE '\\'
        OR email ILIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (filter.status === "active" || filter.status === "inactive") {
    values.push(filter.status);
    where.push(`status::text = $${values.length}`);
  }
  if (filter.role === "member" || filter.role === "admin") {
    values.push(filter.role);
    where.push(`role::text = $${values.length}`);
  }

  const from = `FROM users
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;

  const fetchPage = async (p: number) => {
    const { rows } = await db().query<Member & { total: string }>(
      `SELECT ${COLUMNS}, count(*) OVER () AS total
       ${from}
       ORDER BY last_name, first_name
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
    const found = Number(counted[0].total);
    if (found > 0) {
      page = Math.ceil(found / PAGE_SIZE);
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

export function parseMemberId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getMember(rawId: string): Promise<Member | null> {
  const id = parseMemberId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<Member>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listAllMembers(): Promise<Member[]> {
  const { rows } = await db().query<Member>(
    `SELECT ${COLUMNS} FROM users ORDER BY last_name, first_name`,
  );
  return rows;
}
