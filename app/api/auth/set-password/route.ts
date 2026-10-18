import { fail, jsonBody } from "@/lib/api";
import { bearerToken, setFirstPassword } from "@/lib/auth";

/**
 * Sets a member's own password with the setPasswordToken from login, and
 * returns a normal token. A 401 means that token expired or was already used,
 * so the app goes back to the login screen.
 */
export async function POST(request: Request) {
  const body = await jsonBody(request);
  if (!body) return fail("Μη έγκυρο αίτημα.");
  const { newPassword } = body;
  if (typeof newPassword !== "string") return fail("Συμπλήρωσε τον νέο κωδικό.");

  const result = await setFirstPassword(bearerToken(request), newPassword);
  if (!result.ok) return fail(result.error, result.signInAgain ? 401 : 400);

  return Response.json({ token: result.token });
}
