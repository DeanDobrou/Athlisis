import { fail, jsonBody, signedOut, throttled } from "@/lib/api";
import { changePassword, requireUser } from "@/lib/auth";
import { clearRateLimit, rateLimit } from "@/lib/rate-limit";

/**
 * Changes the signed-in user's password and returns the replacement token.
 * A wrong current password is a 400, never a 401, so the app does not treat
 * it as being signed out.
 */
export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) return signedOut();

  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return fail("Συμπλήρωσε τον τρέχοντα και τον νέο κωδικό.");
  }

  const bucket = `password:${session.userId}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) return throttled(limit);

  const result = await changePassword(
    session.userId,
    currentPassword,
    newPassword,
  );
  if (!result.ok) return fail(result.error);

  clearRateLimit(bucket);
  return Response.json({ token: result.token });
}
