/**
 * Debug endpoint — returns what the server-side auth() sees AND a list
 * of all cookies attached to the request, so we can compare with what
 * the middleware sees. TODO: delete after auth flow is verified.
 */
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  const cookieNames = req.cookies.getAll().map((c) => c.name);
  return NextResponse.json({
    serverAuth: session,
    cookieNames,
    hasSessionCookie: cookieNames.some((n) =>
      n.endsWith("authjs.session-token")
    ),
    headers: {
      host: req.headers.get("host"),
      origin: req.headers.get("origin"),
    },
  });
}
