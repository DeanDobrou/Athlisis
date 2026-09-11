"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, hasPgCode } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type ClassTypeFormState =
  | { error: string; field?: string }
  | undefined;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type ParsedClassType = {
  name: string;
  colorHex: string | null;
};

function parseFields(
  formData: FormData,
): ParsedClassType | { error: string; field: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const name = get("name").slice(0, 100);
  if (!name) return { field: "name", error: "Το όνομα είναι υποχρεωτικό." };

  const colorHex = get("color_hex");
  if (colorHex && !HEX_COLOR.test(colorHex)) {
    return { field: "color_hex", error: "Διάλεξε χρώμα." };
  }

  return { name, colorHex: colorHex ? colorHex.toUpperCase() : null };
}

export async function createClassType(
  _prev: ClassTypeFormState,
  formData: FormData,
): Promise<ClassTypeFormState> {
  await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  await db().query(
    "INSERT INTO class_types (name, color_hex) VALUES ($1, $2)",
    [f.name, f.colorHex],
  );

  revalidatePath("/class-types");
  redirect("/class-types");
}

export async function updateClassType(
  _prev: ClassTypeFormState,
  formData: FormData,
): Promise<ClassTypeFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστος τύπος μαθήματος." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    "UPDATE class_types SET name = $1, color_hex = $2 WHERE id = $3",
    [f.name, f.colorHex, id],
  );
  if (rowCount === 0) return { error: "Άγνωστος τύπος μαθήματος." };

  revalidatePath("/class-types");
  redirect("/class-types");
}

export async function deleteClassType(
  rawId: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστος τύπος μαθήματος." };

  try {
    const { rowCount } = await db().query(
      "DELETE FROM class_types WHERE id = $1",
      [id],
    );
    if (rowCount === 0) return { error: "Άγνωστος τύπος μαθήματος." };
  } catch (err) {
    // class_sessions and wods both point here. Deleting through them would
    // erase what a class on the schedule actually was.
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "Ο τύπος μαθήματος χρησιμοποιείται σε μαθήματα ή WOD και δεν μπορεί να διαγραφεί.",
      };
    }
    throw err;
  }

  revalidatePath("/class-types");
  redirect("/class-types");
}
