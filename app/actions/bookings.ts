"use server";

import { revalidatePath } from "next/cache";

import {
  bookMember,
  cancelBooking,
  moveBooking,
  saveSessionCheckIns,
} from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { parseId } from "@/lib/utils";

export type BoardResult = { ok: true; notice?: string } | { error: string };

export async function bookMemberAction(
  userId: string,
  sessionId: string,
): Promise<BoardResult> {
  await requireAdmin();

  const member = parseId(userId);
  if (member === null) return { error: "Διάλεξε μέλος." };
  const session = parseId(sessionId);
  if (session === null) return { error: "Άγνωστο μάθημα." };

  const result = await withTransaction((client) =>
    bookMember(client, member, session),
  );
  if (!result.ok) return { error: result.error };

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

  revalidatePath("/bookings");
  revalidatePath("/memberships");

  return result.unpaidLeftCents === null
    ? { ok: true }
    : {
        ok: true,
        notice: `Η συνδρομή που την πλήρωνε είναι ανεξόφλητη (${formatMoney(result.unpaidLeftCents)}) και δεν έχει πια κρατήσεις, αλλά μπλοκάρει κάθε νέα κράτηση του μέλους. Αν δεν θα πληρωθεί, διάγραψέ τη από τις Συνδρομές.`,
      };
}

/**
 * Saves one class's roll call. The page sends who is present; the diff against
 * what is stored is worked out in saveSessionCheckIns, inside one transaction.
 */
export async function saveCheckInsAction(
  sessionId: string,
  presentIds: string[],
): Promise<BoardResult> {
  await requireAdmin();

  const session = parseId(sessionId);
  if (session === null) return { error: "Άγνωστο μάθημα." };

  const present = new Set<number>();
  for (const raw of presentIds) {
    const id = parseId(raw);
    if (id === null) return { error: "Άγνωστη κράτηση." };
    present.add(id);
  }

  const { checkedIn, undone, refused } = await withTransaction((client) =>
    saveSessionCheckIns(client, session, present),
  );

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${session}`);

  const saved = `${checkedIn} check-in, ${undone} αναιρέσεις.`;
  return {
    ok: true,
    notice:
      refused.length > 0
        ? `${saved} Δεν άλλαξαν: ${refused.join(", ")} - η κράτηση άλλαξε στο μεταξύ.`
        : saved,
  };
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

  revalidatePath("/bookings");
  return { ok: true };
}
