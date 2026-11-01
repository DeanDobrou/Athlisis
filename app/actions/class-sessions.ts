"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { cancelSession } from "@/lib/bookings";
import * as classes from "@/lib/class-sessions";
import { withTransaction } from "@/lib/db";
import { redirectSaved } from "@/lib/flash";
import { requireAdmin } from "@/lib/session";
import {
  type ActionResult,
  type FormError,
  formFields,
  parseId,
} from "@/lib/utils";

export type SessionFormState = FormError | undefined;

export async function createSession(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireAdmin();

  const result = await classes.createSession(
    formFields(formData),
    formData.getAll("class_type_ids"),
  );
  if ("error" in result) return result;

  revalidatePath("/schedule");
  await redirectSaved(`/schedule?week=${result.day}`);
}

export async function updateSession(
  _prev: SessionFormState,
  formData: FormData,
): Promise<SessionFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const result = await classes.updateSession(
    id,
    formFields(formData),
    formData.getAll("class_type_ids"),
  );
  if ("error" in result) return result;

  revalidatePath("/schedule");
  await redirectSaved(`/schedule?week=${result.day}`);
}

/** Cancels a class through cancelSession in lib/bookings.ts and says what went with it. */
export async function cancelSessionAction(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction((client) => cancelSession(client, id));
  if (!result.ok) return { error: result.error };

  // Bookings, visits and unpaid memberships all moved, so every screen that
  // shows one changes.
  revalidatePath("/schedule");
  revalidatePath("/bookings");
  revalidatePath("/memberships");
  revalidatePath("/dashboard");
  return { notice: result.notice };
}

export async function restoreSessionAction(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const failed = await classes.restoreSession(id);
  if (failed) return failed;

  revalidatePath("/schedule");
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  return undefined;
}

export async function copySession(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const result = await classes.copySession(id);
  if (!result) revalidatePath("/schedule");
  return result;
}

export async function copyLastWeek(
  week: string,
): Promise<ActionResult> {
  await requireAdmin();

  const result = await classes.copyLastWeek(week);
  if (!(result && "error" in result)) revalidatePath("/schedule");
  return result;
}

export async function deleteSession(
  rawId: string,
  week: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο μάθημα." };

  const failed = await classes.deleteSession(id);
  if (failed) return failed;

  revalidatePath("/schedule");
  redirect(week ? `/schedule?week=${week}` : "/schedule");
}
