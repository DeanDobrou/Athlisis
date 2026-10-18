import { fail, jsonBody } from "@/lib/api";
import { logIn, mintSetPasswordToken, mintToken } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

/**
 * Logs a member or an admin in and returns a token for the mobile app. The
 * token goes in the body rather than a cookie, because the app keeps it in
 * expo-secure-store. An account still on a password somebody else chose gets
 * a setPasswordToken instead, for POST /api/auth/set-password.
 */
export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");

  const result = await logIn(body.email, body.password, clientIp(request.headers));
  if (!result.ok) return fail(result.error, result.status, result.retryAfterSeconds);

  if (result.session.mustChangePassword) {
    return Response.json({
      setPasswordToken: await mintSetPasswordToken(result.session),
    });
  }
  return Response.json({ token: await mintToken(result.session) });
}
