"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { isMembershipStatus, isPaymentMethod } from "@/lib/enums";
import { isRealDate } from "@/lib/gym-time";
import { parseMemberId } from "@/lib/members";
import { parseMembershipId, periodEndsOn } from "@/lib/memberships";
import { parsePriceToCents } from "@/lib/money";
import { parsePlanId } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export type MembershipFormState = { error: string } | undefined;

type ParsedMembership = {
  userId: number;
  planId: number;
  status: string;
  startsOn: string;
  amountCents: number;
  method: string;
  paidOn: string | null;
};

function parseFields(formData: FormData): ParsedMembership | { error: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const userId = parseMemberId(get("user_id"));
  if (userId === null) return { error: "Choose a member." };

  const planId = parsePlanId(get("plan_id"));
  if (planId === null) return { error: "Choose a plan." };

  const status = get("status");
  if (!isMembershipStatus(status)) return { error: "Choose a status." };

  const startsOn = get("starts_on");
  if (!isRealDate(startsOn)) {
    return { error: "Enter a real start date." };
  }

  // The money is part of the membership now: a row is a period that was paid
  // for, so there is no way to record one without saying what was taken.
  // Zero is allowed and means granted rather than sold.
  const amountCents = parsePriceToCents(get("amount"));
  if (amountCents === null) {
    return { error: "Enter an amount like 60 or 60.50." };
  }

  const method = get("method");
  if (!isPaymentMethod(method)) return { error: "Choose a payment method." };

  // Blank is the money not being collected yet, which reads as Unpaid. It is
  // how the mobile app writes a membership when a member out of visits books
  // on a promise to pay, and staff can write the same thing by hand.
  const paidOn = get("paid_on");
  if (paidOn && !isRealDate(paidOn)) {
    return { error: "Enter a real payment date, or clear it if unpaid." };
  }

  if (amountCents === 0 && !paidOn) {
    return { error: "A free period has nothing to collect. Set the paid date." };
  }

  return {
    userId,
    planId,
    status,
    startsOn,
    amountCents,
    method,
    paidOn: paidOn || null,
  };
}

export async function createMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  // ends_on and visits_remaining both come from the plan, so a membership can
  // never disagree with what was sold. recorded_by is whoever took the money,
  // so it is set only when there is money: an unpaid row has no recorder yet,
  // and stamping the admin who typed it in would make the column a lie the
  // update below could never correct.
  const { rowCount } = await db().query(
    `INSERT INTO memberships
       (user_id, plan_id, status, starts_on, ends_on, visits_remaining,
        amount_cents, method, paid_on, recorded_by)
     SELECT $2, p.id, $3, $1::date, ${periodEndsOn("$1")}, p.visits,
            $5, $6, $7::date,
            CASE WHEN $7::date IS NULL THEN NULL ELSE $8::bigint END
     FROM plans p WHERE p.id = $4`,
    [
      f.startsOn,
      f.userId,
      f.status,
      f.planId,
      f.amountCents,
      f.method,
      f.paidOn,
      admin.userId,
    ],
  );
  if (rowCount === 0) return { error: "Unknown plan." };

  revalidatePath("/memberships");
  revalidatePath(`/members/${f.userId}`);
  redirect("/memberships");
}

export async function updateMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const id = parseMembershipId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown membership." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const rawVisits = String(formData.get("visits_remaining") ?? "").trim();
  let visitsRemaining: number | null = null;
  if (rawVisits) {
    const n = Number(rawVisits);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { error: "Visits remaining must be zero or a whole number." };
    }
    visitsRemaining = n;
  }

  const { rows: before } = await db().query<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE id = $1",
    [id],
  );
  const previousUserId = before[0]?.user_id;

  // recorded_by keeps whoever took the money first, so editing a row does not
  // rewrite history, but a row that had none gets whoever is settling it now.
  // Clearing the date unpays the row, so the recorder goes with it - the same
  // rule as the insert above, written the same way.
  const { rowCount } = await db().query(
    `UPDATE memberships m SET
       user_id = $2, plan_id = $4, status = $3, starts_on = $1::date,
       ends_on = ${periodEndsOn("$1")},
       visits_remaining = COALESCE($5, p.visits),
       amount_cents = $7, method = $8, paid_on = $9::date,
       recorded_by = CASE WHEN $9::date IS NULL THEN NULL
                          ELSE COALESCE(m.recorded_by, $10::bigint) END
     FROM plans p
     WHERE p.id = $4 AND m.id = $6`,
    [
      f.startsOn,
      f.userId,
      f.status,
      f.planId,
      visitsRemaining,
      id,
      f.amountCents,
      f.method,
      f.paidOn,
      admin.userId,
    ],
  );
  if (rowCount === 0) return { error: "Unknown membership." };

  revalidatePath("/memberships");
  revalidatePath(`/members/${f.userId}`);
  if (previousUserId && previousUserId !== String(f.userId)) {
    revalidatePath(`/members/${previousUserId}`);
  }
  redirect("/memberships");
}

export type DeleteMembershipState = { error: string } | undefined;

export async function deleteMembership(
  _prev: DeleteMembershipState,
  formData: FormData,
): Promise<DeleteMembershipState> {
  await requireAdmin();

  const id = parseMembershipId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Unknown membership." };

  // A row with paid_on set is the only record that cash was taken, so
  // deleting it destroys the record. That, and nothing about the dates, is
  // what refuses: a prepaid month starting next week is as much a cash record
  // as one that started today. An unpaid row records money that never
  // arrived, so there is nothing to lose - a member who booked on a promise,
  // never came and never paid leaves one, and staff need to void it. A paid
  // row entered by mistake gets edited, or has its date cleared first, which
  // is the right amount of friction for destroying a receipt.
  //
  // The guard is the DELETE's own WHERE, so nothing can change underneath it
  // between deciding and deleting. Zero rows means unknown or refused, and
  // only that path pays for a second query to say which.
  const { rows } = await db().query<{ user_id: string }>(
    "DELETE FROM memberships WHERE id = $1 AND paid_on IS NULL RETURNING user_id",
    [id],
  );
  if (rows.length === 0) {
    const { rowCount } = await db().query(
      "SELECT 1 FROM memberships WHERE id = $1",
      [id],
    );
    return {
      error: rowCount
        ? "This membership records money taken. Set it to inactive instead."
        : "Unknown membership.",
    };
  }

  revalidatePath(`/members/${rows[0].user_id}`);
  revalidatePath("/memberships");
  redirect("/memberships");
}
