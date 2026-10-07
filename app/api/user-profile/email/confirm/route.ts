import { requireUser } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { confirmEmailChange } from "@/lib/members";
import { clearRateLimit, rateLimit, retryMessage } from "@/lib/rate-limit";

/** Finishes an email change with the code sent to the new address, and returns that address. */
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
  const { code } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string") {
    return Response.json({ error: "Συμπλήρωσε τον κωδικό από το email." }, { status: 400 });
  }

  const bucket = `email-confirm:${session.userId}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) {
    return Response.json(
      { error: retryMessage(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await withTransaction((client) =>
    confirmEmailChange(client, session.userId, code),
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  clearRateLimit(bucket);
  return Response.json({ email: result.email });
}
