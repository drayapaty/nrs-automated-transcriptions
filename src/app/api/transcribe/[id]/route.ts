/**
 * GET /api/transcribe/:id  → poll job status / fetch result.
 *
 * Same shape as /api/jobs/:id. Exists so the caller can keep one
 * consistent /api/transcribe URL family for both creation and polling.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getJob } from "@/lib/jobs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "Job not found", job_id: id },
      { status: 404 }
    );
  }
  return NextResponse.json(job);
}
