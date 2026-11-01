import { requireUser, type Session } from "@/lib/auth";
import { db, type Queryable } from "@/lib/db";
import { type RateLimitResult, retryMessage } from "@/lib/rate-limit";
import type { FormError } from "@/lib/utils";

/** A JSON { error } reply. A retry delay also sets Retry-After. */
export function fail(
  error: string,
  status = 400,
  retryAfterSeconds?: number,
): Response {
  return Response.json(
    { error },
    {
      status,
      headers:
        retryAfterSeconds === undefined
          ? undefined
          : { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

/** The 401 the app reads as being signed out. */
export const signedOut = () => fail("Απαιτείται σύνδεση.", 401);

/** The 429 for a rate limit that refused the request. */
export const throttled = (limit: RateLimitResult) =>
  fail(retryMessage(limit.retryAfterSeconds), 429, limit.retryAfterSeconds);

/** The request's JSON body as a record, or null when it is not JSON. */
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    return ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The signed-in admin for a route under /api/admin, or the reply to send back
 * instead: 401 signed out, 403 for anyone who is not an admin.
 */
export async function requireAdminApi(
  request: Request,
  runner: Queryable = db(),
): Promise<Session | Response> {
  const session = await requireUser(request, runner);
  if (!session) return signedOut();
  if (session.role !== "admin") return fail("Μόνο για διαχειριστές.", 403);
  return session;
}

/** A lib refusal as a reply: 400 when it names the field to show it under, 409 when the data refuses it. */
export const refused = (e: FormError) =>
  Response.json(e, { status: e.field ? 400 : 409 });
