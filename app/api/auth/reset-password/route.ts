import { resetPassword } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import {
  clearRateLimit,
  clientIp,
  rateLimit,
  retryMessage,
} from "@/lib/rate-limit";

/** Sets a new password with the code from the email, and returns a token that signs the member in. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }

  const { email, code, password } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof email !== "string" ||
    typeof code !== "string" ||
    typeof password !== "string"
  ) {
    return Response.json(
      { error: "Συμπλήρωσε τον κωδικό από το email και τον νέο κωδικό." },
      { status: 400 },
    );
  }

  const bucket = `reset-code:${clientIp(request.headers)}:${email.trim().toLowerCase()}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) {
    return Response.json(
      { error: retryMessage(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await withTransaction((client) =>
    resetPassword(client, email, code, password),
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  clearRateLimit(bucket);
  return Response.json({ token: result.token });
}
