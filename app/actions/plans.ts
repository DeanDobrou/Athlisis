"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, hasPgCode } from "@/lib/db";
import { isBillingInterval } from "@/lib/enums";
import { parsePriceToCents } from "@/lib/money";
import { parsePlanId } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export type PlanFormState = { error: string } | undefined;

type ParsedPlan = {
  name: string;
  priceCents: number;
  billingInterval: string;
  visits: number | null;
};

function parseFields(formData: FormData): ParsedPlan | { error: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const name = get("name").slice(0, 100);
  if (!name) return { error: "A plan name is required." };

  const priceCents = parsePriceToCents(get("price"));
  if (priceCents === null) {
    return { error: "Enter a price like 45 or 45.50." };
  }

  const billingInterval = get("billing_interval");
  if (!isBillingInterval(billingInterval)) {
    return { error: "Choose a billing interval." };
  }

  // Blank means unlimited, which the column stores as NULL.
  const rawVisits = get("visits");
  let visits: number | null = null;
  if (rawVisits) {
    const n = Number(rawVisits);
    if (!Number.isSafeInteger(n) || n < 1) {
      return {
        error:
          "Visits must be a whole number above zero, or blank for unlimited.",
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

  const id = parsePlanId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown plan." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const { rowCount } = await db().query(
    `UPDATE plans SET
       name = $1, price_cents = $2, billing_interval = $3, visits = $4
     WHERE id = $5`,
    [f.name, f.priceCents, f.billingInterval, f.visits, id],
  );
  if (rowCount === 0) return { error: "Unknown plan." };

  revalidatePath("/plans");
  revalidatePath(`/plans/${id}/update`);
  redirect("/plans");
}

export type DeletePlanState = { error: string } | undefined;

export async function deletePlan(
  _prev: DeletePlanState,
  formData: FormData,
): Promise<DeletePlanState> {
  await requireAdmin();

  const id = parsePlanId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown plan." };

  try {
    const { rowCount } = await db().query("DELETE FROM plans WHERE id = $1", [
      id,
    ]);
    if (rowCount === 0) return { error: "Unknown plan." };
  } catch (err) {
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "This plan has been sold to members and cannot be deleted.",
      };
    }
    throw err;
  }

  revalidatePath("/plans");
  redirect("/plans");
}
