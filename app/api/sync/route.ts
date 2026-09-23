import { createHash } from "node:crypto";

import { requireUser } from "@/lib/auth";
import { memberSchedule } from "@/lib/class-sessions";

/**
 * Everything the app shows, rebuilt on each request. Answers 304 with no body
 * when the app sends back the ETag of a copy that is still current.
 */
export async function GET(request: Request) {
  const session = await requireUser(request);
  if (!session) {
    return Response.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const body = JSON.stringify({
    classes: await memberSchedule(session.userId),
  });
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };

  // Also accepts the weak W/"..." form a compressing proxy may send back.
  if (request.headers.get("if-none-match")?.replace(/^W\//, "") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
