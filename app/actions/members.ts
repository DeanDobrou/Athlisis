"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { parseMemberId } from "@/lib/members";
import { generatePassword, hashPassword } from "@/lib/password";
import { requireAdmin } from "@/lib/session";

export type MemberFormState = { error: string } | undefined;

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

function validate(f: Fields): string | null {
  if (!f.firstName || !f.lastName) return "First and last name are required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
    return "Enter a valid email address.";
  }
  return null;
}

function hasPgCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === code
  );
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
  if (invalid) return { error: invalid };

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
      return { error: "That email address is already registered." };
    }
    throw err;
  }

  if (sendWelcomeEmail) {
    // TODO: send `password` to f.email once a transport is chosen (spec §10).
    // It has to happen here: the plaintext exists only inside this function.
  }

  revalidatePath("/members");
  redirect(`/members/${memberId}`);
}

export async function updateMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();

  const id = parseMemberId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown member." };

  const f = parseFields(formData);
  const invalid = validate(f);
  if (invalid) return { error: invalid };

  const status =
    String(formData.get("status") ?? "") === "inactive" ? "inactive" : "active";

  if (id === admin.userId && (status === "inactive" || f.role !== "admin")) {
    return { error: "You cannot remove your own admin access." };
  }

  // Blank means "leave the current password alone".
  const password = String(formData.get("password") ?? "");
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `A new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const { rowCount } = await db().query(
      `UPDATE users SET
         email = $1, first_name = $2, last_name = $3, phone = $4, role = $5,
         date_of_birth = $6, status = $7,
         password_hash = COALESCE($8, password_hash)
       WHERE id = $9`,
      [
        f.email,
        f.firstName,
        f.lastName,
        f.phone,
        f.role,
        f.dateOfBirth,
        status,
        passwordHash,
        id,
      ],
    );
    if (rowCount === 0) return { error: "Unknown member." };
  } catch (err) {
    if (isDuplicateEmail(err)) {
      return { error: "That email address is already registered." };
    }
    throw err;
  }

  revalidatePath("/members");
  revalidatePath(`/members/${id}`);
  redirect(`/members/${id}`);
}

export type DeleteMemberState = { error: string } | undefined;

export async function deleteMember(
  _prev: DeleteMemberState,
  formData: FormData,
): Promise<DeleteMemberState> {
  const admin = await requireAdmin();

  const id = parseMemberId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown member." };
  if (id === admin.userId) {
    return { error: "You cannot delete your own account." };
  }

  const { rows } = await db().query<{ count: string }>(
    "SELECT count(*) AS count FROM memberships WHERE user_id = $1 AND status = 'active'",
    [id],
  );
  if (Number(rows[0].count) > 0) {
    return {
      error:
        "This member has an active membership and cannot be deleted. End the membership first.",
    };
  }

  try {
    const { rowCount } = await db().query("DELETE FROM users WHERE id = $1", [
      id,
    ]);
    if (rowCount === 0) return { error: "Unknown member." };
  } catch (err) {
    // Other tables reference users. Deleting through them would destroy
    // attendance and payment history, so the delete is refused instead.
    if (isStillReferenced(err)) {
      return {
        error:
          "This member has bookings, payments or membership history on record and cannot be deleted.",
      };
    }
    throw err;
  }

  revalidatePath("/members");
  redirect("/members");
}
