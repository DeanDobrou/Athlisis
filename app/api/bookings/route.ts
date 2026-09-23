import { requireUser } from "@/lib/auth";
import { bookMember } from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { parseId } from "@/lib/utils";

/**
 * Books the signed-in member into a class. With no coverage it answers 409
 * with confirm: true and the price, and books only when the request is sent
 * again with confirm: true.
 */
export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }
  const { classId, confirm } = (body ?? {}) as Record<string, unknown>;
  const id = parseId(String(classId ?? ""));
  if (id === null) {
    return Response.json({ error: "Άγνωστο μάθημα." }, { status: 400 });
  }

  const result = await withTransaction((client) =>
    bookMember(client, session.userId, id, { confirmUnpaid: confirm === true }),
  );
  if (!result.ok) {
    return Response.json(
      result.confirmUnpaidCents === undefined
        ? { error: result.error }
        : {
            error: result.error,
            confirm: true,
            amountCents: result.confirmUnpaidCents,
          },
      { status: 409 },
    );
  }

  return Response.json({ id: result.bookingId }, { status: 201 });
}
