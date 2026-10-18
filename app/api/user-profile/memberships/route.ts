import { fail, signedOut } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { memberHistory } from "@/lib/memberships";

/**
 * The signed-in member's past memberships, newest first, a page at a time.
 * The `next` of one reply, sent back as `?before=`, gets the page after it.
 */
export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) return signedOut();

  const before = new URL(request.url).searchParams.get("before");
  const page = await memberHistory(session.userId, before);
  if (!page) return fail("Μη έγκυρο αίτημα.");

  return Response.json(page, { headers: { "Cache-Control": "private, no-cache" } });
}
