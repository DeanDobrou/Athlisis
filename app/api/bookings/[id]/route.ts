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
  if (!session) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const id = parseId((await params).id);
  if (id === null) {
    return Response.json({ error: "Άγνωστη κράτηση." }, { status: 400 });
  }

  const result = await withTransaction((client) =>
    cancelBooking(client, id, session.userId),
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 409 });
  }

  if (result.unpaidLeftCents === null) return Response.json({ ok: true });
  return Response.json({
    ok: true,
    notice: `Η κράτηση ακυρώθηκε. Χρωστάς ακόμη ${formatMoney(result.unpaidLeftCents)} για τη συνδρομή σου, οπότε νέα κράτηση γίνεται αφού πληρώσεις ή μιλήσεις με τη γραμματεία.`,
  });
}
