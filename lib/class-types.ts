import "server-only";

import { db, hasPgCode } from "@/lib/db";
import { type Fields, type FormError, parseId } from "@/lib/utils";

/** A training modality, not a kind of class. A session can carry several. */
export type ClassType = {
  id: string;
  name: string;
  color_hex: string | null;
};

const COLUMNS = `id, name, color_hex`;

// ponytail: no pagination. A gym runs a handful of class types.
export async function listClassTypes(): Promise<ClassType[]> {
  const { rows } = await db().query<ClassType>(
    `SELECT ${COLUMNS} FROM class_types ORDER BY name`,
  );
  return rows;
}

export async function getClassType(rawId: string): Promise<ClassType | null> {
  const id = parseId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<ClassType>(
    `SELECT ${COLUMNS} FROM class_types WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function parseFields(
  get: Fields,
): { name: string; colorHex: string | null } | Required<FormError> {
  const name = get("name").trim().slice(0, 100);
  if (!name) return { field: "name", error: "Το όνομα είναι υποχρεωτικό." };

  const colorHex = get("color_hex").trim();
  if (colorHex && !HEX_COLOR.test(colorHex)) {
    return { field: "color_hex", error: "Διάλεξε χρώμα." };
  }

  return { name, colorHex: colorHex ? colorHex.toUpperCase() : null };
}

/** Adds a class type, or says why not. */
export async function createClassType(
  get: Fields,
): Promise<FormError | undefined> {
  const f = parseFields(get);
  if ("error" in f) return f;

  await db().query(
    "INSERT INTO class_types (name, color_hex) VALUES ($1, $2)",
    [f.name, f.colorHex],
  );
  return undefined;
}

/** Saves a class type, or says why not. */
export async function updateClassType(
  id: number,
  get: Fields,
): Promise<FormError | undefined> {
  const f = parseFields(get);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    "UPDATE class_types SET name = $1, color_hex = $2 WHERE id = $3",
    [f.name, f.colorHex, id],
  );
  return rowCount === 0 ? { error: "Άγνωστος τύπος μαθήματος." } : undefined;
}

/** Deletes a class type no class or WOD uses, or says why not. */
export async function deleteClassType(
  id: number,
): Promise<FormError | undefined> {
  try {
    const { rowCount } = await db().query(
      "DELETE FROM class_types WHERE id = $1",
      [id],
    );
    if (rowCount === 0) return { error: "Άγνωστος τύπος μαθήματος." };
  } catch (err) {
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "Ο τύπος μαθήματος χρησιμοποιείται σε μαθήματα ή WOD και δεν μπορεί να διαγραφεί.",
      };
    }
    throw err;
  }
  return undefined;
}
