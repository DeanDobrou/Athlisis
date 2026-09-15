import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Redirects after a form saved, leaving a note for FlashToast in
 * components/toaster.tsx to say so on the next page. A cookie rather than a
 * ?saved query, so no URL carries it and a reload does not repeat it. Thirty
 * seconds is only long enough to survive the redirect.
 */
export async function redirectSaved(path: string): Promise<never> {
  (await cookies()).set("flash", "saved", {
    path: "/",
    maxAge: 30,
    sameSite: "lax",
  });
  redirect(path);
}
