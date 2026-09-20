import { requireUser } from "@/lib/auth";
import { getMember } from "@/lib/members";

/** The signed-in user's own details. */
export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const member = await getMember(String(session.userId));
  if (!member) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  return Response.json(member);
}
