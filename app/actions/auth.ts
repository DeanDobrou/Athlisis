"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { clearRateLimit, rateLimit } from "@/lib/rate-limit";
import { createSession, destroySession, type Role } from "@/lib/session";

export type LoginState = { error: string } | undefined;

const decoyHash = hashPassword(randomBytes(32).toString("hex"));

type UserRow = {
  id: string;
  password_hash: string;
  role: Role;
  status: "active" | "inactive";
};

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const forwarded = (await headers()).get("x-forwarded-for");
  // Rightmost entry: appended by our own proxy. Everything left of it is
  // client-supplied, so keying on it would let forged headers dodge the limit.
  const ip = forwarded?.split(",").at(-1)?.trim() || "local";
  const bucket = `login:${ip}:${email}`;

  const limit = rateLimit(bucket);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    const unit = minutes === 1 ? "minute" : "minutes";
    return { error: `Too many attempts. Try again in ${minutes} ${unit}.` };
  }

  const { rows } = await db().query<UserRow>(
    "SELECT id, password_hash, role, status FROM users WHERE lower(email) = $1",
    [email],
  );
  const user = rows[0];

  const passwordOk = await verifyPassword(
    password,
    user ? user.password_hash : await decoyHash,
  );

  // One message for every failure. Saying "no such account" would turn this
  // form into a way to discover which emails are registered.
  const ok =
    Boolean(user) &&
    passwordOk &&
    user.status === "active" &&
    user.role === "admin";

  if (!ok) {
    return { error: "Invalid email or password." };
  }

  clearRateLimit(bucket);
  await createSession({ userId: Number(user.id), role: user.role });

  // Outside any try/catch: redirect() signals by throwing, and a catch would
  // swallow it and silently leave the user on the login page.
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
