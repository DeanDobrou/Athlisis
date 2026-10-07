import { issuePasswordReset } from "@/lib/auth";
import { sendCode } from "@/lib/email-codes";
import { clientIp, rateLimit, retryMessage } from "@/lib/rate-limit";

/**
 * Emails a code for setting a new password. Answers the same for an address
 * with no account, so it cannot be used to find out who is a member.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }

  const { email } = (body ?? {}) as Record<string, unknown>;
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized) {
    return Response.json({ error: "Συμπλήρωσε το email σου." }, { status: 400 });
  }

  const limit = rateLimit(`reset:${clientIp(request.headers)}:${normalized}`);
  if (!limit.allowed) {
    return Response.json(
      { error: retryMessage(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // ponytail: a real account takes longer to answer (the send), and a failed
  // send is reported. Queue the send if telling members apart ever matters.
  const issued = await issuePasswordReset(normalized);
  if (issued) {
    try {
      await sendCode(issued.email, "password_reset", issued.code);
    } catch (err) {
      console.error("password reset email failed", err);
      return Response.json(
        { error: "Το email δεν στάλθηκε. Δοκίμασε ξανά σε λίγο." },
        { status: 503 },
      );
    }
  }
  return Response.json({ ok: true });
}
