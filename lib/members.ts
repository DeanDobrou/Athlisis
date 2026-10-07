import "server-only";

import type { Role } from "@/lib/auth";
import type { Queryable } from "@/lib/bookings";
import { db, greekFold, likeLiteral } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { issueCode, spendCode } from "@/lib/email-codes";
import { todayInGym } from "@/lib/gym-time";
import { verifyPassword } from "@/lib/password";
import { parseId } from "@/lib/utils";

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
    // Both sides go through greekFold: accents and final sigma make a
    // literal ILIKE miss how Greek names are really typed and stored. The
    // email half stays literal, since addresses are ASCII.
    where.push(
      `(${greekFold("first_name || ' ' || last_name")} ILIKE ${greekFold(`$${values.length}`)} ESCAPE '\\'
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

export async function getMember(rawId: string): Promise<Member | null> {
  const id = parseId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<Member>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export type MemberFields = ReturnType<typeof parseMemberFields>;

/** A member's details as typed, trimmed and capped to their columns. */
export function parseMemberFields(get: (key: string) => string) {
  const value = (key: string) => get(key).trim();
  return {
    firstName: value("first_name").slice(0, 100),
    lastName: value("last_name").slice(0, 100),
    email: value("email").toLowerCase().slice(0, 255),
    phone: value("phone").slice(0, 30) || null,
    dateOfBirth: value("date_of_birth") || null,
    role: value("role") === "admin" ? "admin" : "member",
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first problem with a member's details, naming the field, or null. */
export function memberFieldsProblem(
  f: MemberFields,
): { field: string; error: string } | null {
  if (!f.firstName) return { field: "first_name", error: "Το όνομα είναι υποχρεωτικό." };
  if (!f.lastName) return { field: "last_name", error: "Το επώνυμο είναι υποχρεωτικό." };
  if (!EMAIL.test(f.email)) {
    return { field: "email", error: "Δώσε έγκυρη διεύθυνση email." };
  }
  if (f.dateOfBirth && !isPastDate(f.dateOfBirth)) {
    return { field: "date_of_birth", error: "Δώσε έγκυρη ημερομηνία γέννησης." };
  }
  return null;
}

/** Whether a YYYY-MM-DD string is a real calendar date before today. */
function isPastDate(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === day &&
    day < todayInGym()
  );
}

/** Saves the details members edit themselves. Email changes through a confirmed code instead. */
export async function updateOwnDetails(
  userId: number,
  f: MemberFields,
): Promise<void> {
  await db().query(
    `UPDATE users SET first_name = $1, last_name = $2, phone = $3,
       date_of_birth = $4
     WHERE id = $5`,
    [f.firstName, f.lastName, f.phone, f.dateOfBirth, userId],
  );
}

const EMAIL_TAKEN = "Αυτό το email χρησιμοποιείται ήδη.";

/**
 * Checks the current password and the new address, then issues a code to
 * confirm the address with. The account keeps its old email until the code
 * comes back.
 */
export async function issueEmailChange(
  runner: Queryable,
  userId: number,
  newEmail: string,
  password: string,
): Promise<{ ok: true; email: string; code: string } | { ok: false; error: string }> {
  const email = newEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 255) {
    return { ok: false, error: "Δώσε έγκυρη διεύθυνση email." };
  }

  const { rows } = await runner.query<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM users WHERE id = $1",
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
    return { ok: false, error: "Ο κωδικός είναι λάθος." };
  }
  if (rows[0].email.toLowerCase() === email) {
    return { ok: false, error: "Αυτό είναι ήδη το email σου." };
  }
  if (await emailTaken(runner, email, userId)) return { ok: false, error: EMAIL_TAKEN };

  return { ok: true, email, code: await issueCode(runner, userId, "email_change", email) };
}

/**
 * Switches the account to the address a code was sent to, once the code
 * matches. Runs inside a transaction that commits a refusal too, so wrong
 * guesses are counted.
 */
export async function confirmEmailChange(
  client: Queryable,
  userId: number,
  code: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  await client.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [userId]);
  const email = await spendCode(client, userId, "email_change", code);
  if (email === null) return { ok: false, error: "Ο κωδικός είναι λάθος ή έχει λήξει." };
  if (await emailTaken(client, email, userId)) return { ok: false, error: EMAIL_TAKEN };

  await client.query("UPDATE users SET email = $1 WHERE id = $2", [email, userId]);
  return { ok: true, email };
}

async function emailTaken(runner: Queryable, email: string, exceptId: number) {
  const { rowCount } = await runner.query(
    "SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2",
    [email, exceptId],
  );
  return rowCount !== 0;
}

/**
 * Emails a new member their login and the generated password, with the steps
 * for the first sign-in in the app, where they choose their own password.
 */
export function sendWelcomeEmail(to: string, firstName: string, password: string) {
  const gym = process.env.GYM_NAME ?? "";
  return sendEmail(
    to,
    `Καλώς ήρθες στο ${gym}`,
    [
      `Γεια σου ${firstName},`,
      "",
      `Ο λογαριασμός σου στο ${gym} είναι έτοιμος. Με αυτόν κλείνεις θέση στα μαθήματα από την εφαρμογή.`,
      "",
      `Email: ${to}`,
      `Προσωρινός κωδικός: ${password}`,
      "",
      "Η πρώτη σου σύνδεση:",
      "1. Άνοιξε την εφαρμογή και συνδέσου με το email σου και τον προσωρινό κωδικό.",
      "2. Η εφαρμογή θα σου ζητήσει να διαλέξεις τον δικό σου κωδικό. Ο προσωρινός ισχύει μόνο για αυτή την πρώτη σύνδεση.",
      "3. Από εκεί και πέρα συνδέεσαι με το email σου και τον κωδικό που διάλεξες.",
      "",
      "Αν ξεχάσεις τον κωδικό σου, πάτησε «Ξέχασες τον κωδικό;» στην οθόνη σύνδεσης και θα σου στείλουμε κωδικό με email για να ορίσεις νέο.",
      "",
      gym,
    ].join("\n"),
  );
}

export async function listAllMembers(): Promise<Member[]> {
  const { rows } = await db().query<Member>(
    `SELECT ${COLUMNS} FROM users ORDER BY last_name, first_name`,
  );
  return rows;
}
