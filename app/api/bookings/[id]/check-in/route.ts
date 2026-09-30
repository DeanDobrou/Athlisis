import { requireUser } from "@/lib/auth";
import { checkInByMember } from "@/lib/bookings";
import { withTransaction } from "@/lib/db";
import { parseId } from "@/lib/utils";

/** Checks the signed-in member in to one of their own bookings. */
export async function POST(
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
    checkInByMember(client, id, session.userId),
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 409 });
  }
  return Response.json({ ok: true });
}
