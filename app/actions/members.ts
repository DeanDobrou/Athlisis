"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { endsSessions, type Session } from "@/lib/auth";
import { db, hasPgCode } from "@/lib/db";
import { redirectSaved } from "@/lib/flash";
import { countMemberships, hasCoverageToday } from "@/lib/memberships";
import { generatePassword, hashPassword } from "@/lib/password";
import { createSession, requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type MemberFormState = { error: string; field?: string } | undefined;

const MIN_PASSWORD_LENGTH = 8;

type Fields = ReturnType<typeof parseFields>;

function parseFields(formData: FormData) {
  const get = (key: string) => String(formData.get(key) ?? "").trim();
  return {
    firstName: get("first_name").slice(0, 100),
    lastName: get("last_name").slice(0, 100),
    email: get("email").toLowerCase().slice(0, 255),
    phone: get("phone").slice(0, 30) || null,
    dateOfBirth: get("date_of_birth") || null,
    role: get("role") === "admin" ? "admin" : "member",
  };
}

function validate(f: Fields): { field: string; error: string } | null {
  if (!f.firstName) return { field: "first_name", error: "Το όνομα είναι υποχρεωτικό." };
  if (!f.lastName) return { field: "last_name", error: "Το επώνυμο είναι υποχρεωτικό." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
    return { field: "email", error: "Δώσε έγκυρη διεύθυνση email." };
  }
  return null;
}

const isDuplicateEmail = (err: unknown) => hasPgCode(err, "23505");
const isStillReferenced = (err: unknown) => hasPgCode(err, "23503");

export async function createMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  await requireAdmin();

  const f = parseFields(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const sendWelcomeEmail = formData.get("send_welcome_email") !== null;

  // password_hash is NOT NULL, so an account always has one. It is never
  // displayed: the member gets it from the welcome email, or an admin sets a
  // new one on the update form.
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  let memberId: string;
  try {
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, role, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        f.email,
        passwordHash,
        f.firstName,
        f.lastName,
        f.phone,
        f.role,
        f.dateOfBirth,
      ],
    );
    memberId = rows[0].id;
  } catch (err) {
    if (isDuplicateEmail(err)) {
      return { field: "email", error: "Αυτό το email χρησιμοποιείται ήδη." };
    }
    throw err;
  }

  if (sendWelcomeEmail) {
    // TODO: send `password` to f.email once a transport is chosen (spec §10).
    // It has to happen here: the plaintext exists only inside this function.
  }

  revalidatePath("/members");
  await redirectSaved(`/members/${memberId}`);
}

/**
 * The write both update forms share. A blank password leaves the current one
 * alone. `access` is null for the profile, which keeps role and status exactly
 * as they are.
 */
async function saveUser(
  id: number,
  f: Fields,
  formData: FormData,
  access: { role: string; status: string } | null,
): Promise<MemberFormState> {
  const password = String(formData.get("password") ?? "");
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return {
      field: "password",
      error: `Ο νέος κωδικός πρέπει να έχει τουλάχιστον ${MIN_PASSWORD_LENGTH} χαρακτήρες.`,
    };
  }
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
    if (isDuplicateEmail(err)) {
      return { field: "email", error: "Αυτό το email χρησιμοποιείται ήδη." };
    }
    throw err;
  }
  return undefined;
}

/**
 * Re-issues the caller's cookie after they save their own row. Setting a new
 * password raises token_version, which would otherwise sign them out of the
 * page they are standing on.
 */
async function keepOwnSessionAlive(session: Session, savedId: number) {
  if (savedId !== session.userId) return;

  const { rows } = await db().query<{ token_version: number }>(
    "SELECT token_version FROM users WHERE id = $1",
    [savedId],
  );
  if (rows[0]) {
    await createSession({ ...session, tokenVersion: rows[0].token_version });
  }
}

export async function updateMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστο μέλος." };

  const f = parseFields(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const status =
    String(formData.get("status") ?? "") === "inactive" ? "inactive" : "active";

  if (id === admin.userId && (status === "inactive" || f.role !== "admin")) {
    return { error: "Δεν μπορείς να αφαιρέσεις τα δικά σου δικαιώματα διαχειριστή." };
  }

  const refused = await saveUser(id, f, formData, { role: f.role, status });
  if (refused) return refused;
  await keepOwnSessionAlive(admin, id);

  revalidatePath("/members");
  revalidatePath(`/members/${id}`);
  await redirectSaved(`/members/${id}`);
}

/**
 * The logged-in admin's own details. The id is the session's, never the
 * form's, and role and status are left alone, so nobody can promote, demote
 * or deactivate themselves from here.
 */
export async function updateProfile(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();

  const f = parseFields(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const refused = await saveUser(admin.userId, f, formData, null);
  if (refused) return refused;
  await keepOwnSessionAlive(admin, admin.userId);

  revalidatePath("/members");
  revalidatePath(`/members/${admin.userId}`);
  await redirectSaved("/dashboard");
}

export async function deleteMember(
  rawId: string,
): Promise<{ error: string } | undefined> {
  const admin = await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μέλος." };
  if (id === admin.userId) {
    return { error: "Δεν μπορείς να διαγράψεις τον δικό σου λογαριασμό." };
  }

  if (await hasCoverageToday(id)) {
    return {
      error:
        "Το μέλος έχει ενεργή συνδρομή και δεν μπορεί να διαγραφεί. Κάνε τη συνδρομή ανενεργή ή διάγραψέ τη πρώτα.",
    };
  }
  if (await countMemberships(id)) {
    return {
      error:
        "Το μέλος έχει ιστορικό συνδρομών και δεν μπορεί να διαγραφεί. Διάγραψε πρώτα τις συνδρομές του.",
    };
  }

  try {
    const { rowCount } = await db().query("DELETE FROM users WHERE id = $1", [
      id,
    ]);
    if (rowCount === 0) return { error: "Άγνωστο μέλος." };
  } catch (err) {
    if (isStillReferenced(err)) {
      return {
        error:
          "Το μέλος έχει κρατήσεις, μαθήματα, WOD ή ιστορικό συνδρομών και δεν μπορεί να διαγραφεί.",
      };
    }
    throw err;
  }

  revalidatePath("/members");
  redirect("/members");
}
