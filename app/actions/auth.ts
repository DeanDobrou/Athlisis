"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { logIn } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error: string } | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // Admins only: the dashboard has no member side.
  const result = await logIn(
    formData.get("email"),
    formData.get("password"),
    clientIp(await headers()),
    "admin",
  );
  if (!result.ok) return { error: result.error };

  await createSession(result.session);

  // Outside any try/catch: redirect() signals by throwing, and a catch would
  // swallow it and silently leave the user on the login page.
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
