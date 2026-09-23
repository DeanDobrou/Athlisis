import { bearerToken, setFirstPassword } from "@/lib/auth";

/**
 * Sets a member's own password with the setPasswordToken from login, and
 * returns a normal token. A 401 means that token expired or was already used,
 * so the app goes back to the login screen.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Μη έγκυρο αίτημα." }, { status: 400 });
  }
  const { newPassword } = (body ?? {}) as Record<string, unknown>;
  if (typeof newPassword !== "string") {
    return Response.json(
      { error: "Συμπλήρωσε τον νέο κωδικό." },
      { status: 400 },
    );
  }

  const result = await setFirstPassword(bearerToken(request), newPassword);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.signInAgain ? 401 : 400 },
    );
  }

  return Response.json({ token: result.token });
}
