import "server-only";

import { randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type { Queryable } from "@/lib/bookings";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

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
 * matched case-insensitively.
 */
export async function authenticate(
  email: string,
  password: string,
  role?: Role,
  runner: Queryable = db(),
): Promise<Session | null> {
  const { rows } = await runner.query<{
    id: string;
    password_hash: string;
    role: Role;
    status: "active" | "inactive";
    token_version: number;
  }>(
    `SELECT id, password_hash, role, status, token_version
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

/**
 * Reads the bearer token off a request and confirms the account is still
 * active, returning the session with its current role. Every handler under
 * /api calls it, because the matcher in proxy.ts skips /api.
 */
export async function requireUser(
  request: Request,
  runner: Queryable = db(),
): Promise<Session | null> {
  const [scheme, value] = (request.headers.get("authorization") ?? "").split(
    " ",
  );
  const session = await readToken(
    scheme?.toLowerCase() === "bearer" ? value : undefined,
  );
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
