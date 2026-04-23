import { NextRequest, NextResponse } from "next/server";

/**
 * Bearer token auth check. Admin sends `Authorization: Bearer <token>`.
 * The expected token is in env `ADMIN_BEARER_TOKEN`.
 *
 * Returns null if authorized, or a NextResponse 401 if not.
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_BEARER_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Service misconfigured: ADMIN_BEARER_TOKEN not set" },
      { status: 500 }
    );
  }

  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || m[1] !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
