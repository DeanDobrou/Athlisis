"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { voidUnpaidMembership } from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { redirectSaved } from "@/lib/flash";
import * as memberships from "@/lib/memberships";
import { requireAdmin } from "@/lib/session";
import {
  type ActionResult,
  type FormError,
  formFields,
  parseId,
} from "@/lib/utils";

export type MembershipFormState = FormError | undefined;

export async function createMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const result = await withTransaction((client) =>
    memberships.createMembership(client, formFields(formData), admin.userId),
  );
  if ("error" in result) return result;

  revalidatePath("/memberships");
  revalidatePath(`/members/${result.userId}`);
  await redirectSaved("/memberships");
}

export async function updateMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστη συνδρομή." };

  const result = await withTransaction((client) =>
    memberships.updateMembership(client, id, formFields(formData), admin.userId),
  );
  if ("error" in result) return result;

  revalidatePath("/memberships");
  revalidatePath(`/members/${result.userId}`);
  if (result.previousUserId !== String(result.userId)) {
    revalidatePath(`/members/${result.previousUserId}`);
  }
  await redirectSaved("/memberships");
}

export async function deleteMembership(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστη συνδρομή." };

  const result = await withTransaction((client) =>
    voidUnpaidMembership(client, id),
  );
  if (!result.ok) return { error: result.error };

  revalidatePath(`/members/${result.userId}`);
  revalidatePath("/memberships");
  redirect("/memberships");
}
