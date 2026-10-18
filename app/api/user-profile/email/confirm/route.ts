import { fail, jsonBody, signedOut, throttled } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { confirmEmailChange } from "@/lib/members";
import { clearRateLimit, rateLimit } from "@/lib/rate-limit";

/** Finishes an email change with the code sent to the new address, and returns that address. */
export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) return signedOut();

  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");
  const { code } = body;
  if (typeof code !== "string") return fail("Συμπλήρωσε τον κωδικό από το email.");

  const bucket = `email-confirm:${session.userId}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) return throttled(limit);

  const result = await withTransaction((client) =>
    confirmEmailChange(client, session.userId, code),
  );
  if (!result.ok) return fail(result.error);

  clearRateLimit(bucket);
  return Response.json({ email: result.email });
}
