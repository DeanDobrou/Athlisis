import { fail, jsonBody, throttled } from "@/lib/api";
import { resetPassword } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { clearRateLimit, rateLimit } from "@/lib/rate-limit";

/** Sets a new password with the code from the email, and returns a token that signs the member in. */
export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");

  const { email, code, password } = body;
  if (
    typeof email !== "string" ||
    typeof code !== "string" ||
    typeof password !== "string"
  ) {
    return fail("Συμπλήρωσε τον κωδικό από το email και τον νέο κωδικό.");
  }

  // Per account, not per IP: a 6-digit code must not get 10 guesses from every
  // address an attacker controls. The cost: someone can stall one reset for 15 minutes.
  const bucket = `reset-code:${email.trim().toLowerCase()}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) return throttled(limit);

  const result = await withTransaction((client) =>
    resetPassword(client, email, code, password),
  );
  if (!result.ok) return fail(result.error);

  clearRateLimit(bucket);
  return Response.json({ token: result.token });
}
