import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { mintToken, readToken, type Session } from "@/lib/auth";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "session";

const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export async function createSession(session: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await mintToken(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export const getSession = cache(
  async (): Promise<Session | null> =>
    readToken((await cookies()).get(SESSION_COOKIE)?.value),
);

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
    `SELECT 1 FROM users
     WHERE id = $1 AND role = 'admin' AND status = 'active'
       AND token_version = $2`,
    [session.userId, session.tokenVersion],
  );
  if (rows.length === 0) redirect("/login");

  return session;
}
