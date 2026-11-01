"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { redirectSaved } from "@/lib/flash";
import * as plans from "@/lib/plans";
import { requireAdmin } from "@/lib/session";
import {
  type ActionResult,
  type FormError,
  formFields,
  parseId,
} from "@/lib/utils";

export type PlanFormState = FormError | undefined;

export async function createPlan(
  _prev: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  await requireAdmin();

  const failed = await plans.createPlan(formFields(formData));
  if (failed) return failed;

  revalidatePath("/plans");
  await redirectSaved("/plans");
}

export async function updatePlan(
  _prev: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστο πακέτο." };

  const failed = await plans.updatePlan(id, formFields(formData));
  if (failed) return failed;

  revalidatePath("/plans");
  revalidatePath(`/plans/${id}/update`);
  await redirectSaved("/plans");
}

export async function deletePlan(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο πακέτο." };

  const failed = await plans.deletePlan(id);
  if (failed) return failed;

  revalidatePath("/plans");
  redirect("/plans");
}
