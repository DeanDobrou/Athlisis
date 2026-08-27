import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// Self-contained on purpose: proxy runs ahead of the render and should not pull
// in the server-only session module. This is an optimistic check that only reads
// the cookie — never a database call, because it runs on every request including
// link prefetches. The real gate is requireAdmin() in lib/session.ts.
const SESSION_COOKIE = "session";

async function hasAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return false;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    // A member's cookie is a validly signed JWT too (the mobile app shares
    // the secret, spec §4); only an admin claim opens the admin shell.
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  // /login is always reachable, even with a valid cookie. requireAdmin()
  // bounces revoked-but-unexpired sessions here, and a signed-in →
  // /dashboard convenience redirect would turn that bounce into a loop.
  if (request.nextUrl.pathname === "/login") return NextResponse.next();

  if (!(await hasAdminSession(request))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Excluding the static paths matters: guard them and the login page loads
  // with its own CSS redirected away, which looks like a broken app.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
