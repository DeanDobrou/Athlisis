import "server-only";

import { endsSessions, type Role } from "@/lib/auth";
import {
  db,
  greekFold,
  hasPgCode,
  likeLiteral,
  type Page,
  paginate,
  type Queryable,
  withTransaction,
} from "@/lib/db";
import { escapeHtml, gymName, sendEmail } from "@/lib/email";
import { issueCode, spendCode } from "@/lib/email-codes";
import { isRealDate, todayInGym } from "@/lib/gym-time";
import { countMemberships } from "@/lib/memberships";
import {
  generatePassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";
import {
  type ActionResult,
  type Fields,
  type FormError,
  parseId,
} from "@/lib/utils";

const APP_STORE_URL = "https://apps.apple.com/gr/app/as-athlisis/id6828026459?l=el";

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

export type MemberFilter = {
  q?: string;
  status?: string;
  role?: string;
  page?: string;
};

export async function listMembers(filter: MemberFilter): Promise<Page<Member>> {
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

  return paginate<Member>(
    COLUMNS,
    from,
    "last_name, first_name",
    values,
    filter.page,
  );
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
  return isRealDate(day) && day < todayInGym();
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
  const gym = gymName();
  const intro = [
    `Γεια σου ${firstName},`,
    "",
    `Ο λογαριασμός σου στο ${gym} είναι έτοιμος. Με αυτόν κλείνεις θέση στα μαθήματα από την εφαρμογή.`,
    "",
    `Email: ${to}`,
    `Προσωρινός κωδικός: ${password}`,
  ].join("\n");
  const steps = [
    "Η πρώτη σου σύνδεση:",
    "1. Άνοιξε την εφαρμογή και συνδέσου με το email σου και τον προσωρινό κωδικό.",
    "2. Η εφαρμογή θα σου ζητήσει να διαλέξεις τον δικό σου κωδικό. Ο προσωρινός ισχύει μόνο για αυτή την πρώτη σύνδεση.",
    "3. Από εκεί και πέρα συνδέεσαι με το email σου και τον κωδικό που διάλεξες.",
    "",
    "Αν ξεχάσεις τον κωδικό σου, πάτησε «Ξέχασες τον κωδικό;» στην οθόνη σύνδεσης και θα σου στείλουμε κωδικό με email για να ορίσεις νέο.",
    "",
    gym,
  ].join("\n");
  const paragraph = (s: string) => `<p>${escapeHtml(s).replaceAll("\n", "<br>")}</p>`;
  const button = `<p><a href="${APP_STORE_URL}" style="display:inline-block;background:#000;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Λήψη από το App Store</a></p>`;
  return sendEmail(
    to,
    `Καλώς ήρθες στο ${gym}`,
    [intro, `Κατέβασε την εφαρμογή από το App Store: ${APP_STORE_URL}`, steps].join("\n\n"),
    `<div style="font-family:sans-serif;font-size:15px;line-height:1.5">${paragraph(intro)}${button}${paragraph(steps)}</div>`,
  );
}

/**
 * Gives an active member a new generated password to change at their next
 * sign-in, and ends their open sessions. Returns what the welcome email needs,
 * or null for an admin or an inactive account.
 */
export async function issueTemporaryPassword(runner: Queryable, id: number) {
  const password = generatePassword();
  const { rows } = await runner.query<{ email: string; first_name: string }>(
    `UPDATE users SET password_hash = $1, must_change_password = true,
       token_version = token_version + 1
     WHERE id = $2 AND role = 'member' AND status = 'active'
     RETURNING email, first_name`,
    [await hashPassword(password), id],
  );
  return rows[0] ? { ...rows[0], password } : null;
}

export async function listAllMembers(): Promise<Member[]> {
  const { rows } = await db().query<Member>(
    `SELECT ${COLUMNS} FROM users ORDER BY last_name, first_name`,
  );
  return rows;
}

/**
 * Adds a member or an admin. A member gets a generated password, changed at
 * the first login, and the welcome email when `sendWelcome`; an admin's
 * password is typed on the form. Returns the new id and how the email went.
 */
export async function createMember(
  get: Fields,
  sendWelcome: boolean,
): Promise<FormError | { id: string; welcome: "sent" | "failed" | null }> {
  const f = parseMemberFields(get);
  const invalid = memberFieldsProblem(f);
  if (invalid) return invalid;

  const isAdmin = f.role === "admin";
  const password = isAdmin ? get("password") : generatePassword();
  if (isAdmin) {
    const problem = passwordProblem(password);
    if (problem) return { field: "password", error: problem };
  }
  const passwordHash = await hashPassword(password);

  let id: string;
  try {
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, role,
          date_of_birth, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        f.email,
        passwordHash,
        f.firstName,
        f.lastName,
        f.phone,
        f.role,
        f.dateOfBirth,
        !isAdmin,
      ],
    );
    id = rows[0].id;
  } catch (err) {
    if (hasPgCode(err, "23505")) return { field: "email", error: EMAIL_TAKEN };
    throw err;
  }

  if (isAdmin || !sendWelcome) return { id, welcome: null };
  try {
    await sendWelcomeEmail(f.email, f.firstName, password);
    return { id, welcome: "sent" };
  } catch (err) {
    console.error("welcome email failed", err);
    return { id, welcome: "failed" };
  }
}

/**
 * Emails an existing member the welcome email with a new temporary password.
 * The new password is kept only if the email went out.
 */
export async function resendWelcomeEmail(id: number): Promise<ActionResult> {
  try {
    const sent = await withTransaction(async (client) => {
      const issued = await issueTemporaryPassword(client, id);
      if (issued) {
        await sendWelcomeEmail(issued.email, issued.first_name, issued.password);
      }
      return issued !== null;
    });
    if (!sent) {
      return { error: "Το email καλωσορίσματος στέλνεται μόνο σε ενεργά μέλη." };
    }
  } catch (err) {
    console.error("welcome email failed", err);
    return {
      error: "Το email δεν στάλθηκε, οπότε ο κωδικός του μέλους δεν άλλαξε.",
    };
  }
  return { notice: "Στάλθηκε email καλωσορίσματος με νέο προσωρινό κωδικό." };
}

/**
 * The write both update forms share. A blank password leaves the current one
 * alone. `access` is null for the profile, which keeps role and status as they are.
 */
async function saveUser(
  id: number,
  f: MemberFields,
  get: Fields,
  access: { role: string; status: string } | null,
): Promise<FormError | undefined> {
  const password = get("password");
  const problem = password ? passwordProblem(password) : null;
  if (problem) return { field: "password", error: problem };
  const passwordHash = password ? await hashPassword(password) : null;
  const bump = endsSessions(passwordHash !== null, access?.status ?? null)
    ? 1
    : 0;

  try {
    const { rowCount } = await db().query(
      `UPDATE users SET
         email = $1, first_name = $2, last_name = $3, phone = $4,
         date_of_birth = $5,
         role = COALESCE($6::user_role, role),
         status = COALESCE($7::user_status, status),
         password_hash = COALESCE($8, password_hash),
         token_version = token_version + $9
       WHERE id = $10`,
      [
        f.email,
        f.firstName,
        f.lastName,
        f.phone,
        f.dateOfBirth,
        access?.role ?? null,
        access?.status ?? null,
        passwordHash,
        bump,
        id,
      ],
    );
    if (rowCount === 0) return { error: "Άγνωστο μέλος." };
  } catch (err) {
    if (hasPgCode(err, "23505")) return { field: "email", error: EMAIL_TAKEN };
    throw err;
  }
  return undefined;
}

/** Saves a member's details, role and status; `adminId` cannot take away their own admin rights. */
export async function updateMember(
  id: number,
  get: Fields,
  adminId: number,
): Promise<FormError | undefined> {
  const f = parseMemberFields(get);
  const invalid = memberFieldsProblem(f);
  if (invalid) return invalid;

  const status = get("status") === "inactive" ? "inactive" : "active";
  if (id === adminId && (status === "inactive" || f.role !== "admin")) {
    return { error: "Δεν μπορείς να αφαιρέσεις τα δικά σου δικαιώματα διαχειριστή." };
  }

  return saveUser(id, f, get, { role: f.role, status });
}

/** Saves an admin's own details, leaving their role and status alone. */
export async function updateProfile(
  userId: number,
  get: Fields,
): Promise<FormError | undefined> {
  const f = parseMemberFields(get);
  const invalid = memberFieldsProblem(f);
  if (invalid) return invalid;

  return saveUser(userId, f, get, null);
}

/** Deletes a member with no history, or says why not; `adminId` cannot delete themselves. */
export async function deleteMember(
  id: number,
  adminId: number,
): Promise<FormError | undefined> {
  if (id === adminId) {
    return { error: "Δεν μπορείς να διαγράψεις τον δικό σου λογαριασμό." };
  }

  if (await countMemberships(id)) {
    return {
      error:
        "Το μέλος έχει ιστορικό συνδρομών και δεν μπορεί να διαγραφεί. Κάνε το μέλος ανενεργό αντί να το διαγράψεις.",
    };
  }

  try {
    const { rowCount } = await db().query("DELETE FROM users WHERE id = $1", [
      id,
    ]);
    if (rowCount === 0) return { error: "Άγνωστο μέλος." };
  } catch (err) {
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "Το μέλος έχει κρατήσεις, μαθήματα, WOD ή ιστορικό συνδρομών και δεν μπορεί να διαγραφεί.",
      };
    }
    throw err;
  }
  return undefined;
}
