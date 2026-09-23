import { changePassword, requireUser } from "@/lib/auth";
import {
  clearRateLimit,
  rateLimit,
  retryMessage,
} from "@/lib/rate-limit";

/**
 * Changes the signed-in user's password and returns the replacement token.
 * A wrong current password is a 400, never a 401, so the app does not treat
 * it as being signed out.
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
  const { currentPassword, newPassword } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return Response.json(
      { error: "Συμπλήρωσε τον τρέχοντα και τον νέο κωδικό." },
      { status: 400 },
    );
  }

  const bucket = `password:${session.userId}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) {
    return Response.json(
      { error: retryMessage(limit.retryAfterSeconds) },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const result = await changePassword(
    session.userId,
    currentPassword,
    newPassword,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  clearRateLimit(bucket);
  return Response.json({ token: result.token });
}
