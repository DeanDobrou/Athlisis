import { fail, jsonBody, signedOut, throttled } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendCode } from "@/lib/email-codes";
import { issueEmailChange } from "@/lib/members";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Starts an email change: checks the current password and emails a code to
 * the new address. The account keeps its email until the code is confirmed at
 * POST /api/user-profile/email/confirm.
 */
export async function POST(request: Request) {
  const session = await requireUser(request);
  if (!session) return signedOut();

  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string") {
    return fail("Συμπλήρωσε το νέο email και τον κωδικό σου.");
  }

  const limit = rateLimit(`email-change:${session.userId}`);
  if (!limit.allowed) return throttled(limit);

  const issued = await issueEmailChange(db(), session.userId, email, password);
  if (!issued.ok) return fail(issued.error);

  try {
    await sendCode(issued.email, "email_change", issued.code);
  } catch (err) {
    console.error("email change code failed", err);
    return fail("Το email δεν στάλθηκε. Δοκίμασε ξανά σε λίγο.", 503);
  }
  return Response.json({ ok: true });
}
