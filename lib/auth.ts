import "server-only";

import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { db, type Queryable } from "@/lib/db";
import { issueCode, spendCode } from "@/lib/email-codes";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";

export type Role = "member" | "admin";
export type Session = { userId: number; role: Role; tokenVersion: number };

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

const decoyHash = hashPassword(randomBytes(32).toString("hex"));

/**
 * Checks an email and password and returns the session, or null. Pass a role
 * to require it; leave it out to accept any role. The email is trimmed and
 * matched case-insensitively. `mustChangePassword` is set while the account
 * still has a password somebody else chose.
 */
export async function authenticate(
  email: string,
  password: string,
  role?: Role,
  runner: Queryable = db(),
): Promise<(Session & { mustChangePassword: boolean }) | null> {
  const { rows } = await runner.query<{
    id: string;
    password_hash: string;
    role: Role;
    status: "active" | "inactive";
    token_version: number;
    must_change_password: boolean;
  }>(
    `SELECT id, password_hash, role, status, token_version,
            must_change_password
     FROM users WHERE lower(email) = $1`,
    [email.trim().toLowerCase()],
  );
  const user = rows[0];

  // Unknown email: verify against a decoy, so the reply takes the same time.
  const passwordOk = await verifyPassword(
    password,
    user ? user.password_hash : await decoyHash,
  );

  if (!user || !passwordOk) return null;
  if (user.status !== "active") return null;
  if (role && user.role !== role) return null;

  return {
    userId: Number(user.id),
    role: user.role,
    tokenVersion: user.token_version,
    mustChangePassword: user.must_change_password,
  };
}

/** Whether a change to a user's row should end the sessions they have open. */
export function endsSessions(
  passwordChanged: boolean,
  newStatus: string | null,
): boolean {
  return passwordChanged || newStatus === "inactive";
}

/** Signs a session into a JWT. It carries no expiry claim. */
export function mintToken(session: Session): Promise<string> {
  return new SignJWT({ role: session.role, tokenVersion: session.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.userId))
    .setIssuedAt()
    .sign(signingKey());
}

/** A token that expires in 15 minutes and can only set a new password. */
export function mintSetPasswordToken(session: Session): Promise<string> {
  return new SignJWT({
    purpose: "set-password",
    tokenVersion: session.tokenVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.userId))
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(signingKey());
}

/** A JWT's user, token_version and role claim, or null if it is missing, not valid, or made for another purpose. */
async function verify(
  token: string | undefined,
  purpose?: string,
): Promise<{ userId: number; tokenVersion: number; role: unknown } | null> {
  if (!token) return null;

  const key = signingKey();

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== purpose) return null;

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    // Tokens minted before the column existed carry no claim and count as 0.
    const tokenVersion = payload.tokenVersion ?? 0;
    if (!Number.isSafeInteger(tokenVersion)) return null;

    return { userId, tokenVersion: tokenVersion as number, role: payload.role };
  } catch {
    return null;
  }
}

/** Reads a session out of a JWT, or null if it is missing or not valid. */
export async function readToken(
  token: string | undefined,
): Promise<Session | null> {
  const claims = await verify(token);
  if (!claims) return null;

  const { userId, tokenVersion, role } = claims;
  if (role !== "admin" && role !== "member") return null;
  return { userId, role, tokenVersion };
}

/** The user's current role, or null once the account is inactive or the session's token_version is stale. */
export async function liveRole(
  session: Session,
  runner: Queryable = db(),
): Promise<Role | null> {
  const { rows } = await runner.query<{ role: Role }>(
    `SELECT role FROM users
     WHERE id = $1 AND status = 'active' AND token_version = $2`,
    [session.userId, session.tokenVersion],
  );
  return rows[0]?.role ?? null;
}

/** The token from an `Authorization: Bearer ...` header, if there is one. */
export function bearerToken(request: Request): string | undefined {
  const [scheme, value] = (request.headers.get("authorization") ?? "").split(
    " ",
  );
  return scheme?.toLowerCase() === "bearer" ? value : undefined;
}

/**
 * Reads the bearer token off a request and confirms the account is still
 * active, returning the session with its current role. Every handler under
 * /api calls it, because the matcher in proxy.ts skips /api.
 */
export async function requireUser(
  request: Request,
  runner: Queryable = db(),
): Promise<Session | null> {
  const session = await readToken(bearerToken(request));
  if (!session) return null;

  const role = await liveRole(session, runner);
  return role ? { ...session, role } : null;
}

/**
 * Saves a new password, raises token_version to sign every other device out,
 * and returns a fresh token. `guard` adds SQL conditions (its value is $3);
 * null when they no longer match.
 */
async function replacePassword(
  runner: Queryable,
  userId: number,
  next: string,
  guard = "",
  guardValue?: unknown,
): Promise<string | null> {
  const { rows } = await runner.query<{ role: Role; token_version: number }>(
    `UPDATE users SET password_hash = $1, must_change_password = false,
       token_version = token_version + 1
     WHERE id = $2 ${guard}
     RETURNING role, token_version`,
    [await hashPassword(next), userId, ...(guard ? [guardValue] : [])],
  );
  if (!rows[0]) return null;

  return mintToken({
    userId,
    role: rows[0].role,
    tokenVersion: rows[0].token_version,
  });
}

/**
 * Replaces a user's password after checking the current one, and returns a
 * fresh token. Raising token_version signs every other device out. If another
 * change lands between the check and the save, this one changes nothing.
 */
export async function changePassword(
  userId: number,
  current: string,
  next: string,
  runner: Queryable = db(),
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };

  const { rows } = await runner.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1 AND status = 'active'",
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
    return { ok: false, error: "Ο τρέχων κωδικός είναι λάθος." };
  }

  const token = await replacePassword(
    runner,
    userId,
    next,
    "AND password_hash = $3",
    rows[0].password_hash,
  );
  if (!token) {
    return {
      ok: false,
      error: "Ο κωδικός μόλις άλλαξε από άλλο αίτημα, οπότε αυτή η αλλαγή δεν έγινε.",
    };
  }
  return { ok: true, token };
}

/**
 * Replaces a password somebody else chose, using the token login returned for
 * it, and returns a normal token. `signInAgain` means the token has expired or
 * was already used, so the app should go back to the login screen.
 */
export async function setFirstPassword(
  setPasswordToken: string | undefined,
  next: string,
  runner: Queryable = db(),
): Promise<
  { ok: true; token: string } | { ok: false; error: string; signInAgain: boolean }
> {
  const expired = {
    ok: false as const,
    error: "Η σύνδεση έληξε. Συνδέσου ξανά με τον κωδικό που σου δόθηκε.",
    signInAgain: true,
  };
  const claims = await verify(setPasswordToken, "set-password");
  if (!claims) return expired;

  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem, signInAgain: false };

  const token = await replacePassword(
    runner,
    claims.userId,
    next,
    "AND status = 'active' AND must_change_password AND token_version = $3",
    claims.tokenVersion,
  );
  return token ? { ok: true, token } : expired;
}

/**
 * Issues a code for setting a new password, and returns the address to email
 * it to. An address with no active account gets null, and the caller must
 * answer exactly as it does for one that has.
 */
export async function issuePasswordReset(
  email: string,
  runner: Queryable = db(),
): Promise<{ email: string; code: string } | null> {
  const { rows } = await runner.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE lower(email) = $1 AND status = 'active'",
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user) return null;
  const code = await issueCode(runner, Number(user.id), "password_reset", user.email);
  return { email: user.email, code };
}

/**
 * Sets a new password with an emailed code and returns a token, signing every
 * other device out. A wrong, expired or exhausted code is refused exactly like
 * an address with no account. Runs inside a transaction that commits a refusal
 * too, so wrong guesses are counted.
 */
export async function resetPassword(
  client: Queryable,
  email: string,
  code: string,
  next: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };

  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 AND status = 'active'
     FOR UPDATE`,
    [email.trim().toLowerCase()],
  );
  const userId = Number(rows[0]?.id);
  if (!rows[0] || (await spendCode(client, userId, "password_reset", code)) === null) {
    return { ok: false, error: "Ο κωδικός είναι λάθος ή έχει λήξει." };
  }

  // The row is locked above, so the save always lands.
  const token = await replacePassword(client, userId, next);
  return token
    ? { ok: true, token }
    : { ok: false, error: "Ο κωδικός είναι λάθος ή έχει λήξει." };
}
