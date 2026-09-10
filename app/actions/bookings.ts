"use server";

import { revalidatePath } from "next/cache";

import { bookMember, cancelBooking, moveBooking } from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

/**
 * What the bookings board gets back. These are called directly by the board,
 * not through forms, and never throw on a refusal: the board puts a moved or
 * cancelled member back where they were and shows the reason.
 */
export type BoardResult = { ok: true; notice?: string } | { error: string };

// The rules themselves are all in lib/bookings.ts; these only parse input,
// check the caller is an admin, and pick what to refresh.

export async function bookMemberAction(
  userId: string,
  sessionId: string,
): Promise<BoardResult> {
  const admin = await requireAdmin();

  const member = parseId(userId);
  if (member === null) return { error: "Διάλεξε μέλος." };
  const session = parseId(sessionId);
  if (session === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction((client) =>
    bookMember(client, member, session, admin.userId),
  );
  if (!result.ok) return { error: result.error };

  // A booking spends a visit or creates a membership, so the ledger and the
  // member's page change along with the board.
  revalidatePath("/bookings");
  revalidatePath("/memberships");
  revalidatePath(`/members/${member}`);

  return result.createdMembership
    ? {
        ok: true,
        notice:
          "Έγινε η κράτηση. Το μέλος δεν είχε κάλυψη, οπότε δημιουργήθηκε ανεξόφλητη συνδρομή που πληρώνεται στην είσοδο.",
      }
    : { ok: true };
}

export async function cancelBookingAction(
  bookingId: string,
): Promise<BoardResult> {
  await requireAdmin();

  const id = parseId(bookingId);
  if (id === null) return { error: "Άγνωστη κράτηση." };

  const result = await withTransaction((client) => cancelBooking(client, id));
  if (!result.ok) return { error: result.error };

  // Cancelling returns a visit, so the ledger changes too.
  revalidatePath("/bookings");
  revalidatePath("/memberships");
  return { ok: true };
}

export async function moveBookingAction(
  bookingId: string,
  targetSessionId: string,
): Promise<BoardResult> {
  await requireAdmin();

  const id = parseId(bookingId);
  if (id === null) return { error: "Άγνωστη κράτηση." };
  const target = parseId(targetSessionId);
  if (target === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction((client) =>
    moveBooking(client, id, target),
  );
  if (!result.ok) return { error: result.error };

  // A move changes no membership or visit, only which class holds the member.
  revalidatePath("/bookings");
  return { ok: true };
}
