/**
 * POST /api/ui/submit
 *
 * Browser-facing proxy in front of POST /api/transcribe. Forwards the
 * body and injects the ADMIN_BEARER_TOKEN server-side so the token
 * never lands in the browser.
 *
 * Auth on this route: NONE for v1 staging — the whole admin-v1
 * deployment sits behind Vercel SSO, so anyone who can see the UI is
 * already authorized. v1 release will add NextAuth + Google +
 * email-allowlist per SPEC.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const token = process.env.ADMIN_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Service misconfigured: ADMIN_BEARER_TOKEN not set" },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const upstream = new URL("/api/transcribe", req.nextUrl.origin);
  const res = await fetch(upstream, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
