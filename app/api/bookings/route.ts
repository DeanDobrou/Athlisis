import { fail, jsonBody, signedOut } from "@/lib/api";
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
  if (!session) return signedOut();

  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");
  const id = parseId(String(body.classId ?? ""));
  if (id === null) return fail("Άγνωστο μάθημα.");

  const result = await withTransaction((client) =>
    bookMember(client, session.userId, id, {
      confirmUnpaid: body.confirm === true,
    }),
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
