import { fail, signedOut } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { cancelBooking } from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { parseId } from "@/lib/utils";

/** Cancels one of the signed-in member's own bookings. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireUser(request);
  if (!session) return signedOut();

  const id = parseId((await params).id);
  if (id === null) return fail("Άγνωστη κράτηση.");

  const result = await withTransaction((client) =>
    cancelBooking(client, id, session.userId),
  );
  if (!result.ok) return fail(result.error, 409);

  if (result.unpaidLeftCents === null) return Response.json({ ok: true });
  return Response.json({
    ok: true,
    notice: `Η κράτηση ακυρώθηκε. Χρωστάς ακόμη ${formatMoney(result.unpaidLeftCents)} για τη συνδρομή σου, οπότε νέα κράτηση γίνεται αφού την πληρώσεις.`,
  });
}
