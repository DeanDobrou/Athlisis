import "server-only";

import { db, hasPgCode } from "@/lib/db";
import { isBillingInterval, type BillingInterval } from "@/lib/enums";
import { parsePriceToCents } from "@/lib/money";
import { type Fields, type FormError, parseId } from "@/lib/utils";

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

type ParsedPlan = {
  name: string;
  priceCents: number;
  billingInterval: string;
  visits: number | null;
};

function parseFields(get: Fields): ParsedPlan | Required<FormError> {
  const value = (key: string) => get(key).trim();

  const name = value("name").slice(0, 100);
  if (!name) {
    return { field: "name", error: "Το όνομα του πακέτου είναι υποχρεωτικό." };
  }

  const priceCents = parsePriceToCents(value("price"));
  if (priceCents === null) {
    return { field: "price", error: "Δώσε τιμή όπως 45 ή 45,50." };
  }

  const billingInterval = value("billing_interval");
  if (!isBillingInterval(billingInterval)) {
    return { field: "billing_interval", error: "Διάλεξε συχνότητα χρέωσης." };
  }

  // Blank means unlimited, which the column stores as NULL.
  const rawVisits = value("visits");
  let visits: number | null = null;
  if (rawVisits) {
    const n = Number(rawVisits);
    if (!Number.isSafeInteger(n) || n < 1) {
      return {
        field: "visits",
        error:
          "Οι επισκέψεις πρέπει να είναι ακέραιος μεγαλύτερος του μηδενός ή κενό για απεριόριστες.",
      };
    }
    visits = n;
  }

  return { name, priceCents, billingInterval, visits };
}

/** Adds a plan, or says why not. */
export async function createPlan(get: Fields): Promise<FormError | undefined> {
  const f = parseFields(get);
  if ("error" in f) return f;

  await db().query(
    `INSERT INTO plans
       (name, price_cents, billing_interval, visits)
     VALUES ($1, $2, $3, $4)`,
    [f.name, f.priceCents, f.billingInterval, f.visits],
  );
  return undefined;
}

/** Saves a plan, or says why not. */
export async function updatePlan(
  id: number,
  get: Fields,
): Promise<FormError | undefined> {
  const f = parseFields(get);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    `UPDATE plans SET
       name = $1, price_cents = $2, billing_interval = $3, visits = $4
     WHERE id = $5`,
    [f.name, f.priceCents, f.billingInterval, f.visits, id],
  );
  return rowCount === 0 ? { error: "Άγνωστο πακέτο." } : undefined;
}

/** Deletes a plan no member was ever sold, or says why not. */
export async function deletePlan(id: number): Promise<FormError | undefined> {
  try {
    const { rowCount } = await db().query("DELETE FROM plans WHERE id = $1", [
      id,
    ]);
    if (rowCount === 0) return { error: "Άγνωστο πακέτο." };
  } catch (err) {
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "Το πακέτο έχει πουληθεί σε μέλη και δεν μπορεί να διαγραφεί.",
      };
    }
    throw err;
  }
  return undefined;
}
