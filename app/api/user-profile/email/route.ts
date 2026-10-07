import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendCode } from "@/lib/email-codes";
import { issueEmailChange } from "@/lib/members";
import { rateLimit, retryMessage } from "@/lib/rate-limit";

/**
 * Starts an email change: checks the current password and emails a code to
 * the new address. The account keeps its email until the code is confirmed at
 * POST /api/user-profile/email/confirm.
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
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json(
      { error: "Συμπλήρωσε το νέο email και τον κωδικό σου." },
      { status: 400 },
    );
  }

  const limit = rateLimit(`email-change:${session.userId}`);
  if (!limit.allowed) {
    return Response.json(
      { error: retryMessage(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const issued = await issueEmailChange(db(), session.userId, email, password);
  if (!issued.ok) {
    return Response.json({ error: issued.error }, { status: 400 });
  }

  try {
    await sendCode(issued.email, "email_change", issued.code);
  } catch (err) {
    console.error("email change code failed", err);
    return Response.json(
      { error: "Το email δεν στάλθηκε. Δοκίμασε ξανά σε λίγο." },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}
