import { authenticate, mintToken } from "@/lib/auth";
import {
  clearRateLimit,
  clientIp,
  rateLimit,
  retryMessage,
} from "@/lib/rate-limit";

/**
 * Logs a member or an admin in and returns a token for the mobile app. The
 * token goes in the body rather than a cookie, because the app keeps it in
 * expo-secure-store.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") {
    return Response.json(
      { error: "Συμπλήρωσε email και κωδικό." },
      { status: 400 },
    );
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) {
    return Response.json(
      { error: "Συμπλήρωσε email και κωδικό." },
      { status: 400 },
    );
  }

  // Same bucket as the web login form.
  const bucket = `login:${clientIp(request.headers)}:${normalized}`;
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

  const session = await authenticate(normalized, password);
  if (!session) {
    return Response.json({ error: "Λάθος email ή κωδικός." }, { status: 401 });
  }

  clearRateLimit(bucket);
  return Response.json({ token: await mintToken(session) });
}
