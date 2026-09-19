import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";

export const SESSION_COOKIE = "session";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type Role = "member" | "admin";
export type Session = { userId: number; role: Role };

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
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
    .sign(signingKey());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
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

  const { rows } = await db().query(
    "SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND status = 'active'",
    [session.userId],
  );
  if (rows.length === 0) redirect("/login");

  return session;
}
