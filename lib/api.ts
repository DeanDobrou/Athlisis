import { type RateLimitResult, retryMessage } from "@/lib/rate-limit";

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
