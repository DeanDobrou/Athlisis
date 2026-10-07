import "server-only";

import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type { Queryable } from "@/lib/bookings";
import { db } from "@/lib/db";
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

/** Reads a session out of a JWT, or null if it is missing or not valid. */
export async function readToken(
  token: string | undefined,
): Promise<Session | null> {
  if (!token) return null;

  const key = signingKey();

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== undefined) return null;

    const role = payload.role;
    if (role !== "admin" && role !== "member") return null;

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    // Tokens minted before the column existed carry no claim and count as 0.
    const tokenVersion = payload.tokenVersion ?? 0;
    if (typeof tokenVersion !== "number" || !Number.isSafeInteger(tokenVersion)) {
      return null;
    }

    return { userId, role, tokenVersion };
  } catch {
    return null;
  }
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

  const { rows } = await runner.query<{ role: Role }>(
    `SELECT role FROM users
     WHERE id = $1 AND status = 'active' AND token_version = $2`,
    [session.userId, session.tokenVersion],
  );
  if (rows.length === 0) return null;

  return {
    userId: session.userId,
    role: rows[0].role,
    tokenVersion: session.tokenVersion,
  };
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

  const { rows: saved } = await runner.query<{
    role: Role;
    token_version: number;
  }>(
    `UPDATE users SET password_hash = $1, must_change_password = false,
       token_version = token_version + 1
     WHERE id = $2 AND password_hash = $3
     RETURNING role, token_version`,
    [await hashPassword(next), userId, rows[0].password_hash],
  );
  if (!saved[0]) {
    return {
      ok: false,
      error: "Ο κωδικός μόλις άλλαξε από άλλο αίτημα, οπότε αυτή η αλλαγή δεν έγινε.",
    };
  }
  const token = await mintToken({
    userId,
    role: saved[0].role,
    tokenVersion: saved[0].token_version,
  });
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
  if (!setPasswordToken) return expired;

  const key = signingKey();
  let userId: number;
  let tokenVersion: unknown;
  try {
    const { payload } = await jwtVerify(setPasswordToken, key, {
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "set-password") return expired;
    userId = Number(payload.sub);
    tokenVersion = payload.tokenVersion;
  } catch {
    return expired;
  }
  if (typeof tokenVersion !== "number") return expired;

  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem, signInAgain: false };

  const { rows } = await runner.query<{ role: Role; token_version: number }>(
    `UPDATE users SET password_hash = $1, must_change_password = false,
       token_version = token_version + 1
     WHERE id = $2 AND status = 'active' AND must_change_password
       AND token_version = $3
     RETURNING role, token_version`,
    [await hashPassword(next), userId, tokenVersion],
  );
  if (!rows[0]) return expired;

  const token = await mintToken({
    userId,
    role: rows[0].role,
    tokenVersion: rows[0].token_version,
  });
  return { ok: true, token };
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

  const { rows: saved } = await client.query<{ role: Role; token_version: number }>(
    `UPDATE users SET password_hash = $1, must_change_password = false,
       token_version = token_version + 1
     WHERE id = $2
     RETURNING role, token_version`,
    [await hashPassword(next), userId],
  );
  const token = await mintToken({
    userId,
    role: saved[0].role,
    tokenVersion: saved[0].token_version,
  });
  return { ok: true, token };
}
