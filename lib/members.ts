import "server-only";

import { db } from "@/lib/db";
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
    values.push(`%${filter.q}%`);
    where.push(
      `((first_name || ' ' || last_name) ILIKE $${values.length} OR email ILIKE $${values.length})`,
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

  const page = Math.max(1, Math.floor(Number(filter.page)) || 1);
  values.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const { rows } = await db().query<Member & { total: string }>(
    `SELECT ${COLUMNS}, count(*) OVER () AS total
     FROM users
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY last_name, first_name
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

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
