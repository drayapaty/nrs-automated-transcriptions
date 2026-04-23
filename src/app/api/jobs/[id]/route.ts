/**
 * GET /api/jobs/:id  → poll job status / fetch result.
 *
 * Response:
 *   {
 *     job_id, status, progress: { stage, pct, message? },
 *     created_at, updated_at, finished_at?,
 *     result?: { transcript_en, translations?, metadata },
 *     error?: string
 *   }
 *
 * 404 if no such job.
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
