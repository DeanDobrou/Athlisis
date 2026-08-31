"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db, hasPgCode } from "@/lib/db";
import { isMembershipStatus } from "@/lib/enums";
import { parseMemberId } from "@/lib/members";
import { parseMembershipId, periodEndsOn } from "@/lib/memberships";
import { parsePlanId } from "@/lib/plans";
import { requireAdmin } from "@/lib/session";

export type MembershipFormState = { error: string } | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The shape check alone would pass 2026-02-31, which Postgres then rejects
 * mid-statement as an unhandled 500. Round-tripping through Date catches a day
 * that does not exist, because JS rolls it over to 3 March and the string no
 * longer matches.
 */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

type ParsedMembership = {
  userId: number;
  planId: number;
  status: string;
  startsOn: string;
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

  return { userId, planId, status, startsOn };
}

export async function createMembership(
  _prev: MembershipFormState,
  formData: FormData,
): Promise<MembershipFormState> {
  await requireAdmin();

  const f = parseFields(formData);
  if ("error" in f) return f;

  // ends_on and visits_remaining both come from the plan, so a membership can
  // never disagree with what was sold.
  const { rowCount } = await db().query(
    `INSERT INTO memberships
       (user_id, plan_id, status, starts_on, ends_on, visits_remaining)
     SELECT $2, p.id, $3, $1::date, ${periodEndsOn("$1")}, p.visits
     FROM plans p WHERE p.id = $4`,
    [f.startsOn, f.userId, f.status, f.planId],
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
  await requireAdmin();

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

  const { rowCount } = await db().query(
    `UPDATE memberships m SET
       user_id = $2, plan_id = $4, status = $3, starts_on = $1::date,
       ends_on = ${periodEndsOn("$1")},
       visits_remaining = COALESCE($5, p.visits)
     FROM plans p
     WHERE p.id = $4 AND m.id = $6`,
    [f.startsOn, f.userId, f.status, f.planId, visitsRemaining, id],
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

  let userId: string | undefined;
  try {
    const { rows } = await db().query<{ user_id: string }>(
      "DELETE FROM memberships WHERE id = $1 RETURNING user_id",
      [id],
    );
    if (rows.length === 0) return { error: "Unknown membership." };
    userId = rows[0].user_id;
  } catch (err) {
    if (hasPgCode(err, "23503")) {
      return {
        error:
          "This membership has payments recorded against it and cannot be deleted. Set it to inactive instead.",
      };
    }
    throw err;
  }

  revalidatePath(`/members/${userId}`);
  revalidatePath("/memberships");
  redirect("/memberships");
}
