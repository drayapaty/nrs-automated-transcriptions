/**
 * Auth gate. Allows unauthenticated access only to:
 *   - /signin/*           sign-in pages (incl. check-email, error)
 *   - /api/auth/*         NextAuth endpoints (magic-link callback, etc.)
 *   - /api/health         service health probe
 *   - /favicon.ico        static
 *   - /_next/*            Next assets (handled by config.matcher exclusion)
 *
 * Everything else (the admin UI, /api/ui/*, /api/transcribe, /api/jobs,
 * download endpoints) requires a session. Unauthed requests get redirected
 * to /signin for HTML routes, or 401 JSON for API routes.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";

const PUBLIC_PREFIXES = ["/signin", "/api/auth", "/api/health"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default auth((req: NextRequest & { auth?: unknown }) => {
  const { pathname } = req.nextUrl;
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

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)).*)",
  ],
};
