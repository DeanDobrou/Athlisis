"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, hasPgCode } from "@/lib/db";
import { isBillingInterval } from "@/lib/enums";
import { parsePriceToCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type PlanFormState = { error: string; field?: string } | undefined;

type ParsedPlan = {
  name: string;
  priceCents: number;
  billingInterval: string;
  visits: number | null;
};

function parseFields(
  formData: FormData,
): ParsedPlan | { error: string; field: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const name = get("name").slice(0, 100);
  if (!name) {
    return { field: "name", error: "Το όνομα του πακέτου είναι υποχρεωτικό." };
  }

  const priceCents = parsePriceToCents(get("price"));
  if (priceCents === null) {
    return { field: "price", error: "Δώσε τιμή όπως 45 ή 45,50." };
  }

  const billingInterval = get("billing_interval");
  if (!isBillingInterval(billingInterval)) {
    return { field: "billing_interval", error: "Διάλεξε συχνότητα χρέωσης." };
  }

  // Blank means unlimited, which the column stores as NULL.
  const rawVisits = get("visits");
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

  return {
    name,
    priceCents,
    billingInterval,
    visits,
  };
}

export async function createPlan(
  _prev: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  await db().query(
    `INSERT INTO plans
       (name, price_cents, billing_interval, visits)
     VALUES ($1, $2, $3, $4)`,
    [f.name, f.priceCents, f.billingInterval, f.visits],
  );

  revalidatePath("/plans");
  redirect("/plans");
}

export async function updatePlan(
  _prev: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστο πακέτο." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    `UPDATE plans SET
       name = $1, price_cents = $2, billing_interval = $3, visits = $4
     WHERE id = $5`,
    [f.name, f.priceCents, f.billingInterval, f.visits, id],
  );
  if (rowCount === 0) return { error: "Άγνωστο πακέτο." };

  revalidatePath("/plans");
  revalidatePath(`/plans/${id}/update`);
  redirect("/plans");
}

export async function deletePlan(
  rawId: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστο πακέτο." };

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

  revalidatePath("/plans");
  redirect("/plans");
}
