import "server-only";

import { db } from "@/lib/db";
import { parseId } from "@/lib/utils";

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
