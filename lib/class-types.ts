import "server-only";

import { db } from "@/lib/db";

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

export function parseClassTypeId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getClassType(rawId: string): Promise<ClassType | null> {
  const id = parseClassTypeId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<ClassType>(
    `SELECT ${COLUMNS} FROM class_types WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
