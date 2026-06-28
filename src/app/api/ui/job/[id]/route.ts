/**
 * GET /api/ui/job/:id
 *
 * Browser-facing proxy in front of GET /api/transcribe/:id. Injects
 * the bearer token server-side. See /api/ui/submit for v1 auth note.
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const token = process.env.ADMIN_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Service misconfigured: ADMIN_BEARER_TOKEN not set" },
      { status: 500 }
    );
  }

  const { id } = await ctx.params;
  if (!/^[a-z0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ error: "Bad job id" }, { status: 400 });
  }

  const upstream = new URL(`/api/transcribe/${id}`, req.nextUrl.origin);
  const res = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
