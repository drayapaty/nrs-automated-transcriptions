/**
 * Auth gate (Edge runtime). Public:
 *   /signin/*, /api/auth/*, /api/health, static assets
 * Everything else requires a session.
 * Unauthed HTML → redirect /signin; unauthed API → 401 JSON.
 *
 * Uses edge-safe authConfig (no adapter import) — full config with
 * DynamoDB adapter is in src/auth.ts (server-only). Importing
 * src/auth.ts here would drag the AWS SDK into the Edge bundle and
 * Vercel cannot ship that — the middleware ends up with no detectable
 * default export and every request 500s.
 */

import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

// Public = user not required to have a session cookie. The session-gated
// surface is the admin UI itself (`/`, `/api/ui/*`). The "worker" APIs
// below are protected by `ADMIN_BEARER_TOKEN` and are called both by
// the user-facing proxy routes (server-to-server, no cookie) and by
// background jobs. They MUST stay accessible without a session cookie
// or the proxy chain returns 401 to the browser.
const PUBLIC_PREFIXES = [
  "/signin",
  "/api/auth",
  "/api/health",
  "/api/debug-auth",
  "/api/transcribe",
  "/api/jobs",
  "/api/lectures",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

const handler = auth((req) => {
  const { pathname } = req.nextUrl;
  // TEMP DEBUG — remove after auth issue resolved
  const cookieNames = req.cookies.getAll().map((c) => c.name);
  const hasSessionCookie = cookieNames.some((n) =>
    n.endsWith("authjs.session-token")
  );
  console.log(
    `[mw] ${req.method} ${pathname} auth=${!!req.auth} hasCookie=${hasSessionCookie} cookies=${cookieNames.join(",")}`
  );
  if (isPublic(pathname)) return NextResponse.next();
  if (req.auth) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?callbackUrl=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
});

export default handler;
export const middleware = handler;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)",
  ],
};
