import { fail, signedOut } from "@/lib/api";
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
  if (!session) return signedOut();

  const id = parseId((await params).id);
  if (id === null) return fail("Άγνωστη κράτηση.");

  const result = await withTransaction((client) =>
    checkInByMember(client, id, session.userId),
  );
  if (!result.ok) return fail(result.error, 409);
  return Response.json({ ok: true });
}
