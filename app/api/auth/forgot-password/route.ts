import { fail, jsonBody, throttled } from "@/lib/api";
import { issuePasswordReset } from "@/lib/auth";
import { sendCode } from "@/lib/email-codes";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Emails a code for setting a new password. Answers the same for an address
 * with no account, so it cannot be used to find out who is a member.
 */
export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");

  const normalized =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!normalized) return fail("Συμπλήρωσε το email σου.");

  const limit = rateLimit(`reset:${clientIp(request.headers)}:${normalized}`);
  if (!limit.allowed) return throttled(limit);

  // ponytail: a real account takes longer to answer (the send), and a failed
  // send is reported. Queue the send if telling members apart ever matters.
  const issued = await issuePasswordReset(normalized);
  if (issued) {
    try {
      await sendCode(issued.email, "password_reset", issued.code);
    } catch (err) {
      console.error("password reset email failed", err);
      return fail("Το email δεν στάλθηκε. Δοκίμασε ξανά σε λίγο.", 503);
    }
  }
  return Response.json({ ok: true });
}
