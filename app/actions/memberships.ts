"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  TRAINED_ON_UNPAID_MEMBERSHIP,
  voidUnpaidMembership,
} from "@/lib/bookings";
import { hasPgCode, withTransaction } from "@/lib/db";
import { isMembershipStatus, isPaymentMethod } from "@/lib/enums";
import { redirectSaved } from "@/lib/flash";
import { isRealDate } from "@/lib/gym-time";
import {
  describeOverlap,
  findOverlap,
  periodEndsOn,
  type Overlap,
} from "@/lib/memberships";
import { parsePriceToCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type MembershipFormState =
  | { error: string; field?: string }
  | undefined;

type ParsedMembership = {
  userId: number;
  planId: number;
  status: string;
  startsOn: string;
  amountCents: number;
  method: string;
  paidOn: string | null;
};

function parseFields(
  formData: FormData,
): ParsedMembership | { error: string; field: string } {
  const get = (key: string) => String(formData.get(key) ?? "").trim();

  const userId = parseId(get("user_id"));
  if (userId === null) return { field: "user_id", error: "Διάλεξε μέλος." };

  const planId = parseId(get("plan_id"));
  if (planId === null) return { field: "plan_id", error: "Διάλεξε πακέτο." };

  const status = get("status");
  if (!isMembershipStatus(status)) {
    return { field: "status", error: "Διάλεξε κατάσταση." };
  }

  const startsOn = get("starts_on");
  if (!isRealDate(startsOn)) {
    return { field: "starts_on", error: "Δώσε υπαρκτή ημερομηνία έναρξης." };
  }

  // The money is part of the membership now: a row is a period that was paid
  // for, so there is no way to record one without saying what was taken.
  // Zero is allowed and means granted rather than sold.
  const amountCents = parsePriceToCents(get("amount"));
  if (amountCents === null) {
    return { field: "amount", error: "Δώσε ποσό όπως 60 ή 60,50." };
  }

  const method = get("method");
  if (!isPaymentMethod(method)) {
    return { field: "method", error: "Διάλεξε τρόπο πληρωμής." };
  }

  // Blank is the money not being collected yet, which reads as Unpaid. It is
  // how the mobile app writes a membership when a member out of visits books
  // on a promise to pay, and staff can write the same thing by hand.
  const paidOn = get("paid_on");
  if (paidOn && !isRealDate(paidOn)) {
    return { field: "paid_on", error: "Δώσε υπαρκτή ημερομηνία πληρωμής ή καθάρισέ τη αν είναι ανεξόφλητη." };
  }

  if (amountCents === 0 && !paidOn) {
    return { field: "paid_on", error: "Μια δωρεάν περίοδος δεν έχει τίποτα να εισπραχθεί. Όρισε ημερομηνία πληρωμής." };
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

function overlapRefusal(clash: Overlap) {
  return {
    field: "starts_on",
    error: `Επικαλύπτεται με τη συνδρομή ${describeOverlap(clash)}. Άλλαξε την έναρξη ή κάνε εκείνη ανενεργή.`,
  };
}

const UNKNOWN_MEMBER = { field: "user_id", error: "Άγνωστο μέλος." };

export async function createMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  const refused = await withTransaction(async (client) => {
    const { rowCount: found } = await client.query(
      "SELECT 1 FROM users WHERE id = $1 FOR UPDATE",
      [f.userId],
    );
    if (!found) return UNKNOWN_MEMBER;

    if (f.status === "active") {
      const clash = await findOverlap(client, f.userId, f.planId, f.startsOn);
      if (clash) return overlapRefusal(clash);
    }

    const { rowCount } = await client.query(
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
    return rowCount === 0
      ? { field: "plan_id", error: "Άγνωστο πακέτο." }
      : undefined;
  });
  if (refused) return refused;

  revalidatePath("/memberships");
  revalidatePath(`/members/${f.userId}`);
  await redirectSaved("/memberships");
}

export async function updateMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  const admin = await requireAdmin();

  const id = parseId(String(formData.get("id") ?? ""));
  if (id === null) return { error: "Άγνωστη συνδρομή." };

  const f = parseFields(formData);
  if ("error" in f) return f;

  const rawVisits = String(formData.get("visits_remaining") ?? "").trim();
  let visitsRemaining: number | null = null;
  if (rawVisits) {
    const n = Number(rawVisits);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { field: "visits_remaining", error: "Οι υπόλοιπες επισκέψεις πρέπει να είναι μηδέν ή ακέραιος αριθμός." };
    }
    visitsRemaining = n;
  }

  let outcome: { error: string; field?: string } | { previousUserId: string };
  try {
    outcome = await withTransaction(async (client) => {
      const { rowCount: found } = await client.query(
        "SELECT 1 FROM users WHERE id = $1 FOR UPDATE",
        [f.userId],
      );
      if (!found) return UNKNOWN_MEMBER;

      const { rows: before } = await client.query<{
        user_id: string;
        plan_id: string;
        status: string;
        starts_on: string;
      }>(
        `SELECT user_id, plan_id, status,
                to_char(starts_on, 'YYYY-MM-DD') AS starts_on
         FROM memberships WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (before.length === 0) return { error: "Άγνωστη συνδρομή." };
      const was = before[0];

      const periodChanged =
        was.user_id !== String(f.userId) ||
        was.plan_id !== String(f.planId) ||
        was.starts_on !== f.startsOn ||
        was.status !== f.status;
      if (f.status === "active" && periodChanged) {
        const clash = await findOverlap(
          client,
          f.userId,
          f.planId,
          f.startsOn,
          id,
        );
        if (clash) return overlapRefusal(clash);
      }

      const { rowCount } = await client.query(
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
      if (rowCount === 0) return { error: "Άγνωστη συνδρομή." };
      return { previousUserId: was.user_id };
    });
  } catch (err) {
    if (
      hasPgCode(err, "23503") &&
      (err as { constraint?: string }).constraint ===
        "bookings_membership_belongs_to_member"
    ) {
      return {
        field: "user_id",
        error: "Η συνδρομή έχει ήδη κρατήσεις, οπότε δεν μπορεί να περάσει σε άλλο μέλος. Φτιάξε νέα συνδρομή για το σωστό μέλος.",
      };
    }
    throw err;
  }
  if ("error" in outcome) return outcome;

  revalidatePath("/memberships");
  revalidatePath(`/members/${f.userId}`);
  if (outcome.previousUserId !== String(f.userId)) {
    revalidatePath(`/members/${outcome.previousUserId}`);
  }
  await redirectSaved("/memberships");
}

export async function deleteMembership(
  rawId: string,
): Promise<{ error: string } | undefined> {
  await requireAdmin();

  const id = parseId(rawId);
  if (id === null) return { error: "Άγνωστη συνδρομή." };

  const result = await withTransaction((client) =>
    voidUnpaidMembership(client, id),
  ).catch((err: unknown) => {
    if (hasPgCode(err, "23503")) {
      return { ok: false as const, error: TRAINED_ON_UNPAID_MEMBERSHIP };
    }
    throw err;
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/members/${result.userId}`);
  revalidatePath("/memberships");
  redirect("/memberships");
}
