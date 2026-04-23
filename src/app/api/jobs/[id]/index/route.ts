/**
 * POST /api/jobs/:id/index
 *
 * Index a completed job's English transcript into OpenSearch.
 * Use this when you initially created a job with `index: false` and now want
 * to push it into the search index.
 *
 * Body:  { metadata?: IndexMetadata }   // optional override of job's metadata
 *                                       // (uuid is required somewhere — either
 *                                       // here or already on the job)
 *
 * Response 202: { job_id, status: "indexing" }
 *
 * Always runs in background — caller polls GET /api/jobs/:id for status.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { requireAuth } from "@/lib/auth";
import { getJob, setStatus, setResult, setError } from "@/lib/jobs";
import { indexTranscript } from "@/lib/pipeline/index-opensearch";
import type { IndexMetadata } from "@/lib/types";

const Body = z.object({
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAuth(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.status !== "done" || !job.result?.transcript_en) {
    return NextResponse.json(
      { error: "Job is not done", current_status: job.status },
      { status: 409 }
    );
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* empty body is fine */
  }
  const parsed = Body.safeParse(raw);
  const overrideMeta =
    (parsed.success ? (parsed.data.metadata as IndexMetadata | undefined) : undefined) ?? undefined;

  const finalMetadata: IndexMetadata = {
    ...(job.request.metadata || ({} as IndexMetadata)),
    ...(overrideMeta || {}),
  } as IndexMetadata;

  if (!finalMetadata.uuid) {
    return NextResponse.json(
      { error: "metadata.uuid required (none on job and none in body)" },
      { status: 400 }
    );
  }

  const englishText = job.result.transcript_en;

  async function doIndex() {
    try {
      await setStatus(id, "indexing", { stage: "indexing", pct: 50 });
      const result = await indexTranscript(englishText, finalMetadata);
      await setResult(id, {
        ...job!.result!,
        metadata: {
          ...job!.result!.metadata,
          indexed_chunks: result.indexed,
        },
      });
    } catch (err) {
      await setError(id, `Indexing failed: ${(err as Error).message}`);
    }
  }

  waitUntil(doIndex());
  return NextResponse.json(
    { job_id: id, status: "indexing", poll_url: `/api/jobs/${id}` },
    { status: 202 }
  );
}
