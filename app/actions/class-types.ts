"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseClassTypeId } from "@/lib/class-types";
import { db, hasPgCode } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export type ClassTypeFormState = { error: string } | undefined;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type ParsedClassType = {
  name: string;
  colorHex: string | null;
};

function parseFields(
  formData: FormData,
): ParsedClassType | { error: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const name = get("name").slice(0, 100);
  if (!name) return { error: "A name is required." };

  const colorHex = get("color_hex");
  if (colorHex && !HEX_COLOR.test(colorHex)) {
    return { error: "Pick a colour." };
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

  const id = parseClassTypeId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown class type." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    "UPDATE class_types SET name = $1, color_hex = $2 WHERE id = $3",
    [f.name, f.colorHex, id],
  );
  if (rowCount === 0) return { error: "Unknown class type." };

  revalidatePath("/class-types");
  redirect("/class-types");
}

export type DeleteClassTypeState = { error: string } | undefined;

export async function deleteClassType(
  _prev: DeleteClassTypeState,
  formData: FormData,
): Promise<DeleteClassTypeState> {
  await requireAdmin();

  const id = parseClassTypeId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown class type." };

  try {
    const { rowCount } = await db().query(
      "DELETE FROM class_types WHERE id = $1",
      [id],
    );
    if (rowCount === 0) return { error: "Unknown class type." };
  } catch (err) {
    // class_sessions and wods both point here. Deleting through them would
    // erase what a class on the schedule actually was.
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "This class type is used by sessions or WODs and cannot be deleted.",
      };
    }
    throw err;
  }

  revalidatePath("/class-types");
  redirect("/class-types");
}
