import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";

export const SESSION_COOKIE = "session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

export type Role = "member" | "admin";
export type Session = { userId: number; role: Role };

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  // A short HS256 key is offline-brute-forceable from a single captured
  // cookie; fail loudly instead of minting weak admin tokens.
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(session.userId))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(signingKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Memoized per request, so several components can ask without re-verifying. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Resolved outside the try: a missing or too-short SESSION_SECRET is a
  // deployment fault, and catching it here would turn it into every user
  // silently bouncing to /login instead of a loud startup error.
  const key = signingKey();

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });

    const role = payload.role;
    if (role !== "admin" && role !== "member") return null;

    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) return null;

    return { userId, role };
  } catch {
    return null;
  }
});

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The real gate. proxy.ts only reads the cookie; every admin page and every
 * admin action calls this, because a Server Action is a separate entry point
 * that a page-level check does not cover.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/login");

  // The JWT alone is not enough: an admin deactivated (or demoted) mid-session
  // keeps a valid cookie for up to 8 hours. One indexed read closes that window.
  const { rows } = await db().query(
    "SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND status = 'active'",
    [session.userId],
  );
  if (rows.length === 0) redirect("/login");

  return session;
}
