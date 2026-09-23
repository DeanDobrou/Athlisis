"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authenticate } from "@/lib/auth";
import {
  clearRateLimit,
  clientIp,
  rateLimit,
  retryMessage,
} from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error: string } | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Συμπλήρωσε email και κωδικό." };
  }

  const bucket = `login:${clientIp(await headers())}:${email}`;
  const limit = rateLimit(bucket);
  if (!limit.allowed) {
    return { error: retryMessage(limit.retryAfterSeconds) };
  }

  // Admins only: the dashboard has no member side.
  const session = await authenticate(email, password, "admin");
  if (!session) {
    return { error: "Λάθος email ή κωδικός." };
  }

  clearRateLimit(bucket);
  await createSession(session);

  // Outside any try/catch: redirect() signals by throwing, and a catch would
  // swallow it and silently leave the user on the login page.
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
