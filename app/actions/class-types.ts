"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as classTypes from "@/lib/class-types";
import { redirectSaved } from "@/lib/flash";
import { requireAdmin } from "@/lib/session";
import {
  type ActionResult,
  type FormError,
  formFields,
  parseId,
} from "@/lib/utils";

export type ClassTypeFormState = FormError | undefined;

export async function createClassType(
  _prev: ClassTypeFormState,
  formData: FormData,
): Promise<ClassTypeFormState> {
  await requireAdmin();

  const failed = await classTypes.createClassType(formFields(formData));
  if (failed) return failed;

  revalidatePath("/class-types");
  await redirectSaved("/class-types");
}

export async function updateClassType(
  _prev: ClassTypeFormState,
  formData: FormData,
): Promise<ClassTypeFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστος τύπος μαθήματος." };

  const failed = await classTypes.updateClassType(id, formFields(formData));
  if (failed) return failed;

  revalidatePath("/class-types");
  await redirectSaved("/class-types");
}

export async function deleteClassType(
  rawId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστος τύπος μαθήματος." };

  const failed = await classTypes.deleteClassType(id);
  if (failed) return failed;

  revalidatePath("/class-types");
  redirect("/class-types");
}
