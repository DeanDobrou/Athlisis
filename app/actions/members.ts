"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirectSaved } from "@/lib/flash";
import * as members from "@/lib/members";
import { createSession, requireAdmin } from "@/lib/session";
import {
  type ActionResult,
  type FormError,
  formFields,
  parseId,
} from "@/lib/utils";

export type MemberFormState = FormError | undefined;

const FLASH = {
  sent: "welcome-sent",
  failed: "welcome-failed",
} as const;

export async function createMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  await requireAdmin();

  const result = await members.createMember(
    formFields(formData),
    formData.get("send_welcome_email") !== null,
  );
  if ("error" in result) return result;

  revalidatePath("/members");
  await redirectSaved(
    `/members/${result.id}`,
    result.welcome ? FLASH[result.welcome] : "saved",
  );
}

export async function resendWelcomeEmail(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μέλος." };

  return members.resendWelcomeEmail(id);
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

  const failed = await members.updateMember(id, formFields(formData), admin.userId);
  if (failed) return failed;
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

  const failed = await members.updateProfile(admin.userId, formFields(formData));
  if (failed) return failed;
  await keepOwnSessionAlive(admin, admin.userId);

  revalidatePath("/members");
  revalidatePath(`/members/${admin.userId}`);
  await redirectSaved("/dashboard");
}

export async function deleteMember(
  rawId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μέλος." };

  const failed = await members.deleteMember(id, admin.userId);
  if (failed) return failed;

  revalidatePath("/members");
  redirect("/members");
}
