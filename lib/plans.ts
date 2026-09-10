import "server-only";

import { db } from "@/lib/db";
import type { BillingInterval } from "@/lib/enums";
import { parseId } from "@/lib/utils";

export type Plan = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: BillingInterval;
  visits: number | null;
};

const COLUMNS = `p.id, p.name, p.price_cents, p.currency,
  p.billing_interval, p.visits`;

export async function listPlans(): Promise<Plan[]> {
  const { rows } = await db().query<Plan>(
    `SELECT ${COLUMNS} FROM plans p ORDER BY p.name`,
  );
  return rows;
}

export async function getPlan(rawId: string): Promise<Plan | null> {
  const id = parseId(rawId);
  if (id === null) return null;

  const { rows } = await db().query<Plan>(
    `SELECT ${COLUMNS} FROM plans p WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
